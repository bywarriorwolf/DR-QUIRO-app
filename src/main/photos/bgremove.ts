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

  /**
   * Alpha mask the same size as the input.
   * The photo is letterboxed (not stretched) into the model square. Portrait
   * frames also get a second pass on the lower 60%, and the stronger alpha wins,
   * so a foot that disappeared in the full-frame pass can come back.
   */
  async mask(img: RawRgb): Promise<Mask> {
    const full = await this.infer(img);
    if (img.height < img.width * 1.05) return full;
    const top = Math.floor(img.height * 0.4);
    const cropH = img.height - top;
    const crop = Buffer.alloc(img.width * cropH * 3);
    for (let y = 0; y < cropH; y++) {
      img.data.copy(crop, y * img.width * 3, (top + y) * img.width * 3, (top + y + 1) * img.width * 3);
    }
    const lower = await this.infer({ data: crop, width: img.width, height: cropH });
    const data = new Uint8Array(full.data);
    for (let i = 0; i < lower.data.length; i++) if (lower.data[i] > data[top * img.width + i]) data[top * img.width + i] = lower.data[i];
    return { data, width: img.width, height: img.height };
  }

  /** Letterbox to the model square, run, then map the mask back to the original pixels. */
  private async infer(img: RawRgb): Promise<Mask> {
    const size = MODEL.inputSize;
    const scale = Math.min(size / img.width, size / img.height);
    const contentW = Math.max(1, Math.round(img.width * scale));
    const contentH = Math.max(1, Math.round(img.height * scale));
    const padX = Math.floor((size - contentW) / 2);
    const padY = Math.floor((size - contentH) / 2);
    const fitted = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
      .resize(contentW, contentH, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    const resized = Buffer.alloc(size * size * 3, 0);
    for (let y = 0; y < contentH; y++) {
      fitted.copy(resized, ((padY + y) * size + padX) * 3, y * contentW * 3, (y + 1) * contentW * 3);
    }

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

    const content = await sharp(small, { raw: { width: size, height: size, channels: 1 } })
      .extract({ left: padX, top: padY, width: contentW, height: contentH })
      .resize(img.width, img.height, { fit: 'fill', kernel: 'lanczos3' })
      .extractChannel(0)
      .raw()
      .toBuffer();
    return { data: new Uint8Array(content.buffer, content.byteOffset, content.length), width: img.width, height: img.height };
  }

  async dispose(): Promise<void> {
    await this.session.release();
  }
}
