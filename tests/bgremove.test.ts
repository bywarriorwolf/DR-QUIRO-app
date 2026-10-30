/**
 * Runs the real isnet-general-use model on sample photos (two consecutive
 * runs, the case that used to crash Electron). Skipped when the model
 * (npm run model) or the sample photos are not present, e.g. in CI.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT, MODEL } from '../src/shared/config';
import { BackgroundRemover } from '../src/main/photos/bgremove';
import { decodeWorking, makeCutout } from '../src/main/photos/compose';

const modelPath = path.join(__dirname, '../resources/models', MODEL.fileName);
const photosDir = process.env.DRQ_SAMPLE_PHOTOS ?? '/workspace/canva-test/photos';
const photos = existsSync(photosDir)
  ? readdirSync(photosDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).slice(0, 3).map((f) => path.join(photosDir, f))
  : [];

describe.skipIf(!existsSync(modelPath) || photos.length < 2)('background removal (real model)', () => {
  it('finds a person-sized foreground in consecutive photos', async () => {
    const remover = await BackgroundRemover.create(modelPath);
    for (const p of photos) {
      const rgb = await decodeWorking(p);
      const m = await remover.mask(rgb);
      expect(m.width).toBe(rgb.width);
      expect(m.height).toBe(rgb.height);
      let fg = 0;
      for (let i = 0; i < m.data.length; i++) if (m.data[i] > LAYOUT.alphaThreshold) fg++;
      const frac = fg / m.data.length;
      expect(frac, p).toBeGreaterThan(0.02);
      expect(frac, p).toBeLessThan(0.9);
      const c = await makeCutout(p, remover);
      expect(c.height).toBeGreaterThan(c.width * 0.8); // standing person: taller than wide-ish
    }
  }, 300_000);
});
