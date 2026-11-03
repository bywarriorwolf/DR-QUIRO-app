/**
 * Retries Canva tool calls that were rejected for rate limiting.
 * Other errors are not waited out: a bad template or a refused design fails
 * immediately (uploads still get a few quick retries, because a single-use
 * upload URL cannot be posted twice).
 */
import { CANVA } from '../../shared/config';

export interface CanvaRetryOptions {
  /** Label used in log lines. */
  label?: string;
  log?: (msg: string) => void;
  /** Tries for "Too many requests" / 429, including the first call. */
  rateLimitAttempts?: number;
  /** Tries for every other error, including the first call. 1 = no retry. */
  otherAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Stop retrying once the waits would exceed this, even if attempts remain. */
  totalCapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1, used for jitter. Defaults to Math.random. */
  random?: () => number;
  now?: () => number;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? '');
}

function readStatus(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const rec = e as Record<string, unknown>;
  for (const key of ['status', 'statusCode']) {
    if (typeof rec[key] === 'number') return rec[key] as number;
  }
  if (rec.cause) return readStatus(rec.cause);
  return undefined;
}

function headerBag(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function readHeader(e: unknown, name: string): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const rec = e as Record<string, unknown>;
  const bags = [headerBag(rec.headers), headerBag((rec.response as { headers?: unknown } | undefined)?.headers)];
  for (const bag of bags) {
    if (!bag) continue;
    const get = bag.get;
    if (typeof get === 'function') {
      const v = (get as (n: string) => unknown).call(bag, name);
      if (typeof v === 'string' || typeof v === 'number') return String(v);
    }
    for (const [k, v] of Object.entries(bag)) {
      if (k.toLowerCase() === name && (typeof v === 'string' || typeof v === 'number')) return String(v);
    }
  }
  if (typeof rec.retryAfter === 'string' || typeof rec.retryAfter === 'number') return String(rec.retryAfter);
  if (typeof rec.retryAfterMs === 'number') return String(rec.retryAfterMs / 1000);
  if (rec.cause) return readHeader(rec.cause, name);
  return undefined;
}

function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.round(Number(trimmed) * 1000));
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return undefined;
}

/** Milliseconds to wait, from a Retry-After header, property, or message. */
export function retryAfterMs(e: unknown, now = Date.now()): number | undefined {
  const header = parseRetryAfter(readHeader(e, 'retry-after'), now);
  if (header != null) return header;
  const match = messageOf(e).match(/retry-after[:\s]+(\d+(?:\.\d+)?)/i);
  if (match) return Math.round(Number(match[1]) * 1000);
  return undefined;
}

export function isRateLimitError(e: unknown): boolean {
  if (readStatus(e) === 429) return true;
  return /too many requests|rate[- ]limit/i.test(messageOf(e));
}

function defaultSleep(ms: number): Promise<void> {
  // Unit tests must not sit through the real backoff. Production waits.
  if (process.env.VITEST === 'true') return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call `fn` again after a rate-limit response. Honors Retry-After when the
 * error carries one. Gives up after `rateLimitAttempts` or when the next wait
 * would pass `totalCapMs`. The progress UI stays up because this promise
 * does not reject until those retries are finished.
 */
export async function withCanvaRetry<T>(fn: () => Promise<T>, opts: CanvaRetryOptions = {}): Promise<T> {
  const rateLimitAttempts = opts.rateLimitAttempts ?? CANVA.rateLimitAttempts;
  const otherAttempts = opts.otherAttempts ?? 1;
  const base = opts.baseDelayMs ?? CANVA.rateLimitBaseMs;
  const maxDelay = opts.maxDelayMs ?? CANVA.rateLimitMaxDelayMs;
  const cap = opts.totalCapMs ?? CANVA.rateLimitTotalCapMs;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const label = opts.label ?? 'canva';
  const started = now();
  let rateUsed = 0;
  let otherUsed = 0;
  let last: unknown;

  for (;;) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const rate = isRateLimitError(e);
      if (rate) rateUsed++;
      else otherUsed++;
      const limit = rate ? rateLimitAttempts : otherAttempts;
      const used = rate ? rateUsed : otherUsed;
      if (used >= limit) break;

      const hinted = rate ? retryAfterMs(e, now()) : undefined;
      let delay: number;
      if (hinted != null) delay = hinted;
      else if (rate) {
        const exp = Math.min(maxDelay, base * 2 ** (rateUsed - 1));
        delay = exp + Math.floor(exp * 0.2 * random());
      } else {
        delay = 400 * 2 ** (otherUsed - 1);
      }
      const elapsed = now() - started;
      if (elapsed + delay > cap) {
        opts.log?.(`${label}: espera máxima ${cap}ms alcanzada`);
        break;
      }
      opts.log?.(`${label}: ${rate ? 'rate limit' : 'error'}, esperando ${delay}ms (${used}/${limit})`);
      await sleep(delay);
    }
  }
  throw last;
}
