import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { THEME } from '../shared/theme';
import { App } from './App';

// Theme colours (src/shared/theme.ts) -> CSS variables.
for (const [k, v] of Object.entries(THEME)) {
  document.documentElement.style.setProperty(`--c-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`, v);
}
// Dashed drop-zone outline as SVG (longer dashes than CSS 'dashed', like the Figma stroke).
const dash = (color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='calc(100% - 2px)' height='calc(100% - 2px)' rx='9' fill='none' stroke='${color}' stroke-width='2' stroke-dasharray='12 9'/></svg>`,
  )}")`;
document.documentElement.style.setProperty('--dash-green', dash(THEME.green));
document.documentElement.style.setProperty('--dash-red', dash(THEME.red));

// Never let a stray drop navigate the window to a file.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
