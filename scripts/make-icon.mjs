// Generates build/icon.png (1024x1024) from the app logo. electron-builder
// derives the Windows .ico and macOS .icns from it. Run: node scripts/make-icon.mjs
import sharp from 'sharp';

const S = 1024;
const logo = sharp('src/renderer/assets/logo.png');
const { width, height } = await logo.metadata();
const w = Math.round(S * 0.74);
const h = Math.round((height / width) * w);
// White logo: keep the alpha, paint every pixel white.
const alpha = await logo.clone().resize(w, h).extractChannel(3).toBuffer();
const white = await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
  .joinChannel(alpha).png().toBuffer();
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect x="40" y="40" width="${S - 80}" height="${S - 80}" rx="200" fill="#708572"/></svg>`);
await sharp(bg).composite([{ input: white, left: Math.round((S - w) / 2), top: Math.round((S - h) / 2) }]).png().toFile('build/icon.png');
console.log('build/icon.png');
