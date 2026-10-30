/**
 * Pure layout maths for placing a cut-out person inside a report slot.
 * No I/O here so it is fully unit-tested (tests/layoutMath.test.ts).
 */
import { LAYOUT } from '../../shared/config';

export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  left: number;
  top: number;
}

export interface LayoutOptions {
  personHeight: number; // fraction of slot height
  maxPersonWidth: number; // fraction of slot width
  baseline: number; // fraction of slot height where the feet sit
}

export const defaultLayout: LayoutOptions = {
  personHeight: LAYOUT.personHeight,
  maxPersonWidth: LAYOUT.maxPersonWidth,
  baseline: LAYOUT.baseline,
};

/**
 * Height (px in the output canvas) a person gets on its own:
 * `personHeight` of the slot, reduced if the width would exceed `maxPersonWidth`.
 */
export function fittedPersonHeight(bbox: Size, canvas: Size, o: LayoutOptions = defaultLayout): number {
  if (bbox.width <= 0 || bbox.height <= 0) throw new Error('Recorte vacío');
  let h = o.personHeight * canvas.height;
  const maxW = o.maxPersonWidth * canvas.width;
  if ((bbox.width * h) / bbox.height > maxW) h = (maxW * bbox.height) / bbox.width;
  // Never exceed the vertical room above the baseline (keeps a top margin).
  return Math.min(h, o.baseline * canvas.height - (1 - o.baseline) * canvas.height);
}

/**
 * Before/after pair: both people get the SAME height — the smaller of the two
 * individual fits, so both respect every margin.
 */
export function pairedPersonHeight(a: Size, b: Size, canvas: Size, o: LayoutOptions = defaultLayout): number {
  return Math.min(fittedPersonHeight(a, canvas, o), fittedPersonHeight(b, canvas, o));
}

/**
 * Where the (trimmed) person image goes in the canvas for a given height:
 * feet on the baseline, bbox centre on the horizontal centre.
 */
export function placePerson(bbox: Size, canvas: Size, personHeight: number, o: LayoutOptions = defaultLayout): Rect {
  const scale = personHeight / bbox.height;
  const width = bbox.width * scale;
  const height = personHeight;
  const left = (canvas.width - width) / 2;
  const top = o.baseline * canvas.height - height;
  return { left, top, width, height };
}

/** Integer pixel rect used for the actual composite (rounded consistently). */
export function toPixelRect(r: Rect): Rect {
  const left = Math.round(r.left);
  const top = Math.round(r.top);
  const right = Math.round(r.left + r.width);
  const bottom = Math.round(r.top + r.height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
