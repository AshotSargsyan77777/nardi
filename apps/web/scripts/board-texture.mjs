/**
 * Renders the static wooden board (frame, inlaid points, hinge bar, tray) to
 * apps/web/public/board/board.webp. Wood grain is made with SVG noise filters, which are too heavy
 * to run live on phones, so it is baked once into an image and the live SVG draws only the
 * checkers, dice and highlights on top.
 *
 *   node apps/web/scripts/board-texture.mjs        (needs Playwright's Chromium)
 *
 * The geometry must match components/game/Board.tsx.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// ---- geometry (keep in sync with Board.tsx) ----
const VW = 1000, VH = 720, M = 24, OFF_W = 62, BAR_W = 46, GAP = 10;
const HALF = (VW - 2 * M - OFF_W - GAP - BAR_W) / 2;
const W = HALF / 6;
const X0 = M, Y0 = M, Y1 = VH - M;
const TRI_H = (Y1 - Y0) * 0.42;
const BAR_X = X0 + HALF;
const OFF_X = VW - M - OFF_W;
const colX = (col) => X0 + (col < 6 ? col * W : HALF + BAR_W + (col - 6) * W) + W / 2;

const grain = (id, fx, fy, color, opacity, seed) => `
  <filter id="${id}" x="0" y="0" width="${VW}" height="${VH}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="5" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.3" result="a"/>
    <feComponentTransfer in="a" result="bands"><feFuncA type="table" tableValues="0 .85 .15 .7 .05 .9 .2 .6 .1 .8 0"/></feComponentTransfer>
    <feTurbulence type="fractalNoise" baseFrequency="${fx * 6} ${fy * 9}" numOctaves="2" seed="${seed + 11}" result="p"/>
    <feColorMatrix in="p" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 2.2 0 -1.05" result="pores"/>
    <feComposite in="bands" in2="pores" operator="arithmetic" k2="0.75" k3="0.5" result="mix"/>
    <feFlood flood-color="${color}" flood-opacity="${opacity}"/>
    <feComposite in2="mix" operator="in" result="ink"/>
    <feComposite in="ink" in2="SourceGraphic" operator="atop"/>
  </filter>`;

const triangles = (dark) => {
  let s = '';
  for (let col = 0; col < 12; col++) for (const top of [true, false]) {
    const isDark = col % 2 === (top ? 0 : 1);
    if (isDark !== dark) continue;
    const x = colX(col), base = top ? Y0 : Y1, tip = top ? Y0 + TRI_H : Y1 - TRI_H;
    s += `<polygon points="${x - W / 2 + 3},${base} ${x + W / 2 - 3},${base} ${x},${tip}"/>`;
  }
  return s;
};
const triEdges = () => {
  let s = '';
  for (let col = 0; col < 12; col++) for (const top of [true, false]) {
    const x = colX(col), base = top ? Y0 : Y1, tip = top ? Y0 + TRI_H : Y1 - TRI_H;
    s += `<polyline points="${x - W / 2 + 3},${base} ${x},${tip} ${x + W / 2 - 3},${base}" fill="none" stroke="#f3dca9" stroke-opacity=".28" stroke-width="1.6"/>`;
    s += `<polyline points="${x - W / 2 + 6},${base} ${x},${tip + (top ? -7 : 7)} ${x + W / 2 - 6},${base}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>`;
  }
  return s;
};

const fields = [
  { x: X0, w: HALF },
  { x: BAR_X + BAR_W, w: HALF },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VW * 2}" height="${VH * 2}" viewBox="0 0 ${VW} ${VH}">
<defs>
  ${grain('g-frame', 0.004, 0.05, '#0d0500', 0.75, 4)}
  ${grain('g-field', 0.006, 0.03, '#5a3412', 0.38, 9)}
  ${grain('g-pt', 0.04, 0.005, '#0d0602', 0.55, 21)}
  ${grain('g-bar', 0.09, 0.003, '#120802', 0.55, 33)}
  <linearGradient id="frameLight" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/>
  </linearGradient>
  <linearGradient id="fieldLight" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#fff5e0" stop-opacity=".18"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#3a1e08" stop-opacity=".22"/>
  </linearGradient>
  <radialGradient id="vignette" cx=".5" cy=".5" r=".75">
    <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/>
  </radialGradient>
  <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f6dc95"/><stop offset=".45" stop-color="#b8892f"/><stop offset=".55" stop-color="#d9b25a"/><stop offset="1" stop-color="#6e4c16"/>
  </linearGradient>
  <filter id="inset" x="-5%" y="-5%" width="110%" height="110%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>
  ${fields.map((f, i) => `<clipPath id="clip${i}"><rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" rx="5"/></clipPath>`).join('')}
  <clipPath id="clipTray"><rect x="${OFF_X}" y="${Y0}" width="${OFF_W}" height="${Y1 - Y0}" rx="7"/></clipPath>
</defs>

<!-- frame: dark walnut -->
<g filter="url(#g-frame)"><rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="#5b3418"/></g>
<rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="url(#frameLight)"/>
<rect x="1.5" y="1.5" width="${VW - 3}" height="${VH - 3}" rx="21" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
<rect x="5" y="5" width="${VW - 10}" height="${VH - 10}" rx="18" fill="none" stroke="#e7b77a" stroke-opacity=".22" stroke-width="1.5"/>
<rect x="${M - 9}" y="${M - 9}" width="${VW - 2 * M + 18}" height="${VH - 2 * M + 18}" rx="12" fill="none" stroke="#d6a45a" stroke-opacity=".35" stroke-width="1.2"/>

<!-- playing fields: light beech, with inlaid points -->
${fields.map((f, i) => `
<g clip-path="url(#clip${i})">
  <g filter="url(#g-field)"><rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" fill="#d8b07a"/></g>
</g>`).join('')}
<g filter="url(#g-pt)" fill="#4a2a16">${triangles(true)}</g>
<g filter="url(#g-pt)" fill="#8e3a22">${triangles(false)}</g>
${triEdges()}
${fields.map((f, i) => `
<g clip-path="url(#clip${i})">
  <rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" fill="url(#fieldLight)"/>
  <rect x="${f.x - 8}" y="${Y0 - 8}" width="${f.w + 16}" height="${Y1 - Y0 + 16}" fill="none" stroke="#1d0e04" stroke-opacity=".75" stroke-width="18" filter="url(#inset)"/>
  <circle cx="${f.x + f.w / 2}" cy="${(Y0 + Y1) / 2}" r="34" fill="none" stroke="#6b3d17" stroke-opacity=".28" stroke-width="1.5"/>
  <path d="M${f.x + f.w / 2 - 24},${(Y0 + Y1) / 2} L${f.x + f.w / 2},${(Y0 + Y1) / 2 - 24} L${f.x + f.w / 2 + 24},${(Y0 + Y1) / 2} L${f.x + f.w / 2},${(Y0 + Y1) / 2 + 24} Z" fill="none" stroke="#6b3d17" stroke-opacity=".25" stroke-width="1.5"/>
</g>
<rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" rx="5" fill="none" stroke="#f0cf96" stroke-opacity=".25" stroke-width="1"/>`).join('')}

<!-- hinge bar -->
<g filter="url(#g-bar)"><rect x="${BAR_X + 3}" y="${Y0 - 6}" width="${BAR_W - 6}" height="${Y1 - Y0 + 12}" rx="5" fill="#4d2b13"/></g>
<rect x="${BAR_X + 3}" y="${Y0 - 6}" width="${BAR_W - 6}" height="${Y1 - Y0 + 12}" rx="5" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="2"/>
<line x1="${BAR_X + BAR_W / 2}" y1="${Y0}" x2="${BAR_X + BAR_W / 2}" y2="${Y1}" stroke="#000" stroke-opacity=".55" stroke-width="2"/>
<line x1="${BAR_X + BAR_W / 2 + 1.5}" y1="${Y0}" x2="${BAR_X + BAR_W / 2 + 1.5}" y2="${Y1}" stroke="#e8b878" stroke-opacity=".18" stroke-width="1"/>
${[Y0 + 70, Y1 - 70 - 64].map((y) => `
<g>
  <rect x="${BAR_X + 9}" y="${y + 2}" width="${BAR_W - 18}" height="64" rx="4" fill="#000" opacity=".35" filter="url(#soft)"/>
  <rect x="${BAR_X + 8}" y="${y}" width="${BAR_W - 16}" height="64" rx="4" fill="url(#brass)"/>
  <rect x="${BAR_X + 8}" y="${y}" width="${BAR_W - 16}" height="64" rx="4" fill="none" stroke="#4a3008" stroke-width="1"/>
  <line x1="${BAR_X + BAR_W / 2}" y1="${y + 2}" x2="${BAR_X + BAR_W / 2}" y2="${y + 62}" stroke="#4a3008" stroke-width="1.2"/>
  ${[12, 32, 52].map((dy) => `<circle cx="${BAR_X + 15}" cy="${y + dy}" r="2.6" fill="#5a3c0c"/><circle cx="${BAR_X + BAR_W - 15}" cy="${y + dy}" r="2.6" fill="#5a3c0c"/>`).join('')}
</g>`).join('')}

<!-- tray for borne-off checkers -->
<g clip-path="url(#clipTray)">
  <g filter="url(#g-bar)"><rect x="${OFF_X}" y="${Y0}" width="${OFF_W}" height="${Y1 - Y0}" fill="#3a200d"/></g>
  <rect x="${OFF_X - 8}" y="${Y0 - 8}" width="${OFF_W + 16}" height="${Y1 - Y0 + 16}" fill="none" stroke="#000" stroke-opacity=".8" stroke-width="18" filter="url(#inset)"/>
  <line x1="${OFF_X}" y1="${(Y0 + Y1) / 2}" x2="${OFF_X + OFF_W}" y2="${(Y0 + Y1) / 2}" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
  <line x1="${OFF_X}" y1="${(Y0 + Y1) / 2 + 2}" x2="${OFF_X + OFF_W}" y2="${(Y0 + Y1) / 2 + 2}" stroke="#e8b878" stroke-opacity=".15" stroke-width="1"/>
</g>
<rect x="${OFF_X}" y="${Y0}" width="${OFF_W}" height="${Y1 - Y0}" rx="7" fill="none" stroke="#e7b77a" stroke-opacity=".2" stroke-width="1"/>

<rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="url(#vignette)"/>
</svg>`;

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/board');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board-source.svg'), svg);

const browser = await chromium.launch();
const page = await browser.newPage();
const data = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.84);
}, svg);
await browser.close();
writeFileSync(join(out, 'board.webp'), Buffer.from(data.split(',')[1], 'base64'));
console.log('board.webp', Math.round((data.length * 3) / 4 / 1024), 'KB');
