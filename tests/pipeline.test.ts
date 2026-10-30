/**
 * Golden checks of the slot PNGs produced from the transparent cut-out
 * fixtures (no model needed): margins, baseline, centring, equal pairs,
 * B&W Inicial vs colour Final.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/shared/config';
import { CANVAS } from '../src/main/photos/compose';
import { renderReportPhotos } from '../src/main/photos/pipeline';

const fx = (n: number) => path.join(__dirname, 'fixtures/cutouts', `person${n}.png`);

async function analyse(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = Infinity, bottom = -1, left = Infinity, right = -1, maxChroma = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] <= LAYOUT.alphaThreshold) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
      if (data[i + 3] > 200) maxChroma = Math.max(maxChroma, Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]));
    }
  }
  return { w: info.width, h: info.height, top, bottom, left, right, height: bottom - top + 1, cx: (left + right + 1) / 2, maxChroma, hasAlpha: info.channels === 4 };
}

describe('photo pipeline (golden geometry)', () => {
  it('Inicial: every photo B&W, transparent, 80% high, feet at 90%, centred, within 90% width', async () => {
    const out = await renderReportPhotos({ inicial: [1, 2, 3, 4, 5, 6].map(fx), final: [], remover: null });
    expect(out.inicial).toHaveLength(6);
    for (const png of out.inicial) {
      const a = await analyse(png);
      expect(a.w).toBe(CANVAS.width);
      expect(a.h).toBe(CANVAS.height);
      expect(a.maxChroma).toBeLessThanOrEqual(1); // grayscale
      expect(a.top).toBeGreaterThanOrEqual(Math.floor(0.1 * a.h) - 2); // free space on top
      expect(Math.abs(a.bottom + 1 - LAYOUT.baseline * a.h)).toBeLessThanOrEqual(3); // feet on the baseline
      expect(a.right - a.left + 1).toBeLessThanOrEqual(Math.ceil(LAYOUT.maxPersonWidth * a.w) + 2);
      expect(Math.abs(a.cx - a.w / 2)).toBeLessThanOrEqual(2);
      const fullHeight = Math.abs(a.height - LAYOUT.personHeight * a.h) <= 3;
      const widthLimited = a.right - a.left + 1 >= LAYOUT.maxPersonWidth * a.w - 3;
      expect(fullHeight || widthLimited).toBe(true);
    }
  });
  it('Comparativo pairs: same height and baseline; Final keeps colour', async () => {
    const out = await renderReportPhotos({ inicial: [fx(1), fx(3), fx(5)], final: [fx(2), fx(4), fx(6)], remover: null });
    let finalHasColour = false;
    for (let i = 0; i < 3; i++) {
      const a = await analyse(out.inicial[i]);
      const b = await analyse(out.final[i]);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.bottom - b.bottom)).toBeLessThanOrEqual(2);
      expect(a.maxChroma).toBeLessThanOrEqual(1);
      if (b.maxChroma > 10) finalHasColour = true;
    }
    expect(finalHasColour).toBe(true);
  });
  it('a pair never makes the "after" bigger than the "before"', async () => {
    // person2 alone vs person2 paired with a wider pose: paired height <= solo height
    const solo = await renderReportPhotos({ inicial: [fx(2)], final: [], remover: null });
    const pair = await renderReportPhotos({ inicial: [fx(1)], final: [fx(2)], remover: null });
    expect((await analyse(pair.final[0])).height).toBeLessThanOrEqual((await analyse(solo.inicial[0])).height + 1);
  });
  it('without the model, a non-transparent photo fails with a clear photo error', async () => {
    const jpg = await sharp({ create: { width: 50, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const p = path.join(os.tmpdir(), `drq-${process.pid}.jpg`);
    await fs.writeFile(p, jpg);
    await expect(renderReportPhotos({ inicial: [p], final: [], remover: null })).rejects.toMatchObject({ name: 'PhotoProcessingError', which: 'inicial', index: 0 });
    await expect(renderReportPhotos({ inicial: [p], final: [], inicialOriginal: [false], remover: null })).rejects.toMatchObject({ name: 'PhotoProcessingError', which: 'inicial', index: 0 });
  });

  it('a manual original skips the model, stays black and white on Inicial, and shares the Comparativo baseline', async () => {
    let masks = 0;
    const remover = {
      mask: async () => {
        masks += 1;
        throw new Error('el modelo no debe correr');
      },
    } as never;
    const red = path.join(os.tmpdir(), `drq-${process.pid}-red.jpg`);
    const blue = path.join(os.tmpdir(), `drq-${process.pid}-blue.jpg`);
    await fs.writeFile(red, await sharp({ create: { width: 180, height: 420, channels: 3, background: '#d02020' } }).jpeg().toBuffer());
    await fs.writeFile(blue, await sharp({ create: { width: 320, height: 220, channels: 3, background: '#2040d0' } }).jpeg().toBuffer());

    const solo = await renderReportPhotos({ inicial: [red], final: [], inicialOriginal: [true], remover });
    const a = await analyse(solo.inicial[0]);
    expect(masks).toBe(0);
    expect(a.maxChroma).toBeLessThanOrEqual(1);
    const mid = await sharp(solo.inicial[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cx = Math.round(a.cx);
    const cy = Math.round((a.top + a.bottom) / 2);
    const pi = (cy * mid.info.width + cx) * 4;
    expect(mid.data[pi + 3]).toBeGreaterThan(200);

    const pair = await renderReportPhotos({
      inicial: [red],
      final: [blue],
      inicialOriginal: [true],
      finalOriginal: [true],
      remover,
    });
    const ini = await analyse(pair.inicial[0]);
    const fin = await analyse(pair.final[0]);
    expect(masks).toBe(0);
    expect(ini.maxChroma).toBeLessThanOrEqual(1);
    expect(fin.maxChroma).toBeGreaterThan(10);
    expect(Math.abs(ini.height - fin.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(ini.bottom - fin.bottom)).toBeLessThanOrEqual(2);

    const mixed = await renderReportPhotos({
      inicial: [red],
      final: [fx(2)],
      inicialOriginal: [true],
      finalOriginal: [false],
      remover: null,
    });
    const left = await analyse(mixed.inicial[0]);
    const right = await analyse(mixed.final[0]);
    expect(left.maxChroma).toBeLessThanOrEqual(1);
    expect(Math.abs(left.bottom - right.bottom)).toBeLessThanOrEqual(2);
    expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(2);
  });
});
