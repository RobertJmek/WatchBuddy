// Android status-bar icon for push notifications (expo-notifications `icon`).
//
// The app icon is two tilted tickets (assets/images/icon.png, since 1.9.7). At
// 24dp that is mush, so this is its one-shape reduction: a single upright
// ticket, notched, with a bold perforation — drawn on the 24dp grid, filling
// the 20dp live area (2dp padding), white on transparent (Android uses only the
// alpha and tints it). Upright on purpose: tilted edges blur at this size.
// Since Android 17 the notification itself shows the launcher icon; this one
// is what the status bar shows.
//
//   node scripts/generate-notification-icon.mjs            → preview in /private/tmp/wb-notif
//   node scripts/generate-notification-icon.mjs --write    → assets/images/notification-icon.png

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// In dp on a 24×24 canvas. Body 20×15, corner radius 2, a notch of radius 2.5
// in the middle of each short side.
const ticket = [
  'M 4 4.5 H 20 A 2 2 0 0 1 22 6.5',
  'V 9.5 A 2.5 2.5 0 0 0 22 14.5',
  'V 17.5 A 2 2 0 0 1 20 19.5 H 4 A 2 2 0 0 1 2 17.5',
  'V 14.5 A 2.5 2.5 0 0 0 2 9.5',
  'V 6.5 A 2 2 0 0 1 4 4.5 Z',
].join(' ');
// The perforation: three 2dp dashes, cut out (stub on the right, as on the art).
const holes = [
  'M 15 6.5 h 2 v 2.5 h -2 Z',
  'M 15 10.75 h 2 v 2.5 h -2 Z',
  'M 15 15 h 2 v 2.5 h -2 Z',
].join(' ');

const shape = `<path d="${ticket} ${holes}" fill="white" fill-rule="evenodd"/>`;
const svg = (bg = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${bg}${shape}</svg>`;

const render = (s, width) =>
  new Resvg(s, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();

const out = WRITE ? join(ROOT, 'assets', 'images') : '/private/tmp/wb-notif';
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'notification-icon.png'), render(svg(), 96)); // 24dp at xxxhdpi
if (!WRITE) {
  // On a dark bar at real size (24dp at 3x) and blown up.
  const bg = '<rect width="24" height="24" fill="#1b1d21"/>';
  writeFileSync(join(out, 'preview-72.png'), render(svg(bg), 72));
  writeFileSync(join(out, 'preview-512.png'), render(svg(bg), 512));
}
console.log(`notification-icon.png -> ${out}`);
