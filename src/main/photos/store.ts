/**
 * Imported photos live in a private temp directory under generated names
 * (<uuid>.png|jpg). The renderer only ever sees the uuid and a thumbnail;
 * paths are never built from renderer input, so there is no path traversal.
 * Originals are only read, never modified or deleted.
 */
import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PHOTOS } from '../../shared/config';
import type { ImportedPhoto, ImportResult } from '../../shared/ipc';
import { detectImageKind } from './magic';

export class PhotoStore {
  private readonly files = new Map<string, string>();
  private constructor(readonly dir: string) {}

  static async create(baseDir = os.tmpdir()): Promise<PhotoStore> {
    const dir = await fs.mkdtemp(path.join(baseDir, 'drquiro-'));
    await fs.chmod(dir, 0o700).catch(() => {});
    return new PhotoStore(dir);
  }

  async import(paths: string[], onProgress?: (done: number, total: number) => void, delayMs = 0): Promise<ImportResult> {
    const result: ImportResult = { photos: [], rejected: [] };
    let done = 0;
    for (const p of paths) {
      const name = path.basename(String(p));
      try {
        const photo = await this.importOne(p);
        if ('reason' in photo) result.rejected.push({ name, reason: photo.reason });
        else result.photos.push(photo);
      } catch {
        result.rejected.push({ name, reason: 'unreadable' });
      }
      onProgress?.(++done, paths.length);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    return result;
  }

  private async importOne(p: string): Promise<ImportedPhoto | { reason: 'format' | 'size' | 'unreadable' }> {
    if (typeof p !== 'string' || p.includes('\0') || !path.isAbsolute(p)) return { reason: 'unreadable' };
    const real = await fs.realpath(p);
    const st = await fs.stat(real);
    if (!st.isFile()) return { reason: 'format' };
    if (st.size > PHOTOS.maxFileBytes) return { reason: 'size' };
    const fh = await fs.open(real, 'r');
    const head = Buffer.alloc(16);
    try {
      await fh.read(head, 0, 16, 0);
    } finally {
      await fh.close();
    }
    const kind = detectImageKind(head);
    if (!kind) return { reason: 'format' };

    const id = randomUUID();
    const dest = path.join(this.dir, `${id}.${kind === 'png' ? 'png' : 'jpg'}`);
    await fs.copyFile(real, dest, constants.COPYFILE_EXCL);
    try {
      const thumb = await sharp(dest, { failOn: 'error' })
        .rotate()
        .resize(PHOTOS.thumbnailSize, PHOTOS.thumbnailSize, { fit: 'cover', position: 'attention' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer();
      this.files.set(id, dest);
      return { id, name: path.basename(real), thumbDataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}` };
    } catch {
      await fs.rm(dest, { force: true });
      return { reason: 'unreadable' };
    }
  }

  /** Path of an imported photo; throws for unknown ids. */
  pathOf(id: string): string {
    const f = this.files.get(id);
    if (!f) throw new Error('foto desconocida');
    return f;
  }

  async release(ids: string[]): Promise<void> {
    for (const id of ids) {
      const f = this.files.get(id);
      if (!f) continue;
      this.files.delete(id);
      await fs.rm(f, { force: true });
    }
  }

  async dispose(): Promise<void> {
    this.files.clear();
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
