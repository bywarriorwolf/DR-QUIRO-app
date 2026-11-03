import { describe, expect, it } from 'vitest';
import { MockCanva } from '../src/main/canva/mock';
import { CanvaToolError } from '../src/main/canva/parse';
import { isRateLimitError, retryAfterMs, withCanvaRetry } from '../src/main/canva/retry';
import { runReport } from '../src/main/canva/runner';
import type { CanvaTools } from '../src/main/canva/tools';
import { makeForm } from './helpers';

const noWait = { sleep: async () => {}, random: () => 0 };

function tooMany(tool: string, extra: Record<string, unknown> = {}) {
  const err = new CanvaToolError(tool, 'Error: Too many requests. (Request ID: a52bcec078d57ab1)');
  Object.assign(err, extra);
  return err;
}

function toolsOf(mock: MockCanva, callTool?: CanvaTools['callTool']): CanvaTools {
  return { callTool: callTool ?? mock.callTool.bind(mock), upload: mock.upload.bind(mock) };
}

describe('rate-limit detection', () => {
  it('recognises 429, Too many requests, and Retry-After', () => {
    expect(isRateLimitError(tooMany('create-upload-url'))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('nope'), { status: 429 }))).toBe(true);
    expect(isRateLimitError(new Error('template missing'))).toBe(false);
    expect(retryAfterMs(tooMany('create-upload-url', { headers: { 'retry-after': '5' } }))).toBe(5000);
    expect(retryAfterMs(tooMany('copy-design', { retryAfter: 2 }))).toBe(2000);
  });
});

describe('withCanvaRetry', () => {
  it('backs off with jitter, then returns', async () => {
    const waits: number[] = [];
    let n = 0;
    const value = await withCanvaRetry(
      async () => {
        n++;
        if (n < 4) throw tooMany('create-upload-url');
        return 'ok';
      },
      { sleep: async (ms) => { waits.push(ms); }, random: () => 1, baseDelayMs: 2000, rateLimitAttempts: 6, totalCapMs: 180_000 },
    );
    expect(value).toBe('ok');
    expect(n).toBe(4);
    // exp + 20% jitter: 2000+400, 4000+800, 8000+1600
    expect(waits).toEqual([2400, 4800, 9600]);
  });

  it('honors Retry-After and stops when the total wait cap would be exceeded', async () => {
    const waits: number[] = [];
    let t = 0;
    let n = 0;
    await expect(
      withCanvaRetry(
        async () => {
          n++;
          throw tooMany('perform-editing-operations', { headers: { 'Retry-After': '4' } });
        },
        {
          sleep: async (ms) => { waits.push(ms); t += ms; },
          now: () => t,
          random: () => 0,
          rateLimitAttempts: 6,
          totalCapMs: 5_000,
        },
      ),
    ).rejects.toThrow(/Too many requests/);
    expect(waits).toEqual([4000]);
    expect(n).toBe(2);
  });

  it('does not retry an ordinary Canva rejection', async () => {
    let n = 0;
    await expect(
      withCanvaRetry(
        async () => {
          n++;
          throw new CanvaToolError('copy-design', 'permission denied');
        },
        { ...noWait, otherAttempts: 1 },
      ),
    ).rejects.toThrow(/permission denied/);
    expect(n).toBe(1);
  });
});

describe('runReport rate limits', () => {
  it('uploads one photo at a time and pauses between create-upload-url calls', async () => {
    const mock = new MockCanva();
    let inFlight = 0;
    let max = 0;
    const waits: number[] = [];
    const tools = toolsOf(mock, async (name, args) => {
      if (name === 'create-upload-url') {
        inFlight++;
        max = Math.max(max, inFlight);
        const res = await mock.callTool(name, args);
        inFlight--;
        return res;
      }
      return mock.callTool(name, args);
    });
    await runReport(tools, {
      form: makeForm('inicial'),
      inicialPngs: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')],
      finalPngs: [],
      uploadGapMs: 800,
      retry: { sleep: async (ms) => { waits.push(ms); }, random: () => 0 },
    });
    expect(max).toBe(1);
    expect(waits).toEqual([800, 800]);
    expect(mock.calls.filter((c) => c.name === 'create-upload-url')).toHaveLength(3);
  });

  it('retries create-upload-url on Too many requests and keeps the raw message when it gives up', async () => {
    const mock = new MockCanva();
    let n = 0;
    const stages: string[] = [];
    const tools = toolsOf(mock, async (name, args) => {
      if (name === 'create-upload-url') {
        n++;
        throw tooMany(name);
      }
      return mock.callTool(name, args);
    });
    await expect(
      runReport(tools, {
        form: makeForm('inicial'),
        inicialPngs: [Buffer.from('only')],
        finalPngs: [],
        onProgress: (p) => stages.push(p.stage),
        retry: { ...noWait, rateLimitAttempts: 6 },
      }),
    ).rejects.toThrow(/create-upload-url: Error: Too many requests\. \(Request ID: a52bcec078d57ab1\)/);
    expect(n).toBe(6);
    expect(stages[0]).toBe('upload');
    expect(mock.copies.size).toBe(0);
  });

  it('retries copy-design and perform-editing-operations, and does not upload again', async () => {
    const mock = new MockCanva();
    const counts = { copy: 0, edit: 0, upload: 0 };
    const waits: number[] = [];
    const buf = Buffer.from('photo-once');
    const tools = toolsOf(mock, async (name, args) => {
      if (name === 'create-upload-url') counts.upload++;
      if (name === 'copy-design') {
        counts.copy++;
        if (counts.copy < 3) throw tooMany(name, { retryAfter: 2 });
      }
      if (name === 'perform-editing-operations') {
        counts.edit++;
        if (counts.edit === 1) throw tooMany(name);
      }
      return mock.callTool(name, args);
    });
    const cache = new Map<string, string>();
    await runReport(tools, {
      form: makeForm('inicial'),
      inicialPngs: [buf],
      finalPngs: [],
      assetCache: cache,
      retry: { sleep: async (ms) => { waits.push(ms); }, random: () => 0, baseDelayMs: 1000 },
    });
    expect(counts.copy).toBe(3);
    // One photo: cover, photo page, injuries. The first edit is rate-limited once, then retried.
    expect(counts.edit).toBe(4);
    expect(waits).toContain(2000);
    expect(waits).toContain(1000);
    const uploadsBefore = counts.upload;
    await runReport(tools, {
      form: makeForm('inicial'),
      inicialPngs: [buf],
      finalPngs: [],
      assetCache: cache,
      retry: noWait,
    });
    expect(counts.upload).toBe(uploadsBefore);
    expect(cache.size).toBe(1);
  });
});
