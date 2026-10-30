/**
 * Orchestrates one report in Canva:
 *   upload photos (create-upload-url + POST)  ->  copy-design (template)
 *   -> start-editing-transaction -> perform-editing-operations (page by page)
 *   -> commit-editing-transaction.
 * Any failure after the transaction started cancels it. Photos are uploaded
 * first so a network problem never leaves an orphaned copy behind (the MCP
 * server has no delete tool); if a later step fails, the copy's id is logged.
 */
import { CANVA, type ReportType } from '../../shared/config';
import { buildTitle, type ReportForm } from '../../shared/report';
import { buildEditBatches } from './ops';
import { assertOperationsApplied, CanvaToolError, parseCopyDesign, parseEditingState, parseUploadResponse, parseUploadUrl } from './parse';
import { USER_INTENT, type CanvaTools } from './tools';
import type { EditingState } from './types';

export class ProtectedDesignError extends Error {
  constructor(id: string) {
    super(`El diseño ${id} está protegido y no se puede editar`);
    this.name = 'ProtectedDesignError';
  }
}

export interface RunnerProgress {
  stage: 'upload' | 'copy' | 'edit' | 'commit';
  done: number;
  total: number;
}

export interface RunReportInput {
  form: ReportForm;
  inicialPngs: Buffer[];
  finalPngs: Buffer[];
  onProgress?: (p: RunnerProgress) => void;
  log?: (msg: string) => void;
}

export interface RunReportResult {
  designId: string;
  editUrl: string;
  title: string;
}

/** The only ids that may be passed to copy-design are the configured templates. */
export function templateFor(type: ReportType): string {
  return CANVA.templates[type];
}

export function assertEditable(designId: string): void {
  if ((CANVA.protectedDesignIds as readonly string[]).includes(designId)) throw new ProtectedDesignError(designId);
}

async function withRetry<T>(fn: () => Promise<T>, tries: number, log?: (m: string) => void): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      log?.(`reintento ${i + 1}/${tries}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

/** Upload one PNG: fresh single-use URL per attempt (never reuse a URL). */
async function uploadOne(tools: CanvaTools, png: Buffer, log?: (m: string) => void): Promise<string> {
  return withRetry(
    async () => {
      const url = parseUploadUrl(await tools.callTool('create-upload-url', { user_intent: USER_INTENT }));
      return parseUploadResponse(await tools.upload(url, png));
    },
    CANVA.maxRetries,
    log,
  );
}

/** Runs `worker` over items with bounded concurrency, preserving order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

export async function runReport(tools: CanvaTools, input: RunReportInput): Promise<RunReportResult> {
  const { form, onProgress, log } = input;
  const finalPngs = form.type === 'comparativo' ? input.finalPngs : [];
  const all = [...input.inicialPngs, ...finalPngs];

  // 1) Upload every slot PNG.
  let uploaded = 0;
  onProgress?.({ stage: 'upload', done: 0, total: all.length });
  const assets = await mapLimit(all, CANVA.uploadConcurrency, async (png) => {
    const id = await uploadOne(tools, png, log);
    onProgress?.({ stage: 'upload', done: ++uploaded, total: all.length });
    return id;
  });
  const inicialAssets = assets.slice(0, input.inicialPngs.length);
  const finalAssets = assets.slice(input.inicialPngs.length);

  // 2) Copy the template (the original is never opened for editing).
  onProgress?.({ stage: 'copy', done: 0, total: 1 });
  const templateId = templateFor(form.type);
  const designId = parseCopyDesign(await tools.callTool('copy-design', { design_id: templateId, user_intent: USER_INTENT }));
  assertEditable(designId);
  log?.(`copia creada: ${designId}`);
  onProgress?.({ stage: 'copy', done: 1, total: 1 });

  // 3) Edit inside a transaction; cancel on any failure.
  let state: EditingState = parseEditingState(
    'start-editing-transaction',
    await tools.callTool('start-editing-transaction', { design_id: designId, user_intent: USER_INTENT }),
  );
  try {
    const batches = buildEditBatches(state, { form, inicialAssets, finalAssets });
    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ stage: 'edit', done: i, total: batches.length });
      const b = batches[i];
      const res = await tools.callTool('perform-editing-operations', {
        transaction_id: state.transaction_id,
        page_index: b.pageIndex,
        pages: state.pages,
        operations: b.operations,
        user_intent: USER_INTENT,
      });
      state = parseEditingState('perform-editing-operations', res, state);
      assertOperationsApplied('perform-editing-operations', res);
    }
    onProgress?.({ stage: 'commit', done: 0, total: 1 });
    const committed = await tools.callTool('commit-editing-transaction', {
      transaction_id: state.transaction_id,
      user_intent: USER_INTENT,
    });
    if (committed.isError) throw new CanvaToolError('commit-editing-transaction', 'commit rejected');
    onProgress?.({ stage: 'commit', done: 1, total: 1 });
  } catch (e) {
    try {
      await tools.callTool('cancel-editing-transaction', { transaction_id: state.transaction_id, user_intent: USER_INTENT });
    } catch (cancelErr) {
      log?.(`no se pudo cancelar la transacción: ${(cancelErr as Error).message}`);
    }
    log?.(`la copia ${designId} quedó sin terminar (Canva MCP no permite borrarla)`);
    throw e;
  }

  const title = buildTitle(form);
  const editUrl = state.edit_design_url ?? `https://www.canva.com/design/${designId}/edit`;
  return { designId, editUrl, title };
}
