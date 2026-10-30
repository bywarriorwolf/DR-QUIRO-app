/**
 * Runs the REAL photo pipeline (ONNX background removal + layout) on sample
 * photos and writes a contact sheet so the result can be inspected by eye.
 *
 *   npm run contact-sheet -- [photoDir...]   (default: tests/fixtures/cutouts = spec samples)
 *
 * PNGs that already have a transparent background use their own alpha; other
 * photos go through the ONNX model.
 *
 * Output: artifacts/contact-sheet.png (+ each slot PNG in artifacts/slots/).
 * Each tile is drawn on a checkerboard with guide lines for the 10% top margin,
 * the 90% baseline and the 5% side margins.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { BackgroundRemover } from '../src/main/photos/bgremove';
import { CANVAS, makeCutout, personHeightFor, renderSlot, type Cutout } from '../src/main/photos/compose';
import { pairedPersonHeight } from '../src/main/photos/layoutMath';
import { LAYOUT } from '../src/shared/config';

const root = path.resolve(import.meta.dirname, '..');
const modelPath = path.join(root, 'resources/models/isnet-general-use.onnx');
const outDir = path.join(root, 'artifacts');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, 'tests/fixtures/cutouts')];

const W = CANVAS.width, H = CANVAS.height;
const SCALE = 0.4; // tile scale in the sheet

function guidesSvg(label: string) {
  const y1 = Math.round((LAYOUT.baseline - LAYOUT.personHeight) * H);
  const y2 = Math.round(LAYOUT.baseline * H);
  const x1 = Math.round(((1 - LAYOUT.maxPersonWidth) / 2) * W);
  const x2 = W - x1;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#000" stroke-width="2"/>
  <line x1="0" x2="${W}" y1="${y1}" y2="${y1}" stroke="#0a0" stroke-width="2" stroke-dasharray="8 6"/>
  <line x1="0" x2="${W}" y1="${y2}" y2="${y2}" stroke="#d00" stroke-width="2"/>
  <line x1="${x1}" x2="${x1}" y1="0" y2="${H}" stroke="#08f" stroke-width="1" stroke-dasharray="4 6"/>
  <line x1="${x2}" x2="${x2}" y1="0" y2="${H}" stroke="#08f" stroke-width="1" stroke-dasharray="4 6"/>
  <line x1="${W / 2}" x2="${W / 2}" y1="0" y2="${H}" stroke="#f0f" stroke-width="1" stroke-dasharray="2 8"/>
  <rect x="0" y="${H - 40}" width="${W}" height="40" fill="rgba(255,255,255,0.85)"/>
  <text x="10" y="${H - 12}" font-family="sans-serif" font-size="24">${label}</text>
</svg>`);
}

async function checker(): Promise<Buffer> {
  const s = 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><pattern id="p" width="${s * 2}" height="${s * 2}" patternUnits="userSpaceOnUse"><rect width="${s * 2}" height="${s * 2}" fill="#fff"/><rect width="${s}" height="${s}" fill="#ddd"/><rect x="${s}" y="${s}" width="${s}" height="${s}" fill="#ddd"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function tile(png: Buffer, label: string, bg: Buffer) {
  const full = await sharp(bg).composite([{ input: png }, { input: guidesSvg(label) }]).png().toBuffer();
  return sharp(full)
    .resize(Math.round(W * SCALE), Math.round(H * SCALE))
    .png()
    .toBuffer();
}

async function main() {
  const files: string[] = [];
  for (const d of dirs) {
    for (const f of (await readdir(d)).sort()) if (/\.(jpe?g|png)$/i.test(f)) files.push(path.join(d, f));
  }
  if (!files.length) throw new Error('No photos found in ' + dirs.join(', '));
  await mkdir(path.join(outDir, 'slots'), { recursive: true });
  const remover = await BackgroundRemover.create(modelPath);
  const bg = await checker();
  const cuts: { name: string; cut: Cutout }[] = [];
  for (const f of files) {
    const t0 = Date.now();
    const cut = await makeCutout(f, remover);
    console.log(`${path.basename(f)}: bbox ${cut.width}x${cut.height} (${Date.now() - t0} ms)`);
    cuts.push({ name: path.basename(f), cut });
  }
  const tiles: Buffer[] = [];
  // Row A: each photo on its own, colour (Final style)
  for (const { name, cut } of cuts) {
    const png = await renderSlot(cut, personHeightFor(cut), { grayscale: false });
    await writeFile(path.join(outDir, 'slots', name.replace(/\.\w+$/, '') + '.png'), png);
    tiles.push(await tile(png, `${name} solo`, bg));
  }
  // Pairs: consecutive photos as ANTES (B&W) / DESPUÉS (colour), equal height
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const a = cuts[i], b = cuts[i + 1];
    const h = pairedPersonHeight(a.cut, b.cut, CANVAS);
    tiles.push(await tile(await renderSlot(a.cut, h, { grayscale: true }), `ANTES ${a.name}`, bg));
    tiles.push(await tile(await renderSlot(b.cut, h, { grayscale: false }), `DESPUES ${b.name}`, bg));
  }
  await remover.dispose();
  const tw = Math.round(W * SCALE), th = Math.round(H * SCALE), cols = 4, gap = 8;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = sharp({
    create: { width: cols * (tw + gap) + gap, height: rows * (th + gap) + gap, channels: 3, background: '#888' },
  }).composite(tiles.map((t, i) => ({ input: t, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })));
  const out = path.join(outDir, 'contact-sheet.png');
  await sheet.png().toFile(out);
  console.log('Wrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
