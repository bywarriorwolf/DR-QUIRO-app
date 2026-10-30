/**
 * Turns a patient photo into the PNG that goes into a report slot:
 * cut-out -> clean alpha -> trim -> scale/centre on a transparent canvas
 * whose aspect matches the slot (see layoutMath.ts for the rules).
 */
import sharp from 'sharp';
import { LAYOUT, PHOTOS, outputSize } from '../../shared/config';
import { alphaBBox, assessMask, fillHoles, keepMainComponents, levels, type BBox, type Mask, type MaskAssessment } from './alpha';
import type { RawRgb } from './bgremove';
import { fittedPersonHeight, placePerson, toPixelRect, type Size } from './layoutMath';

export interface Cutout {
  /** RGBA pixels of the trimmed person (straight alpha). */
  rgba: Buffer;
  width: number;
  height: number;
  /** bbox inside the working image, for diagnostics */
  bbox: BBox;
}

export const CANVAS: Size = outputSize;

/** Decode (EXIF-rotated), limit size and return raw RGB. */
export async function decodeWorking(input: Buffer | string) {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(PHOTOS.workingMaxSide, PHOTOS.workingMaxSide, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function cleanMask(mask: Mask): Promise<Mask> {
  // One subject only, then close holes. Extra blobs (a leftover hand, scraps of
  // background) are dropped. Erosion is skipped: it eats toes and thin edges.
  let m = keepMainComponents(mask, LAYOUT.alphaThreshold, 1);
  m = fillHoles(m, LAYOUT.alphaThreshold);
  m = levels(m, LAYOUT.alphaLo, LAYOUT.alphaHi);
  if (LAYOUT.featherSigma >= 0.3) {
    const blurred = await sharp(Buffer.from(m.data), { raw: { width: m.width, height: m.height, channels: 1 } })
      .blur(LAYOUT.featherSigma)
      .extractChannel(0)
      .raw()
      .toBuffer();
    m = { ...m, data: new Uint8Array(blurred.buffer, blurred.byteOffset, blurred.length) };
  }
  return m;
}

/**
 * If the input already is a cut-out (PNG with a real transparent background),
 * its own alpha is used and the model is skipped.
 */
export async function existingAlpha(input: Buffer | string): Promise<Mask | null> {
  const img = sharp(input, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.hasAlpha) return null;
  const { data, info } = await img
    .rotate()
    .resize(PHOTOS.workingMaxSide, PHOTOS.workingMaxSide, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < 16) transparent++;
  if (transparent / data.length < 0.05) return null;
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** The whole frame, fully opaque. Used when the cutout is refused or the user asks for the original. */
export function opaqueCutout(rgb: { data: Buffer; width: number; height: number }): Cutout {
  const mask: Mask = { data: new Uint8Array(rgb.width * rgb.height).fill(255), width: rgb.width, height: rgb.height };
  return cutoutFromMask(rgb, mask);
}

export type CutoutChoice = 'auto' | 'original' | 'cutout';

export interface PreparedPhoto {
  cutout: Cutout;
  /** True when auto mode refused the mask and the original frame was used instead. */
  unreliable: boolean;
  assessment: MaskAssessment | null;
}

/** Background removal (or existing alpha) + clean-up + trim. Throws if no person is found and the original was not allowed. */
export async function preparePhoto(
  input: Buffer | string,
  remover: { mask(img: RawRgb): Promise<Mask> } | null,
  choice: CutoutChoice = 'auto',
): Promise<PreparedPhoto> {
  const rgb = await decodeWorking(input);
  if (choice === 'original') return { cutout: opaqueCutout(rgb), unreliable: false, assessment: null };
  let raw = await existingAlpha(input);
  if (!raw) {
    if (!remover) throw new Error('Modelo de recorte no disponible');
    raw = await remover.mask(rgb);
  }
  const assessment = assessMask(raw);
  if (choice === 'auto' && !assessment.ok) {
    return { cutout: opaqueCutout(rgb), unreliable: true, assessment };
  }
  try {
    return { cutout: cutoutFromMask(rgb, await cleanMask(raw)), unreliable: false, assessment };
  } catch (e) {
    if (choice === 'cutout') throw e;
    return { cutout: opaqueCutout(rgb), unreliable: true, assessment };
  }
}

/** Background removal (or existing alpha) + clean-up + trim. Throws if no person is found. */
export async function makeCutout(input: Buffer | string, remover: { mask(img: RawRgb): Promise<Mask> } | null): Promise<Cutout> {
  const prepared = await preparePhoto(input, remover, 'cutout');
  return prepared.cutout;
}

export function cutoutFromMask(rgb: { data: Buffer; width: number; height: number }, mask: Mask): Cutout {
  const bbox = alphaBBox(mask, LAYOUT.alphaThreshold);
  if (!bbox || bbox.width < 8 || bbox.height < 8) throw new Error('No se detectó a la persona en la foto');
  const rgba = Buffer.alloc(bbox.width * bbox.height * 4);
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const si = (bbox.top + y) * rgb.width + (bbox.left + x);
      const di = (y * bbox.width + x) * 4;
      rgba[di] = rgb.data[si * 3];
      rgba[di + 1] = rgb.data[si * 3 + 1];
      rgba[di + 2] = rgb.data[si * 3 + 2];
      rgba[di + 3] = mask.data[si];
    }
  }
  return { rgba, width: bbox.width, height: bbox.height, bbox };
}

/** Rec.601 luma, alpha untouched. */
export function toGrayscale(rgba: Buffer): Buffer {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const y = Math.round(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = y;
  }
  return out;
}

export function personHeightFor(c: Cutout): number {
  return fittedPersonHeight(c, CANVAS);
}

/** Render a cutout at a given person height onto the transparent slot canvas. */
export async function renderSlot(c: Cutout, personHeight: number, opts: { grayscale: boolean }): Promise<Buffer> {
  const rect = toPixelRect(placePerson(c, CANVAS, personHeight));
  const pixels = opts.grayscale ? toGrayscale(c.rgba) : c.rgba;
  const person = await sharp(pixels, { raw: { width: c.width, height: c.height, channels: 4 } })
    .resize(rect.width, rect.height, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const base = sharp({
    create: { width: CANVAS.width, height: CANVAS.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: person, left: rect.left, top: rect.top }]);
  let png = await base.png({ compressionLevel: LAYOUT.pngCompression }).toBuffer();
  if (png.length > LAYOUT.maxUploadBytes) {
    png = await sharp(png).png({ palette: true, quality: 95, compressionLevel: 9 }).toBuffer();
  }
  return png;
}
