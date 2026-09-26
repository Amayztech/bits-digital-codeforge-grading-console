/**
 * Unit and integration tests for the grading console.
 *   node tests/run.js
 *
 * The browser core modules are environment-agnostic (they attach to
 * globalThis.CF and never touch the DOM), so they can be loaded straight into
 * Node and exercised against the generated adversarial workbook corpus.
 */
'use strict';

const H = require('./harness');
const { suite, test, eq, ok, near, throws, loadApp, analyseFixture } = H;

const CF = loadApp();
const XLSX = globalThis.XLSX;

/* ==================================================================== *
 * util
 * ==================================================================== */
suite('util');
const U = CF.util;

test('roundHalfUp is classic half-up, and roundMark honours the chosen policy', () => {
  // The challenge states "rounded to the nearest integer" but illustrates it
  // with 80.2 -> 81. Both policies are offered so the choice is explicit.
  eq(U.roundHalfUp(80.2), 80, 'nearest whole mark to 80.2');
  eq(U.roundHalfUp(80.6), 81);
  eq(U.roundHalfUp(0.5), 1);
  eq(U.roundHalfUp(-0.5), -1);
  eq(U.roundMark(80.2, 'nearest'), 80);
  eq(U.roundMark(80.2, 'up'), 81);
  eq(U.roundMark(80.6, 'up'), 81);
  eq(U.roundMark(80.6, 'down'), 80);
});

test('headerKey normalises case, padding, underscores and "(out of 100)"', () => {
  eq(U.headerKey('  Total Marks  '), 'total marks');
  eq(U.headerKey('TOTAL_MARKS'), 'total marks');
  eq(U.headerKey("Student's BITS ID"), "student's bits id");
  eq(U.headerKey('Total Marks (out of 100)'), 'total marks');
  eq(U.headerKey('bits-id'), 'bits id');
  eq(U.headerKey(null), '');
});

test('csvField applies RFC 4180 quoting', () => {
  eq(U.csvField('plain'), 'plain');
  eq(U.csvField('has,comma'), '"has,comma"');
  eq(U.csvField('say "hi"'), '"say ""hi"""');
  eq(U.csvField('line\nbreak'), '"line\nbreak"');
  eq(U.csvField(''), '""');
});

test('csvField neutralises spreadsheet formula injection', () => {
  eq(U.csvField('=1+1'), "'=1+1");
  eq(U.csvField('+SUM(A1)'), "'+SUM(A1)");
  eq(U.csvField('-2+3'), "'-2+3");
  eq(U.csvField('@import'), "'@import");
  eq(U.csvField('82'), '82');
});

test('slugify produces filesystem-safe file name fragments', () => {
  eq(U.slugify('CS 101: Data Structures'), 'CS-101-Data-Structures');
  eq(U.slugify('A/B\\C*D'), 'A-B-C-D');
  eq(U.slugify('   '), 'course');
  eq(U.slugify('OEE 2024-25 Sem 1').length <= 48, true);
});

test('percent never returns NaN for an empty whole', () => {
  eq(U.percent(0, 0), 0);
  eq(U.percent(3, 4), 75);
  eq(U.percent(0, 10), 0);
});

test('formatDuration reads naturally at every magnitude', () => {
  eq(U.formatDuration(0), '0s');
  eq(U.formatDuration(9000), '9s');
  eq(U.formatDuration(65000), '1m 05s');
  eq(U.formatDuration(3725000), '1h 02m');
});

test('deepEqual compares cutoff arrays by value', () => {
  eq(U.deepEqual([1, 2], [1, 2]), true);
  eq(U.deepEqual([1, 2], [2, 1]), false);
  eq(U.deepEqual([1], [1, 2]), false);
});

/* ==================================================================== *
 * statistics
 * ==================================================================== */
suite('statistics');
const S = CF.statistics;

test('sortedMarks sorts numerically even when the source values were text', () => {
  // The starter produced Min: 100, Max: 9 and an average of 1821296420 here.
  eq(S.sortedMarks(['9', '10', '82', '100', '64']), [9, 10, 64, 82, 100]);
  eq(S.sortedMarks(['9', '10', '82', '100', '64']), [9, 10, 64, 82, 100]);
});

test('sortedMarks and describe ignore values that are not numbers at all', () => {
  eq(S.sortedMarks(['ABS', '', null, undefined, 'x', 50, 10]), [10, 50]);
  eq(S.sortedMarks([NaN, Infinity, 3]), [3]);
  const d = S.describe(['ABS', 10, 20, null]);
  eq([d.count, d.min, d.max, d.mean], [2, 10, 20, 15]);
});

test('describe on an empty cohort returns nulls, never NaN', () => {
  const d = S.describe([]);
  eq(d.count, 0);
  eq(d.min, null);
  eq(d.max, null);
  eq(d.mean, null);
  eq(d.median, null);
  eq(d.stdDev, null);
  eq(d.q1, null);
  eq(d.q3, null);
  Object.keys(d).forEach((k) => {
    if (typeof d[k] === 'number') ok(isFinite(d[k]), k + ' must be finite');
  });
});

test('describe on a single value is well defined', () => {
  const d = S.describe([73]);
  eq([d.count, d.min, d.max, d.mean, d.median, d.stdDev], [1, 73, 73, 73, 73, null]);
});

