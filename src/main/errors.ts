import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ErrorCode } from '../shared/ipc';
import { LoginCancelledError } from './canva/loopback';
import { TemplateError } from './canva/ops';
import { NeedsLoginError } from './canva/oauthProvider';
import { CanvaToolError } from './canva/parse';
import { ProtectedDesignError } from './canva/runner';
import { PhotoProcessingError } from './photos/pipeline';

export class ModelMissingError extends Error {}

/** Maps any thrown error to a user-facing error code (messages live in strings.ts). */
export function errorCode(e: unknown): ErrorCode {
  if (e instanceof ModelMissingError) return 'model';
  if (e instanceof PhotoProcessingError) return 'photo';
  if (e instanceof TemplateError || e instanceof ProtectedDesignError) return 'template';
  if (e instanceof LoginCancelledError) return 'loginCancelled';
  if (e instanceof UnauthorizedError || e instanceof NeedsLoginError) return 'notConnected';
  if (e instanceof CanvaToolError) return 'canva';
  const msg = String((e as Error)?.message ?? e);
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  if (
    /fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed? ?out|aborted/i.test(msg) ||
    (code && /^E(NOTFOUND|CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN)$/.test(code))
  ) {
    return 'network';
  }
  return 'unknown';
}

/** Short, secret-free text for the error modal. */
export function publicErrorDetail(e: unknown): string | undefined {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const clean = raw
    .replace(/(access_token|refresh_token|code|_sat)=[^&\s]+/gi, '$1=***')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
  return clean || undefined;
}
