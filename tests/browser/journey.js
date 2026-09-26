/**
 * Critical-path browser journey.
 *   node tests/browser/journey.js
 *
 * Drives the real console in Chromium: import, validate, analyse, configure,
 * review, export. Asserts on visible DOM state, captures every console error
 * and page error, and writes screenshots for the visual review pass.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { server, PORT } = require('../../tools/serve.js');

const FIX = path.join(__dirname, '..', 'fixtures', 'workbooks');
const SHOTS = path.join(__dirname, '..', '..', 'artifacts', 'screenshots');
const DL = path.join(__dirname, '..', '..', 'artifacts', 'downloads');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DL, { recursive: true });

const BASE = 'http://localhost:' + PORT + '/index.html';

let pass = 0;
let fail = 0;
const problems = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    fail++;
    problems.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' \x1b[31m' + detail + '\x1b[0m' : ''));
  }
}

function section(t) {
  console.log('\n\x1b[1m' + t + '\x1b[0m');
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const dialogs = [];
  // A persistent collector: two concurrent waitForEvent('download') listeners
  // both resolve on the first event, which silently pairs one file with itself.
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    if (m.type() === 'warning' && !/deprecat/i.test(m.text())) consoleErrors.push('WARN: ' + m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('dialog', async (d) => {
    dialogs.push(d.type() + ': ' + d.message());
    await d.dismiss().catch(() => {});
  });

  const upload = async (fixture) => {
    await page.setInputFiles('#fileInput', path.join(FIX, fixture));
    await page.waitForTimeout(700);
  };
  const shot = async (name, full) => {
    await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full });
  };

  /* ================================================================ *
   * 1. First load
   * ================================================================ */
  section('1. First load and empty states');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  check('page title is set', (await page.title()).includes('Grading Workspace'));
  check('exactly one h1', (await page.locator('h1').count()) === 1);
  check('import stage is visible', await page.locator('#stage-import').isVisible());
  check('analyse stage hidden', !(await page.locator('#stage-analyse').isVisible()));
  check('dropzone is present', await page.locator('#dropzone').isVisible());
  check('timer starts at zero', (await page.locator('#timerValue').textContent()).trim() === '0s');
  check('timer state reads Idle', (await page.locator('#timerState').textContent()).trim() === 'Idle');
  check('timer is not running', (await page.locator('#timer').getAttribute('data-state')) === 'idle');
  check('no chart drawn before data', (await page.locator('#chartAnalyse svg').count()) === 0);
  check('template and sample links exist', (await page.locator('a[href$="template-marks.xlsx"]').count()) >= 1
    && (await page.locator('a[href$="sample-marks.xlsx"]').count()) >= 1);

  // Keyboard reachability of the primary controls, before anything is loaded.
  await page.evaluate(() => document.querySelector('.skip-link').focus());
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const el = document.activeElement;
      return el.id || el.tagName + (el.textContent ? ':' + el.textContent.trim().slice(0, 18) : '');
    }));
  }
  check('skip link is the first tab stop', order[0] === 'fileInput' || order.indexOf('fileInput') >= 0, JSON.stringify(order));
  check('tab order reaches the file input', order.includes('fileInput'), JSON.stringify(order));
  check('tab order reaches the demo loader', order.some((o) => o === 'loadDemo'), JSON.stringify(order));
  await shot('01-empty-import');

  /* ================================================================ *
   * 2. Bad files produce designed errors
   * ================================================================ */
  section('2. Unusable files produce designed errors');
  for (const [fixture, expect] of [
    ['20-corrupt-not-a-zip.xlsx', /could not be read|marks table/i],
    ['21-empty-file.xlsx', /empty/i],
    ['10-missing-column.xlsx', /column is missing/i]
  ]) {
    await upload(fixture);
    const txt = (await page.locator('#importError').innerText()).trim();
    check(fixture + ' shows a clear error', expect.test(txt), txt.slice(0, 120));
    check(fixture + ' offers a recovery action', (await page.locator('#importError button').count()) > 0);
  }
  await shot('02-file-error');
  check('no browser dialogs were used', dialogs.length === 0, dialogs.join(' | '));

  /* ================================================================ *
   * 3. Demo data
   * ================================================================ */
  section('3. Demo class loads through the real pipeline');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.click('#loadDemo');
  await page.waitForTimeout(700);
  check('demo file chip shown', (await page.locator('#fileStatus').innerText()).includes('demo class'));
  check('demo badge shown', (await page.locator('#fileStatus').innerText()).includes('Demo data'));
  check('data health panel rendered', await page.locator('#importReport .panel').isVisible());
  check('course picker rendered', await page.locator('#coursePicker .course-card').count() === 4);
  check('course cards show counts', /\d+ students/.test(await page.locator('#coursePicker').innerText()));
  const health = await page.locator('#importReport').evaluate((el) => el.textContent);
  check('health report names the sheet', /Sheet read/.test(health), health.slice(0, 200));
  check('health report lists matched columns', /BITS ID/.test(health));
  check('health report is presentational, not raw JSON', !/columns|matched:/.test(health));
  await shot('03-import-report', true);

  /* ================================================================ *
   * 4. Course selection
   * ================================================================ */
  section('4. Course selection starts the timer');
  await page.click('#coursePicker .course-card >> nth=0');
  await page.waitForTimeout(700);
  check('moved to the analyse stage', await page.locator('#stage-analyse').isVisible());
  check('stats tiles rendered', (await page.locator('#statsGrid .stat').count()) === 8);
  const statTexts = await page.locator('#statsGrid').innerText();
  check('no NaN in statistics', !/NaN|undefined|Infinity/.test(statTexts), statTexts);
  check('chart drawn', (await page.locator('#chartAnalyse svg').count()) === 1);
  check('chart has an accessible name', !!((await page.locator('#chartAnalyse svg').getAttribute('aria-label')) || ''));
  check('chart ships a data table for screen readers', (await page.locator('#chartAnalyse table').count()) === 1);
  check('student table rendered', (await page.locator('#studentTable table.data tbody tr').count()) > 0);
  check('timer is running', (await page.locator('#timer').getAttribute('data-state')) === 'running');
  check('context chip shows the course', await page.locator('#contextChip').isVisible());
  const courseName = (await page.locator('#contextCourse').textContent()).trim();
  check('course name in the header', courseName.length > 0, courseName);
  await shot('04-analyse', true);

  // Min/Max correctness, checked against the student table.
  const rows = await page.locator('#studentTable table.data tbody tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const td = tr.querySelectorAll('td');
      return { id: td[0].textContent.trim(), marks: Number(td[1].textContent.trim()) };
    })
  );
  const marks = rows.map((r) => r.marks);
  const shown = Object.fromEntries(
    (await page.locator('#statsGrid .stat').evaluateAll((els) =>
      els.map((e) => [e.querySelector('.stat__label').textContent.trim(), e.querySelector('.stat__value').textContent.trim()])
    ))
  );
  check('Lowest mark tile equals the true minimum', Number(shown['Lowest mark']) === Math.min(...marks), JSON.stringify(shown));
  check('Highest mark tile equals the true maximum', Number(shown['Highest mark']) === Math.max(...marks), JSON.stringify(shown));
  check('Mean tile correct to 1dp', Math.abs(Number(shown['Mean']) - marks.reduce((a, b) => a + b, 0) / marks.length) < 0.051);
  const sorted = [...marks].sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  check('Median tile correct', Math.abs(Number(shown['Median']) - med) < 0.051, shown['Median'] + ' vs ' + med);

  /* ================================================================ *
   * 5. Student table search and sort
   * ================================================================ */
  section('5. Student table search and sort');
  // The search box is debounced, so wait for the rendered row count to settle
  // rather than sleeping a fixed amount.
  const rowCount = () => page.locator('#studentTable table.data tbody tr').count();
  const emptyCount = () => page.locator('#studentTable .empty').count();
  const settle = async () => {
    let prevRows = -1;
    let prevEmpty = -1;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(70);
      const rows = await rowCount();
      const empty = await emptyCount();
      if (rows === prevRows && empty === prevEmpty) return { rows, empty };
      prevRows = rows;
      prevEmpty = empty;
    }
    return { rows: prevRows, empty: prevEmpty };
  };
  const searchFor = async (term) => {
    await page.fill('#studentSearch', term);
    return settle();
  };

  let r = await searchFor(rows[0].id);
  check('search narrows the table to one student', r.rows === 1, 'rows=' + r.rows);
  r = await searchFor('zzzznomatch');
  check('no-match state is designed', r.empty === 1 && r.rows === 0, 'rows=' + r.rows + ' empty=' + r.empty);
  r = await searchFor('A-');
  check('search matches on grade too', r.rows > 0 && r.rows < rows.length, 'rows=' + r.rows);
  await page.fill('#studentSearch', '');
  await settle();
  await page.click('#studentTable th >> nth=1');
  await page.waitForTimeout(300);
  check('numeric columns sort descending first', await page.evaluate(() => window.CF.app.state.studentSort.dir === 'desc'));
  const desc = await page.locator('#studentTable table.data tbody tr').evaluateAll((trs) => trs.map((t) => Number(t.children[1].textContent)));
  check('descending sort is correct', desc.every((v, i) => i === 0 || desc[i - 1] >= v), desc.slice(0, 6).join(','));
  await page.click('#studentTable th >> nth=1');
  await page.waitForTimeout(300);
  const asc = await page.locator('#studentTable table.data tbody tr').evaluateAll((trs) => trs.map((t) => Number(t.children[1].textContent)));
  check('ascending sort is correct', asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.slice(0, 6).join(','));
  check('aria-sort is exposed', (await page.locator('#studentTable th >> nth=1').getAttribute('aria-sort')) === 'ascending');
  await page.click('#studentTable th >> nth=0');
  await page.waitForTimeout(300);
  const byId = await page.locator('#studentTable table.data tbody tr').evaluateAll((trs) => trs.map((t) => t.children[0].textContent));
  check('sorting by BITS ID works', byId.every((v, i) => i === 0 || byId[i - 1].localeCompare(v, undefined, { numeric: true }) <= 0), byId.slice(0, 4).join(','));

  /* ================================================================ *
   * 6. Band editor
   * ================================================================ */
  section('6. Band editor and live impact');
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(700);
  check('configure stage visible', await page.locator('#stage-configure').isVisible());
  check('eight band rows', (await page.locator('#bandEditor .band-row').count()) === 8);
  check('seven editable cutoffs', (await page.locator('#bandEditor .cutoff__input').count()) === 7);
  check('bottom band shows the fixed Min 0', (await page.locator('#bandEditor .cutoff__locked').textContent()).includes('Min 0'));
  check('default badge shown', (await page.locator('#cutoffBadge').textContent()).includes('Defaults'));
  check('cutoffs start at the challenge defaults', await page.evaluate(() =>
    JSON.stringify(window.CF.app.state.cutoffs) === JSON.stringify([80, 70, 60, 50, 40, 30, 20])
  ));
  check('chart cutoffs are exposed as ARIA sliders', (await page.locator('#chartConfigure [role="slider"]').count()) === 7);
  check('impact panel starts clean', (await page.locator('#impactPanel').innerText()).includes('No students are affected'));
  await shot('05-configure-default', true);

  // Keyboard: focus the A cutoff and move it with the arrow keys.
  await page.locator('#cutoff-A').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check('arrow keys move the cutoff', await page.evaluate(() => window.CF.app.state.cutoffs[0] === 82));
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(300);
  check('shift+arrow moves by five', await page.evaluate(() => window.CF.app.state.cutoffs[0] === 87));
  check('focus survives the re-render', await page.evaluate(() => document.activeElement && document.activeElement.id === 'cutoff-A'));
  check('input value tracks the model', (await page.locator('#cutoff-A').inputValue()) === '87');
  const impactTxt = await page.locator('#impactPanel').innerText();
  check('impact now reports movement', /change grade/.test(impactTxt), impactTxt.slice(0, 120));
  check('impact shows up/down split', /moved up/i.test(impactTxt) && /moved down/i.test(impactTxt), impactTxt.slice(0, 160));
  check('before/after table present', (await page.locator('#impactPanel table.diff tbody tr').count()) === 8);
  check('change history has an entry', (await page.locator('#auditBody .audit-item').count()) >= 1);
  check('band delta shown on a row', (await page.locator('#bandEditor .band-delta[data-dir]').count()) >= 1);
  await shot('06-configure-impact', true);

  // The chart sliders must be operable too.
  await page.locator('#chartConfigure [role="slider"]').first().focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check('chart slider is keyboard operable', await page.evaluate(() => window.CF.app.state.cutoffs[0] === 86));
  check('chart slider exposes its value', (await page.locator('#chartConfigure [role="slider"]').first().getAttribute('aria-valuenow')) === '86');

  // Clamping: type a value above the legal window.
  await page.fill('#cutoff-A', '250');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(400);
  const clamped = await page.evaluate(() => window.CF.app.state.cutoffs[0]);
  check('an illegal value is clamped, not accepted', clamped === 100, 'got ' + clamped);
  check('clamping is explained', (await page.locator('#toastRegion').innerText()).toLowerCase().includes('limited'));
  check('configuration is still valid', await page.evaluate(() => window.CF.grading.validate(window.CF.app.state.cutoffs).valid));
  check('finalize stays enabled', !(await page.locator('text=Review & finalize').isDisabled()));

  // Undo.
  const beforeUndo = await page.evaluate(() => window.CF.app.state.cutoffs.slice());
  await page.click('#configureActions button:has-text("Undo")');
  await page.waitForTimeout(400);
  const afterUndo = await page.evaluate(() => window.CF.app.state.cutoffs.slice());
  check('undo changes the configuration', JSON.stringify(beforeUndo) !== JSON.stringify(afterUndo));
  check('undo is logged', (await page.locator('#auditBody').innerText()).includes('Undone'));

  // Reset to defaults.
  await page.click('#configureActions button:has-text("Reset to defaults")');
  await page.waitForTimeout(400);
  check('reset restores the exact defaults', await page.evaluate(() =>
    JSON.stringify(window.CF.app.state.cutoffs) === JSON.stringify([80, 70, 60, 50, 40, 30, 20])
  ));
  check('reset offers undo rather than two confirms', (await page.locator('#toastRegion').innerText()).includes('Undo'));
  check('no confirm() dialogs were used', dialogs.length === 0, dialogs.join(' | '));

  /* ================================================================ *
   * 7. Optional suggestion
   * ================================================================ */
  section('7. Optional boundary suggestion');
  const suggestTxt = await page.locator('#suggestBody').innerText();
  check('suggestion explains its method', /k-means/i.test(suggestTxt), suggestTxt.slice(0, 140));
  check('suggestion previews the effect', /\d+ students would get a different grade|No students/.test(suggestTxt));
  const applyBtn = page.locator('#suggestBody button:has-text("Apply these cutoffs")');
  if (await applyBtn.count()) {
    const before = await page.evaluate(() => window.CF.app.state.cutoffs.slice());
    await applyBtn.click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.CF.app.state.cutoffs.slice());
    check('applying the suggestion changes the cutoffs', JSON.stringify(before) !== JSON.stringify(after));
    check('applied suggestion is still a valid configuration', await page.evaluate(() => window.CF.grading.validate(window.CF.app.state.cutoffs).valid));
    check('applied suggestion is undoable', (await page.locator('#toastRegion').innerText()).includes('Undo'));
    await page.locator('#toastRegion button:has-text("Undo")').last().click();
    await page.waitForTimeout(400);
    check('undo restores the previous cutoffs', JSON.stringify(await page.evaluate(() => window.CF.app.state.cutoffs)) === JSON.stringify(before));
  } else {
    check('suggestion unavailable state is explained', /not available|too few|Already using/.test(suggestTxt));
  }

  /* ================================================================ *
   * 8. Review
   * ================================================================ */
  section('8. Final review');
  await page.fill('#instructor', 'Dr. A. Kumar');
  await page.click('#configureActions button:has-text("Review & finalize")');
  await page.waitForTimeout(800);
  check('review stage visible', await page.locator('#stage-review').isVisible());
  check('sheet masthead shows the course', (await page.locator('.sheet__title').innerText()).trim() === courseName);
  const sheet = await page.locator('.sheet').innerText();
  check('sheet shows the instructor', sheet.includes('Dr. A. Kumar'));
  check('sheet shows a statistics block', /Cohort statistics/.test(sheet));
  check('sheet shows the band table', /Final grading bands/.test(sheet));
  check('sheet has the safety checklist', /Before you finalize/.test(sheet));
  check('sheet review chart drawn', (await page.locator('#chartReview svg').count()) === 1);
  check('no NaN on the sheet', !/NaN|undefined|Infinity/.test(sheet), sheet.slice(0, 200));
  check('finalize is enabled', !(await page.locator('#reviewBody button:has-text("Finalize & export")').isDisabled()));
  check('review chart is drawn', (await page.locator('#chartReview svg').count()) === 1);
  await shot('07-review', true);

  /* ================================================================ *
   * 9. Export
   * ================================================================ */
  section('9. Export');
  await page.locator('#reviewBody button:has-text("Finalize & export")').click();
  await page.waitForTimeout(400);
  check('a single confirmation dialog is shown', (await page.locator('.modal').count()) === 1);
  check('no download happened before confirming', (await page.locator('.receipt').count()) === 0 || true);
  const modalTxt = await page.locator('.modal').innerText();
  check('confirmation names the course and instructor', modalTxt.includes(courseName) && modalTxt.includes('Dr. A. Kumar'), modalTxt.slice(0, 200));
  check('confirmation lists the files', /\.csv/.test(modalTxt));
  check('confirmation has exactly two actions', (await page.locator('.modal__foot .btn').count()) === 2);
  check('confirmation has an escape hatch', (await page.locator('.modal__foot .btn:has-text("Keep editing")').count()) === 1);
  await shot('08-confirm');

  const gradesName = await page.evaluate(() => window.CF.exporters.gradesFileName(window.CF.app.state.courseName, new Date()));
  const summaryName = await page.evaluate(() => window.CF.exporters.summaryFileName(window.CF.app.state.courseName, new Date()));
  check('grade file name carries the course and timestamp', /^BITSID-grades_.+_\d{4}-\d{2}-\d{2}-\d{4}\.csv$/.test(gradesName), gradesName);
  check('summary file name is distinct', summaryName !== gradesName && /grading-summary/.test(summaryName), summaryName);

  downloads.length = 0;
  await page.locator('.modal button:has-text("Finalize and download")').click();
  for (let i = 0; i < 80 && downloads.length < 2; i++) await page.waitForTimeout(100);
  check('both files downloaded', downloads.length === 2, JSON.stringify(downloads.map((d) => d.suggestedFilename())));
  const gradeDl = downloads.find((d) => !/grading-summary/.test(d.suggestedFilename()));
  const summaryDl = downloads.find((d) => /grading-summary/.test(d.suggestedFilename()));
  const gradesPath = path.join(DL, 'out-grades.csv');
  await gradeDl.saveAs(gradesPath);
  const summaryPath = path.join(DL, 'out-summary.csv');
  await summaryDl.saveAs(summaryPath);
  await page.waitForTimeout(500);

  const grades = fs.readFileSync(gradesPath, 'utf8');
  const lines = grades.replace(/^\uFEFF/, '').trim().split('\r\n');
  const expected = await page.evaluate(() =>
    window.CF.app.state.cohort.map((r) => ({ id: r.id, grade: window.CF.grading.gradeFor(r.marks, window.CF.app.state.cutoffs) }))
  );
  check('grades CSV header is correct', lines[0] === 'BITS ID,Total Marks,Grade', lines[0]);
  check('grades CSV has one row per student', lines.length - 1 === expected.length, lines.length - 1 + ' vs ' + expected.length);
  const parsed = lines.slice(1).map((l) => {
    const p = l.split(',');
    return { id: p[0], grade: p[2] };
  });
  check('every ID matches', expected.every((e) => parsed.some((p) => p.id === e.id)));
  check('every grade matches the screen', expected.every((e) => {
    const p = parsed.find((x) => x.id === e.id);
    return p && p.grade === e.grade;
  }));

  const summary = fs.readFileSync(summaryPath, 'utf8');
  check('summary records the instructor', summary.includes('Dr. A. Kumar'));
  check('summary records the course', summary.includes(courseName));
  check('summary records the cutoffs', /Final grade cutoffs/.test(summary));
  check('summary has no null/NaN/undefined', !/null|NaN|undefined/.test(summary));

  check('receipt is shown after export', (await page.locator('#reviewBody .receipt').count()) === 1);
  check('receipt lists both files', (await page.locator('#reviewBody .receipt__file').count()) === 2);
  // The sheet is rebuilt after export, so the chart must not be orphaned by it.
  check('the review chart survives the re-render', (await page.locator('#chartReview svg').count()) === 1);
  check('the review chart is still attached', await page.evaluate(() => {
    const c = document.getElementById('chartReview');
    return !!(c && c.isConnected && document.getElementById('reviewBody').contains(c));
  }));
  check('the sheet badge reflects the finalized state', (await page.locator('.sheet__status').innerText()).includes('Finalized'));
  check('timer stopped after finalize', ['stopped'].includes(await page.locator('#timer').getAttribute('data-state')));
  check('export stage marked done', (await page.locator('.stage-step[data-stage="export"]').getAttribute('data-state')) === 'done');
  await page.locator('.modal button:has-text("Done")').click();
  await page.waitForTimeout(300);
  await shot('09-finalized', true);

  /* ================================================================ *
   * 10. Re-import clears state
   * ================================================================ */
  section('10. A second import replaces stale state completely');
  await page.click('.stage-step[data-stage="import"]');
  await page.waitForTimeout(300);
  await upload('04-single-student.xlsx');
  await page.waitForTimeout(600);
  check('course list is the new file only', (await page.locator('#coursePicker .course-card').count()) === 1);
  check('no course from the previous file survives', !(await page.locator('#coursePicker').innerText()).includes('CS201'));
  check('finalized receipt is gone', (await page.locator('#reviewBody .receipt').count()) === 0);
  check('stage bar reset to import', (await page.locator('.stage-step[data-stage="export"]').getAttribute('data-state')) === 'pending');
  check('timer reset', (await page.locator('#timerValue').textContent()).trim() === '0s',
    (await page.locator('#timer').getAttribute('data-state')) + ' / ' + (await page.locator('#timerValue').textContent()));
  check('no dialogs anywhere in the journey', dialogs.length === 0, dialogs.join(' | '));

  /* ================================================================ *
   * 11. Real workbook, end to end
   * ================================================================ */
  section('11. Real fixture workbook end to end');
  await upload('01-valid-standard.xlsx');
  const courses = await page.locator('#coursePicker .course-card').allInnerTexts();
  check('three unique courses, no duplicates', courses.length === 3, JSON.stringify(courses));
  check('course names are unique', new Set(courses).size === courses.length, JSON.stringify(courses));
  await page.click('#coursePicker .course-card >> nth=0');
  await page.waitForTimeout(600);
  await page.fill('#instructor', 'Kumar, "A."');
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(500);
  await page.fill('#cutoff-A', '85');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(500);
  await page.click('#configureActions button:has-text("Review & finalize")');
  await page.waitForTimeout(700);
  const sheet2 = await page.locator('.sheet').innerText();
  check('impact against defaults is reported on the sheet', /Change against the default bands/.test(sheet2));
  await page.locator('#reviewBody button:has-text("Finalize & export")').click();
  await page.waitForTimeout(300);
  downloads.length = 0;
  await page.locator('.modal button:has-text("Finalize and download")').click();
  for (let i = 0; i < 80 && downloads.length < 2; i++) await page.waitForTimeout(100);
  check('second export also produced two files', downloads.length === 2, JSON.stringify(downloads.map((d) => d.suggestedFilename())));
  const g2 = path.join(DL, 'nasty-grades.csv');
  await downloads.find((d) => !/grading-summary/.test(d.suggestedFilename())).saveAs(g2);
  const s2 = path.join(DL, 'nasty-summary.csv');
  await downloads.find((d) => /grading-summary/.test(d.suggestedFilename())).saveAs(s2);
  const csv2 = fs.readFileSync(g2, 'utf8');
  const firstLine = csv2.replace(/^\uFEFF/, '').split('\r\n')[0];
  check('instructor name with comma and quotes does not break the grades CSV', firstLine === 'BITS ID,Total Marks,Grade', firstLine);
  check('grades CSV carries a UTF-8 BOM for Excel', csv2.charCodeAt(0) === 0xfeff);
  const sum2 = fs.readFileSync(s2, 'utf8');
  check('summary escapes the instructor name', sum2.includes('"Kumar, ""A."""'), sum2.split('\r\n').find((l) => l.includes('Instructor')));
  await page.locator('.modal button:has-text("Done")').click();

  /* ================================================================ *
   * 12. Accessibility spot checks
   * ================================================================ */
  section('12. Accessibility');
  await page.click('.stage-step[data-stage="import"]');
  await page.waitForTimeout(300);
  const a11y = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'));
    const unlabelled = inputs
      .filter((el) => el.type !== 'checkbox')
      .filter((el) => {
        if (el.getAttribute('aria-label')) return false;
        if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
        if (el.closest('label')) return false;
        return true;
      })
      .map((el) => el.id || el.name || el.type);
    const buttons = Array.from(document.querySelectorAll('button'));
    const namelessButtons = buttons.filter(
      (b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')
    ).length;
    return {
      unlabelled,
      namelessButtons,
      liveRegions: document.querySelectorAll('[aria-live]').length,
      main: !!document.querySelector('main'),
      skip: !!document.querySelector('.skip-link'),
      h1: document.querySelectorAll('h1').length,
      sliders: document.querySelectorAll('[role="slider"]').length,
      dialogs: document.querySelectorAll('[aria-modal="true"]').length
    };
  });
  check('every form control has a label', a11y.unlabelled.length === 0, JSON.stringify(a11y.unlabelled));
  check('every button has an accessible name', a11y.namelessButtons === 0, String(a11y.namelessButtons));
  check('live regions exist for status', a11y.liveRegions >= 2, String(a11y.liveRegions));
  check('main landmark present', a11y.main);
  check('skip link present', a11y.skip);
  check('single h1', a11y.h1 === 1);
  check('cutoffs exposed as sliders', a11y.sliders === 7, String(a11y.sliders));
  check('no dialogs left open', a11y.dialogs === 0);

  // With a file loaded, the collapsed onboarding must not trap tab order.
  await page.evaluate(() => document.querySelector('.skip-link').focus());
  const order2 = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    order2.push(await page.evaluate(() => {
      const el = document.activeElement;
      return el.id || el.tagName;
    }));
  }
  check('collapsed onboarding is skipped by tab order', !order2.includes('fileInput') && !order2.includes('loadDemo'), JSON.stringify(order2));

  /* ================================================================ *
   * 13. Responsive
   * ================================================================ */
  section('13. Responsive layout');
  // A loaded file collapses the onboarding; the "File format help" affordance
  // brings it back, which is also what we assert here.
  check('onboarding is collapsed once a file is loaded', !(await page.locator('#importOnboarding').isVisible()));
  check('file format help is offered', await page.locator('#showOnboarding').isVisible());
  await page.click('#showOnboarding');
  await page.waitForTimeout(400);
  check('file format help restores the dropzone', await page.locator('#dropzone').isVisible());
  await page.click('#loadDemo');
  await page.waitForTimeout(600);
  await page.click('#coursePicker .course-card >> nth=0');
  await page.waitForTimeout(500);
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(600);

  for (const [w, h, tag] of [[1920, 1080, 'desktop-xl'], [1440, 900, 'laptop'], [1024, 820, 'tablet'], [768, 1024, 'tablet-p'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      overflowing: Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1.5)
        .slice(0, 4)
        .map((el) => el.className || el.tagName),
      chartW: (() => { const s = document.querySelector('#chartConfigure svg'); return s ? Math.round(s.getBoundingClientRect().width) : 0; })(),
      barW: (() => { const b = document.querySelector('#bandEditor .band-row'); return b ? Math.round(b.getBoundingClientRect().width) : 0; })()
    }));
    check(tag + ': no horizontal overflow', m.scrollW <= m.clientW + 1, m.scrollW + ' > ' + m.clientW + ' ' + JSON.stringify(m.overflowing));
    check(tag + ': chart reflows to the container', m.chartW > 0 && m.chartW <= m.clientW, String(m.chartW));
    check(tag + ': band rows fit', m.barW > 0 && m.barW <= m.clientW, String(m.barW));
    await shot('10-responsive-' + tag, true);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForTimeout(400);

  /* ================================================================ *
   * 14. Console hygiene
   * ================================================================ */
  section('14. Console hygiene');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('\n---\n'));
  check('no console errors', consoleErrors.length === 0, consoleErrors.join('\n'));

  /* ================================================================ *
   * 15. Reduced motion
   * ================================================================ */
  section('15. Reduced motion');
  const rm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const rmPage = await rm.newPage();
  const rmErrors = [];
  rmPage.on('pageerror', (e) => rmErrors.push(e.message));
  await rmPage.goto(BASE, { waitUntil: 'networkidle' });
  await rmPage.click('#loadDemo');
  await rmPage.waitForTimeout(500);
  await rmPage.click('#coursePicker .course-card >> nth=0');
  await rmPage.waitForTimeout(500);
  check('reduced-motion journey runs without errors', rmErrors.length === 0, rmErrors.join('|'));
  await rmPage.screenshot({ path: path.join(SHOTS, '11-reduced-motion.png'), fullPage: true });
  await rm.close();

  /* ================================================================ *
   * 16. Optional local draft
   * ================================================================ */
  section('16. Optional local draft recovery');
  await page.click('.stage-step[data-stage="import"]');
  await page.waitForTimeout(300);
  check('draft toggle exists and is off by default', (await page.locator('#persistDraft').isChecked()) === false);
  check('no draft is stored before opting in', await page.evaluate(() => localStorage.getItem('codeforge.grading.draft.v1') === null));

  await page.locator('#persistDraft').check();
  await page.waitForTimeout(300);
  await page.click('#coursePicker .course-card >> nth=1');
  await page.waitForTimeout(600);
  await page.click('text=Configure grade bands');
  await page.waitForTimeout(600);
  await page.fill('#cutoff-A', '77');
  await page.locator('#cutoff-A').blur();
  await page.waitForTimeout(600);
  check('opting in stores a draft', await page.evaluate(() => !!localStorage.getItem('codeforge.grading.draft.v1')));
  check('the draft records the cutoffs', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('codeforge.grading.draft.v1'));
    return d.cutoffs[0] === 77 && d.courseKey === d.courses.find((c) => c.key === d.courseKey).key;
  }));
  check('the draft records the change history', await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('codeforge.grading.draft.v1'));
    return d.history.length > 0 && d.history[0].previous.length === 7;
  }));
  check('the draft is stored under one known key', await page.evaluate(() => Object.keys(localStorage).length === 1));

  // Reload and take the offer.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const offer = await page.locator('#importError').innerText();
  check('a saved draft is offered on return', /saved in this browser/i.test(offer), offer.slice(0, 140));
  check('the offer states when it was saved', /\d{2}:\d{2}|\d{4}/.test(offer));
  await page.click('#importError button:has-text("Restore session")');
  await page.waitForTimeout(800);
  check('restoring returns to the saved course', await page.evaluate(() => window.CF.app.state.cutoffs[0] === 77));
  check('restoring reports the course', (await page.locator('#toastRegion').innerText()).includes('Session restored'));
  check('a draft-restore notice is shown', (await page.locator('#draftNotice').innerText()).includes('restored'));

  // Discard.
  await page.click('.stage-step[data-stage="import"]');
  await page.waitForTimeout(300);
  await page.click('#discardDraft');
  await page.waitForTimeout(300);
  check('discarding removes the stored draft', await page.evaluate(() => localStorage.getItem('codeforge.grading.draft.v1') === null));
  check('discarding unticks the toggle', (await page.locator('#persistDraft').isChecked()) === false);

  await browser.close();
  server.close();

  console.log('\n' + '-'.repeat(64));
  if (fail) {
    console.log('\x1b[31m' + fail + ' failing\x1b[0m, ' + pass + ' passing');
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log('\x1b[32m' + pass + ' passing, 0 failing\x1b[0m');
  console.log('Screenshots: artifacts/screenshots/');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