test('describe on identical marks reports zero standard deviation, not NaN', () => {
  const d = S.describe(Array(12).fill(75));
  eq(d.stdDev, 0);
  eq(d.mean, 75);
  eq(d.median, 75);
  eq(d.min, 75);
  eq(d.max, 75);
});

test('min, max, mean and median are mathematically correct', () => {
  const d = S.describe([10, 20, 30, 40, 100]);
  eq(d.min, 10);
  eq(d.max, 100);
  eq(d.mean, 40);
  eq(d.median, 30);
  near(d.stdDev, Math.sqrt(((10 - 40) ** 2 + (20 - 40) ** 2 + (30 - 40) ** 2 + (40 - 40) ** 2 + (100 - 40) ** 2) / 4), 1e-9);
});

test('median of an even-length cohort averages the two middle values', () => {
  eq(S.median([1, 2, 3, 4]), 2.5);
  eq(S.median([1, 2, 3]), 2);
});

test('quantile interpolates linearly (spreadsheet PERCENTILE.INC convention)', () => {
  const s = [1, 2, 3, 4];
  eq(S.quantile(s, 0), 1);
  eq(S.quantile(s, 0.5), 2.5);
  eq(S.quantile(s, 1), 4);
  eq(S.quantile([10, 20, 30, 40, 50], 0.25), 20);
  eq(S.quantile([10, 20, 30, 40, 50], 0.75), 40);
});

test('standard deviation is null for fewer than two values', () => {
  eq(S.stdDev([]), null);
  eq(S.stdDev([5]), null);
});

test('histogram has exactly 101 bins and places 100 in the top bin', () => {
  const h = S.histogram([0, 50, 100, 100, 100]);
  eq(h.bins.length, 101);
  eq(h.bins[0], 1);
  eq(h.bins[50], 1);
  eq(h.bins[100], 3);
  eq(h.peak, 3);
  eq(h.counted, 5);
});

test('histogram ignores marks outside the 0-100 scale instead of corrupting bins', () => {
  const h = S.histogram([-5, 120, 50]);
  eq(h.bins[0], 0);
  eq(h.bins[100], 0);
  eq(h.bins[50], 1);
  eq(h.counted, 1);
});

test('axisTicks gives a sensible scale for tiny and large classes', () => {
  eq(S.niceMax(1), 1);
  eq(S.niceMax(3), 3);
  eq(S.niceMax(7), 10);
  eq(S.niceMax(23), 25);
  eq(S.niceMax(300), 300);
  const t = S.axisTicks(7);
  ok(t.top >= 7, 'axis top must cover the peak');
  ok(t.ticks.length >= 2, 'needs at least two ticks');
  ok(t.ticks.every((v) => v <= t.top), 'no tick above the axis top');
});

test('clusters finds separated groups and one merged group', () => {
  const bimodal = S.clusters([35, 36, 37, 85, 86, 87], 6);
  eq(bimodal.length, 2);
  eq([bimodal[0].min, bimodal[0].max], [35, 37]);
  eq([bimodal[1].min, bimodal[1].max], [85, 87]);
  eq(S.clusters([10, 12, 14, 15, 16], 6).length, 1);
  eq(S.clusters([], 6), []);
});

/* ==================================================================== *
 * grading
 * ==================================================================== */
suite('grading');
const G = CF.grading;

test('default cutoffs produce the bands named in the challenge brief', () => {
  const b = G.defaultBands();
  eq(b.map((x) => x.grade + ' ' + x.min + '-' + x.max), [
    'A 80-100', 'A- 70-79', 'B 60-69', 'B- 50-59',
    'C 40-49', 'C- 30-39', 'D 20-29', 'E 0-19'
  ]);
});

test('every mark from 0 to 100 receives exactly one grade on the defaults', () => {
  const counts = {};
  for (let m = 0; m <= 100; m++) {
    const g = G.gradeFor(m, G.defaults());
    ok(g !== null, 'mark ' + m + ' received no grade');
    counts[g] = (counts[g] || 0) + 1;
  }
  eq(Object.keys(counts).length, 8);
  eq(counts.A, 21);
  eq(counts.E, 20);
});

test('boundary marks land in the band the instructor expects', () => {
  const c = G.defaults();
  const expect = {
    0: 'E', 19: 'E', 20: 'D', 29: 'D', 30: 'C-', 39: 'C-', 40: 'C', 49: 'C',
    50: 'B-', 59: 'B-', 60: 'B', 69: 'B', 70: 'A-', 79: 'A-', 80: 'A', 100: 'A'
  };
  Object.keys(expect).forEach((k) => {
    eq(G.gradeFor(Number(k), c), expect[k], 'mark ' + k);
  });
});

test('marks outside the scale are refused rather than silently graded', () => {
  eq(G.gradeFor(-1, G.defaults()), null);
  eq(G.gradeFor(101, G.defaults()), null);
  eq(G.gradeFor(NaN, G.defaults()), null);
  eq(G.gradeFor('82', G.defaults()), null);
});

