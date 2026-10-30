/**
 * Tolerant parsing of MCP tool results. Canva returns JSON either as
 * `structuredContent` or as a JSON string inside a text content block; both
 * are accepted so a server-side change of style does not break the app.
 */
import type { EditingState, PageInfo } from './types';

export interface ToolResultLike {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}

export class CanvaToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = 'CanvaToolError';
  }
}

function textBlocks(result: ToolResultLike): string[] {
  if (!Array.isArray(result.content)) return [];
  return result.content
    .filter((c): c is { type: 'text'; text: string } => !!c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text);
}

/**
 * perform-editing-operations can return HTTP success while an individual
 * operation failed. Surface that instead of committing a half-edited design.
 */
export function assertOperationsApplied(tool: string, result: ToolResultLike): void {
  if (result.isError) return; // payloadOf throws with the server text
  const texts = textBlocks(result);
  let payload: Record<string, unknown> = {};
  try {
    payload = payloadOf(tool, result);
  } catch {
    return;
  }
  const results = payload.edit_operation_results;
  if (!Array.isArray(results)) return;
  const failed = results.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    const status = (r as { status?: string }).status;
    return !!status && status !== 'success';
  });
  if (!failed.length) return;
  const detail = failed
    .map((r) => {
      const rec = r as { status?: string; message?: string; error?: { message?: string } };
      return rec.error?.message || rec.message || rec.status || '';
    })
    .filter(Boolean)
    .join('; ');
  throw new CanvaToolError(tool, (detail || texts.join(' ') || 'una operación de edición falló').slice(0, 400));
}

/** Returns the JSON payload of a tool result (throws CanvaToolError on isError). */
export function payloadOf(tool: string, result: ToolResultLike): Record<string, unknown> {
  const texts = textBlocks(result);
  if (result.isError) throw new CanvaToolError(tool, texts.join(' ').slice(0, 500) || 'error');
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  for (const t of texts) {
    const trimmed = t.trim();
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        /* try next block */
      }
    }
    // Some servers prefix JSON with prose; take the first {...} span.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
  return { text: texts.join('\n') };
}

/** Depth-first search for the first string value under any of `keys`. */
export function findString(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) if (typeof rec[k] === 'string' && rec[k]) return rec[k] as string;
  for (const v of Object.values(rec)) {
    const found = findString(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Canva design ids start with D and are at least 11 characters. */
const DESIGN_ID = /^D[A-Za-z0-9_-]{10,}$/;
const DESIGN_ID_IN_TEXT = /\bD[A-Za-z0-9_-]{10,}\b/;

export function parseCopyDesign(result: ToolResultLike): string {
  const p = payloadOf('copy-design', result);
  const id =
    findString(p, ['design_id', 'designId']) ??
    (typeof (p as { design?: { id?: string } }).design?.id === 'string'
      ? (p as { design: { id: string } }).design.id
      : undefined) ??
    findString(p, ['id']) ??
    JSON.stringify(p).match(DESIGN_ID_IN_TEXT)?.[0];
  if (!id || !DESIGN_ID.test(id)) throw new CanvaToolError('copy-design', 'no design_id in response');
  return id;
}

export function parseEditingState(tool: string, result: ToolResultLike, prev?: EditingState): EditingState {
  const p = payloadOf(tool, result) as Record<string, unknown>;
  const tx = (p.transaction as { transaction_id?: string } | undefined)?.transaction_id ?? findString(p, ['transaction_id']);
  const pages = Array.isArray(p.pages) ? (p.pages as PageInfo[]) : prev?.pages;
  if (!tx && !prev) throw new CanvaToolError(tool, 'no transaction_id in response');
  if (!pages) throw new CanvaToolError(tool, 'no pages in response');
  return {
    transaction_id: tx ?? prev!.transaction_id,
    edit_design_url: (p.edit_design_url as string | undefined) ?? findString(p, ['edit_url']) ?? prev?.edit_design_url,
    richtexts: Array.isArray(p.richtexts) ? (p.richtexts as EditingState['richtexts']) : (prev?.richtexts ?? []),
    fills: Array.isArray(p.fills) ? (p.fills as EditingState['fills']) : (prev?.fills ?? []),
    pages,
  };
}

/** create-upload-url -> the single-use URL. */
export function parseUploadUrl(result: ToolResultLike): string {
  const p = payloadOf('create-upload-url', result);
  const url = findString(p, ['upload_url', 'uploadUrl', 'url']) ?? JSON.stringify(p).match(/https:\/\/[^"\s]+/)?.[0];
  if (!url) throw new CanvaToolError('create-upload-url', 'no upload URL in response');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new CanvaToolError('create-upload-url', 'upload URL is not https');
  return url;
}

/** Body of the upload POST -> asset id usable in insert_fill ("MA..."). */
export function parseUploadResponse(body: string): string {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* fall through to regex */
  }
  const id =
    findString(json, ['mediaId', 'media_id', 'asset_id', 'assetId']) ?? body.match(/\bM[A-Za-z0-9_-]{8,49}\b/)?.[0];
  if (!id || !/^[A-Za-z0-9_-]{1,50}$/.test(id)) throw new CanvaToolError('upload', 'no media id in upload response');
  return id;
}

export function parseAccountName(result: ToolResultLike): string | null {
  try {
    const p = payloadOf('get-logged-in-account-details', result);
    return findString(p, ['display_name', 'name']) ?? null;
  } catch {
    return null;
  }
}
