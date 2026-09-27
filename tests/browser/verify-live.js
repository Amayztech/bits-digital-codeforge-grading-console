/**
 * Verifies the DEPLOYED site, not the local one.
 *   node tests/browser/verify-live.js [url]
 *
 * Loads the public URL in Chromium and drives the whole workflow, so a broken
 * asset path under a /<repo>/ subdirectory cannot pass unnoticed.
 */
'use strict';

const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://ayeshh11.github.io/bits-digital-codeforge-grading-console/';

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
  console.log('\nVerifying ' + URL + '\n');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => failedRequests.push(r.url() + ' ' + (r.failure() || {}).errorText));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url()); });

  const downloads = [];
  page.on('download', (d) => downloads.push(d));

  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  check('page responds 200', resp.status() === 200, String(resp.status()));
  check('page title is correct', (await page.title()).includes('Grading Workspace'));
  check('no failed asset requests', failedRequests.length === 0, failedRequests.join(' | '));

  // Subdirectory asset resolution
  check('stylesheet loaded from the subdirectory', await page.evaluate(() => {
    return getComputedStyle(document.body).backgroundColor === 'rgb(243, 243, 242)';
  }));
  check('vendored SheetJS loaded', await page.evaluate(() => typeof window.XLSX === 'object' && !!window.XLSX.read));
  check('app namespace present', await page.evaluate(() => !!(window.CF && window.CF.grading && window.CF.app)));
  check('favicon resolves', await page.evaluate(async () => {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return false;
    const r = await fetch(link.href);
    return r.ok && r.headers.get('content-type').indexOf('image/') === 0;
  }));
  check('apple-touch-icon resolves', await page.evaluate(async () => {
    const link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) return false;
    const r = await fetch(link.href);
    return r.ok;
  }));
  check('brand crest loads', await page.evaluate(() => {
    const img = document.querySelector('.brand__mark img');
    return !!(img && img.complete && img.naturalWidth > 0);
  }));
  check('brand crest is served as WebP with a PNG fallback', await page.evaluate(() => {
    const picture = document.querySelector('.brand__mark');
    const src = picture.querySelector('source');
    const img = picture.querySelector('img');
    return !!(src && src.getAttribute('type') === 'image/webp' && img && img.getAttribute('src').endsWith('.png'));
  }));
  check('template workbook downloads', await page.evaluate(async () => {
    const r = await fetch(new URL('samples/template-marks.xlsx', document.baseURI).href);
    return r.ok && r.headers.get('content-length') > 1000;
  }));
  check('sample workbook downloads', await page.evaluate(async () => {
    const r = await fetch(new URL('samples/sample-marks.xlsx', document.baseURI).href);
    return r.ok && r.headers.get('content-length') > 1000;
  }));

  // Full workflow
  await page.click('#loadDemo');
  await page.waitForTimeout(900);
  check('demo class loads', (await page.locator('#coursePicker .course-card').count()) === 4);
  await page.click('#coursePicker .course-card >> nth=0');
  await page.waitForTimeout(800);
  check('course selection works', await page.locator('#stage-analyse').isVisible());
  check('statistics rendered', (await page.locator('#statsGrid .stat').count()) === 8);
  check('chart drawn', (await page.locator('#chartAnalyse svg').count()) === 1);

  await page.fill('#instructor', 'Live Check');
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(700);
  check('band editor rendered', (await page.locator('#bandEditor .cutoff__input').count()) === 7);
  await page.fill('#cutoff-A', '85');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(600);
  check('cutoff applied', await page.evaluate(() => window.CF.app.state.cutoffs[0] === 85));
  check('impact reported', (await page.locator('#impactPanel').innerText()).includes('change grade'));

  await page.click('#configureActions button:has-text("Review & finalize")');
  await page.waitForTimeout(900);
  check('review sheet rendered', (await page.locator('.sheet').count()) === 1);
  check('review chart drawn', (await page.locator('#chartReview svg').count()) === 1);
  await page.locator('#reviewBody button:has-text("Finalize & export")').click();
  await page.waitForTimeout(400);
  check('confirmation shown', (await page.locator('.modal').count()) === 1);
  downloads.length = 0;
  await page.locator('.modal button:has-text("Finalize and download")').click();
  for (let i = 0; i < 80 && downloads.length < 2; i++) await page.waitForTimeout(100);
  check('both files downloaded from the live site', downloads.length === 2, JSON.stringify(downloads.map((d) => d.suggestedFilename())));
  check('grade file name is correct', /BITSID-grades_CS101_\d{4}-\d{2}-\d{2}-\d{4}\.csv/.test(downloads[0] ? downloads[0].suggestedFilename() : ''), downloads[0] && downloads[0].suggestedFilename());
  await page.waitForTimeout(600);
  check('receipt shown', (await page.locator('#reviewBody .receipt').count()) === 1);
  await page.screenshot({ path: 'artifacts/screenshots/live-finalized.png', fullPage: true });

  check('no console or page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n' + '-'.repeat(64));
  if (fail) {
    console.log('\x1b[31m' + fail + ' failing\x1b[0m, ' + pass + ' passing');
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('\x1b[32m' + pass + ' passing, 0 failing — the deployed site works end to end\x1b[0m');
})().catch((e) => { console.error(e); process.exit(1); });
