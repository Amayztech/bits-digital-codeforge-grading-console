# CodeForge submission

### What the application does

An instructor imports a marks workbook, and the console validates every row
before any grading is possible. They pick a course, read honest descriptive
statistics, design the grade bands on top of the actual marks distribution while
seeing exactly which students each change moves, review the result as a document,
and export an auditable grade set plus the record of how it was produced.

Everything happens in the browser. No student record is uploaded anywhere.

The workflow is **Import → Validate → Analyse → Configure → Review → Export**, and
the interface always shows where you are in it.

---

### How to use it

1. **Import.** Drop a marks workbook on the dropzone, or press *Load demo class*
   to try it immediately. Read the *Data health* panel: it tells you how many
   rows were accepted, how many were rejected and why, and what was read from
   which sheet. Anything rejected is listed with its spreadsheet row number, the
   offending value, and what to do about it.
2. **Choose a course.** Each card shows the student count, mean and mark range.
   Grade bands are per course and do not leak into the next one.
3. **Analyse.** Read the statistics and the distribution. The median marker and
   the score-cluster strip tell you where the class actually separates.
4. **Configure.** Drag a cutoff on the distribution, or use the stepper and
   number field. The counts, the shares, the before/after table and the list of
   affected students update as you move. *Undo* reverses any single change.
5. **Review.** The review sheet is exactly what will be written to file, and is
   also the report you can print. Work through the safety checklist.
6. **Export.** One confirmation, then two files: the student grades and the
   grading summary.

Set your name in the field at the top right at any point. It is required before
finalizing and is written into both exported files.

---

### Supported marks file format

One worksheet containing a marks table. Three columns, one row per student:

| Column | Required | Rule |
| --- | --- | --- |
| `BITS ID` | Yes | The student's BITS ID, e.g. `2024CS0001`. Must be unique **within a course** — the same student appearing in two courses is expected and allowed. |
| `Course` | Yes | The course code as it should appear on the transcript. |
| `Total Marks` | Yes | A whole number from 0 to 100. |

Rules and behaviours you should know about:

- **Header matching** ignores capitalisation, surrounding spaces, underscores and
  hyphens, and accepts common variants: `Student's BITS ID`, `Student ID`,
  `Course Code`, `Course Name`, `Marks`, `Total Score`, `Marks Obtained`, and
  `Total Marks (out of 100)`. The header that was actually matched is shown in
  the import report.
- **Sheet selection.** Every sheet is inspected and the one that actually looks
  like a marks table is read, so a cover or instructions sheet in first position
  does not break the import. The chosen sheet is reported.
- **Header row detection.** The first 12 rows are scanned, so a title row above
  the header is fine.
- **Extra columns** are ignored, and listed in the report.
- **Course names** that differ only by capitalisation or padding (`CS101`,
  `cs101`, `CS101 `) are treated as one course, using the first spelling seen.
  The merge is reported.
- **Values that are read rather than rejected**, each reported with the original
  and the value used: numbers stored as text (`"88"`), scores written as fractions
  or percentages (`82/100`, `82%`), values with stray whitespace (`"  88  "`), and
  fractional marks.
- **Fractional marks** need a rounding rule. The challenge brief says fractional
  values are "rounded to the nearest integer" but illustrates that with
  `80.2 → 81`, which is not the nearest integer. Rather than guess, the console
  asks — but only when a fractional mark actually exists — and lists every
  original and rounded value. Default is *nearest*.
- **Rejected rows** are never graded and never exported. The reasons are: missing
  or duplicate BITS ID, missing course, missing mark, an unparseable mark, or a
  mark outside 0–100.
- **Students absent for the examination and to be awarded NC must be left out of
  the file**, as the brief specifies. The console will reject an `NC` or `ABS`
  entry rather than guess at a mark.
- **Formats accepted:** `.xlsx`, `.xls`, `.xlsm`, `.csv`.

Two files are provided: `samples/template-marks.xlsx` (a `Marks` sheet with one
worked example row and a `How to use` sheet) and `samples/sample-marks.xlsx`
(90 students across three courses).

---

### Bugs fixed

