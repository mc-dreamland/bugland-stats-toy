// SPDX-License-Identifier: AGPL-3.0-only
// From the repo root, run: node assets/release/render.mjs
// Puppeteer Core is loaded from .tmp/pp/node_modules by default.
// Set PUPPETEER_CORE to its package directory or entry file to override.
// Set EDGE_PATH to override the default Microsoft Edge executable on Windows.

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../.tmp/pp/package.json', import.meta.url));
const puppeteer = require(process.env.PUPPETEER_CORE ? resolve(process.env.PUPPETEER_CORE) : 'puppeteer-core');
const executablePath = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const renders = [
  { source: 'cover', name: 'cover-1920x1080', width: 1920, height: 1080 },
  { source: 'cover', name: 'cover-1280x720', width: 1280, height: 720 },
  { source: 'cover', name: 'cover-1080x1440', width: 1080, height: 1440 },
  { source: 'icon', name: 'icon-1024', width: 1024, height: 1024 },
  { source: 'icon', name: 'icon-512', width: 512, height: 512 },
];

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (const { source, name, width, height } of renders) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(new URL(`src/${source}.html`, import.meta.url).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}.png`, import.meta.url)),
      type: 'png',
      omitBackground: false,
    });
    console.log(`${name}.png (${width} × ${height})`);
  }
} finally {
  await browser.close();
}
