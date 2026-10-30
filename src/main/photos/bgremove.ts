/**
 * Local background removal with the rembg "isnet-general-use" ONNX model
 * (Apache-2.0) via onnxruntime-node. Pre/post-processing mirrors rembg's
 * DisISSession: RGB -> 1024x1024 (Lanczos) -> /max -> (x - mean) / std ->
 * NCHW float32 -> model -> min-max normalise -> resize back -> alpha mask.
 */
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { MODEL } from '../../shared/config';
import type { Mask } from './alpha';

type Ort = typeof import('onnxruntime-node');

/**
 * onnxruntime-node >= 1.24 no longer ships an Intel-mac binary, so on
 * darwin-x64 we load 1.23.2 (installed under an npm alias).
 */
export function ortModuleName(platform = process.platform, arch = process.arch): string {
  return platform === 'darwin' && arch === 'x64' ? 'onnxruntime-node-darwin-x64' : 'onnxruntime-node';
}

let ortCache: Ort | null = null;
function loadOrt(): Ort {
  if (!ortCache) {
    const require = createRequire(import.meta.url);
    ortCache = require(ortModuleName()) as Ort;
  }
  return ortCache;
}

export interface RawRgb {
  data: Buffer; // RGB, 3 bytes per pixel
  width: number;
  height: number;
}

export class BackgroundRemover {
  private constructor(
    private readonly ort: Ort,
    private readonly session: import('onnxruntime-node').InferenceSession,
  ) {}

  static async create(modelPath: string): Promise<BackgroundRemover> {
    const ort = loadOrt();
    const session = await ort.InferenceSession.create(modelPath, {
      graphOptimizationLevel: 'all',
      executionProviders: ['cpu'],
      // Electron's V8 memory cage refuses two ArrayBuffers over the same native
      // memory. With the arena / memory pattern on, ORT hands the 2nd run's
      // output back in the 1st run's buffer and the main process dies (SIGTRAP).
      enableCpuMemArena: false,
      enableMemPattern: false,
    });
    return new BackgroundRemover(ort, session);
  }

  /** Returns an alpha mask (0-255) with the same size as the input. */
  async mask(img: RawRgb): Promise<Mask> {
    const size = MODEL.inputSize;
    const resized = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    let max = 0;
    for (let i = 0; i < resized.length; i++) if (resized[i] > max) max = resized[i];
    const denom = Math.max(max, 1e-6);
    const plane = size * size;
    const input = new Float32Array(3 * plane);
    for (let p = 0; p < plane; p++) {
      for (let c = 0; c < 3; c++) {
        input[c * plane + p] = (resized[p * 3 + c] / denom - MODEL.mean[c]) / MODEL.std[c];
      }
    }
    const feeds = { [this.session.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, size, size]) };
    const out = await this.session.run(feeds);
    const pred = out[this.session.outputNames[0]].data as Float32Array; // [1,1,1024,1024]

    let mi = Infinity, ma = -Infinity;
    for (let i = 0; i < plane; i++) {
      const v = pred[i];
      if (v < mi) mi = v;
      if (v > ma) ma = v;
    }
    const range = ma - mi || 1;
    const small = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) small[i] = Math.max(0, Math.min(255, Math.floor(((pred[i] - mi) / range) * 255)));

    const full = await sharp(small, { raw: { width: size, height: size, channels: 1 } })
      .resize(img.width, img.height, { fit: 'fill', kernel: 'lanczos3' })
      .extractChannel(0)
      .raw()
      .toBuffer();
    return { data: new Uint8Array(full.buffer, full.byteOffset, full.length), width: img.width, height: img.height };
  }

  async dispose(): Promise<void> {
    await this.session.release();
  }
}