test('single-mark bands are representable (the starter rejected Min === Max)', () => {
  const cut = [80, 60, 40, 30, 20, 10, 5];
  const b = G.bandsFromCutoffs(cut);
  eq(G.gradeFor(4, cut), 'E');
  eq(G.gradeFor(5, cut), 'D');
  eq(G.gradeFor(6, cut), 'D');
  const v = G.validate(cut);
  eq(v.valid, true, v.problems.join('; '));
  // Give E a single mark by raising D's cutoff to 1.
  const cut2 = [80, 60, 40, 30, 20, 10, 1];
  eq(G.bandsFromCutoffs(cut2)[7].min, 0);
  eq(G.bandsFromCutoffs(cut2)[7].max, 0);
  eq(G.gradeFor(0, cut2), 'E');
  eq(G.gradeFor(1, cut2), 'D');
  eq(G.validate(cut2).valid, true);
});

test('applyCutoff clamps to the legal window and reports that it did', () => {
  const c = G.defaults();
  const up = G.applyCutoff(c, 0, 999);
  eq(up.cutoffs[0], 100, 'A may rise to a single-mark top band');
  eq(up.clampedTo, 100);
  const down = G.applyCutoff(c, 0, -5);
  eq(down.cutoffs[0], 71, 'A may not fall to or below A-');
  eq(down.clampedTo, 71);
  const mid = G.applyCutoff(c, 0, 85);
  eq(mid.cutoffs[0], 85);
  eq(mid.clampedTo, null);
});

test('applyCutoff refuses to edit the bottom band, which is fixed at 0', () => {
  const c = G.defaults();
  eq(G.windowFor(c, 7), null, 'E is not editable');
  eq(G.applyCutoff(c, 7, 50).cutoffs[6], 20, 'the D cutoff must be untouched');
  eq(G.applyCutoff(c, -1, 50).cutoffs, c);
});

test('windows match the derivation rules', () => {
  const c = G.defaults();
  eq(G.windowFor(c, 0), { lo: 71, hi: 100 });
  eq(G.windowFor(c, 1), { lo: 61, hi: 79 });
  eq(G.windowFor(c, 6), { lo: 1, hi: 29 });
});

test('no sequence of edits can produce a gap or an overlap', () => {
  let c = G.defaults();
  const sequence = [
    [0, 99], [0, 1], [1, 99], [6, 0], [6, 100], [3, 3], [5, 98], [4, 0], [4, 100],
    [0, 50], [1, 60], [2, 40], [3, 30], [4, 20], [5, 10], [6, 5]
  ];
  sequence.forEach(([i, v]) => {
    c = G.applyCutoff(c, i, v).cutoffs;
    const check = G.validate(c);
    ok(check.valid, 'invalid after editing cutoff ' + i + ' to ' + v + ': ' + check.problems.join('; '));
  });
  // Exhaustive coverage proof.
  for (let m = 0; m <= 100; m++) ok(G.gradeFor(m, c) !== null, 'mark ' + m + ' ungraded');
});

test('validate reports a non-increasing configuration instead of passing it', () => {
  const v = G.validate([80, 70, 60, 50, 40, 30, 30]);
  eq(v.valid, false);
  ok(v.problems.length > 0);
  const short = G.validate([80, 70]);
  eq(short.valid, false);
  const bad = G.validate([80, 70, 60, 50, 40, 30, 'x']);
  eq(bad.valid, false);
  const nan = G.validate([80, 70, 60, 50, 40, 30, NaN]);
  eq(nan.valid, false);
});

test('gradeAll tallies per band and never loses a student', () => {
  const records = [0, 19, 20, 50, 79, 80, 100].map((m, i) => ({
    id: 'S' + i, marks: m, course: 'C'
  }));
  const r = G.gradeAll(records, G.defaults());
  eq(r.counts.reduce((a, b) => a + b, 0), 7);
  eq(r.ungraded.length, 0);
  eq(r.graded.map((g) => g.grade), ['E', 'E', 'D', 'B-', 'A-', 'A', 'A']);
});

test('impact counts moves, direction and per-band deltas', () => {
  const records = [95, 85, 75, 65, 55, 45, 35, 25, 15].map((m, i) => ({
    id: 'S' + i, marks: m, course: 'C'
  }));
  const before = G.defaults();
  // Open up room bottom-up, then raise A to 90 and drop A- to 60.
  let after = before;
  [[6, 10], [5, 20], [4, 30], [3, 40], [2, 50], [1, 60], [0, 90]].forEach(([i, v]) => {
    after = G.applyCutoff(after, i, v).cutoffs;
  });
  eq(after, [90, 60, 50, 40, 30, 20, 10]);
  const imp = G.impact(records, after, before);
  eq(imp.total, 9);
  eq(imp.down, 1, 'only the 85 falls, from A down to A-');
  eq(imp.up, 6, '65, 55, 45, 35, 25 and 15 each climb a grade');
  eq(imp.changed, 7);
  eq(imp.bandDelta.reduce((a, b) => a + b.delta, 0), 0, 'band deltas must net to zero');
  eq(imp.bandDelta[0].before, 2);
  eq(imp.bandDelta[0].count, 1);
  eq(imp.bandDelta[0].delta, -1, 'A lost the 85');
  eq(imp.bandDelta[1].before, 1);
  eq(imp.bandDelta[1].count, 3);
  eq(imp.bandDelta[1].delta, 2, 'A- gained the 85 and the 65');
  eq(imp.moved.map((m) => m.id + ':' + m.from + '>' + m.to).sort(), [
    'S1:A>A-', 'S3:B>A-', 'S4:B->B', 'S5:C>B-', 'S6:C->C', 'S7:D>C-', 'S8:E>D'
  ].sort());
});

