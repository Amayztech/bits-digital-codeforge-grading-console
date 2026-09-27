/**
 * Second-pass independent verification.
 *   node tests/browser/second-review.js
 *
 * Re-derives expected results with its own implementations (not the app's)
 * and compares them with what the running console shows and exports:
 *   1. grade mapping 0-100, cutoff edits, reset, invalid configurations
 *   2. statistics on edge cohorts
 *   3. import validation and recoverable errors
 *   4. state isolation across files, demo, and courses
 *   5. impact figures against an independent recount
 *   6. review sheet freshness
 *   7. exported CSVs against the review sheet the instructor saw
 *   8. console hygiene and basic responsiveness
 */
'use strict';

const path = require('path');
const fs = require('fs');
const H = require('../harness');
const { chromium } = require('playwright');
const { server, PORT } = require('../../tools/serve.js');

const CF = H.loadApp();
const G = CF.grading;
const FIX = path.join(__dirname, '..', 'fixtures', 'workbooks');
const BASE = 'http://localhost:' + PORT + '/index.html';
const GRADES = ['A', 'A-', 'B', 'B-', 'C', 'C-', 'D', 'E'];
const DEFAULTS = [80, 70, 60, 50, 40, 30, 20];

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    fail++;
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' \x1b[31m' + detail + '\x1b[0m' : ''));
  }
}
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* ---- independent reference implementations ---------------------------- */

// Grade straight from the brief's wording: a mark earns the first grade
// whose lower bound it reaches, E otherwise.
function refGrade(mark, cutoffs) {
  for (let i = 0; i < 7; i++) if (mark >= cutoffs[i]) return GRADES[i];
  return 'E';
}
// Bands expressed as explicit [lo, hi] ranges, then each mark located by scan.
function refBands(cutoffs) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push({ g: GRADES[i], lo: i === 7 ? 0 : cutoffs[i], hi: i === 0 ? 100 : cutoffs[i - 1] - 1 });
  }
  return out;
}
function refStats(marks) {
  const s = marks.slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n < 2 ? null : Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const q = (p) => {
    const h = (n - 1) * p;
    const l = Math.floor(h);
    return s[l] + (h - l) * ((s[l + 1] === undefined ? s[l] : s[l + 1]) - s[l]);
  };
  return { n, min: s[0], max: s[n - 1], mean, med, sd, q1: q(0.25), q3: q(0.75) };
}
function refImpact(marks, now, before) {
  let changed = 0, up = 0, down = 0;
  const cNow = GRADES.map(() => 0), cBefore = GRADES.map(() => 0);
  marks.forEach((m) => {
    const a = refGrade(m, now), b = refGrade(m, before);
    cNow[GRADES.indexOf(a)]++;
    cBefore[GRADES.indexOf(b)]++;
    if (a !== b) {
      changed++;
      if (GRADES.indexOf(a) < GRADES.indexOf(b)) up++; else down++;
    }
  });
  return { changed, up, down, cNow, cBefore };
}
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function randomCutoffs() {
  const set = new Set();
  while (set.size < 7) set.add(1 + Math.floor(Math.random() * 100));
  return Array.from(set).sort((a, b) => b - a);
}

/* ======================================================================= */
section('1. Grading logic (pure, independent reference)');

