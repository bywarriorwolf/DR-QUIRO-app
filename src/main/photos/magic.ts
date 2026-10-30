/** File-type detection by magic bytes (never trust the extension alone). */
export type ImageKind = 'png' | 'jpeg';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectImageKind(head: Uint8Array): ImageKind | null {
  if (head.length >= 8 && PNG.every((b, i) => head[i] === b)) return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  return null;
}
