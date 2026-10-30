// electron-builder afterPack hook: keep only the native binaries needed by the
// platform/arch being packaged (onnxruntime-node ships every OS: ~500 MB).
const fs = require('node:fs');
const path = require('node:path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const os = context.electronPlatformName; // win32 | darwin | linux
  const arch = ARCH[context.arch] ?? String(context.arch);
  const res =
    os === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const nm = path.join(res, 'app.asar.unpacked', 'node_modules');
  const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

  // onnxruntime-node >= 1.24 has no darwin-x64 build; Intel Macs use the 1.23.2 alias.
  const keepOrt = os === 'darwin' && arch === 'x64' ? 'onnxruntime-node-darwin-x64' : 'onnxruntime-node';
  for (const pkg of ['onnxruntime-node', 'onnxruntime-node-darwin-x64']) {
    const bin = path.join(nm, pkg, 'bin', 'napi-v6');
    if (!fs.existsSync(bin)) continue;
    for (const o of fs.readdirSync(bin)) {
      for (const a of fs.readdirSync(path.join(bin, o))) {
        if (pkg !== keepOrt || o !== os || a !== arch) rm(path.join(bin, o, a));
      }
    }
  }
  // sharp: drop @img packages for other targets (e.g. linux ones on a Windows build made on Linux).
  const img = path.join(nm, '@img');
  if (fs.existsSync(img)) {
    for (const d of fs.readdirSync(img)) {
      const m = /^sharp-(?:libvips-)?([a-z0-9]+)-([a-z0-9]+)$/.exec(d);
      if (m && (m[1] !== os || m[2] !== arch)) rm(path.join(img, d));
    }
  }
  console.log(`  • afterPack: kept ${keepOrt} ${os}-${arch} binaries`);
};
