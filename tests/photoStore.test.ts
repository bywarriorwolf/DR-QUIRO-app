import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectImageKind } from '../src/main/photos/magic';
import { PhotoStore } from '../src/main/photos/store';

let dir: string;
let store: PhotoStore;
const f = (n: string) => path.join(dir, n);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drq-test-'));
  const img = sharp({ create: { width: 40, height: 60, channels: 3, background: '#88aa88' } });
  await fs.writeFile(f('real.jpg'), await img.clone().jpeg().toBuffer());
  await fs.writeFile(f('real.png'), await img.clone().png().toBuffer());
  await fs.writeFile(f('png-named.jpg'), await img.clone().png().toBuffer()); // wrong extension, real PNG
  await fs.writeFile(f('fake.jpg'), Buffer.from('GIF89a this is not a jpeg'));
  await fs.writeFile(f('photo.webp'), await img.clone().webp().toBuffer());
  await fs.writeFile(f('broken.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  await fs.mkdir(f('folder.jpg'));
  await fs.symlink(f('real.jpg'), f('link.jpg'));
  store = await PhotoStore.create(dir);
});
afterAll(async () => {
  await store.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('magic bytes', () => {
  it('detects PNG and JPEG only', () => {
    expect(detectImageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectImageKind(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(detectImageKind(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageKind(Buffer.from('RIFF....WEBP'))).toBeNull();
    expect(detectImageKind(Buffer.alloc(0))).toBeNull();
  });
});

describe('PhotoStore', () => {
  it('imports real PNG/JPG under generated uuid names inside its private dir', async () => {
    const r = await store.import([f('real.jpg'), f('real.png'), f('png-named.jpg')]);
    expect(r.rejected).toEqual([]);
    expect(r.photos).toHaveLength(3);
    for (const p of r.photos) {
      expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
      const copy = store.pathOf(p.id);
      expect(path.dirname(copy)).toBe(store.dir);
      expect(path.basename(copy)).toMatch(new RegExp(`^${p.id}\\.(png|jpg)$`));
      expect(p.thumbDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    }
    // extension follows the content, not the file name
    expect(store.pathOf(r.photos[2].id).endsWith('.png')).toBe(true);
  });
  it('rejects wrong formats by content, folders and corrupt images', async () => {
    const r = await store.import([f('fake.jpg'), f('photo.webp'), f('folder.jpg'), f('broken.jpg')]);
    expect(r.photos).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['format', 'format', 'format', 'unreadable']);
  });
  it('rejects relative paths, NUL bytes and missing files (no traversal)', async () => {
    const r = await store.import(['../../etc/passwd', 'real.jpg', `${f('real.jpg')}\0.png`, f('nope.jpg')]);
    expect(r.photos).toEqual([]);
    expect(r.rejected.every((x) => x.reason === 'unreadable')).toBe(true);
  });
  it('follows a symlink to a real image but stores an independent copy', async () => {
    const r = await store.import([f('link.jpg')]);
    expect(r.photos).toHaveLength(1);
    const st = await fs.lstat(store.pathOf(r.photos[0].id));
    expect(st.isSymbolicLink()).toBe(false);
  });
  it('unknown ids throw; release deletes only the copy, never the original', async () => {
    expect(() => store.pathOf('../../real.jpg')).toThrow();
    const r = await store.import([f('real.jpg')]);
    const copy = store.pathOf(r.photos[0].id);
    await store.release([r.photos[0].id, 'not-an-id']);
    await expect(fs.stat(copy)).rejects.toThrow();
    await expect(fs.stat(f('real.jpg'))).resolves.toBeTruthy();
  });
});
