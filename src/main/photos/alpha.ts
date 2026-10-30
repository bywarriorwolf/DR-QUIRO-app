/**
 * Alpha-mask clean-up on raw single-channel buffers (pure, unit-tested):
 * stray-blob removal, levels, 1 px erosion and bounding box.
 */

export interface Mask {
  data: Uint8Array; // one byte per pixel
  width: number;
  height: number;
}

export interface BBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Keep the largest 8-connected component of pixels with alpha > threshold and
 * any other component whose area is >= keepRatio * largest. Everything else
 * (including faint pixels attached to removed blobs) becomes 0.
 */
export function keepMainComponents(mask: Mask, threshold: number, keepRatio: number): Mask {
  const { data, width, height } = mask;
  const n = width * height;
  const labels = new Int32Array(n); // 0 = unlabelled / background
  const areas: number[] = [0];
  const stack = new Int32Array(n);
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== 0 || data[i] <= threshold) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (labels[q] === 0 && data[q] > threshold) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    areas.push(area);
    next++;
  }
  if (next === 1) return { data: new Uint8Array(n), width, height };
  const largest = Math.max(...areas.slice(1));
  const keep = areas.map((a, i) => i > 0 && a >= keepRatio * largest);

  // Faint pixels (<= threshold) are kept only when next to a kept component pixel
  // (within 2 px) so soft hair/edge alpha survives but faint haze far away does not.
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (keep[labels[i]]) out[i] = data[i];
  const near = dilateBinary(out, width, height, 2);
  for (let i = 0; i < n; i++) if (labels[i] === 0 && near[i] && data[i] > 0) out[i] = data[i];
  return { data: out, width, height };
}

function dilateBinary(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  // separable max filter on a 0/1 map
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r) && !v; k++) v = src[row + k] ? 1 : 0;
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r) && !v; k++) v = tmp[k * width + x];
      out[y * width + x] = v;
    }
  }
  return out;
}

/** Linear levels: <= lo -> 0, >= hi -> 255 (tightens soft halos). */
export function levels(mask: Mask, lo: number, hi: number): Mask {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / (hi - lo)) * 255);
  const out = new Uint8Array(mask.data.length);
  for (let i = 0; i < out.length; i++) out[i] = lut[mask.data[i]];
  return { ...mask, data: out };
}

/** Grey-scale erosion (3x3 min) repeated `px` times. */
export function erode(mask: Mask, px: number): Mask {
  let cur = mask.data;
  const { width, height } = mask;
  for (let it = 0; it < px; it++) {
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let m = 255;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) {
            m = 0;
            continue;
          }
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const v = xx < 0 || xx >= width ? 0 : cur[yy * width + xx];
            if (v < m) m = v;
          }
        }
        out[y * width + x] = m;
      }
    }
    cur = out;
  }
  return { ...mask, data: cur };
}

/**
 * Fill holes inside the foreground: pixels that cannot reach the image border
 * without crossing a pixel above `threshold` become solid (255). Soft edge
 * pixels that do touch the outside are left alone.
 */
export function fillHoles(mask: Mask, threshold: number): Mask {
  const { data, width, height } = mask;
  const n = width * height;
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => {
    if (outside[i] || data[i] > threshold) return;
    outside[i] = 1;
    stack[sp++] = i;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x + 1 < width) push(p + 1);
    if (y > 0) push(p - width);
    if (y + 1 < height) push(p + width);
  }
  const out = new Uint8Array(data);
  for (let i = 0; i < n; i++) if (!outside[i] && data[i] <= threshold) out[i] = 255;
  return { data: out, width, height };
}

export type CutoutProblem = 'empty' | 'full' | 'fragmented' | 'faint';

export interface MaskAssessment {
  ok: boolean;
  foregroundRatio: number;
  componentCount: number;
  /** Largest component area divided by all foreground pixels. 1 when there is one blob. */
  largestShare: number;
  meanForegroundAlpha: number;
  reasons: CutoutProblem[];
}

export const CUTOUT_GUARD = {
  /** Foreground (alpha > componentThreshold) as a fraction of the frame. */
  minForeground: 0.035,
  maxForeground: 0.9,
  /** A component counts when it is at least this fraction of the largest. */
  significantRatio: 0.08,
  /** Fragmented when this many significant blobs exist and the largest is not dominant. */
  minSignificant: 3,
  minLargestShare: 0.7,
  /** Mean alpha of pixels above `faintFloor`. A ghost cutout sits well below this. */
  minMeanAlpha: 110,
  faintFloor: 12,
  componentThreshold: 24,
} as const;

/** Decide whether a raw model mask is safe to place in a report. */
export function assessMask(mask: Mask, guard = CUTOUT_GUARD): MaskAssessment {
  const { data, width, height } = mask;
  const n = width * height;
  const labels = new Int32Array(n);
  const areas: number[] = [0];
  const stack = new Int32Array(n);
  let next = 1;
  let foreground = 0;
  let alphaSum = 0;
  let alphaCount = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] > guard.faintFloor) {
      alphaSum += data[i];
      alphaCount++;
    }
    if (labels[i] !== 0 || data[i] <= guard.componentThreshold) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (labels[q] === 0 && data[q] > guard.componentThreshold) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
      }
    }
    areas.push(area);
    foreground += area;
    next++;
  }
  const largest = areas.length > 1 ? Math.max(...areas.slice(1)) : 0;
  const significant = areas.slice(1).filter((a) => a >= guard.significantRatio * Math.max(largest, 1)).length;
  const foregroundRatio = n ? foreground / n : 0;
  const largestShare = foreground ? largest / foreground : 0;
  const meanForegroundAlpha = alphaCount ? alphaSum / alphaCount : 0;
  const reasons: CutoutProblem[] = [];
  if (foregroundRatio < guard.minForeground) reasons.push('empty');
  if (foregroundRatio > guard.maxForeground) reasons.push('full');
  if (significant >= guard.minSignificant && largestShare < guard.minLargestShare) reasons.push('fragmented');
  if (alphaCount > 0 && meanForegroundAlpha < guard.minMeanAlpha) reasons.push('faint');
  return { ok: reasons.length === 0, foregroundRatio, componentCount: significant, largestShare, meanForegroundAlpha, reasons };
}

/** Bounding box of pixels with alpha > threshold, or null if empty. */
export function alphaBBox(mask: Mask, threshold: number): BBox | null {
  const { data, width, height } = mask;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