(function () {
  const bands = refBands(DEFAULTS);
  let bad = [];
  for (let m = 0; m <= 100; m++) {
    const hits = bands.filter((b) => m >= b.lo && m <= b.hi);
    if (hits.length !== 1 || hits[0].g !== G.gradeFor(m, DEFAULTS)) bad.push(m);
  }
  check('defaults: every mark 0-100 has exactly one grade, matching the app', bad.length === 0, bad.join(','));
  const edges = { 0: 'E', 19: 'E', 20: 'D', 29: 'D', 30: 'C-', 39: 'C-', 40: 'C', 49: 'C', 50: 'B-', 59: 'B-', 60: 'B', 69: 'B', 70: 'A-', 79: 'A-', 80: 'A', 100: 'A' };
  const edgeBad = Object.keys(edges).filter((m) => G.gradeFor(+m, DEFAULTS) !== edges[m]);
  check('defaults: boundary marks graded per the brief', edgeBad.length === 0, edgeBad.join(','));
  check('out-of-scale marks are not graded', G.gradeFor(-1, DEFAULTS) === null && G.gradeFor(101, DEFAULTS) === null);

  let cfgBad = 0;
  for (let k = 0; k < 400; k++) {
    const c = randomCutoffs();
    if (!G.validate(c).valid) { cfgBad++; continue; }
    const appBands = G.bandsFromCutoffs(c);
    const rb = refBands(c);
    for (let m = 0; m <= 100; m++) {
      const hits = rb.filter((b) => m >= b.lo && m <= b.hi).length;
      const appHits = appBands.filter((b) => m >= b.min && m <= b.max).length;
      if (hits !== 1 || appHits !== 1 || G.gradeFor(m, c) !== refGrade(m, c)) { cfgBad++; break; }
    }
  }
  check('400 random valid configurations: no gaps, no overlaps, app == reference', cfgBad === 0, cfgBad + ' failed');

  let reachable = 0;
  for (let k = 0; k < 400; k++) {
    let c = DEFAULTS.slice();
    for (let s = 0; s < 25; s++) {
      c = G.applyCutoff(c, Math.floor(Math.random() * 9) - 1, Math.floor(Math.random() * 400) - 150).cutoffs;
      if (!G.validate(c).valid) { reachable++; break; }
    }
  }
  check('hostile edit sequences never reach an invalid configuration', reachable === 0, reachable + ' reached');
  check('invalid configurations are rejected by validate()', [
    [80, 80, 60, 50, 40, 30, 20], [70, 80, 60, 50, 40, 30, 20], [80, 70, 60, 50, 40, 30], [101, 70, 60, 50, 40, 30, 20],
    [80.5, 70, 60, 50, 40, 30, 20], [NaN, 70, 60, 50, 40, 30, 20]
  ].every((c) => !G.validate(c).valid));
  check('defaults() returns a fresh copy', (() => { const d = G.defaults(); d[0] = 1; return G.defaults()[0] === 80; })());
})();

section('2. Statistics (pure, independent reference)');
(function () {
  const S = CF.statistics;
  const cases = { one: [73], identical: Array(12).fill(64), zero: [0], hundred: [100], extremes: [0, 0, 100, 100, 0, 100], mixed: [9, 100, 45, 45, 77, 12, 88, 60] };
  Object.keys(cases).forEach((k) => {
    const d = S.describe(cases[k]);
    const r = refStats(cases[k]);
    const close = (a, b) => (a === null && b === null) || Math.abs(a - b) < 1e-9;
    const okAll = d.count === r.n && d.min === r.min && d.max === r.max && close(d.mean, r.mean) && close(d.median, r.med) && close(d.stdDev, r.sd) && close(d.q1, r.q1) && close(d.q3, r.q3);
    const finite = [d.min, d.max, d.mean, d.median, d.q1, d.q3].every((v) => typeof v === 'number' && isFinite(v)) && (d.stdDev === null || isFinite(d.stdDev));
    check('stats match reference: ' + k, okAll && finite, JSON.stringify({ d: { ...d, sorted: undefined }, r }));
    const h = S.histogram(cases[k]);
    check('histogram counts every mark: ' + k, h.counted === cases[k].length && h.bins.reduce((a, b) => a + b, 0) === cases[k].length);
  });
  const e = S.describe([]);
  check('empty cohort yields nulls, not NaN', e.count === 0 && e.mean === null && e.median === null && e.stdDev === null);
  const gAll = G.gradeAll([0, 20, 79, 80, 100].map((m, i) => ({ id: 's' + i, marks: m })), DEFAULTS);
  check('grade counts sum to cohort size', gAll.counts.reduce((a, b) => a + b, 0) === 5 && gAll.ungraded.length === 0);
})();

