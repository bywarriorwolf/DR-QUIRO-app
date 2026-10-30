/** Colours and sizes taken from the Figma file. Exposed to CSS as variables. */
export const THEME = {
  green: '#708572', // primary sage green (buttons, labels, active tab)
  greenFrame: 'rgba(87, 196, 97, 0.4)', // inner frame line
  canvaPurple: '#8b3dff',
  red: '#d00000', // error red
  field: '#f3f3f3',
  placeholder: '#d0d0d0',
  injuryPlaceholder: '#c2c2c2',
  injuryValue: '#606060',
  inactiveTab: '#e8e8e8',
  inactiveTabText: '#a0a0a0',
  disabledText: '#d6d6d6',
  progressTrack: '#d0d0d0',
  white: '#ffffff',
  font: "'Montserrat', system-ui, sans-serif",
} as const;

export function themeCssVariables(): string {
  return Object.entries(THEME)
    .map(([k, v]) => `--c-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`)
    .join('\n');
}
