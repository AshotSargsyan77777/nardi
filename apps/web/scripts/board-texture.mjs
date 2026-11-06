/**
 * Renders the static wooden board (frame, inlaid points, hinge bar, tray) to
 * apps/web/public/board/<theme>.webp (one image per board theme). Wood grain is made with SVG noise filters, which are too heavy
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
  <filter id="${id}" x="0" y="0" width="1000" height="1000" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
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

const felt = (id, color) => `
  <filter id="${id}" x="0" y="0" width="1000" height="1000" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1.4 0 -0.45" result="a"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="8" result="m"/>
    <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 -0.35" result="b"/>
    <feComposite in="a" in2="b" operator="arithmetic" k2="0.6" k3="0.5" result="mix"/>
    <feFlood flood-color="${color}" flood-opacity="0.5"/>
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

const buildSvg = (T) => `<svg xmlns="http://www.w3.org/2000/svg" width="${VW * 2}" height="${VH * 2}" viewBox="0 0 ${VW} ${VH}">
<defs>
  ${grain('g-frame', 0.004, 0.05, T.frameInk, 0.75, 4)}
  ${(T.felt ? felt('g-field', T.fieldInk) : grain('g-field', 0.006, 0.03, T.fieldInk, T.fieldInkOp ?? 0.38, 9))}
  ${grain('g-pt', 0.04, 0.005, '#0d0602', 0.55, 21)}
  ${grain('g-bar', 0.09, 0.003, '#120802', 0.55, 33)}
  <linearGradient id="frameLight" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/>
  </linearGradient>
  <linearGradient id="fieldLight" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#fff5e0" stop-opacity=".18"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/>
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
<g filter="url(#g-frame)"><rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="${T.frame}"/></g>
<rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="url(#frameLight)"/>
<rect x="1.5" y="1.5" width="${VW - 3}" height="${VH - 3}" rx="21" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
<rect x="5" y="5" width="${VW - 10}" height="${VH - 10}" rx="18" fill="none" stroke="#e7b77a" stroke-opacity=".22" stroke-width="1.5"/>
<rect x="${M - 9}" y="${M - 9}" width="${VW - 2 * M + 18}" height="${VH - 2 * M + 18}" rx="12" fill="none" stroke="${T.line}" stroke-opacity=".35" stroke-width="1.2"/>

<!-- playing fields: light beech, with inlaid points -->
${fields.map((f, i) => `
<g clip-path="url(#clip${i})">
  <g filter="url(#g-field)"><rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" fill="${T.field}"/></g>
</g>`).join('')}
<g filter="url(#g-pt)" fill="${T.ptA}">${triangles(true)}</g>
<g filter="url(#g-pt)" fill="${T.ptB}">${triangles(false)}</g>
${triEdges()}
${fields.map((f, i) => `
<g clip-path="url(#clip${i})">
  <rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" fill="url(#fieldLight)"/>
  <rect x="${f.x - 8}" y="${Y0 - 8}" width="${f.w + 16}" height="${Y1 - Y0 + 16}" fill="none" stroke="#1d0e04" stroke-opacity=".75" stroke-width="18" filter="url(#inset)"/>
  <circle cx="${f.x + f.w / 2}" cy="${(Y0 + Y1) / 2}" r="34" fill="none" stroke="${T.orn}" stroke-opacity=".28" stroke-width="1.5"/>
  <path d="M${f.x + f.w / 2 - 24},${(Y0 + Y1) / 2} L${f.x + f.w / 2},${(Y0 + Y1) / 2 - 24} L${f.x + f.w / 2 + 24},${(Y0 + Y1) / 2} L${f.x + f.w / 2},${(Y0 + Y1) / 2 + 24} Z" fill="none" stroke="${T.orn}" stroke-opacity=".25" stroke-width="1.5"/>
</g>
<rect x="${f.x}" y="${Y0}" width="${f.w}" height="${Y1 - Y0}" rx="5" fill="none" stroke="#f0cf96" stroke-opacity=".25" stroke-width="1"/>`).join('')}

<!-- hinge bar -->
<g filter="url(#g-bar)"><rect x="${BAR_X + 3}" y="${Y0 - 6}" width="${BAR_W - 6}" height="${Y1 - Y0 + 12}" rx="5" fill="${T.bar}"/></g>
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
  <g filter="url(#g-bar)"><rect x="${OFF_X}" y="${Y0}" width="${OFF_W}" height="${Y1 - Y0}" fill="${T.tray}"/></g>
  <rect x="${OFF_X - 8}" y="${Y0 - 8}" width="${OFF_W + 16}" height="${Y1 - Y0 + 16}" fill="none" stroke="#000" stroke-opacity=".8" stroke-width="18" filter="url(#inset)"/>
  <line x1="${OFF_X}" y1="${(Y0 + Y1) / 2}" x2="${OFF_X + OFF_W}" y2="${(Y0 + Y1) / 2}" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
  <line x1="${OFF_X}" y1="${(Y0 + Y1) / 2 + 2}" x2="${OFF_X + OFF_W}" y2="${(Y0 + Y1) / 2 + 2}" stroke="#e8b878" stroke-opacity=".15" stroke-width="1"/>
</g>
<rect x="${OFF_X}" y="${Y0}" width="${OFF_W}" height="${Y1 - Y0}" rx="7" fill="none" stroke="#e7b77a" stroke-opacity=".2" stroke-width="1"/>

<rect x="0" y="0" width="${VW}" height="${VH}" rx="22" fill="url(#vignette)"/>
</svg>`;

// keep ids in sync with lib/look.ts
const THEMES = {
  walnut: { frame: '#5b3418', frameInk: '#0d0500', field: '#d8b07a', fieldInk: '#5a3412', ptA: '#4a2a16', ptB: '#8e3a22', bar: '#4d2b13', tray: '#3a200d', line: '#d6a45a', orn: '#6b3d17' },
  oak: { frame: '#a77442', frameInk: '#3a1d06', field: '#ead2a6', fieldInk: '#8a5a26', fieldInkOp: 0.3, ptA: '#6b4a2a', ptB: '#3f5a3a', bar: '#8f6034', tray: '#6e4622', line: '#f3d39a', orn: '#8a5a26' },
  felt: { frame: '#5a2414', frameInk: '#120400', field: '#1f6a49', fieldInk: '#000', felt: true, ptA: '#efe2c2', ptB: '#0f3d29', bar: '#4a1c0e', tray: '#2a0f06', line: '#d9a25a', orn: '#9fd2b4' },
  ebony: { frame: '#26201d', frameInk: '#000', field: '#3a3330', fieldInk: '#000', fieldInkOp: 0.45, ptA: '#b8a27a', ptB: '#8f1e1e', bar: '#1b1614', tray: '#120e0c', line: '#c9a86a', orn: '#c9a86a' },
  pomegranate: { frame: '#5e1420', frameInk: '#140003', field: '#e4c79a', fieldInk: '#6e3b18', fieldInkOp: 0.3, ptA: '#7a1424', ptB: '#b5852f', bar: '#4a0f19', tray: '#2e0910', line: '#e8c06a', orn: '#9a2a36' },
};

/** The 8×8 board for chess and checkers (1000×1000; coordinates are drawn live). Keep in sync with SquareBoard.tsx. */
const SQ_M = 40;
const SQ = (1000 - 2 * SQ_M) / 8;
const SQUARES = {
  'squares-walnut': { frame: '#4f2c14', frameInk: '#0d0500', light: '#e6c493', lightInk: '#8a5a26', dark: '#86532e', darkInk: '#1e0d03', line: '#d6a45a' },
  'squares-green': { frame: '#3b2414', frameInk: '#0d0500', light: '#eeeed2', lightInk: '#9a9a70', dark: '#6f9450', darkInk: '#1f3010', line: '#c9a86a' },
};
const buildSquares = (T) => {
  let light = '', dark = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const rect = `<rect x="${SQ_M + c * SQ}" y="${SQ_M + r * SQ}" width="${SQ + 0.5}" height="${SQ + 0.5}"/>`;
    if ((r + c) % 2) dark += rect; else light += rect;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" viewBox="0 0 1000 1000">
<defs>
  ${grain('g-frame', 0.004, 0.05, T.frameInk, 0.75, 4)}
  ${grain('g-light', 0.006, 0.03, T.lightInk, 0.32, 12)}
  ${grain('g-dark', 0.03, 0.006, T.darkInk, 0.45, 17)}
  <linearGradient id="frameLight" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
  <filter id="inset" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="6"/></filter>
  <clipPath id="field"><rect x="${SQ_M}" y="${SQ_M}" width="${1000 - 2 * SQ_M}" height="${1000 - 2 * SQ_M}"/></clipPath>
</defs>
<g filter="url(#g-frame)"><rect width="1000" height="1000" rx="22" fill="${T.frame}"/></g>
<rect width="1000" height="1000" rx="22" fill="url(#frameLight)"/>
<rect x="1.5" y="1.5" width="997" height="997" rx="21" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
<rect x="6" y="6" width="988" height="988" rx="17" fill="none" stroke="#e7b77a" stroke-opacity=".2" stroke-width="1.5"/>
<g filter="url(#g-light)" fill="${T.light}">${light}</g>
<g filter="url(#g-dark)" fill="${T.dark}">${dark}</g>
<g clip-path="url(#field)">
  <rect x="${SQ_M}" y="${SQ_M}" width="${1000 - 2 * SQ_M}" height="${1000 - 2 * SQ_M}" fill="url(#sheen)"/>
  <rect x="${SQ_M - 8}" y="${SQ_M - 8}" width="${1000 - 2 * SQ_M + 16}" height="${1000 - 2 * SQ_M + 16}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="16" filter="url(#inset)"/>
</g>
<rect x="${SQ_M - 4}" y="${SQ_M - 4}" width="${1000 - 2 * SQ_M + 8}" height="${1000 - 2 * SQ_M + 8}" fill="none" stroke="${T.line}" stroke-opacity=".55" stroke-width="2.5"/>
</svg>`;
};

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/board');
mkdirSync(out, { recursive: true });
const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [...Object.entries(THEMES).map(([id, T]) => [id, buildSvg(T)]), ...Object.entries(SQUARES).map(([id, T]) => [id, buildSquares(T)])];
for (const [id, svgSrc] of jobs) {
  if (only && only !== id) continue;
  const data = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.84);
  }, svgSrc);
  writeFileSync(join(out, `${id}.webp`), Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${id}.webp`, Math.round((data.length * 3) / 4 / 1024), 'KB');
}
await browser.close();
