// Renders the PWA / home-screen PNG icons from public/icons/icon.svg.
// Usage: npm run icons   (set CHROME=/path/to/chrome to use a specific browser)

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
// Full-bleed variant: square background, artwork shrunk into the centre.
const fullBleed = (scale) => {
  const off = (512 * (1 - scale)) / 2;
  return svg
    .replace('<rect width="512" height="512" rx="112" fill="url(#bg)"/>',
      `<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(${off} ${off}) scale(${scale})">`)
    .replace('</svg>', '</g></svg>');
};
const jobs = [
  ['public/icons/icon-192.png', svg, 192],
  ['public/icons/icon-512.png', svg, 512],
  ['public/icons/icon-maskable-512.png', fullBleed(0.78), 512],
  ['public/icons/apple-touch-icon.png', fullBleed(0.9), 180],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
for (const [out, markup, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  await page.screenshot({ path: out, omitBackground: true });
  console.log('wrote', out);
}
await browser.close();
