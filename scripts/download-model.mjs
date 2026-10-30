// Downloads the background-removal model (rembg "isnet-general-use", Apache-2.0)
// into resources/models/ and verifies its SHA-256. The model is never committed.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
};

const dir = path.resolve('resources', 'models');
const dest = path.join(dir, MODEL.file);

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

mkdirSync(dir, { recursive: true });
if (existsSync(dest) && (await sha256(dest)) === MODEL.sha256) {
  console.log(`model ok: ${dest}`);
  process.exit(0);
}

console.log(`downloading ${MODEL.url}`);
const res = await fetch(MODEL.url, { redirect: 'follow' });
if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
const tmp = `${dest}.part`;
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
const got = await sha256(tmp);
if (got !== MODEL.sha256) {
  rmSync(tmp, { force: true });
  throw new Error(`SHA-256 mismatch: ${got}`);
}
renameSync(tmp, dest);
console.log(`model saved: ${dest}`);
