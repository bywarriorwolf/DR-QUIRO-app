/**
 * Orchestrates one report in Canva:
 *   upload photos (create-upload-url + POST)  ->  copy-design (template)
 *   -> start-editing-transaction -> perform-editing-operations (page by page)
 *   -> commit-editing-transaction.
 * Any failure after the transaction started cancels it. Photos are uploaded
 * first so a network problem never leaves an orphaned copy behind (the MCP
 * server has no delete tool); if a later step fails, the copy's id is logged.
 */
import { createHash } from 'node:crypto';
import { CANVA, type ReportType } from '../../shared/config';
import { buildTitle, type ReportForm } from '../../shared/report';
import { buildEditBatches } from './ops';
import { assertOperationsApplied, CanvaToolError, parseCopyDesign, parseEditingState, parseUploadResponse, parseUploadUrl } from './parse';
import { withCanvaRetry, type CanvaRetryOptions } from './retry';
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
  /**
   * sha256(png) -> Canva asset id. Survives a failed report so "Reintentar"
   * does not upload the same photos again. Omit it and each run uploads.
   */
  assetCache?: Map<string, string>;
  /** Test hook for backoff waits. Production uses the defaults in config.ts. */
  retry?: CanvaRetryOptions;
  /** Pause between uploads. Tests set 0. */
  uploadGapMs?: number;
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

function pngKey(png: Buffer): string {
  return createHash('sha256').update(png).digest('hex');
}

/** Upload one PNG. A fresh single-use URL is taken per attempt; a URL is never reused. */
async function uploadOne(tools: CanvaTools, png: Buffer, retry: CanvaRetryOptions | undefined, log?: (m: string) => void): Promise<string> {
  return withCanvaRetry(
    async () => {
      const url = parseUploadUrl(await tools.callTool('create-upload-url', { user_intent: USER_INTENT }));
      return parseUploadResponse(await tools.upload(url, png));
    },
    { ...retry, label: 'upload', otherAttempts: CANVA.maxRetries, log },
  );
}

/** One Canva tool call, retried when the server says it is rate limiting. */
function callCanva(
  tools: CanvaTools,
  name: string,
  args: Record<string, unknown>,
  retry: CanvaRetryOptions | undefined,
  log?: (m: string) => void,
) {
  return withCanvaRetry(() => tools.callTool(name, args), { ...retry, label: name, otherAttempts: 1, log });
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
  const { form, onProgress, log, retry } = input;
  const cache = input.assetCache;
  const gapMs = input.uploadGapMs ?? (process.env.VITEST === 'true' ? 0 : CANVA.uploadGapMs);
  const sleep = retry?.sleep ?? ((ms: number) => (ms > 0 && process.env.VITEST !== 'true' ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve()));
  const finalPngs = form.type === 'comparativo' ? input.finalPngs : [];
  const all = [...input.inicialPngs, ...finalPngs];

  // 1) Upload every slot PNG, one at a time. A rate-limit wait stays inside
  // this call, so the "Creando Documento" modal is still on screen.
  let uploaded = 0;
  onProgress?.({ stage: 'upload', done: 0, total: all.length });
  const assets: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const png = all[i]!;
    const key = pngKey(png);
    const cached = cache?.get(key);
    if (cached) {
      log?.(`reutilizando asset ya subido ${cached}`);
      assets.push(cached);
      onProgress?.({ stage: 'upload', done: ++uploaded, total: all.length });
      continue;
    }
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    const id = await uploadOne(tools, png, retry, log);
    cache?.set(key, id);
    assets.push(id);
    onProgress?.({ stage: 'upload', done: ++uploaded, total: all.length });
  }
  const inicialAssets = assets.slice(0, input.inicialPngs.length);
  const finalAssets = assets.slice(input.inicialPngs.length);

  // 2) Copy the template (the original is never opened for editing).
  onProgress?.({ stage: 'copy', done: 0, total: 1 });
  const templateId = templateFor(form.type);
  const designId = parseCopyDesign(await callCanva(tools, 'copy-design', { design_id: templateId, user_intent: USER_INTENT }, retry, log));
  assertEditable(designId);
  log?.(`copia creada: ${designId}`);
  onProgress?.({ stage: 'copy', done: 1, total: 1 });

  // 3) Edit inside a transaction; cancel on any failure.
  let state: EditingState = parseEditingState(
    'start-editing-transaction',
    await callCanva(tools, 'start-editing-transaction', { design_id: designId, user_intent: USER_INTENT }, retry, log),
  );
  try {
    const batches = buildEditBatches(state, { form, inicialAssets, finalAssets });
    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ stage: 'edit', done: i, total: batches.length });
      const b = batches[i]!;
      const res = await callCanva(
        tools,
        'perform-editing-operations',
        {
          transaction_id: state.transaction_id,
          page_index: b.pageIndex,
          pages: state.pages,
          operations: b.operations,
          user_intent: USER_INTENT,
        },
        retry,
        log,
      );
      state = parseEditingState('perform-editing-operations', res, state);
      assertOperationsApplied('perform-editing-operations', res);
    }
    onProgress?.({ stage: 'commit', done: 0, total: 1 });
    const committed = await callCanva(tools, 'commit-editing-transaction', {
      transaction_id: state.transaction_id,
      user_intent: USER_INTENT,
    }, retry, log);
    if (committed.isError) throw new CanvaToolError('commit-editing-transaction', 'commit rejected');
    onProgress?.({ stage: 'commit', done: 1, total: 1 });
  } catch (e) {
    try {
      await callCanva(tools, 'cancel-editing-transaction', { transaction_id: state.transaction_id, user_intent: USER_INTENT }, retry, log);
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
