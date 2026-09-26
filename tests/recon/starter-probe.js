/**
 * RECON HARNESS
 *
 * Drives the ORIGINAL starter console (starter-reference/...ORIGINAL.html) in a
 * real Chromium instance and records what it *actually* does for every
 * adversarial fixture. Output feeds BUG_FIX_LOG.md with real evidence rather
 * than speculation.
 *
 *   node tests/recon/starter-probe.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { server, PORT } = require('../../tools/serve.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'workbooks');
const OUT = path.join(__dirname, '..', '..', 'artifacts', 'recon');
fs.mkdirSync(OUT, { recursive: true });

/** Reads every observable signal the starter exposes. */
const PROBE = () => {
  const text = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.trim() : '<missing #' + id + '>';
  };
  const sel = document.getElementById('course');
  const statBox = (label) => {
    const box = Array.from(document.querySelectorAll('.stat')).find((s) =>
      s.textContent.trim().startsWith(label)
    );
    const b = box && box.querySelector('b');
    return {
      label,
      shows: b ? b.textContent.trim() : '<none>',
      elementId: b ? b.id : null
    };
  };
  const cv = document.getElementById('hist');
  return {
    courseOptionCount: sel ? sel.options.length : -1,
    courseOptions: sel ? Array.from(sel.options).map((o) => o.text) : [],
    statBoxes: ['Min', 'Max', 'Avg', 'Median'].map(statBox),
    gradeSummary: Array.from(document.querySelectorAll('#gradeSummary span')).map((s) => s.textContent),
    rangeError: text('rangeError'),
    downloadDisabled: document.getElementById('download').disabled,
    welcome: text('welcome'),
    thankyou: text('thankyou'),
    timerText: text('timerText'),
    gradeCardCount: document.querySelectorAll('#grades .grade').length,
    selectOptionCounts: Array.from(document.querySelectorAll('#grades select')).map(
      (s) => s.options.length
    ),
    canvasSize: cv ? [cv.width, cv.height] : null,
    canvasClientSize: cv ? [cv.clientWidth, cv.clientHeight] : null,
    alerts: window.__alerts || [],
    hasImpliedGlobals: ['file', 'course', 'instructor', 'min', 'max', 'avg', 'med', 'grades', 'download']
      .filter((k) => k in window)
      .length
  };
};

