/**
 * Renders the final review sheet as a PDF so the printable report can be
 * inspected: node tests/browser/print.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { server, PORT } = require('../../tools/serve.js');

const OUT = path.join(__dirname, '..', '..', 'artifacts');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle' });
  await page.click('#loadDemo');
  await page.waitForTimeout(700);
  await page.click('#coursePicker .course-card >> nth=1');
  await page.waitForTimeout(700);
  await page.fill('#instructor', 'Dr. A. Menon');
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(700);
  await page.fill('#cutoff-A', '78');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(500);
  await page.click('#configureActions button:has-text("Review & finalize")');
  await page.waitForTimeout(900);

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'print-preview.png'), fullPage: true });
  await page.pdf({ path: path.join(OUT, 'grade-report.pdf'), format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  console.log('page errors:', errors.length ? errors : 'none');
  console.log('wrote artifacts/grade-report.pdf and artifacts/print-preview.png');
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