**60 entries in [`BUG_FIX_LOG.md`](BUG_FIX_LOG.md)** — 55 defects and 5
specification reconciliations, each reproduced in a real browser before it was
fixed. The most consequential:

- **Students were silently dropped from the export.** A band configuration that
  left part of the 0–100 scale outside every grade was accepted as valid, and the
  students in that gap were written to no row at all. 15 of 17 rows were produced
  with nothing on screen to indicate it. The grading model was rebuilt around
  seven ordered cutoffs with *derived* maxima, so a gap or overlap is no longer
  representable.
- **The Min and Max statistics were displayed under each other's labels** — the
  tile marked "Min" showed 84 when the true minimum was 52.
- **Marks stored as text** produced a minimum of 100, a maximum of 9 and an
  average of 1,821,296,420, because the sort was lexicographic and the sum
  concatenated.
- **The course list gained one option per student row** — 61 options for 60
  students across 3 courses — and options from previous uploads were never
  cleared, so a third upload produced 78.
- **Unreadable files failed silently.** Corrupt, empty and truncated workbooks
  produced no message whatsoever.
- **The brief's own column name was not read.** Headers written as
  `Student's BITS ID`, exactly as the brief's table shows, produced blank IDs in
  the export.
- **The first worksheet was always read**, so a workbook with an instructions
  sheet in front of the data created courses named `undefined`.
- **The grading timer started at page load** and counted the time spent deciding
  whether to use the tool.
- **The layout broke below ~900px**, producing 302px of horizontal scroll at
  390px wide.

`tests/recon/` contains the harness that reproduced each of these against the
original file, and `starter-reference/` keeps the original verbatim.

---

### Major enhancements

**12 enhancements in [`ENHANCEMENTS.md`](ENHANCEMENTS.md).** The strongest, and
the problem each solves:

1. **Intelligent import with a data-health report.** Every row is validated into
   accepted, normalised-with-report, or rejected-with-remedy. *Problem: a console
   that says nothing about its input leaves the instructor unable to trust its
   output.*
2. **Gap-free cutoff model.** Seven cutoffs instead of sixteen Min/Max fields,
   each clamped to its legal window, so an invalid configuration cannot be
   reached by typing. *Problem: independent Min/Max fields made it possible to
   create a configuration where some students have no grade at all.*
3. **Live grade-impact workspace.** Cutoffs are draggable on the distribution and
   operable from the keyboard as ARIA sliders. Any change instantly shows the
   count and share per band, how many students moved up and down, and which
   students. *Problem: "which students does this move?" is the question that
   decides whether a cutoff is right, and the basic console could not answer it.*
4. **Optional boundary suggestion** from 1-D k-means natural breaks, with the
   method stated, the impact previewed before applying, and an explicit button.
   A normal-curve fit was deliberately rejected because it quietly assumes the
   class is normally distributed. *Problem: drawing defensible cutoffs from
   scratch is slow; guessing from memory is worse.*
5. **Deliberate final review with a printable report.** A document-style sheet
   that is exactly what gets written to file, doubles as the printable grade
   report, and lists each safety requirement as pass or fail with a one-click fix.
   *Problem: finalizing publishes grades and should be inspectable, not one click
   from anywhere.*
6. **Two-file export with a real audit trail** — grades plus a summary carrying
   provenance, statistics, exact cutoffs and the full change log, both RFC 4180
   escaped, BOM-prefixed, injection-hardened, and named for the course and date.
   *Problem: `grades.csv` is an absence of a filename, and a grade set with no
   provenance cannot be defended six months later.*
7. Plus an in-session change history with per-entry undo, a searchable and
   sortable student outcome table, meaningful active grading time, a demo class
   and sample data, and opt-in local draft recovery.

---

### Technical decisions

**The grading model is the architecture.** Everything else follows from it. Bands
are `A = [cutoffs[0], 100]`, `A- = [cutoffs[1], cutoffs[0]−1]`, … `E = [0,
cutoffs[6]−1]`. A maximum is derived, so a gap or an overlap cannot be expressed;
`validate()` additionally walks all 101 marks as a belt-and-braces proof. This
single decision removed the starter's worst bug class outright.

