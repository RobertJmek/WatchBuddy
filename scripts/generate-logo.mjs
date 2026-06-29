// WatchBuddy logo generator.
//
// Single SVG master -> every PNG the app needs (launcher icon, iOS icon,
// Android adaptive trio, favicon, splash, and the in-app sign-in mark + glow).
// Reproducible: tweak the constants below and re-run `node scripts/generate-logo.mjs`.
//
//   Mark   : a play triangle inside an eye/lens, white.
//   Finish : teal gradient #0D9488 -> #0B7C72.
//
// Renders to /private/tmp/wb-exp by default (preview). Pass `--write` to emit
// straight into assets/images.

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const OUT = WRITE ? join(ROOT, 'assets', 'images') : '/private/tmp/wb-exp';

// --- Brand --------------------------------------------------------------
const TEAL_LIGHT = '#14B8A6'; // gradient top
const TEAL = '#0D9488'; // accent (src/constants/theme.ts)
const TEAL_DARK = '#0B7C72'; // gradient bottom

// --- Geometry (1024 canvas) --------------------------------------------
// Eye/lens almond + right-pointing play triangle, both centered at 512,512.
const eyePath = 'M 282 512 Q 512 312 742 512 Q 512 712 282 512 Z';
const playPath = 'M 452 432 L 452 592 L 620 512 Z';

function mark(color, scale = 1) {
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <path d="${eyePath}" fill="none" stroke="${color}" stroke-width="40" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${playPath}" fill="${color}"/>
  </g>`;
}

const gradientDef = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${TEAL_LIGHT}"/>
    <stop offset="0.55" stop-color="${TEAL}"/>
    <stop offset="1" stop-color="${TEAL_DARK}"/>
  </linearGradient>`;

// bg: 'gradient' | 'none' ; markColor + scale configurable.
function svg({ bg = 'gradient', markColor = '#FFFFFF', scale = 1.15 } = {}) {
  const defs = bg === 'gradient' ? `<defs>${gradientDef}</defs>` : '';
  const back =
    bg === 'gradient'
      ? `<rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}${back}${mark(markColor, scale)}
</svg>`;
}

// Radial teal glow for the sign-in animation backdrop.
function glowSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="512" cy="512" r="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${TEAL}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${TEAL}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" fill="url(#g)"/>
</svg>`;
}

// Official Google "G" mark (4-color) for the social sign-in button.
function googleSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;
}

function render(svgStr, width, file) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
  });
  const png = resvg.render().asPng();
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`  ${file}  (${width}px)`);
}

mkdirSync(OUT, { recursive: true });
console.log(`Rendering WatchBuddy logo -> ${OUT}${WRITE ? '' : '  (preview)'}`);

// Launcher / iOS icon: full-bleed gradient, opaque.
render(svg({ bg: 'gradient', scale: 1.15 }), 1024, 'icon.png');

// Android adaptive layers (mark sized up for the safe zone).
render(svg({ bg: 'none', markColor: '#FFFFFF', scale: 1.4 }), 1024, 'android-icon-foreground.png');
render(svg({ bg: 'gradient', scale: 1.15 }).replace(mark('#FFFFFF', 1.15), ''), 1024, 'android-icon-background.png');
render(svg({ bg: 'none', markColor: '#FFFFFF', scale: 1.4 }), 1024, 'android-icon-monochrome.png');

// Web favicon.
render(svg({ bg: 'gradient', scale: 1.15 }), 48, 'favicon.png');

// Splash + in-app sign-in mark (white on transparent) and glow.
render(svg({ bg: 'none', markColor: '#FFFFFF', scale: 1.15 }), 512, 'splash-icon.png');
render(svg({ bg: 'none', markColor: '#FFFFFF', scale: 1.15 }), 600, 'wb-mark.png');
render(glowSvg(), 600, 'wb-glow.png');

// Google "G" for the sign-in button.
render(googleSvg(), 72, 'google-g.png');

// A 4x contact sheet for quick visual review (preview only).
if (!WRITE) {
  const tile = (x, y, inner) =>
    `<g transform="translate(${x} ${y})"><g transform="scale(0.5)">${inner}</g></g>`;
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" fill="#15181C"/>
    ${tile(0, 0, svg({ bg: 'gradient', scale: 1.15 }))}
    ${tile(512, 0, glowSvg() + svg({ bg: 'none', scale: 1.15 }))}
    ${tile(0, 512, `<rect width="1024" height="1024" rx="180" fill="url(#bg)"/><defs>${gradientDef}</defs>${mark('#FFFFFF', 1.15)}`)}
    ${tile(512, 512, svg({ bg: 'none', markColor: '#0D9488', scale: 1.15 }))}
  </svg>`;
  render(sheet, 800, 'contact-sheet.png');
}

console.log('Done.');
