// Dev: Vite dev server for the renderer + esbuild watch for main/preload + Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
const esb = spawn(process.execPath, ['scripts/build-main.mjs'], { stdio: 'inherit' });
await new Promise((r) => esb.on('exit', r));
const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
