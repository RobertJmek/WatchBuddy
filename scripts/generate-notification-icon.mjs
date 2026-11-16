// Android status-bar icon for push notifications (expo-notifications `icon`):
// the app's two-ticket artwork (assets/images/icon.png, since 1.9.7) as one
// white silhouette on transparent. Android paints this icon in a single colour,
// so the tickets are told apart by a transparent gap and the barcode and
// perforation are holes, drawn thick enough to survive 24dp.
//
//   node scripts/generate-notification-icon.mjs            → preview in /private/tmp/wb-notif
//   node scripts/generate-notification-icon.mjs --write    → assets/images/notification-icon.png

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// A ticket centred on the origin: rounded corners, a round notch in each short side.
function ticket(w, h, r, n) {
  const x = w / 2;
  const y = h / 2;
  return [
    `M ${-x + r} ${-y} H ${x - r} A ${r} ${r} 0 0 1 ${x} ${-y + r}`,
    `V ${-n} A ${n} ${n} 0 0 0 ${x} ${n}`,
    `V ${y - r} A ${r} ${r} 0 0 1 ${x - r} ${y} H ${-x + r} A ${r} ${r} 0 0 1 ${-x} ${y - r}`,
    `V ${n} A ${n} ${n} 0 0 0 ${-x} ${-n}`,
    `V ${-y + r} A ${r} ${r} 0 0 1 ${-x + r} ${-y} Z`,
  ].join(' ');
}

const rect = (x, y, w, h) => `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;

// Proportions and angles read off the artwork: the cream ticket behind, tilted
// up, and the teal one in front, almost level.
const W = 440;
const H = 190;
const body = ticket(W, H, 26, 34);
// Holes in the front ticket: four barcode bars and a three-dash perforation.
const holes = [
  rect(-150, -52, 30, 104),
  rect(-104, -52, 16, 104),
  rect(-72, -52, 38, 104),
  rect(-18, -52, 16, 104),
  rect(84, -64, 14, 30),
  rect(84, -15, 14, 30),
  rect(84, 34, 14, 30),
].join(' ');

const BACK = 'translate(470 420) rotate(-26)';
const FRONT = 'translate(520 575) rotate(-9)';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="190 170 640 640">
  <defs>
    <mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="white"/>
      <path d="${body}" transform="${FRONT}" fill="black" stroke="black" stroke-width="72" stroke-linejoin="round"/>
    </mask>
  </defs>
  <path d="${body}" transform="${BACK}" fill="white" mask="url(#gap)"/>
  <path d="${body} ${holes}" transform="${FRONT}" fill="white" fill-rule="evenodd"/>
</svg>`;

function render(width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();
}

const out = WRITE ? join(ROOT, 'assets', 'images') : '/private/tmp/wb-notif';
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'notification-icon.png'), render(96));
if (!WRITE) {
  // White on a dark status bar at real size (24dp at 3x) and blown up.
  for (const [w, name] of [[72, 'preview-72.png'], [512, 'preview-512.png']]) {
    const dark = new Resvg(svg.replace('<defs>', '<rect x="190" y="170" width="640" height="640" fill="#1b1d21"/><defs>'), {
      fitTo: { mode: 'width', value: w },
    });
    writeFileSync(join(out, name), dark.render().asPng());
  }
}
console.log(`notification-icon.png -> ${out}`);