**One source of truth, everything derived.** `app.js` owns the session; no panel
holds authoritative state. The exporter and the screen read the same object, which
is why they cannot disagree — the starter's most serious defect was precisely a
disagreement between them.

**Vanilla, classic scripts, no build step.** The core modules
(`assets/js/core/*.js`) are environment-agnostic: they attach to a single `CF`
namespace and touch no DOM, so `tests/run.js` loads them straight into Node with
`vm` and tests them against the workbook corpus. They are loaded with ordinary
`<script>` tags rather than ES modules specifically so the console also works when
`index.html` is opened directly from disk — which is how a judge may first try it.
There is no bundler, no framework, and no `node_modules` in production.

**SheetJS is vendored, not fetched.** `vendor/xlsx.full.min.js` (v0.18.5, SHA-256
`C9506197…`) is committed, so the console works offline and on any static host
with no CDN dependency and no content-security-policy concerns about third-party
scripts.

**The chart is SVG, one bar per whole mark.** A 10-mark bin cannot show you that a
cutoff at 82 is exact; 101 bins can. SVG is resolution-independent and reflows
through a `ResizeObserver`. The honest consequence is that the chart shows *where
students are*, not a fitted distribution — the misleading normal curve is gone,
replaced by labelled median and mean markers and a score-cluster strip.

**Invalid states are prevented rather than reported.** Cutoffs clamp to the window
their neighbours allow; the finalize gate and the on-screen checklist are the same
function; `describe()` returns `null` rather than `NaN`; the CSV writer cannot drop
a record.

**Testing follows the logic split.** Pure logic is tested in Node against 25
generated adversarial workbooks; the user journey is driven in real Chromium with
170 assertions on visible DOM state, plus console-error and overflow capture at
five viewport widths.

---

### Privacy

Your grading data stays in this browser.

The workbook is read with `FileReader`, parsed in memory, and never transmitted.
Exports are generated client-side from an in-memory object. There is no backend, no
API call, no analytics, no telemetry and no third-party script. The only external
file is the vendored SheetJS library, which is served from this repository.

The one optional feature that persists anything is *Keep this session on this
device*, which is **off by default**. When enabled it writes a single
`localStorage` entry containing the selected course, the cutoffs, the change
history, the instructor name and the raw rows — all on the local device, readable
only by this origin, and removable at any time with *Discard saved session*. It
is not uploaded, and the interface says so where the choice is made.

---

### Testing

Full detail in [`TEST_REPORT.md`](TEST_REPORT.md)**. In summary:

- **92 unit and integration tests** over the pure logic, run against a corpus of
  **25 generated adversarial workbooks** covering valid files, the brief's own
  header wording, messy headers, a single student, identical marks, boundary
  marks, only 0 and 100, text marks, invalid marks, a missing column, duplicate
  and blank IDs, course-name fragmentation, an empty workbook, extra columns, an
  instructions-first workbook, extreme skew, a bimodal class, a 300-student class,
  legacy `.xls`, a corrupt file, a zero-byte file, a truncated zip, CSV wearing an
  `.xlsx` extension, a workbook with zero worksheets, and a title row above the
  header.
- **174 browser assertions** across 16 sections driving the real console in
  Chromium: empty states, three unusable files, the demo class, course selection,
  statistics verified against the rendered student table, search and all three
  sort orders, the band editor by keyboard, mouse and by typing an illegal value,
  the optional suggestion and its undo, the review sheet, two complete exports
  with byte-level CSV verification, a second import, accessibility, five viewport
  widths, console hygiene, reduced motion, and local draft recovery.
- **23 live assertions** against the deployed URL, including that every asset
  resolves from the `/<repo>/` subdirectory.
- **Print output** rendered to PDF and inspected; one real bug (a blank printed
  page) was found and fixed this way.
- **Zero** uncaught page errors and **zero** console errors across every run.

```bash
npm test              # 92 unit tests
npm run test:browser  # 174 browser assertions (needs: npx playwright install chromium)
npm run test:print    # renders the printable report to PDF
npm run test:all      # all of the above
npm run verify:live   # drives the deployed URL end to end
npm run fixtures      # regenerate the 25-workbook corpus
```

---

### Running locally

