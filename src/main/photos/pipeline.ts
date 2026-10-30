/**
 * Turns the ordered photo lists into slot PNGs.
 * Pairs (Inicial n, Final n) are processed together so both people get the
 * same height; only the finished PNGs are kept in memory.
 * Inicial photos -> black & white (alpha kept); Final photos keep colour.
 */
import { pairedPersonHeight } from './layoutMath';
import { CANVAS, personHeightFor, preparePhoto, renderSlot, type CutoutChoice } from './compose';
import type { RawRgb } from './bgremove';
import type { Mask } from './alpha';

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
  /** Per photo. Missing entries are 'auto' (cut out, fall back to the original when the mask looks bad). */
  inicialChoice?: CutoutChoice[];
  finalChoice?: CutoutChoice[];
  remover: { mask(img: RawRgb): Promise<Mask> } | null;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderedPhotos {
  inicial: Buffer[];
  final: Buffer[];
  /** Indexes whose cutout was refused and replaced by the original photo. */
  unreliableInicial: number[];
  unreliableFinal: number[];
}

export async function renderReportPhotos(input: PipelineInput): Promise<RenderedPhotos> {
  const total = input.inicial.length + input.final.length;
  const out: RenderedPhotos = { inicial: [], final: [], unreliableInicial: [], unreliableFinal: [] };
  let done = 0;
  const n = Math.max(input.inicial.length, input.final.length);
  const cut = async (which: 'inicial' | 'final', i: number) => {
    try {
      const choice = (which === 'inicial' ? input.inicialChoice : input.finalChoice)?.[i] ?? 'auto';
      const prepared = await preparePhoto(input[which][i], input.remover, choice);
      if (prepared.unreliable) (which === 'inicial' ? out.unreliableInicial : out.unreliableFinal).push(i);
      return prepared.cutout;
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
