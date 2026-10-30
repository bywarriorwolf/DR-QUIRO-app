/**
 * Offline stand-in for the Canva MCP server, used by unit tests and by the
 * app's dry-run mode (DRQUIRO_MOCK_CANVA=1). It answers with the REAL
 * structure dumps of both templates, validates every call against the same
 * argument rules the server enforces, and records everything it was asked to
 * do so tests (and the dry-run output folder) can inspect it.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CANVA } from '../../shared/config';
import comparativo from './fixtures/comparativo_structure.json' with { type: 'json' };
import inicial from './fixtures/inicial_structure.json' with { type: 'json' };
import type { ToolResultLike } from './parse';
import type { CanvaTools } from './tools';
import type { EditingState } from './types';

const assetId = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/);
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update_title'), title: z.string().min(1) }).strict(),
  z.object({ type: z.literal('replace_text'), element_id: z.string(), text: z.string() }).strict(),
  z
    .object({ type: z.literal('find_and_replace_text'), element_id: z.string(), find_text: z.string().min(1), replace_text: z.string() })
    .strict(),
  z
    .object({
      type: z.literal('insert_fill'),
      page_id: z.string(),
      asset_type: z.enum(['image', 'video']),
      asset_id: assetId,
      alt_text: z.string().max(250),
      top: z.number(),
      left: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .strict(),
]);
const performSchema = z
  .object({
    transaction_id: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    page_index: z.number().int().min(1),
    pages: z.array(z.object({ page_id: z.string(), is_responsive: z.boolean() }).loose()),
    operations: z.array(operationSchema).min(1),
    user_intent: z.string().optional(),
  })
  .strict();

export interface MockCall {
  name: string;
  args: Record<string, unknown>;
}

export interface MockOptions {
  /** Fail the named tool (once it is called for the `failOnCall`-th time, 1-based). */
  failTool?: string;
  failOnCall?: number;
  /** Artificial latency per call (ms), so the UI progress can be seen. */
  delayMs?: number;
  accountName?: string;
}

const TEMPLATE_FIXTURES: Record<string, unknown> = {
  [CANVA.templates.inicial]: inicial,
  [CANVA.templates.comparativo]: comparativo,
};

const ok = (payload: unknown): ToolResultLike => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
const fail = (msg: string): ToolResultLike => ({ isError: true, content: [{ type: 'text', text: msg }] });

export class MockCanva implements CanvaTools {
  readonly calls: MockCall[] = [];
  readonly uploads = new Map<string, Buffer>(); // mediaId -> bytes
  readonly copies = new Map<string, string>(); // copyId -> templateId
  committed: string[] = [];
  cancelled: string[] = [];
  /** Title and operations actually applied per design (after commit). */
  readonly applied = new Map<string, { title?: string; operations: { page_index: number; op: unknown }[] }>();
  private readonly pendingUrls = new Set<string>();
  private readonly tx = new Map<string, { designId: string; ops: { page_index: number; op: unknown }[] }>();
  private readonly counts = new Map<string, number>();

  constructor(private readonly opts: MockOptions = {}) {}

  get accountName(): string {
    return this.opts.accountName ?? 'Brian Pulgarin Vidal';
  }

  private async delay() {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResultLike> {
    this.calls.push({ name, args: structuredClone(args) });
    const n = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, n);
    await this.delay();
    if (this.opts.failTool === name && n === (this.opts.failOnCall ?? 1)) return fail(`mock failure in ${name}`);

    switch (name) {
      case 'get-logged-in-account-details':
        return ok({ id: 'UAmock', name: this.accountName, team_id: 'BAmock' });
      case 'create-upload-url': {
        const url = `https://upload.mock.canva.invalid/${randomUUID()}`;
        this.pendingUrls.add(url);
        return ok({ upload_url: url });
      }
      case 'copy-design': {
        const src = String(args.design_id);
        if (!TEMPLATE_FIXTURES[src]) return fail(`unknown design ${src}`);
        const id = 'DMOCK' + randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
        this.copies.set(id, src);
        return ok({ design_id: id });
      }
      case 'start-editing-transaction': {
        const id = String(args.design_id);
        const template = this.copies.get(id);
        // Editing anything that is not a fresh copy is a bug in the app.
        if (!template) return fail(`refusing to edit ${id}: not a copy made in this session`);
        const state = structuredClone(TEMPLATE_FIXTURES[template]) as EditingState & { transaction: { transaction_id: string } };
        const txId = String(Date.now()) + String(this.tx.size);
        state.transaction = { transaction_id: txId };
        (state as { edit_design_url?: string }).edit_design_url = `https://www.canva.com/d/mock-${id}`;
        this.tx.set(txId, { designId: id, ops: [] });
        return ok(state);
      }
      case 'perform-editing-operations': {
        const parsed = performSchema.safeParse(args);
        if (!parsed.success) return fail(`invalid arguments: ${parsed.error.message}`);
        const t = this.tx.get(parsed.data.transaction_id);
        if (!t) return fail('unknown transaction');
        for (const op of parsed.data.operations) {
          if (op.type === 'insert_fill' && !this.uploads.has(op.asset_id)) return fail(`unknown asset ${op.asset_id}`);
          t.ops.push({ page_index: parsed.data.page_index, op });
        }
        const template = TEMPLATE_FIXTURES[this.copies.get(t.designId)!] as EditingState;
        return ok({ pages: template.pages, richtexts: template.richtexts, fills: template.fills });
      }
      case 'commit-editing-transaction':
      case 'cancel-editing-transaction': {
        const id = String(args.transaction_id);
        const t = this.tx.get(id);
        if (!t) return fail('unknown transaction');
        this.tx.delete(id);
        if (name === 'commit-editing-transaction') {
          this.committed.push(t.designId);
          const title = (t.ops.find((o) => (o.op as { type: string }).type === 'update_title')?.op as { title?: string } | undefined)?.title;
          this.applied.set(t.designId, { title, operations: t.ops });
        } else this.cancelled.push(t.designId);
        return ok({ status: name === 'commit-editing-transaction' ? 'committed' : 'cancelled' });
      }
      default:
        return fail(`tool ${name} not mocked`);
    }
  }

  async upload(url: string, bytes: Buffer): Promise<string> {
    await this.delay();
    if (!this.pendingUrls.delete(url)) throw new Error('upload URL unknown or already used');
    const mediaId = 'MA' + randomUUID().replace(/-/g, '').slice(0, 9);
    this.uploads.set(mediaId, Buffer.from(bytes));
    return JSON.stringify({ mediaId });
  }
}
