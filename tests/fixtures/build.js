/**
 * Adversarial Excel fixture corpus for the CodeForge grading console.
 *
 * Every workbook here exists to prove or disprove a specific behaviour claim.
 * They are generated (not hand-made) so the corpus is reproducible and can be
 * regenerated after a schema change with `npm run fixtures`.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('../../vendor/xlsx.full.min.js');
const { zipSync, unzipSync, strToU8 } = require('fflate');

const OUT = path.join(__dirname, 'workbooks');
const SAMPLES = path.join(__dirname, '..', '..', 'samples');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SAMPLES, { recursive: true });

/** Deterministic PRNG so fixtures are byte-stable across regenerations. */
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function write(name, aoa, opts = {}) {
  const wb = XLSX.utils.book_new();
  const sheets = opts.sheets || [{ name: opts.sheetName || 'Sheet1', aoa }];
  sheets.forEach((s) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  });
  const bookType = opts.bookType || 'xlsx';
  const buf = XLSX.write(wb, { type: 'buffer', bookType });
  const dest = opts.dir === 'samples' ? SAMPLES : OUT;
  fs.writeFileSync(path.join(dest, name), buf);
  return path.join(dest, name);
}

const HEAD = ['BITS ID', 'Course', 'Total Marks'];
const id = (n) => '2024CS' + String(n).padStart(4, '0');

/* ------------------------------------------------------------------ *
 * 1. Standard valid workbook: 3 courses, 60 students
 * ------------------------------------------------------------------ */
