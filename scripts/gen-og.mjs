// scripts/gen-og.mjs
//
// Generates public/og-image.png (1200x630) — the Open Graph / Twitter share
// card for the site. Original artwork (brand teal gradient, capsule mark, a
// small decorative molecule) rasterized from an inline SVG via sharp.
//
// Run from the site/ directory:
//   node scripts/gen-og.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'public', 'og-image.png');

const FONT =
  "'Microsoft YaHei','微软雅黑','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC','SimHei',sans-serif";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#115e59"/>
      <stop offset="0.55" stop-color="#0f766e"/>
      <stop offset="1" stop-color="#0b3b38"/>
    </linearGradient>
    <linearGradient id="pill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#99f6e4"/>
      <stop offset="1" stop-color="#2dd4bf"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <g stroke="#ccfbf1" stroke-opacity="0.22" stroke-width="3" fill="none">
    <line x1="1000" y1="120" x2="1095" y2="78"/>
    <line x1="1000" y1="120" x2="985" y2="220"/>
    <line x1="1095" y1="78" x2="1160" y2="168"/>
    <line x1="1160" y1="168" x2="1075" y2="222"/>
    <line x1="1075" y1="222" x2="985" y2="220"/>
    <line x1="1075" y1="222" x2="1000" y2="120"/>
  </g>
  <g fill="#ccfbf1" fill-opacity="0.55">
    <circle cx="1000" cy="120" r="13"/>
    <circle cx="1095" cy="78" r="11"/>
    <circle cx="1160" cy="168" r="10"/>
    <circle cx="1075" cy="222" r="11"/>
    <circle cx="985" cy="220" r="9"/>
  </g>

  <g transform="translate(120 96) rotate(-28)">
    <rect x="0" y="0" width="122" height="52" rx="26" fill="url(#pill)"/>
    <rect x="0" y="0" width="61" height="52" rx="26" fill="#ffffff"/>
    <line x1="61" y1="6" x2="61" y2="46" stroke="#0f766e" stroke-opacity="0.3" stroke-width="2.5"/>
  </g>

  <text x="118" y="336" font-family="${FONT}" font-size="152" font-weight="800" fill="#ffffff" letter-spacing="8">药知道</text>
  <text x="122" y="410" font-family="${FONT}" font-size="38" fill="#ccfbf1">用大白话和原创动画，讲清药物如何起作用</text>
  <rect x="124" y="440" width="150" height="6" rx="3" fill="#5eead4"/>
  <text x="122" y="566" font-family="${FONT}" font-size="28" fill="#5eead4" letter-spacing="3">pharmasimple.matata.fun</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
await sharp(png).toFile(outPath);
const meta = await sharp(outPath).metadata();
console.log(
  `OG image written: ${outPath} (${meta.width}x${meta.height}, ${(png.length / 1024).toFixed(1)} KB)`,
);