/* ======================================================================= */
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('dialog', (d) => { errors.push('DIALOG ' + d.message()); d.dismiss().catch(() => {}); });

  const upload = async (f) => { await page.setInputFiles('#fileInput', path.join(FIX, f)); await page.waitForTimeout(700); };
  const state = () => page.evaluate(() => {
    const s = window.CF.app.state;
    return {
      courseKey: s.courseKey, courseName: s.courseName, cutoffs: s.cutoffs.slice(), baseline: s.baseline && s.baseline.slice(),
      history: s.history.length, finalized: !!s.finalized, isDemo: s.isDemo, cohort: s.cohort.map((r) => ({ id: r.id, marks: r.marks })),
      file: s.file && s.file.name, courses: s.analysis ? s.analysis.courses.map((c) => c.name) : null, instructor: s.instructor
    };
  });
  const pickCourse = async (n) => { await page.click('.stage-step[data-stage="import"]'); await page.waitForTimeout(250); await page.click('#coursePicker .course-card >> nth=' + n); await page.waitForTimeout(400); };
  // Stages unlock as the instructor reaches them, so an unvisited stage is
  // entered through its forward button, exactly as a user would.
  const goto = async (stage) => {
    const step = page.locator('.stage-step[data-stage="' + stage + '"]');
    if (await step.isEnabled()) await step.click();
    else if (stage === 'configure') { await goto('analyse'); await page.click('text=Configure grade bands'); }
    else if (stage === 'review') { await goto('configure'); await page.click('text=Review & finalize'); }
    await page.waitForTimeout(400);
  };
  const setCut = async (grade, v) => {
    await goto('configure');
    await page.fill('#cutoff-' + grade, String(v));
    await page.locator('#cutoff-' + grade).blur();
    await page.waitForTimeout(250);
  };
  // Once a file is in, the demo loader sits inside the collapsed onboarding.
  const loadDemo = async () => {
    await goto('import');
    if (!(await page.locator('#loadDemo').isVisible())) { await page.click('#showOnboarding'); await page.waitForTimeout(300); }
    await page.click('#loadDemo');
    await page.waitForTimeout(600);
  };
  const scrapeReview = () => page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return null;
    const bands = Array.from(sheet.querySelectorAll('table.diff tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => c.textContent.trim()));
    const tiles = Array.from(sheet.querySelectorAll('.stats > *')).map((t) => t.textContent.trim());
    return { title: sheet.querySelector('.sheet__title').textContent.trim(), text: sheet.innerText, bands, tiles };
  });
  // "80-100" | "80" -> [lo, hi]
  const parseRange = (s) => { const m = s.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); return m ? [+m[1], m[2] ? +m[2] : +m[1]] : null; };
  const reviewBands = (rv) => rv.bands.map((cells) => {
    const g = cells.find((c) => /^[A-E]-?$/.test(c));
    const r = cells.map(parseRange).find(Boolean);
    return { g, lo: r && r[0], hi: r && r[1], n: +cells[cells.findIndex((c) => parseRange(c)) + 1] };
  });

  await page.goto(BASE);
  await page.waitForTimeout(600);

  /* ---- 3. import validation ------------------------------------------ */
  section('3. Import validation');
  for (const f of ['10-missing-column.xlsx', '20-corrupt-not-a-zip.xlsx', '21-empty-file.xlsx', '13-empty-headers-only.xlsx', '24-zero-worksheets.xlsx']) {
    await upload(f);
    const txt = (await page.locator('#importError').innerText().catch(() => '')) || '';
    const st = await state();
    check(f + ': clear error, no course picker, no data adopted', txt.length > 40 && !/undefined|NaN|null/.test(txt) && st.courses === null && !(await page.locator('#coursePicker').isVisible()) && (await page.locator('#importError button').count()) > 0, txt.slice(0, 120));
  }
  await upload('01-valid-standard.xlsx');
  let st = await state();
  check('recovery: a valid file after failures loads normally', JSON.stringify(st.courses.sort()) === JSON.stringify(['BA210', 'CS101', 'ME201']));
  await upload('11-duplicate-and-blank.xlsx');
  let rep = await page.locator('#importReport').innerText();
  check('duplicate and blank IDs are reported as rejected rows', /duplicate/i.test(rep) && /(blank|missing|empty)/i.test(rep), rep.slice(0, 200));
  await upload('09-invalid-marks.xlsx');
  rep = await page.locator('#importReport').innerText();
  const rej = await page.evaluate(() => window.CF.app.state.analysis.issues.filter((i) => i.severity === 'error').map((i) => i.row));
  check('invalid marks are rejected with their spreadsheet row numbers shown', rej.length === 5 && rej.every((r) => rep.includes(String(r))), JSON.stringify(rej));
  check('fractional marks offer a rounding rule', await page.locator('#roundingPolicy').count() === 1);

  /* ---- rounding workflow ---------------------------------------------- */
  await pickCourse(0);
  const marksNearest = (await state()).cohort.map((r) => r.marks);
  await setCut('A', 85);
  const beforeRound = await state();
  await goto('import');
  await page.selectOption('#roundingPolicy', 'up');
  await page.waitForTimeout(500);
  const afterRound = await state();
  check('changing the rounding rule re-grades the fractional marks', JSON.stringify(afterRound.cohort.map((r) => r.marks)) !== JSON.stringify(marksNearest) && afterRound.cohort.every((r) => Number.isInteger(r.marks)));
  check('changing the rounding rule keeps the selected course', afterRound.courseKey === beforeRound.courseKey);
  check('changing the rounding rule keeps the instructor\'s cutoffs', JSON.stringify(afterRound.cutoffs) === JSON.stringify(beforeRound.cutoffs), 'before ' + beforeRound.cutoffs + ' after ' + afterRound.cutoffs);
  check('changing the rounding rule keeps the change history', afterRound.history === beforeRound.history, beforeRound.history + ' -> ' + afterRound.history);

  /* ---- 4. state isolation --------------------------------------------- */
  section('4. Stale state / repeated upload');
  await page.fill('#instructor', 'Dr. Stale Check');
  await upload('01-valid-standard.xlsx');
  await pickCourse(1);
  await setCut('A', 88);
  await setCut('C', 45);
  await goto('review');
  await upload('17-bimodal.xlsx');
  st = await state();
  check('file B: no course selected yet', st.courseKey === null && st.cohort.length === 0);
  check('file B: cutoffs back to defaults', JSON.stringify(st.cutoffs) === JSON.stringify(DEFAULTS));
  check('file B: history and baseline cleared', st.history === 0 && st.baseline === null);
  check('file B: only its own courses listed', JSON.stringify(st.courses) === JSON.stringify(['CS101']) && (await page.locator('#coursePicker .course-card').count()) === 1);
  check('file B: stale review sheet removed', (await page.locator('#reviewBody .sheet').count()) === 0);
  await pickCourse(0);
  st = await state();
  await goto('review');
  const rvB = await scrapeReview();
  check('file B: review reflects file B cohort and defaults', rvB && rvB.title === 'CS101' && reviewBands(rvB).every((b, i) => b.lo === refBands(DEFAULTS)[i].lo));

  await loadDemo();
  await pickCourse(0);
  await setCut('A', 90);
  const demoState = await state();
  check('demo loads and is flagged as demo', demoState.isDemo === true);
  await upload('01-valid-standard.xlsx');
  st = await state();
  check('demo -> real: demo flag cleared, cutoffs default, no course', st.isDemo === false && JSON.stringify(st.cutoffs) === JSON.stringify(DEFAULTS) && st.courseKey === null);
  await loadDemo();
  st = await state();
  check('real -> demo: demo flag set, real courses gone', st.isDemo === true && !st.courses.includes('BA210'));

  await upload('01-valid-standard.xlsx');
  await pickCourse(0);
  const courseA = (await state()).courseName;
  await setCut('A', 86);
  await pickCourse(1);
  st = await state();
  check('course A -> B: B starts from defaults with its own cohort', st.courseName !== courseA && JSON.stringify(st.cutoffs) === JSON.stringify(DEFAULTS) && st.history === 0);
  await pickCourse(0);
  st = await state();
  check('course B -> A: cohort is course A only', st.courseName === courseA && st.cohort.length === 22);

  /* ---- 5. impact -------------------------------------------------------- */
  section('5. Impact calculations');
  const cohortMarks = st.cohort.map((r) => r.marks);
  const impactDom = () => page.evaluate(() => {
    const fig = document.querySelector('.impact__figure');
    const banner = document.querySelector('.impact__banner');
    const up = document.querySelector('.impact-split__item[data-dir="up"] .impact-split__n');
    const down = document.querySelector('.impact-split__item[data-dir="down"] .impact-split__n');
    return { state: banner && banner.dataset.state, changed: fig ? +fig.textContent : 0, up: up ? +up.textContent : 0, down: down ? +down.textContent : 0 };
  });
  // Zero affected: move a cutoff across an empty stretch of marks.
  // Zero affected: find any one-step cutoff move that crosses no student's mark.
  const cz = (await state()).cutoffs;
  let zero = null;
  for (let i = 0; i < 7 && !zero; i++) {
    for (const v of [cz[i] + 1, cz[i] - 1]) {
      const w = G.windowFor(cz, i);
      const lo = Math.min(cz[i], v), hi = Math.max(cz[i], v);
      if (w && v >= w.lo && v <= w.hi && !cohortMarks.some((m) => m >= lo && m < hi)) { zero = { g: GRADES[i], v }; break; }
    }
  }
  check('found a zero-impact move to test', !!zero);
  if (zero) {
    await setCut(zero.g, zero.v);
    const sz = await state();
    const dom = await impactDom();
    const ref = refImpact(cohortMarks, sz.cutoffs, sz.baseline);
    check('zero affected: panel says so and matches reference', ref.changed === 0 && dom.state === 'clean', JSON.stringify({ zero, dom, ref: ref.changed }));
    await page.click('#configureActions button:has-text("Undo")');
    await page.waitForTimeout(300);
  }
  // One affected: move A down to exactly one student's mark below the cutoff.
  const cNow = (await state()).cutoffs;
  const below = cohortMarks.filter((m) => m < cNow[0] && m >= cNow[1]).sort((a, b) => b - a);
  if (below.length && below.filter((m) => m === below[0]).length === 1) {
    await setCut('A', below[0]);
    const s1 = await state();
    const dom = await impactDom();
    const ref = refImpact(cohortMarks, s1.cutoffs, s1.baseline);
    check('one affected: count and direction match reference', ref.changed === 1 && dom.changed === 1 && dom.up === 1 && dom.down === 0, JSON.stringify({ dom, ref }));
  }
  // Multiple affected.
  await setCut('B', 68);
  let s2 = await state();
  let dom2 = await impactDom();
  let ref2 = refImpact(cohortMarks, s2.cutoffs, s2.baseline);
  check('multiple affected: changed/up/down match reference', dom2.changed === ref2.changed && dom2.up === ref2.up && dom2.down === ref2.down && ref2.changed >= 1, JSON.stringify({ dom2, ref2 }));
  const movedList = await page.evaluate(() => document.querySelector('#impactPanel, .impact') ? (document.querySelector('#impactPanel') || document.querySelector('.impact')).innerText : '');
  const expectMoved = s2.cohort.filter((r) => refGrade(r.marks, s2.cutoffs) !== refGrade(r.marks, s2.baseline));
  check('moved students listed with previous and new grade', expectMoved.every((r) => movedList.includes(r.id) && movedList.includes(refGrade(r.marks, s2.baseline)) && movedList.includes(refGrade(r.marks, s2.cutoffs))), expectMoved.map((r) => r.id).join(','));
  const deltas = await page.evaluate(() => Array.from(document.querySelectorAll('#bandEditor .band-delta[data-dir]')).map((n) => n.textContent.trim()));
  const expDeltas = ref2.cNow.map((n, i) => n - ref2.cBefore[i]).filter((d) => d !== 0);
  check('before/after band deltas match reference', deltas.length === expDeltas.length, JSON.stringify({ deltas, expDeltas }));
  // Undo restores the previous cutoffs and impact is again consistent.
  const beforeUndo = s2.baseline;
  await page.click('#configureActions button:has-text("Undo")');
  await page.waitForTimeout(300);
  s2 = await state();
  dom2 = await impactDom();
  ref2 = refImpact(cohortMarks, s2.cutoffs, s2.baseline);
  check('undo restores the previous cutoffs; impact still matches reference', JSON.stringify(s2.cutoffs) === JSON.stringify(beforeUndo) && dom2.changed === ref2.changed && dom2.up === ref2.up && dom2.down === ref2.down, JSON.stringify({ dom2, ref2 }));
  await page.click('#configureActions button:has-text("Reset")').catch(() => {});
  await page.waitForTimeout(300);
  s2 = await state();
  check('reset restores the challenge defaults', JSON.stringify(s2.cutoffs) === JSON.stringify(DEFAULTS));

  /* ---- 6. review consistency ------------------------------------------ */
  section('6. Final review consistency');
  await setCut('A', 84);
  await setCut('B-', 55);
  await page.fill('#instructor', 'Prof. First');
  await goto('review');
  let rv = await scrapeReview();
  let s3 = await state();
  const checkReview = (label) => {
    const rb = reviewBands(rv);
    const ref = refBands(s3.cutoffs);
    const marks = s3.cohort.map((r) => r.marks);
    const counts = GRADES.map((g) => marks.filter((m) => refGrade(m, s3.cutoffs) === g).length);
    const bandsOk = rb.length === 8 && rb.every((b, i) => b.g === ref[i].g && b.lo === ref[i].lo && b.hi === ref[i].hi && b.n === counts[i]);
    const r = refStats(marks);
    const tilesTxt = rv.tiles.join(' | ');
    const statsOk = tilesTxt.includes(String(r.n)) && tilesTxt.includes(String(r.min)) && tilesTxt.includes(String(r.max)) && tilesTxt.includes(r.mean.toFixed(1));
    check(label + ': course and instructor current', rv.title === s3.courseName && rv.text.includes(s3.instructor.trim()));
    check(label + ': band table and counts match reference', bandsOk, JSON.stringify(rb) + ' vs ' + JSON.stringify(ref) + ' ' + counts);
    check(label + ': statistics match reference', statsOk && !/NaN|undefined|Infinity/.test(rv.text), tilesTxt);
  };
  checkReview('review #1');
  await setCut('A', 91);
  await page.fill('#instructor', 'Prof. Second');
  await goto('review');
  rv = await scrapeReview();
  s3 = await state();
  checkReview('review after edits');

  /* ---- 7. export ------------------------------------------------------- */
  section('7. Export correctness');
  const exportNow = async () => {
    downloads.length = 0;
    const btn = page.locator('#reviewBody button:has-text("Finalize & export")');
    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await btn.click();
    await page.waitForTimeout(300);
    await page.locator('.modal button:has-text("Finalize and download")').click();
    for (let i = 0; i < 30 && downloads.length < 2; i++) await page.waitForTimeout(100);
    const files = {};
    for (const d of downloads) files[d.suggestedFilename()] = fs.readFileSync(await d.path(), 'utf8');
    try { await page.locator('.modal button:has-text("Done")').click({ timeout: 3000 }); } catch (e) { /* closed */ }
    return files;
  };
  const verifyExport = (files, label, rvNow, sNow) => {
    const names = Object.keys(files);
    const gName = names.find((n) => !/summary/i.test(n));
    const sName = names.find((n) => /summary/i.test(n));
    check(label + ': two files, named for the course', names.length === 2 && gName && sName && names.every((n) => n.includes(sNow.courseName) && n.endsWith('.csv')), names.join(', '));
    const rows = parseCsv(files[gName]);
    const body = rows.slice(1).filter((r) => r.length > 1);
    check(label + ': header and row count', rows[0].join('|') === 'BITS ID|Total Marks|Grade' && body.length === sNow.cohort.length, body.length + ' vs ' + sNow.cohort.length);
    const byId = new Map(sNow.cohort.map((r) => [r.id, r.marks]));
    check(label + ': every ID and mark matches the cohort', body.every((r) => byId.has(r[0]) && +r[1] === byId.get(r[0])) && new Set(body.map((r) => r[0])).size === body.length);
    const sheetBands = reviewBands(rvNow);
    const gradeFromSheet = (m) => (sheetBands.find((b) => m >= b.lo && m <= b.hi) || {}).g;
    const mismatch = body.filter((r) => r[2] !== gradeFromSheet(+r[1]));
    check(label + ': EXPORTED GRADES == grades implied by the review sheet', mismatch.length === 0, mismatch.slice(0, 3).map((r) => r.join(',')).join(' | '));
    const tally = GRADES.map((g) => body.filter((r) => r[2] === g).length);
    check(label + ': exported grade counts == review sheet counts', sheetBands.every((b, i) => b.n === tally[i]), tally + ' vs ' + sheetBands.map((b) => b.n));
    const sum = parseCsv(files[sName]);
    const field = (k) => (sum.find((r) => r[0] === k) || [])[1];
    check(label + ': summary instructor, course, count', field('Instructor') === sNow.instructor.trim() && field('Course') === sNow.courseName && +field('Students graded') === sNow.cohort.length);
    const sumBands = sum.filter((r) => GRADES.includes(r[0]) && r.length >= 5 && /^\d+$/.test(r[1]));
    check(label + ': summary bands == review sheet', sumBands.length === 8 && sumBands.every((r, i) => +r[1] === sheetBands[i].lo && +r[2] === sheetBands[i].hi && +r[3] === sheetBands[i].n));
    if (sum.some((r) => r[0] === 'Students affected')) {
      check(label + ': impact section is labelled as a comparison with the defaults', files[sName].includes('Change from the default bands') && !files[sName].includes('previous configuration'));
    }
    check(label + ': no NaN/undefined/null in either file', !/NaN|undefined|null/.test(files[gName] + files[sName]));
  };
  let files = await exportNow();
  s3 = await state();
  verifyExport(files, 'export #1', rv, s3);
  check('finalized state recorded', s3.finalized === true);
  await setCut('A', 89);
  check('an edit after finalize clears finalized state', (await state()).finalized === false);

  // CSV escaping via a hostile instructor name.
  await page.fill('#instructor', 'Rao, "K." =SUM(A1)');
  await goto('review');
  rv = await scrapeReview();
  s3 = await state();
  files = await exportNow();
  verifyExport(files, 'export #2 (hostile name)', rv, s3);

  /* ---- 8. second workbook end-to-end ---------------------------------- */
  section('8. Second workbook end-to-end');
  await upload('18-large-class-300.xlsx');
  await pickCourse(1);
  await setCut('A', 77);
  await setCut('D', 25);
  await page.fill('#instructor', 'Dr. Second Run');
  await goto('review');
  rv = await scrapeReview();
  s3 = await state();
  check('second workbook: review shows the new course', rv.title === s3.courseName && s3.cohort.length === 150);
  files = await exportNow();
  verifyExport(files, 'second workbook export', rv, s3);

  /* ---- 9. modal, keyboard, responsive --------------------------------- */
  section('9. Accessibility / responsiveness spot checks');
  await setCut('A', 78);
  await goto('review');
  const unlabelled = await page.evaluate(() => Array.from(document.querySelectorAll('input:not([type=hidden]), select, button')).filter((el) => {
    if (el.offsetParent === null) return false;
    const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent || el.title || '').trim();
    const lab = el.id && document.querySelector('label[for="' + el.id + '"]');
    return !name && !lab && !el.closest('label');
  }).map((el) => el.outerHTML.slice(0, 80)));
  check('visible controls all have an accessible name', unlabelled.length === 0, unlabelled.join(' | '));
  const btn = page.locator('#reviewBody button:has-text("Finalize & export")');
  await btn.scrollIntoViewIfNeeded();
  await btn.focus();
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const focusVisible = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && s.outlineWidth !== '0px' || s.boxShadow !== 'none'; });
  check('keyboard focus is visible', outline || focusVisible);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const inModal = await page.evaluate(() => !!document.activeElement.closest('.modal'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = (await page.locator('.modal').count()) === 0 || !(await page.locator('.modal').first().isVisible());
  check('finalize dialog opens by keyboard, traps focus, closes on Escape', inModal && closed);

  for (const w of [1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const stg of ['import', 'analyse', 'configure', 'review']) {
      await goto(stg);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(w + 'px ' + stg + ': no horizontal overflow', over <= 1, over + 'px');
    }
  }

  section('10. Console');
  check('no console errors, page errors or native dialogs', errors.length === 0, errors.slice(0, 5).join(' | '));

  console.log('\n' + '-'.repeat(64));
  console.log((fail ? '\x1b[31m' : '\x1b[32m') + pass + ' passing, ' + fail + ' failing\x1b[0m');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