(function standardWorkbook() {
  const rng = makeRng(7);
  const rows = [HEAD];
  const courses = [
    { code: 'CS101', n: 22, mean: 68, sd: 16 },
    { code: 'ME201', n: 20, mean: 61, sd: 18 },
    { code: 'BA210', n: 18, mean: 74, sd: 12 }
  ];
  let n = 1;
  courses.forEach((c) => {
    for (let i = 0; i < c.n; i++) {
      const v = Math.round(c.mean + (rng() + rng() + rng() - 1.5) * c.sd);
      rows.push([id(n++), c.code, Math.max(0, Math.min(100, v))]);
    }
  });
  write('01-valid-standard.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 2. Headers exactly as written in the challenge brief
 *    ("Student's BITS ID", "Course", "Total Marks")
 * ------------------------------------------------------------------ */
(function specHeaderWorkbook() {
  const rows = [
    ["Student's BITS ID", 'Course', 'Total Marks'],
    ['2024CS0001', 'CS101', 82],
    ['2024CS0002', 'CS101', 71],
    ['2024CS0003', 'CS101', 64]
  ];
  write('02-spec-headers-apostrophe.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 3. Messy headers: case, padding, alternate spellings
 * ------------------------------------------------------------------ */
(function messyHeaderWorkbook() {
  const rows = [
    ['  bits id  ', 'COURSE', 'total marks '],
    ['2024CS0001', 'CS101', 82],
    ['2024CS0002', 'CS101', 55]
  ];
  write('03-messy-headers.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 4. Single student
 * ------------------------------------------------------------------ */
(function singleStudent() {
  write('04-single-student.xlsx', [HEAD, ['2024CS0001', 'CS101', 73]]);
})();

/* ------------------------------------------------------------------ *
 * 5. All identical marks (zero standard deviation)
 * ------------------------------------------------------------------ */
(function identicalMarks() {
  const rows = [HEAD];
  for (let i = 1; i <= 12; i++) rows.push([id(i), 'CS101', 75]);
  write('05-identical-marks.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 6. Boundary marks against the default grade bands
 * ------------------------------------------------------------------ */
(function boundaryMarks() {
  const marks = [0, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 99, 100];
  const rows = [HEAD];
  marks.forEach((m, i) => rows.push([id(i + 1), 'CS101', m]));
  write('06-boundary-marks.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 7. Only 0 and 100
 * ------------------------------------------------------------------ */
(function extremesOnly() {
  const rows = [HEAD];
  for (let i = 1; i <= 6; i++) rows.push([id(i), 'CS101', i % 2 ? 0 : 100]);
  write('07-extremes-only.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 8. Marks stored as TEXT (string cells) - legacy export from older systems
 * ------------------------------------------------------------------ */
(function textMarks() {
  const rows = [HEAD];
  ['9', '10', '82', '100', '64'].forEach((m, i) => rows.push([id(i + 1), 'CS101', m]));
  write('08-text-marks.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 9. Invalid marks: text junk, negatives, >100, blank, fractional
 * ------------------------------------------------------------------ */
(function invalidMarks() {
  const rows = [
    HEAD,
    [id(1), 'CS101', 75], // valid control
    [id(2), 'CS101', 'ABS'], // unparseable text
    [id(3), 'CS101', -5], // negative
    [id(4), 'CS101', 120], // above 100
    [id(5), 'CS101', ''], // blank
    [id(6), 'CS101', null], // empty cell
    [id(7), 'CS101', 82.6], // fractional
    [id(8), 'CS101', '82/100'], // formatted score
    [id(9), 'CS101', 0.4], // fractional below 1
    [id(10), 'CS101', '  88  '] // padded numeric text (recoverable)
  ];
  write('09-invalid-marks.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 10. Missing required column (no Total Marks)
 * ------------------------------------------------------------------ */
(function missingColumn() {
  write('10-missing-column.xlsx', [
    ['BITS ID', 'Course'],
    ['2024CS0001', 'CS101'],
    ['2024CS0002', 'CS101']
  ]);
})();

/* ------------------------------------------------------------------ *
 * 11. Duplicate BITS IDs inside the same course + blank ID + blank course
 * ------------------------------------------------------------------ */
(function duplicatesAndBlanks() {
  const rows = [
    HEAD,
    ['2024CS0001', 'CS101', 82],
    ['2024CS0001', 'CS101', 41], // duplicate ID, different mark
    ['2024CS0001', 'CS101', 55], // duplicate ID again
    ['', 'CS101', 63], // blank ID
    [id(9), '', 71], // blank course
    [id(10), 'CS102', 60],
    [id(10), 'CS102', 61] // duplicate ID in a second course
  ];
  write('11-duplicate-and-blank.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 12. Course names that differ only by whitespace / case
 * ------------------------------------------------------------------ */
(function courseNameFragments() {
  const rows = [
    HEAD,
    [id(1), 'CS101', 82],
    [id(2), 'CS101 ', 71], // trailing space
    [id(3), ' cs101', 64], // leading space
    [id(4), 'CS101', 55] // exact
  ];
  write('12-course-name-fragments.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 13. Empty workbook (headers only, zero students)
 * ------------------------------------------------------------------ */
(function emptyWorkbook() {
  write('13-empty-headers-only.xlsx', [HEAD]);
})();

/* ------------------------------------------------------------------ *
 * 14. Extra, irrelevant columns present
 * ------------------------------------------------------------------ */
(function extraColumns() {
  const rows = [
    ['Roll No', 'BITS ID', 'Course', 'Total Marks', 'Attendance %', 'Email'],
    ['1', '2024CS0001', 'CS101', 82, 91, 'a@x.com'],
    ['2', '2024CS0002', 'CS101', 71, 88, 'b@x.com']
  ];
  write('14-extra-columns.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 15. First worksheet is an instructions sheet, data is on the second
 * ------------------------------------------------------------------ */
(function instructionsFirst() {
  write('15-instructions-first.xlsx', [], {
    sheets: [
      {
        name: 'Instructions',
        aoa: [
          ['Marks Export'],
          ['Do not edit column headers.'],
          ['Total Marks must be a whole number out of 100.']
        ]
      },
      {
        name: 'Marks',
        aoa: [HEAD, ['2024CS0001', 'CS101', 82], ['2024CS0002', 'CS101', 61]]
      }
    ]
  });
})();

/* ------------------------------------------------------------------ *
 * 16. Extreme skew: one outlier at 100, everyone else near zero
 * ------------------------------------------------------------------ */
(function skewed() {
  const rows = [HEAD];
  rows.push([id(1), 'CS101', 100]);
  for (let i = 2; i <= 40; i++) rows.push([id(i), 'CS101', i % 6 === 0 ? 4 : 2]);
  write('16-extreme-skew.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 17. Uniform / bimodal distribution (no meaningful bell curve)
 * ------------------------------------------------------------------ */
(function bimodal() {
  const rows = [HEAD];
  let n = 1;
  for (let i = 0; i < 15; i++) rows.push([id(n++), 'CS101', 35 + (i % 3)]);
  for (let i = 0; i < 15; i++) rows.push([id(n++), 'CS101', 85 + (i % 3)]);
  write('17-bimodal.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 18. Large class (300 students, 2 courses) - performance / table density
 * ------------------------------------------------------------------ */
(function largeClass() {
  const rng = makeRng(99);
  const rows = [HEAD];
  for (let i = 1; i <= 300; i++) {
    rows.push([id(i), i % 2 ? 'CS101' : 'CS102', Math.round(rng() * 100)]);
  }
  write('18-large-class-300.xlsx', rows);
})();

/* ------------------------------------------------------------------ *
 * 19. Legacy .xls (BIFF8) workbook
 * ------------------------------------------------------------------ */
(function legacyXls() {
  write('19-legacy-biff8.xls', [HEAD, ['2024CS0001', 'CS101', 82], ['2024CS0002', 'CS101', 44]], {
    bookType: 'biff8'
  });
})();

/* ------------------------------------------------------------------ *
 * 20. Corrupt / non-Excel payloads
 * ------------------------------------------------------------------ */
(function corruptFiles() {
  fs.writeFileSync(
    path.join(OUT, '20-corrupt-not-a-zip.xlsx'),
    Buffer.from('This is definitely not a spreadsheet. '.repeat(20), 'utf8')
  );
  fs.writeFileSync(path.join(OUT, '21-empty-file.xlsx'), Buffer.alloc(0));
  // Random-ish binary that starts like a zip but has no central directory.
  const junk = Buffer.alloc(512);
  junk[0] = 0x50; junk[1] = 0x4b; junk[2] = 0x03; junk[3] = 0x04;
  for (let i = 4; i < junk.length; i++) junk[i] = (i * 37) % 251;
  fs.writeFileSync(path.join(OUT, '22-truncated-zip.xlsx'), junk);
  // Real CSV content wearing an .xlsx extension.
  fs.writeFileSync(path.join(OUT, '23-csv-wearing-xlsx.xlsx'), 'BITS ID,Course,Total Marks\n2024CS0001,CS101,82\n', 'utf8');
})();

/* ------------------------------------------------------------------ *
 * 24. Workbook with zero worksheets (structurally valid zip, no sheets)
 * ------------------------------------------------------------------ */
(function zeroWorksheets() {
  // Start from a real workbook, then strip the sheet from workbook.xml.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ['1', 'C', 5]]), 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const files = unzipSync(new Uint8Array(buf));
  const xml = Buffer.from(files['xl/workbook.xml']).toString('utf8');
  const stripped = xml.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets></sheets>');
  files['xl/workbook.xml'] = strToU8(stripped);
  // Also blank out the sheet part so nothing can be silently recovered.
  files['xl/worksheets/sheet1.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'
  );
  fs.writeFileSync(path.join(OUT, '24-zero-worksheets.xlsx'), Buffer.from(zipSync(files)));
})();

/* ------------------------------------------------------------------ *
 * 25. A sheet whose header row is preceded by a title row
 * ------------------------------------------------------------------ */
(function titleRowOffset() {
  write('25-title-row-offset.xlsx', [
    ['Trimester 1 Marks Export'],
    [],
    HEAD,
    ['2024CS0001', 'CS101', 82],
    ['2024CS0002', 'CS101', 61]
  ]);
})();

/* ------------------------------------------------------------------ *
 * Public sample + template shipped with the app
 * ------------------------------------------------------------------ */
(function publicSamples() {
  const rng = makeRng(2024);
  const rows = [
    ['BITS ID', 'Course', 'Total Marks'],
    // CS101 - a normal, slightly left-skewed class
    ...Array.from({ length: 34 }, (_, i) => [
      id(1000 + i),
      'CS101',
      Math.max(0, Math.min(100, Math.round(64 + (rng() + rng() - 1) * 26)))
    ]),
    // CS201 - a stronger class
    ...Array.from({ length: 28 }, (_, i) => [
      id(2000 + i),
      'CS201',
      Math.max(0, Math.min(100, Math.round(76 + (rng() + rng() - 1) * 18)))
    ]),
    // CS305 - a weak class with one outlier
    ...Array.from({ length: 30 }, (_, i) => [
      id(3000 + i),
      'CS305',
      i === 12 ? 97 : Math.max(0, Math.min(100, Math.round(41 + (rng() + rng() - 1) * 16)))
    ])
  ];
  write('sample-marks.xlsx', rows, { dir: 'samples', sheetName: 'Marks' });

  // Template: headers + one worked example row + a guidance sheet.
  const tplWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    tplWb,
    XLSX.utils.aoa_to_sheet([
      ['BITS ID', 'Course', 'Total Marks'],
      ['2024CS0001', 'CS101', 82]
    ]),
    'Marks'
  );
  XLSX.utils.book_append_sheet(
    tplWb,
    XLSX.utils.aoa_to_sheet([
      ['Column', 'Required', 'Rule'],
      ['BITS ID', 'Yes', "Student's BITS ID, e.g. 2024CS0001. Must be unique within a course."],
      ['Course', 'Yes', 'Course code exactly as it should appear on the transcript.'],
      ['Total Marks', 'Yes', 'Whole number from 0 to 100. Students absent for T1 exams must be omitted.']
    ]),
    'How to use'
  );
  fs.writeFileSync(
    path.join(SAMPLES, 'template-marks.xlsx'),
    XLSX.write(tplWb, { type: 'buffer', bookType: 'xlsx' })
  );
})();

const files = fs.readdirSync(OUT).sort();
console.log('Generated ' + files.length + ' adversarial fixtures in tests/fixtures/workbooks/');
files.forEach((f) => {
  const st = fs.statSync(path.join(OUT, f));
  console.log('  ' + f.padEnd(36) + String(st.size).padStart(8) + ' bytes');
});
console.log('Samples written to samples/: ' + fs.readdirSync(SAMPLES).join(', '));
