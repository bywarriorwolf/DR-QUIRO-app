/**
 * Turns the ordered photo lists into slot PNGs.
 * Pairs (Inicial n, Final n) are processed together so both people get the
 * same height; only the finished PNGs are kept in memory.
 * Inicial photos -> black & white (alpha kept); Final photos keep colour.
 */
import { pairedPersonHeight } from './layoutMath';
import { CANVAS, decodeWorking, makeCutout, opaqueFrame, personHeightFor, renderSlot } from './compose';
import type { BackgroundRemover } from './bgremove';

export class PhotoProcessingError extends Error {
  constructor(
    readonly which: 'inicial' | 'final',
    readonly index: number,
    cause: unknown,
  ) {
    super(`foto ${which} ${index + 1}: ${(cause as Error)?.message ?? cause}`);
    this.name = 'PhotoProcessingError';
  }
}

export interface PipelineInput {
  inicial: string[]; // file paths in order
  final: string[]; // empty for Inicial reports
  /**
   * Parallel to the paths. True places the original frame and skips background
   * removal. Missing or false keeps the v1.0.3 cutout (the default).
   */
  inicialOriginal?: boolean[];
  finalOriginal?: boolean[];
  remover: BackgroundRemover | null;
  onProgress?: (done: number, total: number) => void;
}

export async function renderReportPhotos(input: PipelineInput): Promise<{ inicial: Buffer[]; final: Buffer[] }> {
  const total = input.inicial.length + input.final.length;
  const out = { inicial: [] as Buffer[], final: [] as Buffer[] };
  let done = 0;
  const n = Math.max(input.inicial.length, input.final.length);
  const cut = async (which: 'inicial' | 'final', i: number) => {
    try {
      const original = (which === 'inicial' ? input.inicialOriginal : input.finalOriginal)?.[i] === true;
      if (original) return opaqueFrame(await decodeWorking(input[which][i]));
      return await makeCutout(input[which][i], input.remover);
    } catch (e) {
      throw new PhotoProcessingError(which, i, e);
    }
  };
  for (let i = 0; i < n; i++) {
    const a = i < input.inicial.length ? await cut('inicial', i) : null;
    const b = i < input.final.length ? await cut('final', i) : null;
    const h = a && b ? pairedPersonHeight(a, b, CANVAS) : null;
    if (a) {
      out.inicial.push(await renderSlot(a, h ?? personHeightFor(a), { grayscale: true }));
      input.onProgress?.(++done, total);
    }
    if (b) {
      out.final.push(await renderSlot(b, h ?? personHeightFor(b), { grayscale: false }));
      input.onProgress?.(++done, total);
    }
    await new Promise((r) => setImmediate(r)); // keep the event loop responsive
  }
  return out;
}