test('impact with no baseline reports counts but no movement', () => {
  const records = [10, 90].map((m, i) => ({ id: 'S' + i, marks: m, course: 'C' }));
  const imp = G.impact(records, G.defaults(), null);
  eq(imp.hasBaseline, false);
  eq(imp.changed, 0);
  eq(imp.bandDelta[0].count, 1);
});

test('rangeLabel collapses single-mark bands', () => {
  eq(G.rangeLabel({ min: 80, max: 80 }), '80');
  eq(G.rangeLabel({ min: 80, max: 100 }), '80-100');
});

/* ==================================================================== *
 * workbook: mark parsing
 * ==================================================================== */
suite('workbook — mark parsing');
const W = CF.workbook;

function codes(res) {
  return res.issues.map((i) => i.code);
}

test('accepts a plain whole number', () => {
  const r = W.parseMark(82);
  eq([r.ok, r.value, r.issues.length], [true, 82, 0]);
});

test('rounds a fractional mark and reports it under the chosen policy', () => {
  const r = W.parseMark(82.6, 'nearest');
  eq(r.ok, true);
  eq(r.value, 83);
  eq(r.issues.map((i) => i.code), ['ROUNDED_MARKS']);
  eq(r.issues[0].resolved, 83);
  eq(W.parseMark(80.2, 'nearest').value, 80);
  eq(W.parseMark(80.2, 'up').value, 81);
  eq(W.parseMark(0.4, 'nearest').value, 0);
});

test('the rounding policy is applied per import and reported in the counts', () => {
  const rows = [
    ['BITS ID', 'Course', 'Total Marks'],
    ['A', 'C1', 80.2],
    ['B', 'C1', 80.6]
  ];
  const nearest = W.readRows(rows, { name: 'inline' });
  eq(nearest.records.map((r) => r.marks), [80, 81]);
  eq(nearest.rounding, 'nearest');
  eq(nearest.fractionalCount, 2);
  const up = W.readRows(rows, { name: 'inline', rounding: 'up' });
  eq(up.records.map((r) => r.marks), [81, 81]);
  eq(up.rounding, 'up');
});

test('reads a numeric string and reports it as text', () => {
  const r = W.parseMark('88');
  eq([r.ok, r.value], [true, 88]);
  eq(r.issues.map((i) => i.code), ['TEXT_MARKS']);
});

test('reads "82/100" and "82%" but keeps them visible', () => {
  const f = W.parseMark('82/100');
  eq([f.ok, f.value], [true, 82]);
  eq(f.issues.map((i) => i.code), ['FRACTION_MARKS']);
  const p = W.parseMark('82%');
  eq([p.ok, p.value], [true, 82]);
  eq(p.issues.map((i) => i.code), ['PERCENT_MARKS']);
});

test('rejects an unparseable, out-of-range or blank mark', () => {
  eq(W.parseMark('ABS').ok, false);
  eq(W.parseMark('82/100').ok, true);
  eq(W.parseMark('-5').ok, false);
  eq(W.parseMark(120).ok, false);
  eq(W.parseMark('').ok, false);
  eq(W.parseMark(null).ok, false);
  eq(W.parseMark(undefined).ok, false);
  eq(W.parseMark('1e2').ok, false, 'exponent notation is not a plain mark');
  eq(W.parseMark(NaN).ok, false);
  eq(W.parseMark(Infinity).ok, false);
});

test('out-of-range marks report both the parse problem and the range problem', () => {
  const r = W.parseMark(120);
  ok(codes(r).includes('MARKS_OUT_OF_RANGE'));
});

test('strips padded whitespace and says so', () => {
  const r = W.parseMark('  88  ');
  eq([r.ok, r.value], [true, 88]);
  ok(codes(r).includes('PADDED_MARKS'));
});

test('header matching is case- and alias-tolerant', () => {
  eq(W.matchField(U.headerKey('BITS ID')), 'id');
  eq(W.matchField(U.headerKey("Student's BITS ID")), 'id');
  eq(W.matchField(U.headerKey('Student ID')), 'id');
  eq(W.matchField(U.headerKey('COURSE')), 'course');
  eq(W.matchField(U.headerKey('Course Code')), 'course');
  eq(W.matchField(U.headerKey('total marks')), 'marks');
  eq(W.matchField(U.headerKey('Marks Obtained')), 'marks');
  eq(W.matchField(U.headerKey('Attendance %')), null);
});

/* ==================================================================== *
 * workbook: whole-file analysis against the fixture corpus
 * ==================================================================== */
suite('workbook — fixture corpus');

