import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The dev server needs inline styles + websockets for HMR; production keeps the strict CSP. */
function devCsp(): Plugin {
  return {
    name: 'drquiro-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'none'", "connect-src 'self' ws://localhost:5173");
    },
  };
}

// Renderer only. Main + preload are bundled by scripts/build-main.mjs (esbuild).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), devCsp()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
  },
  server: { port: 5173, strictPort: true },
});
