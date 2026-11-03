// electron-builder afterPack hook: keep only the native binaries needed by the
// platform/arch being packaged (onnxruntime-node ships every OS), require the
// background-removal model to be in the bundle, and ad-hoc sign macOS apps.
// Developer ID signing stays off (identity: null). Apple Silicon still needs a
// signature, so the .app is signed with the ad-hoc identity "-".
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function archName(arch) {
  return ARCH[arch] ?? String(arch);
}

/** onnxruntime-node >= 1.24 has no darwin-x64 build. Intel Macs use the 1.23.2 alias. */
function ortPackageFor(os, arch) {
  return os === 'darwin' && arch === 'x64' ? 'onnxruntime-node-darwin-x64' : 'onnxruntime-node';
}

function pruneNativeBinaries(nm, os, arch) {
  const keepOrt = ortPackageFor(os, arch);
  const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
  for (const pkg of ['onnxruntime-node', 'onnxruntime-node-darwin-x64']) {
    const bin = path.join(nm, pkg, 'bin', 'napi-v6');
    if (!fs.existsSync(bin)) continue;
    for (const o of fs.readdirSync(bin)) {
      const osDir = path.join(bin, o);
      if (!fs.statSync(osDir).isDirectory()) continue;
      for (const a of fs.readdirSync(osDir)) {
        if (pkg !== keepOrt || o !== os || a !== arch) rm(path.join(osDir, a));
      }
    }
  }
  const img = path.join(nm, '@img');
  if (fs.existsSync(img)) {
    for (const d of fs.readdirSync(img)) {
      const m = /^sharp-(?:libvips-)?([a-z0-9]+)-([a-z0-9]+)$/.exec(d);
      if (m && (m[1] !== os || m[2] !== arch)) rm(path.join(img, d));
    }
  }
}

function assertNativeBinaries(nm, os, arch) {
  const pkg = ortPackageFor(os, arch);
  const binding = path.join(nm, pkg, 'bin', 'napi-v6', os, arch, 'onnxruntime_binding.node');
  if (!fs.existsSync(binding)) throw new Error(`afterPack: falta onnxruntime para ${os}-${arch} (${binding})`);
  const sharpDir = path.join(nm, '@img', `sharp-${os}-${arch}`);
  if (!fs.existsSync(sharpDir)) throw new Error(`afterPack: falta sharp para ${os}-${arch} (${sharpDir})`);
  // Windows ships libvips inside sharp-win32-*. macOS and Linux use a sibling package.
  if (os !== 'win32') {
    const vips = path.join(nm, '@img', `sharp-libvips-${os}-${arch}`);
    if (!fs.existsSync(vips)) throw new Error(`afterPack: falta libvips para ${os}-${arch} (${vips})`);
  }
}

function assertModel(resourcesDir) {
  const dir = path.join(resourcesDir, 'models');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.onnx')) : [];
  if (files.length === 0) throw new Error(`afterPack: el modelo ONNX no está en ${dir}`);
}

function adHocSign(appPath) {
  if (process.platform !== 'darwin') return;
  const r = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`afterPack: codesign ad-hoc falló (${r.status ?? r.error?.message})`);
}

async function afterPack(context) {
  const os = context.electronPlatformName; // win32 | darwin | linux
  const arch = archName(context.arch);
  if (arch === 'universal') {
    throw new Error('afterPack: no se empaqueta un binario universal; Intel y Apple Silicon usan paquetes distintos de onnxruntime');
  }
  const res =
    os === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const nm = path.join(res, 'app.asar.unpacked', 'node_modules');
  pruneNativeBinaries(nm, os, arch);
  assertNativeBinaries(nm, os, arch);
  assertModel(res);
  if (os === 'darwin') adHocSign(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
  console.log(`  • afterPack: ${ortPackageFor(os, arch)} ${os}-${arch}, modelo incluido${os === 'darwin' ? ', firma ad-hoc' : ''}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.archName = archName;
module.exports.ortPackageFor = ortPackageFor;
module.exports.pruneNativeBinaries = pruneNativeBinaries;
module.exports.assertNativeBinaries = assertNativeBinaries;
module.exports.assertModel = assertModel;