test('01 valid standard workbook imports 60 students across 3 unique courses', () => {
  const a = analyseFixture(CF, '01-valid-standard.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 60);
  eq(a.counts.rejected, 0);
  eq(a.courses.length, 3);
  eq(a.courses.map((c) => c.name).sort(), ['BA210', 'CS101', 'ME201']);
});

test('02 headers written as "Student\'s BITS ID" (the brief\'s wording) are accepted', () => {
  const a = analyseFixture(CF, '02-spec-headers-apostrophe.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 3);
  eq(a.records[0].id, '2024CS0001', 'the ID column must be mapped, not undefined');
  eq(a.records[0].marks, 82);
});

test('03 messy headers (padding, case) are matched', () => {
  const a = analyseFixture(CF, '03-messy-headers.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 2);
  eq(a.records[0].id, '2024CS0001');
});

test('04 single student imports and every statistic is defined', () => {
  const a = analyseFixture(CF, '04-single-student.xlsx');
  eq(a.counts.accepted, 1);
  eq(a.stats.stdDev, null);
  eq(a.stats.mean, 73);
  const r = G.gradeAll(a.records, G.defaults());
  eq(r.counts.reduce((x, y) => x + y, 0), 1);
});

test('05 identical marks import with a zero standard deviation and no NaN anywhere', () => {
  const a = analyseFixture(CF, '05-identical-marks.xlsx');
  eq(a.counts.accepted, 12);
  eq(a.stats.stdDev, 0);
  eq(a.stats.mean, 75);
});

test('06 boundary marks every receive exactly one grade', () => {
  const a = analyseFixture(CF, '06-boundary-marks.xlsx');
  eq(a.counts.accepted, 17);
  const r = G.gradeAll(a.records, G.defaults());
  eq(r.ungraded.length, 0);
  eq(r.counts.reduce((x, y) => x + y, 0), 17);
});

test('07 marks of only 0 and 100 import cleanly', () => {
  const a = analyseFixture(CF, '07-extremes-only.xlsx');
  eq(a.counts.accepted, 6);
  const r = G.gradeAll(a.records, G.defaults());
  eq(r.counts[0], 3);
  eq(r.counts[7], 3);
});

test('08 marks stored as text import as numbers, not concatenated garbage', () => {
  const a = analyseFixture(CF, '08-text-marks.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 5);
  eq(a.stats.min, 9);
  eq(a.stats.max, 100);
  near(a.stats.mean, 53, 1e-9);
  ok(a.issues.some((i) => i.code === 'TEXT_MARKS'));
});

test('09 invalid marks are rejected with a row number and a remedy, not guessed', () => {
  const a = analyseFixture(CF, '09-invalid-marks.xlsx');
  // Rows: 75 ok | ABS bad | -5 bad | 120 bad | '' bad | null bad | 82.6 ok
  //       82/100 ok | 0.4 ok | "  88  " ok
  eq(a.counts.rejected, 5);
  eq(a.counts.accepted, 5);
  eq(a.records.map((r) => r.marks).sort((x, y) => x - y), [0, 75, 82, 83, 88]);
  a.issues
    .filter((i) => i.severity === 'error')
    .forEach((i) => {
      ok(typeof i.row === 'number' && i.row >= 2, 'error issue must carry a spreadsheet row number');
      ok(i.remedy && i.remedy.length > 10, 'error issue must say what to do');
    });
  const c = codes(a);
  ok(c.includes('INVALID_MARKS'));
  ok(c.includes('MARKS_OUT_OF_RANGE'));
  ok(c.includes('MISSING_MARKS'));
  ok(c.includes('ROUNDED_MARKS'));
  ok(a.fatal === undefined, 'a partially valid file must not be treated as fatal');
});

test('10 a missing Total Marks column is a clear fatal error naming the headers', () => {
  const a = analyseFixture(CF, '10-missing-column.xlsx');
  eq(a.ok, false);
  eq(a.fatal.code, 'MISSING_COLUMN');
  ok(a.fatal.detail.includes('Total Marks'));
  ok(Array.isArray(a.fatal.foundHeaders) && a.fatal.foundHeaders.length > 0);
});

test('11 duplicate IDs are rejected per course; the same ID in another course is fine', () => {
  const a = analyseFixture(CF, '11-duplicate-and-blank.xlsx');
  eq(a.counts.accepted, 2); // one 2024CS0001 in CS101, one 2024CS0010 in CS102
  const dups = a.issues.filter((i) => i.code === 'DUPLICATE_ID');
  eq(dups.length, 3); // two extra 2024CS0001 rows + the duplicate 2024CS0010
  ok(a.issues.some((i) => i.code === 'MISSING_ID'));
  ok(a.issues.some((i) => i.code === 'MISSING_COURSE'));
  eq(a.courses.length, 2);
});

test('12 course names differing by case or padding are merged and reported', () => {
  const a = analyseFixture(CF, '12-course-name-fragments.xlsx');
  eq(a.courses.length, 1, 'one course, not four');
  eq(a.courses[0].count, 4);
  eq(a.courses[0].name, 'CS101', 'the first-seen spelling is used for display and export');
  const note = a.issues.find((i) => i.code === 'COURSE_NAME_MERGED');
  ok(note, 'the merge must be reported');
  ok(note.problem.includes('CS101'), 'the variants must be listed');
});

test('13 a workbook with headers but no students fails with a clear reason', () => {
  const a = analyseFixture(CF, '13-empty-headers-only.xlsx');
  eq(a.ok, false);
  eq(a.fatal.code, 'NO_VALID_ROWS');
  eq(a.records.length, 0);
});

test('14 extra columns are ignored and reported, not treated as an error', () => {
  const a = analyseFixture(CF, '14-extra-columns.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 2);
  ok(a.ignoredColumns.includes('Attendance %'));
  ok(a.ignoredColumns.includes('Email'));
  ok(!a.ignoredColumns.includes('BITS ID'));
});

test('15 the sheet that actually holds the marks is found, not just the first sheet', () => {
  const a = analyseFixture(CF, '15-instructions-first.xlsx');
  eq(a.ok, true);
  eq(a.sheet.name, 'Marks');
  ok(a.sheet.skipped.includes('Instructions'));
  eq(a.courses[0].name, 'CS101', 'the starter produced two blank course names here');
});

test('16 an extreme outlier does not break the statistics', () => {
  const a = analyseFixture(CF, '16-extreme-skew.xlsx');
  eq(a.ok, true);
  eq(a.stats.max, 100);
  eq(a.stats.min, 2);
  ok(isFinite(a.stats.mean));
  ok(isFinite(a.stats.stdDev));
});

test('17 a bimodal class imports and both clusters are detected', () => {
  const a = analyseFixture(CF, '17-bimodal.xlsx');
  const c = S.clusters(a.stats.sorted, 6);
  eq(c.length, 2);
});

test('18 a 300-student, two-course workbook grades every student exactly once', () => {
  const a = analyseFixture(CF, '18-large-class-300.xlsx');
  eq(a.counts.accepted, 300);
  eq(a.courses.length, 2);
  a.courses.forEach((course) => {
    const cohort = a.records.filter((r) => r.courseKey === course.key);
    const r = G.gradeAll(cohort, G.defaults());
    eq(r.counts.reduce((x, y) => x + y, 0), cohort.length);
    eq(r.ungraded.length, 0);
  });
});

test('19 a legacy .xls (BIFF8) workbook is accepted', () => {
  const a = analyseFixture(CF, '19-legacy-biff8.xls');
  eq(a.ok, true);
  eq(a.counts.accepted, 2);
});

test('20 a corrupt file produces a helpful error instead of silence', () => {
  const a = analyseFixture(CF, '20-corrupt-not-a-zip.xlsx');
  eq(a.ok, false);
  ok(['NOT_A_WORKBOOK', 'NO_HEADER_ROW'].includes(a.fatal.code), a.fatal.code);
  ok(a.fatal.remedy.length > 20);
});

test('21 an empty file produces a specific error', () => {
  const a = analyseFixture(CF, '21-empty-file.xlsx');
  eq(a.ok, false);
  eq(a.fatal.code, 'FILE_EMPTY');
});

test('22 a truncated zip is handled, not thrown', () => {
  let threw = false;
  let a = null;
  try {
    a = analyseFixture(CF, '22-truncated-zip.xlsx');
  } catch (e) {
    threw = true;
  }
  eq(threw, false, 'readWorkbook must never throw');
  if (a) eq(a.ok, false);
});

test('23 CSV content in an .xlsx file is read leniently rather than rejected', () => {
  const a = analyseFixture(CF, '23-csv-wearing-xlsx.xlsx');
  eq(a.ok, true, a.fatal ? a.fatal.code : '');
  eq(a.counts.accepted, 1);
});

test('24 a workbook with zero worksheets is reported clearly', () => {
  const a = analyseFixture(CF, '24-zero-worksheets.xlsx');
  eq(a.ok, false);
  ok(['NO_WORKSHEET', 'NO_HEADER_ROW'].includes(a.fatal.code), a.fatal.code);
});

test('25 a title row above the header row is skipped', () => {
  const a = analyseFixture(CF, '25-title-row-offset.xlsx');
  eq(a.ok, true);
  eq(a.counts.accepted, 2);
  // The title row occupies index 0 and the blank row is not carried into the
  // grid, so the header is detected on the second grid row.
  eq(a.headerRow, 1);
  eq(a.records[0].id, '2024CS0001');
});

test('re-uploading the same file replaces the state completely', () => {
  const a1 = analyseFixture(CF, '01-valid-standard.xlsx');
  const a2 = analyseFixture(CF, '04-single-student.xlsx');
  eq(a1.courses.length, 3);
  eq(a2.courses.length, 1);
  eq(a2.records.length, 1);
  ok(!a2.courses.some((c) => c.name === 'ME201'), 'no course from the first file may survive');
});

test('blank rows are skipped silently but counted', () => {
  const rows = [['BITS ID', 'Course', 'Total Marks'], ['A', 'C1', 10], ['', '', ''], ['B', 'C1', 20], null];
  const a = W.readRows(rows, { name: 'inline' });
  eq(a.counts.accepted, 2);
  eq(a.blankRows, 2);
});

/* ==================================================================== *
 * suggestions
 * ==================================================================== */
suite('suggestions');
const SG = CF.suggest;

test('declines when there is nothing to find', () => {
  eq(SG.suggest([]).ok, false);
  eq(SG.suggest([50]).ok, false);
  eq(SG.suggest([50, 50, 50, 50]).ok, false);
  ok(SG.suggest([50, 50, 50]).reason.length > 10);
});

test('produces seven strictly decreasing, in-range cutoffs', () => {
  const marks = [];
  for (let i = 0; i < 40; i++) marks.push(20 + (i % 12) * 6);
  const r = SG.suggest(marks);
  eq(r.ok, true);
  eq(r.cutoffs.length, 7);
  for (let i = 1; i < r.cutoffs.length; i++) {
    ok(r.cutoffs[i] < r.cutoffs[i - 1], 'cutoffs must decrease down the grade ladder: ' + r.cutoffs.join(','));
  }
  r.cutoffs.forEach((c) => ok(c >= 1 && c <= 100, 'cutoff out of range: ' + c));
  eq(G.validate(r.cutoffs).valid, true);
  // The suggestion must not simply be the defaults, or it is not doing anything.
  ok(!U.deepEqual(r.cutoffs, G.defaults()), 'expected a data-driven proposal');
});

test('is deterministic', () => {
  const marks = [5, 12, 19, 20, 31, 44, 58, 61, 72, 79, 80, 91, 95, 99];
  eq(SG.suggest(marks).cutoffs, SG.suggest(marks).cutoffs);
});

test('separates a genuinely bimodal class at the gap', () => {
  const marks = [];
  for (let i = 0; i < 15; i++) marks.push(34 + (i % 3));
  for (let i = 0; i < 15; i++) marks.push(86 + (i % 3));
  const r = SG.suggest(marks);
  const cohort = marks.map((m, i) => ({ id: 'S' + i, marks: m }));
  const moved = SG.preview(cohort, G.defaults(), r.cutoffs);
  // Whatever it proposes must be valid and must actually grade everybody.
  eq(G.validate(r.cutoffs).valid, true);
  eq(G.gradeAll(cohort, r.cutoffs).ungraded.length, 0);
  ok(typeof moved.changed === 'number');
});

test('handles a class smaller than the number of bands', () => {
  const r = SG.suggest([40, 55, 70]);
  eq(r.ok, true);
  eq(G.validate(r.cutoffs).valid, true);
});

test('states its method in plain language', () => {
  const r = SG.suggest([10, 40, 50, 60, 90]);
  ok(r.method.includes('k-means'));
  ok(r.method.length > 80);
});

/* ==================================================================== *
 * export
 * ==================================================================== */
suite('export');
const E = CF.exporters;

test('grades CSV has a header and exactly one row per student', () => {
  const records = [
    { id: '2024CS0002', marks: 95, course: 'C' },
    { id: '2024CS0001', marks: 5, course: 'C' },
    { id: '2024CS0003', marks: 75, course: 'C' }
  ];
  const csv = E.studentCsv(records, G.defaults());
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  eq(lines[0], 'BITS ID,Total Marks,Grade');
  eq(lines.length, 4);
  eq(lines[1], '2024CS0001,5,E');
  eq(lines[2], '2024CS0002,95,A');
  eq(lines[3], '2024CS0003,75,A-');
});

test('grades CSV carries a UTF-8 BOM so Excel renders names correctly', () => {
  ok(E.studentCsv([{ id: 'A', marks: 50 }], G.defaults()).charCodeAt(0) === 0xfeff);
});

test('grades CSV escapes commas, quotes and newlines in the ID field', () => {
  const nasty = '2024, "CS" ' + String.fromCharCode(10) + 'x';
  const csv = E.studentCsv([{ id: nasty, marks: 50, course: 'C' }], G.defaults());
  const row = csv.replace(/^\uFEFF/, '').split('\r\n')[1];
  ok(row.startsWith('"2024, ""CS"" '), row);
  ok(row.includes('"'), 'the embedded newline must be inside the quoted field');
});

test('grades CSV neutralises a formula-looking BITS ID', () => {
  const csv = E.studentCsv([{ id: '=cmd|calc', marks: 50, course: 'C' }], G.defaults());
  ok(csv.includes("\"'=cmd|calc\"") || csv.includes("'=cmd|calc"), csv);
});

test('grades CSV never silently drops a record, even one outside the scale', () => {
  // Import rejects out-of-scale marks, but the exporter must still be total:
  // a record that cannot be graded is written as NOT GRADED, not omitted.
  const records = [95, 120, -3].map((m, i) => ({ id: 'S' + i, marks: m, course: 'C' }));
  const csv = E.studentCsv(records, G.defaults());
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  eq(lines.length, 4);
  eq(lines[1], 'S0,95,A');
  eq(lines[2], 'S1,120,NOT GRADED');
  eq(lines[3], 'S2,-3,NOT GRADED');
});

test('for any valid configuration, every mark 0-100 lands in exactly one band', () => {
  // This is the property the starter violated: it happily accepted a
  // configuration that left 91-100 outside every band, then exported 15 of 17
  // students without saying so.
  const configs = [
    G.defaults(),
    [99, 98, 97, 96, 95, 94, 93],
    [91, 81, 71, 61, 51, 41, 31],
    [8, 7, 6, 5, 4, 3, 2],
    [100, 50, 49, 48, 47, 46, 45]
  ];
  configs.forEach((c) => {
    eq(G.validate(c).valid, true, JSON.stringify(c));
    const bands = G.bandsFromCutoffs(c);
    for (let m = 0; m <= 100; m++) {
      let hits = bands.filter((b) => m >= b.min && m <= b.max);
      eq(hits.length, 1, 'mark ' + m + ' in ' + JSON.stringify(c));
      eq(G.gradeFor(m, c), hits[0].grade);
    }
  });
});

test('exported grades agree with what the screen shows', () => {
  const records = [0, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 99, 100].map((m, i) => ({
    id: '2024CS' + String(i + 1).padStart(4, '0'),
    marks: m,
    course: 'CS101'
  }));
  const cutoffs = G.defaults();
  const r = G.gradeAll(records, cutoffs);
  const csv = E.studentCsv(records, cutoffs);
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n').slice(1);
  eq(lines.length, records.length);
  lines.forEach((line, i) => {
    const parts = line.split(',');
    eq(parts[0], records[i].id);
    eq(Number(parts[1]), records[i].marks);
    eq(parts[2], r.graded[i].grade);
  });
});

test('summary CSV carries the audit trail and escapes the instructor name', () => {
  const records = [{ id: 'A', marks: 85, course: 'CS101' }, { id: 'B', marks: 45, course: 'CS101' }];
  const csv = E.summaryCsv({
    instructor: 'Kumar, "A."',
    course: 'CS101',
    cutoffs: G.defaults(),
    records,
    stats: S.describe([85, 45]),
    fileName: { name: 'marks.xlsx' },
    sheet: { name: 'Marks' },
    counts: { accepted: 2, rejected: 1, normalised: 0 },
    elapsedMs: 65000,
    history: [{ time: '14:32', text: 'A- minimum: 70 → 74' }]
  });
  ok(csv.includes('"Kumar, ""A."""'), 'instructor must be escaped');
  ok(csv.includes('CS101'));
  ok(csv.includes('85'));
  ok(csv.includes('1m 05s'));
  ok(csv.includes('A- minimum: 70 → 74'));
  ok(csv.includes('BITS Pilani Digital'));
});

test('summary CSV renders blanks, not "null", for undefined statistics', () => {
  const csv = E.summaryCsv({
    instructor: 'A', course: 'C', cutoffs: G.defaults(), records: [], stats: S.describe([]), counts: {}
  });
  ok(!csv.includes('null'), csv);
  ok(!csv.includes('NaN'), csv);
  ok(!csv.includes('undefined'), csv);
});

test('file names include the course and a timestamp', () => {
  const name = E.gradesFileName('CS 101: Data Structures', new Date(2026, 8, 26, 14, 32));
  eq(name, 'BITSID-grades_CS-101-Data-Structures_2026-09-26-1432.csv');
  ok(E.summaryFileName('CS101', new Date(2026, 8, 26, 14, 32)).includes('grading-summary'));
  ok(E.rejectedFileName(new Date(2026, 8, 26, 14, 32)).includes('rejected-rows'));
});

test('rejected-rows CSV lists the row, the problem, the value and the fix', () => {
  const a = analyseFixture(CF, '09-invalid-marks.xlsx');
  const csv = E.rejectedRowsCsv(a);
  ok(csv.includes('Row,') && csv.includes('Severity'));
  ok(csv.includes('ABS'));
  ok(csv.includes('MARKS_OUT_OF_RANGE') || csv.includes('Mark outside'));
  a.issues
    .filter((i) => i.severity === 'error')
    .forEach((i) => ok(csv.includes(i.remedy.slice(0, 20)), 'remedy missing for ' + i.code));
});

test('an empty cohort still produces a well-formed grades CSV', () => {
  const csv = E.studentCsv([], G.defaults());
  eq(csv.replace(/^\uFEFF/, '').trim(), 'BITS ID,Total Marks,Grade');
});

/* ==================================================================== *
 * demo data
 * ==================================================================== */
suite('demo data');
const demo = CF.demoClass;

test('demo data travels the same pipeline and yields valid records', () => {
  const a = W.readRows(demo.rows, { name: demo.fileName, size: 1, demo: true });
  eq(a.ok, true, a.fatal ? a.fatal.code : '');
  eq(a.counts.rejected, 0, 'the demo class must not look broken');
  ok(a.counts.accepted > 50);
  eq(a.courses.length, 4);
});

test('demo data includes recoverable imperfections that are reported, not hidden', () => {
  const a = W.readRows(demo.rows, { name: demo.fileName, size: 1, demo: true });
  ok(a.counts.normalised >= 2, 'expected the deliberate fractional and fraction-form rows');
  ok(a.issues.every((i) => i.severity !== 'error'));
});

test('every demo course grades completely', () => {
  const a = W.readRows(demo.rows, { name: demo.fileName, size: 1, demo: true });
  a.courses.forEach((c) => {
    const cohort = a.records.filter((r) => r.courseKey === c.key);
    eq(G.gradeAll(cohort, G.defaults()).ungraded.length, 0, c.name);
  });
});

/* ==================================================================== *
 * summary
 * ==================================================================== */
const summary = H.summary();
console.log('\n' + '-'.repeat(64));
if (summary.failed) {
  console.log('\x1b[31m' + summary.failed + ' failing\x1b[0m, ' + summary.passed + ' passing');
  console.log('\nFailures:');
  summary.failures.forEach((f) => {
    console.log('  - [' + f.suite + '] ' + f.name);
    console.log('      ' + (f.error && f.error.message ? f.error.message : f.error));
  });
  process.exit(1);
} else {
  console.log('\x1b[32m' + summary.passed + ' passing, 0 failing\x1b[0m');
}
