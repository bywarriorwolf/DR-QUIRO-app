import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assessMask, fillHoles, keepMainComponents, type Mask } from '../src/main/photos/alpha';
import { preparePhoto } from '../src/main/photos/compose';
import { renderReportPhotos } from '../src/main/photos/pipeline';

function mask(width: number, height: number, paint: (x: number, y: number) => number): Mask {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = paint(x, y);
  return { data, width, height };
}

describe('mask cleanup', () => {
  it('keeps only the largest component', () => {
    const m = mask(30, 20, (x, y) => {
      if (x >= 2 && x < 12 && y >= 2 && y < 16) return 255;
      if (x >= 20 && x < 24 && y >= 2 && y < 6) return 255;
      return 0;
    });
    const kept = keepMainComponents(m, 24, 1);
    expect(kept.data[3 * 30 + 3]).toBe(255);
    expect(kept.data[3 * 30 + 21]).toBe(0);
  });

  it('fills a hole that does not touch the border', () => {
    const m = mask(20, 20, (x, y) => {
      const edge = x === 4 || x === 14 || y === 4 || y === 14;
      const inside = x > 4 && x < 14 && y > 4 && y < 14;
      if (edge) return 255;
      if (inside) return 0;
      return 0;
    });
    const filled = fillHoles(m, 24);
    expect(filled.data[8 * 20 + 8]).toBe(255);
    expect(filled.data[1 * 20 + 1]).toBe(0);
  });
});

describe('cutout guard', () => {
  it('accepts one solid subject', () => {
    const m = mask(40, 40, (x, y) => (x > 8 && x < 30 && y > 4 && y < 36 ? 255 : 0));
    const a = assessMask(m);
    expect(a.ok).toBe(true);
    expect(a.reasons).toEqual([]);
    expect(a.componentCount).toBe(1);
  });

  it('rejects an almost empty mask, a ghost, and a shredded subject', () => {
    expect(assessMask(mask(40, 40, () => 0)).reasons).toContain('empty');
    const ghost = mask(40, 40, (x, y) => (x > 5 && x < 35 && y > 5 && y < 35 ? 40 : 0));
    expect(assessMask(ghost).reasons).toContain('faint');
    const bits = mask(60, 40, (x, y) => {
      if (x >= 2 && x < 16 && y >= 4 && y < 30) return 255;
      if (x >= 22 && x < 36 && y >= 4 && y < 30) return 255;
      if (x >= 42 && x < 56 && y >= 4 && y < 30) return 255;
      return 0;
    });
    const shredded = assessMask(bits);
    expect(shredded.ok).toBe(false);
    expect(shredded.reasons).toContain('fragmented');
    expect(shredded.componentCount).toBe(3);
  });

  it('auto mode falls back to the original frame and Inicial stays grayscale', async () => {
    const jpg = await sharp({ create: { width: 80, height: 120, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
    const remover = {
      async mask(img: { width: number; height: number }) {
        return mask(img.width, img.height, (x) => (x % 20 < 8 ? 220 : 0));
      },
    };
    const prepared = await preparePhoto(jpg, remover, 'auto');
    expect(prepared.unreliable).toBe(true);
    expect(prepared.cutout.rgba[3]).toBe(255);

    const file = `/tmp/drq-guard-${process.pid}.jpg`;
    await sharp(jpg).toFile(file);
    const out = await renderReportPhotos({ inicial: [file], final: [], inicialChoice: ['auto'], remover });
    expect(out.unreliableInicial).toEqual([0]);
    const { data, info } = await sharp(out.inicial[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let chroma = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 20) continue;
      chroma = Math.max(chroma, Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]));
    }
    expect(chroma).toBeLessThanOrEqual(1);
    expect(info.width).toBeGreaterThan(0);
  });
});