const results = [];
let dialogHandler = null;
let dialogLog = [];

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  const url = 'http://localhost:' + PORT + '/starter-reference/BITS_Digital_CodeForge_Challenge.ORIGINAL.html';

  async function scenario(name, fn) {
    await page.goto(url, { waitUntil: 'load' });
    const before = await page.evaluate(PROBE);
    const row = { name, before, after: null, note: '' };
    dialogLog = [];
    try {
      row.note = (await Promise.race([
        fn(page),
        new Promise((_, rej) => setTimeout(() => rej(new Error('scenario timeout 25s')), 25000))
      ])) || '';
    } catch (e) {
      row.note = 'THREW: ' + e.message;
    }
    await page.waitForTimeout(700);
    row.after = await page.evaluate(PROBE);
    row.dialogs = dialogLog.slice();
    row.consoleErrors = consoleErrors.splice(0);
    results.push(row);
    console.log('\n=== ' + name + ' ===');
    if (row.note) console.log('note: ' + row.note);
    console.log('course options (' + row.after.courseOptionCount + '): ' + JSON.stringify(row.after.courseOptions.slice(0, 14)));
    console.log('stat boxes: ' + JSON.stringify(row.after.statBoxes));
    console.log('grade summary: ' + JSON.stringify(row.after.gradeSummary));
    console.log('rangeError: ' + JSON.stringify(row.after.rangeError));
    console.log('download disabled: ' + row.after.downloadDisabled);
    if (row.dialogs && row.dialogs.length) console.log('DIALOGS: ' + JSON.stringify(row.dialogs));
    if (row.after.welcome) console.log('welcome: ' + JSON.stringify(row.after.welcome));
    if (row.after.thankyou) console.log('thankyou: ' + JSON.stringify(row.after.thankyou));
    if (row.consoleErrors.length) console.log('CONSOLE ERRORS: ' + JSON.stringify(row.consoleErrors));
  }

  // Browser dialogs: capture instead of accepting, so probing continues.
  // NOTE: never page.evaluate() from inside the dialog handler - Playwright
  // serialises commands and the page cannot respond while a modal is open.
  page.on('dialog', async (d) => {
    dialogLog.push({ type: d.type(), message: d.message() });
    await d.dismiss().catch(() => {});
  });

  const upload = async (fixture) => {
    await page.setInputFiles('#file', path.join(FIX, fixture));
    await page.waitForTimeout(450);
  };

  // ---- 0. Baseline, nothing uploaded -------------------------------
  await scenario('00-baseline-no-upload', async () => {
    return 'download button state with zero data loaded';
  });

  // ---- 1. .xlsx rejection by the accept attribute -------------------
  await scenario('01-xlsx-accept-attribute', async (p) => {
    const accept = await p.getAttribute('#file', 'accept');
    const el = await p.$('#file');
    // Ask the browser whether the file input would accept our fixture.
    const verdict = await el.evaluate((input) => input.accept);
    return 'accept="' + accept + '" (as read back: ' + verdict + ')';
  });

  // ---- 2. Duplicate course options from a single upload ------------
  await scenario('02-valid-standard', async (p) => {
    await upload('01-valid-standard.xlsx');
    const rows = await p.evaluate(() => document.getElementById('course').options.length);
    return 'workbook has 60 data rows across 3 courses; option elements = ' + rows;
  });

  // ---- 3. Course list accumulation across two uploads --------------
  await scenario('03-second-upload-accumulates', async (p) => {
    await upload('01-valid-standard.xlsx');
    const first = await p.evaluate(() => document.getElementById('course').options.length);
    await upload('04-single-student.xlsx');
    const second = await p.evaluate(() =>
      Array.from(document.getElementById('course').options).map((o) => o.text)
    );
    return 'after 1st upload=' + first + ' options; after 2nd upload=' + second.length + ' options -> ' + JSON.stringify(second);
  });

  // ---- 4. Duplicate course list when selecting --------------------
  await scenario('04-select-course-duplicates', async (p) => {
    await upload('01-valid-standard.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(400);
    const cards = await p.evaluate(() => document.querySelectorAll('#grades .grade').length);
    return 'grade cards built = ' + cards;
  });

  // ---- 5. Instructor gate uses alert() -----------------------------
  await scenario('05-instructor-required-alert', async (p) => {
    await upload('04-single-student.xlsx');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    return 'instructor was left blank on purpose';
  });

  // ---- 6. Spec headers ("Student's BITS ID") ----------------------
  await scenario('06-spec-headers', async (p) => {
    await upload('02-spec-headers-apostrophe.xlsx');
    return 'brief says the column is "Student\'s BITS ID"';
  });

  // ---- 7. Text marks: lexicographic sort ---------------------------
  await scenario('07-text-marks-sort', async (p) => {
    await upload('08-text-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(400);
    return 'marks stored as text: 9, 10, 82, 100, 64';
  });

  // ---- 8. Empty workbook ------------------------------------------
  await scenario('08-empty-headers-only', async (p) => {
    await upload('13-empty-headers-only.xlsx');
    return 'headers only, zero students';
  });

  // ---- 9. Identical marks (zero std dev) ---------------------------
  await scenario('09-identical-marks', async (p) => {
    await upload('05-identical-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(500);
    return '12 students all at 75';
  });

  // ---- 10. Fractional marks (documented rounding) -----------------
  await scenario('10-fractional-marks', async (p) => {
    await upload('09-invalid-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(400);
    return 'includes 82.6, 0.4, "ABS", -5, 120, "", null, "82/100"';
  });

  // ---- 11. Corrupt file -------------------------------------------
  await scenario('11-corrupt-file', async (p) => {
    await upload('20-corrupt-not-a-zip.xlsx');
    return 'plain text with an .xlsx extension';
  });

  // ---- 12. Empty file ----------------------------------------------
  await scenario('12-empty-file', async (p) => {
    await upload('21-empty-file.xlsx');
    return '0 bytes';
  });

  // ---- 13. CSV wearing an xlsx extension --------------------------
  await scenario('13-csv-wearing-xlsx', async (p) => {
    await upload('23-csv-wearing-xlsx.xlsx');
    return 'real CSV bytes, .xlsx name';
  });

  // ---- 14. Zero worksheets ----------------------------------------
  await scenario('14-zero-worksheets', async (p) => {
    await upload('24-zero-worksheets.xlsx');
    return 'valid zip, workbook.xml has <sheets></sheets>';
  });

  // ---- 15. Missing required column --------------------------------
  await scenario('15-missing-column', async (p) => {
    await upload('10-missing-column.xlsx');
    return 'no Total Marks column';
  });

  // ---- 16. Blank / duplicate IDs -----------------------------------
  await scenario('16-duplicate-and-blank-ids', async (p) => {
    await upload('11-duplicate-and-blank.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(400);
    return '3 duplicate IDs, 1 blank ID, 1 blank course';
  });

  // ---- 17. Course name fragmentation -------------------------------
  await scenario('17-course-name-fragments', async (p) => {
    await upload('12-course-name-fragments.xlsx');
    return '"CS101", "CS101 ", " cs101", "CS101"';
  });

  // ---- 18. First sheet is instructions ----------------------------
  await scenario('18-instructions-first', async (p) => {
    await upload('15-instructions-first.xlsx');
    return 'Sheet1=Instructions, Sheet2=Marks';
  });

  // ---- 19. Coverage gap: A max lowered below 100 -------------------
  await scenario('19-range-coverage-gap', async (p) => {
    await upload('06-boundary-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    // Lower A's Max to 90 - the top band no longer reaches 100.
    await p.selectOption('#Amax', '90');
    await p.waitForTimeout(400);
    return 'A band set to 80-90; 99 and 100 now fall outside every band';
  });

  // ---- 20. Bottom gap: E min raised above 0 ------------------------
  await scenario('20-range-bottom-gap', async (p) => {
    await upload('06-boundary-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    await p.selectOption('#Emin', '10');
    await p.waitForTimeout(400);
    return 'E band set to 10-19; 0..9 now fall outside every band';
  });

  // ---- 21. Single-mark band rejected ------------------------------
  await scenario('21-single-mark-band', async (p) => {
    await upload('06-boundary-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    // Give C a one-mark band: min 45, max 45 -> needs D/B- recomputed.
    await p.evaluate(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('change'));
      };
      set('Bmin', 46); // cascades B- max 45, C max 44 ...
    });
    await p.waitForTimeout(300);
    return 'attempted a 1-mark-wide band';
  });

  // ---- 22. Export with a coverage gap (silent student loss) -------
  await scenario('22-export-with-gap', async (p) => {
    await upload('06-boundary-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    await p.selectOption('#Amax', '90');
    await p.waitForTimeout(300);
    let captured = null;
    p.on('download', async (d) => {
      const target = path.join(OUT, '22-gap-export.csv');
      await d.saveAs(target);
      captured = target;
    });
    await p.click('#download');
    await p.waitForTimeout(900);
    if (captured) {
      const csv = fs.readFileSync(captured, 'utf8');
      const lines = csv.trim().split(/\r?\n/);
      return 'export had ' + (lines.length - 2) + ' student rows for 17 students in the course';
    }
    return 'no download captured';
  });

  // ---- 23. Export before any data ----------------------------------
  await scenario('23-export-with-no-data', async (p) => {
    const dl = p.waitForEvent('download', { timeout: 2500 }).catch(() => null);
    const disabled = await p.isDisabled('#download');
    await p.click('#download', { force: true });
    const d = await dl;
    if (d) {
      const t = path.join(OUT, '23-empty-export.csv');
      await d.saveAs(t);
      return 'button disabled=' + disabled + ' but download still fired: ' + JSON.stringify(fs.readFileSync(t, 'utf8'));
    }
    return 'button disabled=' + disabled + ', no download';
  });

  // ---- 24. CSV escaping: commas and quotes in instructor/course ----
  await scenario('24-csv-escaping', async (p) => {
    await upload('01-valid-standard.xlsx');
    await p.fill('#instructor', 'Ayesh, "Prof" Kumar');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    const dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await p.click('#download');
    const d = await dl;
    if (!d) return 'no download';
    const t = path.join(OUT, '24-escaped-export.csv');
    await d.saveAs(t);
    return JSON.stringify(fs.readFileSync(t, 'utf8').split(/\r?\n/).slice(0, 3));
  });

  // ---- 25. Range edits silently lost on course switch --------------
  await scenario('25-course-switch-drops-config', async (p) => {
    await upload('01-valid-standard.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(250);
    await p.selectOption('#Amin', '85');
    await p.waitForTimeout(250);
    const afterEdit = await p.evaluate(() => document.getElementById('Amin').value);
    const courses = await p.evaluate(() =>
      Array.from(document.getElementById('course').options).map((o) => o.value)
    );
    await p.selectOption('#course', courses[2]);
    await p.waitForTimeout(250);
    await p.selectOption('#course', courses[1]);
    await p.waitForTimeout(250);
    const afterRoundTrip = await p.evaluate(() => document.getElementById('Amin').value);
    return 'A min after edit=' + afterEdit + ', after switching away and back=' + afterRoundTrip;
  });

  // ---- 26. Timer: does it start at page load? ---------------------
  await scenario('26-timer-start-point', async (p) => {
    await p.waitForTimeout(2500);
    const t1 = await p.evaluate(() => document.getElementById('timerText').textContent);
    return 'timer read "' + t1 + '" 2.5s after page load, before any upload or interaction';
  });

  // ---- 27. Timer arc / circumference sanity ------------------------
  await scenario('27-timer-arc', async (p) => {
    const info = await p.evaluate(() => ({
      dash: document.getElementById('timerArc').getAttribute('stroke-dasharray'),
      circumference: 2 * Math.PI * 40,
      textAtLoad: document.getElementById('timerText').textContent
    }));
    return JSON.stringify(info);
  });

  // ---- 28. Repeated finalize ---------------------------------------
  await scenario('28-repeated-finalize', async (p) => {
    await upload('04-single-student.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(300);
    const msgs = [];
    for (let i = 0; i < 4; i++) {
      const dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
      await p.click('#download');
      const d = await dl;
      if (d) await d.saveAs(path.join(OUT, '28-finalize-' + (i + 1) + '.csv'));
      msgs.push(await p.evaluate(() => document.getElementById('thankyou').textContent));
    }
    return JSON.stringify(msgs, null, 1);
  });

  // ---- 29. Repeated finalize across a NEW file ---------------------
  await scenario('29-finalize-counter-across-files', async (p) => {
    await upload('04-single-student.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(250);
    let dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await p.click('#download');
    await dl;
    await upload('01-valid-standard.xlsx');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(250);
    dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await p.click('#download');
    await dl;
    return 'message after switching to a brand new workbook: ' + JSON.stringify(await p.evaluate(() => document.getElementById('thankyou').textContent));
  });

  // ---- 30. Grade config silently reset on new upload ---------------
  await scenario('30-new-upload-keeps-stale-config', async (p) => {
    await upload('06-boundary-marks.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(250);
    await p.selectOption('#Amin', '90');
    await p.waitForTimeout(250);
    await upload('01-valid-standard.xlsx');
    const staleValue = await p.evaluate(() => document.getElementById('course').value);
    const stillThere = await p.evaluate(() => !!document.getElementById('Amin'));
    return 'selected course value after 2nd upload=' + JSON.stringify(staleValue) + ', grade cards still in DOM=' + stillThere;
  });

  // ---- 31. Responsive layout at 390px ------------------------------
  await scenario('31-responsive-390', async (p) => {
    await p.setViewportSize({ width: 390, height: 844 });
    await upload('01-valid-standard.xlsx');
    await p.fill('#instructor', 'Ayesh');
    await p.selectOption('#course', { index: 1 });
    await p.waitForTimeout(500);
    return await p.evaluate(() => {
      const ws = getComputedStyle(document.querySelector('.workspace'));
      const cv = document.getElementById('hist');
      return (
        'workspace columns=' + ws.gridTemplateColumns +
        ' | doc scrollWidth=' + document.documentElement.scrollWidth +
        ' clientWidth=' + document.documentElement.clientWidth +
        ' | canvas attr=' + cv.width + 'x' + cv.height + ' css=' + cv.clientWidth + 'x' + cv.clientHeight
      );
    });
  });

  // ---- 32. Accessibility snapshot of the starter -------------------
  await scenario('32-accessibility-baseline', async (p) => {
    return await p.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input,select')).map((el) => ({
        id: el.id || null,
        type: el.type,
        hasLabel: !!(el.id && document.querySelector('label[for="' + el.id + '"]')),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder')
      }));
      return JSON.stringify({
        inputs,
        canvasHasRole: document.getElementById('hist').getAttribute('role'),
        canvasHasLabel: document.getElementById('hist').getAttribute('aria-label'),
        liveRegions: document.querySelectorAll('[aria-live]').length,
        mainLandmark: !!document.querySelector('main'),
        h1: document.querySelectorAll('h1').length
      });
    });
  });

  fs.writeFileSync(path.join(OUT, 'starter-probe.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  console.log('\nFull probe written to artifacts/recon/starter-probe.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
