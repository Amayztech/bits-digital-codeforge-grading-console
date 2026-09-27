/**
 * Verifies the console works when index.html is opened directly from disk.
 *   node tests/browser/verify-file-protocol.js
 *
 * The scripts are classic scripts rather than ES modules specifically so this
 * works; this check makes sure the claim stays true.
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const FILE = pathToFileURL(path.join(__dirname, '..', '..', 'index.html')).href;

let pass = 0;
let fail = 0;
const problems = [];
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    fail++;
    problems.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' \x1b[31m' + detail + '\x1b[0m' : ''));
  }
}

(async () => {
  console.log('\nVerifying ' + FILE + '\n');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const downloads = [];
  page.on('download', (d) => downloads.push(d));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  check('page loads from file://', (await page.title()).includes('Grading Workspace'));
  check('stylesheet applied', await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(242, 244, 247)'));
  check('vendored SheetJS loaded', await page.evaluate(() => typeof window.XLSX === 'object' && !!window.XLSX.read));
  check('no script errors', errors.length === 0, errors.join(' | '));

  await page.click('#loadDemo');
  await page.waitForTimeout(800);
  check('demo class loads', (await page.locator('#coursePicker .course-card').count()) === 4);
  await page.click('#coursePicker .course-card >> nth=0');
  await page.waitForTimeout(700);
  check('workflow advances', await page.locator('#stage-analyse').isVisible());
  await page.fill('#instructor', 'File Protocol Check');
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(600);
  await page.fill('#cutoff-A', '84');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(500);
  await page.click('#configureActions button:has-text("Review & finalize")');
  await page.waitForTimeout(700);
  await page.locator('#reviewBody button:has-text("Finalize & export")').click();
  await page.waitForTimeout(300);
  downloads.length = 0;
  await page.locator('.modal button:has-text("Finalize and download")').click();
  for (let i = 0; i < 60 && downloads.length < 2; i++) await page.waitForTimeout(100);
  check('both files download from file://', downloads.length === 2, JSON.stringify(downloads.map((d) => d.suggestedFilename())));
  check('no errors during the full workflow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n' + '-'.repeat(64));
  if (fail) {
    console.log('\x1b[31m' + fail + ' failing\x1b[0m, ' + pass + ' passing');
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('\x1b[32m' + pass + ' passing, 0 failing — the console works opened directly from disk\x1b[0m');
})().catch((e) => { console.error(e); process.exit(1); });
