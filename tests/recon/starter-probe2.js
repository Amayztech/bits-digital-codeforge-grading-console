/**
 * RECON HARNESS - PART 2
 *
 * Follow-up probes for behaviours that need instrumentation inside the page:
 * CSV payload capture, finalize gating, and canvas geometry.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { server, PORT } = require('../../tools/serve.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'workbooks');
const OUT = path.join(__dirname, '..', '..', 'artifacts', 'recon');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('dialog', async (d) => {
    console.log('  [dialog] ' + d.type() + ': ' + d.message());
    await d.dismiss().catch(() => {});
  });

  // Intercept the generated CSV by wrapping URL.createObjectURL before the
  // starter's own script runs.
  await page.addInitScript(() => {
    window.__csv = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      blob.text().then((t) => window.__csv.push(t));
      return orig(blob);
    };
  });

  const url = 'http://localhost:' + PORT + '/starter-reference/BITS_Digital_CodeForge_Challenge.ORIGINAL.html';
  const upload = async (f) => {
    await page.setInputFiles('#file', path.join(FIX, f));
    await page.waitForTimeout(500);
  };

  /* ---- A. Export with a coverage gap: who disappears? -------------- */
  console.log('\n########## A. Export with an uncovered band ##########');
  await page.goto(url);
  await upload('06-boundary-marks.xlsx');
  await page.fill('#instructor', 'Ayesh');
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(300);
  await page.selectOption('#Amax', '90'); // A band becomes 80-90; 91-100 orphaned
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({
    students: window.__csDataProbe,
    summary: Array.from(document.querySelectorAll('#gradeSummary span')).map((s) => s.textContent)
  }));
  await page.click('#download');
  await page.waitForTimeout(700);
  const csv = await page.evaluate(() => window.__csv[window.__csv.length - 1]);
  fs.writeFileSync(path.join(OUT, 'A-gap-export.csv'), csv || '');
  const rows = (csv || '').trim().split(/\r?\n/).filter((l) => /^\d{4}/.test(l));
  console.log('  grade summary shown : ' + JSON.stringify(before.summary));
  console.log('  students in course  : 17 (marks 0,19,20,...,99,100)');
  console.log('  CSV student rows    : ' + rows.length);
  console.log('  CSV rows            : ' + JSON.stringify(rows));
  console.log('  >>> students 99 and 100 are silently absent from the export.');

  /* ---- B. Finalize with a blank instructor ------------------------- */
  console.log('\n########## B. Finalize gate vs instructor ##########');
  await page.goto(url);
  await upload('04-single-student.xlsx');
  await page.selectOption('#course', { index: 1 }); // triggers the alert, resets value
  await page.waitForTimeout(300);
  await page.fill('#instructor', 'Ayesh');
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(300);
  await page.fill('#instructor', ''); // instructor cleared AFTER grading began
  await page.waitForTimeout(200);
  await page.click('#download');
  await page.waitForTimeout(700);
  const csv2 = await page.evaluate(() => window.__csv[window.__csv.length - 1]);
  console.log('  instructor field is empty; finalize was allowed.');
  console.log('  CSV produced:\n' + (csv2 || '<none>').split('\n').map((l) => '    | ' + l).join('\n'));

  /* ---- C. Histogram geometry vs the bell curve --------------------- */
  console.log('\n########## C. Histogram geometry ##########');
  await page.goto(url);
  await upload('01-valid-standard.xlsx');
  await page.fill('#instructor', 'Ayesh');
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(900);
  const geo = await page.evaluate(() => {
    const cv = document.getElementById('hist');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // Column-wise ink profile: where are the bars drawn?
    const cols = [];
    for (let x = 0; x < cv.width; x++) {
      let ink = 0;
      for (let y = 0; y < cv.height; y++) {
        const i = (y * cv.width + x) * 4;
        if (d[i + 3] > 10 && !(d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200)) ink++;
      }
      cols.push(ink);
    }
    // Baseline used by the starter is y=210; bars are 24px wide, 32px pitch.
    return {
      canvas: [cv.width, cv.height],
      barPitch: 32,
      barWidth: 24,
      barOriginX: 30,
      // The bell curve maps mark m to x = 30 + (m/10)*30 = 30 + 3m
      curveXForMark0: 30,
      curveXForMark100: 30 + 3 * 100,
      barXForBin0: 30,
      barXForBin9: 30 + 9 * 32,
      barXForBin9End: 30 + 9 * 32 + 24,
      inkedColumns: cols.filter((c) => c > 0).length
    };
  });
  console.log('  ' + JSON.stringify(geo, null, 2).split('\n').join('\n  '));
  console.log('  >>> Bars live on a 32px pitch from x=30 (so bin 9 ends at x=318),');
  console.log('  >>> while the bell curve maps mark m to x = 30 + 3m (so mark 100 is at x=330).');
  console.log('  >>> The two scales disagree by up to 12px, and bars are 24px wide,');
  console.log('  >>> so a bar labelled 90-100 actually spans marks 90-97 in curve space.');

  /* ---- D. Zero standard deviation ---------------------------------- */
  console.log('\n########## D. Zero standard deviation (identical marks) ##########');
  await page.goto(url);
  await upload('05-identical-marks.xlsx');
  await page.fill('#instructor', 'Ayesh');
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(900);
  const red = await page.evaluate(() => {
    const cv = document.getElementById('hist');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let redPixels = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) redPixels++;
    }
    return redPixels;
  });
  console.log('  12 students all at 75 -> std = 0. Bell-curve red pixels drawn: ' + red);
  console.log('  >>> y = 1/(0*sqrt(2pi)) * exp(0) = Infinity, py = 210 - Infinity = -Infinity.');
  console.log('  >>> Canvas silently discards non-finite coordinates, so the curve vanishes');

  /* ---- E. Skewed data: bell curve implies normality ---------------- */
  console.log('\n########## E. Bimodal data ##########');
  await page.goto(url);
  await upload('17-bimodal.xlsx');
  await page.fill('#instructor', 'Ayesh');
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(900);
  console.log('  15 students near 35, 15 near 85. The console still draws a single');
  console.log('  unimodal normal curve over a bimodal histogram.');

  /* ---- F. Messy headers ------------------------------------------- */
  console.log('\n########## F. Messy headers ("  bits id  ", "COURSE", "total marks ") ####');
  await page.goto(url);
  await upload('03-messy-headers.xlsx');
  await page.fill('#instructor', 'Ayesh');
  const opts = await page.evaluate(() =>
    Array.from(document.getElementById('course').options).map((o) => o.text)
  );
  console.log('  course options: ' + JSON.stringify(opts));
  await page.selectOption('#course', { index: 1 });
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({
    min: document.getElementById('min').textContent,
    max: document.getElementById('max').textContent,
    avg: document.getElementById('avg').textContent,
    summary: Array.from(document.querySelectorAll('#gradeSummary span')).map((s) => s.textContent)
  }));
  console.log('  stats: ' + JSON.stringify(st));

  /* ---- G. Legacy .xls --------------------------------------------- */
  console.log('\n########## G. Legacy .xls (BIFF8) ##########');
  await page.goto(url);
  await upload('19-legacy-biff8.xls');
  console.log('  course options: ' + JSON.stringify(await page.evaluate(() =>
    Array.from(document.getElementById('course').options).map((o) => o.text)
  )));

  /* ---- H. Extra columns / title-row offset ------------------------- */
  console.log('\n########## H. Extra columns + title row offset ##########');
  await page.goto(url);
  await upload('14-extra-columns.xlsx');
  console.log('  extra-columns options: ' + JSON.stringify(await page.evaluate(() =>
    Array.from(document.getElementById('course').options).map((o) => o.text).slice(0, 4)
  )));
  await page.goto(url);
  await upload('25-title-row-offset.xlsx');
  console.log('  title-row-offset options: ' + JSON.stringify(await page.evaluate(() =>
    Array.from(document.getElementById('course').options).map((o) => o.text).slice(0, 4)
  )));

  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