The console is a static site. Any static server works.

```bash
# Option 1 - the bundled zero-dependency server
npm install
npm start
# then open http://localhost:4173

# Option 2 - Python
python -m http.server 4173

# Option 3 - Node
npx serve .

# Option 4 - just open the file
# index.html also works from file://, because the scripts are classic scripts
# rather than ES modules. The download and print features work; the browser
# treats file:// origins as opaque, so serving it is still preferable.
```

`npm install` is only needed for the test tooling. The application itself has no
runtime dependencies.

---

### Deployment

The project is a plain static site, so it deploys to any static host. All paths
are **relative** (`assets/…`, `samples/…`, `vendor/…`) and there is no
server-side routing, so it works unchanged from a domain root or from a
subdirectory such as `https://<user>.github.io/<repo>/`.

**GitHub Pages** (already configured in this repository — see `.github/workflows/pages.yml`):

```bash
git push origin main
# or, to deploy immediately:
npm run deploy        # pushes, then asks GitHub Actions to publish
```

The workflow builds nothing: it uploads the repository root and publishes it. The
live URL is recorded in `DEPLOYMENT.md`.

**Vercel**

```bash
npx vercel --prod
```

**Netlify**

```bash
npx netlify-cli deploy --prod --dir .
```

**Any other static host** — upload the repository root, excluding `node_modules/`
and `artifacts/`. No build command, no output directory, no environment variables.

---

### Project layout

```
index.html                     Semantic application shell
assets/
  styles/
    tokens.css                 Design tokens: colour, space, type, radii, shadow, motion
    base.css                   Reset, document defaults, utilities
    components.css             Buttons, panels, tables, badges, notices, toasts
    layout.css                 App shell, workflow bar, stage layout, responsive
    workspace.css              Chart, band editor, impact, review sheet, modal
    print.css                  The review sheet as an A4 report
  js/
    core/                      Pure, DOM-free, unit-tested
      util.js                  Helpers, CSV escaping, number and time formatting
      statistics.js            Total descriptive statistics, histogram, clusters
      grading.js               The cutoff model: bands, clamping, validation, impact
      workbook.js              Parsing, header/sheet detection, row validation
      exporters.js             Grades CSV, summary CSV, rejected-rows CSV
      suggest.js               Optional 1-D k-means boundary suggestion
    ui/                        DOM-only
      dom.js  toast.js  modal.js  chart.js
      import-panel.js  analyse-panel.js  band-editor.js
      impact-panel.js  review-panel.js
    app.js                     Session state, stage navigation, timer, wiring
  data/demo-class.js           Generated demo dataset
  favicon.svg
samples/                       sample-marks.xlsx, template-marks.xlsx
vendor/xlsx.full.min.js        SheetJS 0.18.5, vendored
tests/
  harness.js  run.js           Unit tests (Node, no framework)
  fixtures/build.js            Generates the 25-workbook corpus and the samples
  recon/                       Harnesses that reproduced the starter's bugs
  browser/journey.js           Critical-path browser journey
  browser/print.js             Renders the printable report to PDF
tools/                         serve.js, build-demo.js, fix-encoding.js
starter-reference/             The supplied starter, kept verbatim
```

---

### Honesty notes

- This is a competition prototype, **not** an official BITS Pilani Digital grading
  tool, and it is not used for real academic grading.
- The demo class is synthetic. It is labelled `Demo data` in the file chip, the
  review sheet flags it, and the exported summary records it.
- Accessibility was implemented deliberately and audited with automated checks and
  a keyboard pass. It has **not** been certified against WCAG by an independent
  auditor, and no such claim is made.
- Browser testing was carried out in headless Chromium. Layout was visually
  reviewed in Chromium at 1920, 1440, 1024, 768 and 390px. It has not been tested
  in Safari or Firefox; the code avoids browser-specific APIs except
  `ResizeObserver`, `PointerEvent` and `localStorage`, which are broadly
  supported, but this is an untested assumption rather than a verified fact.
- Grade band defaults are the challenge's defaults: A 80–100, A− 70–79, B 60–69,
  B− 50–59, C 40–49, C− 30–39, D 20–29, E 0–19.
