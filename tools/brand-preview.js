/**
 * Renders the header at high device scale so the crest can be inspected.
 *   node tools/brand-preview.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { server, PORT } = require('./serve.js');

const OUT = path.join(__dirname, '..', 'artifacts', 'screenshots');

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });

  for (const [w, dsf, tag] of [[1440, 4, 'brand-desktop-4x'], [390, 4, 'brand-mobile-4x']]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: 400 },
      deviceScaleFactor: dsf
    });
    const page = await ctx.newPage();
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const header = await page.locator('.app-header').boundingBox();
    await page.screenshot({
      path: path.join(OUT, tag + '.png'),
      clip: { x: 0, y: 0, width: w, height: Math.ceil(header.height) }
    });
    const box = await page.locator('.brand').boundingBox();
    console.log(tag + ': brand block ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' at ' + dsf + 'x');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('wrote artifacts/screenshots/brand-desktop-4x.png and brand-mobile-4x.png');
})().catch((e) => { console.error(e); process.exit(1); });
