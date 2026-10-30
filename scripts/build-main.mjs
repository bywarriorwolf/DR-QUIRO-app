// Bundles the Electron main process (ESM) and preload (CJS, sandbox-compatible).
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  external: ['electron', 'sharp', 'onnxruntime-node', 'onnxruntime-node-darwin-x64'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    format: 'esm',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.cjs', format: 'cjs' }),
]);
