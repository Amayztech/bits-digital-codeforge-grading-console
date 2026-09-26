# Test Report — BITS Digital CodeForge V1.0

Everything below was executed. The raw captured output is committed alongside
this report:

- `artifacts/test-run-unit.txt` — 92 unit and integration tests
- `artifacts/test-run-browser.txt` — 181 browser assertions
- `artifacts/test-run-print.txt` — printable report rendering
- `artifacts/live-verify.txt` — 23 assertions against the deployed URL
- `artifacts/recon/starter-probe.json` — the starter's recorded behaviour across 33 scenarios
- `artifacts/recon/A-gap-export.csv` — the starter's 15-of-17-row export
- `artifacts/grade-report.pdf` — the printable grade report
- `artifacts/screenshots/` — 16 screenshots across five viewport widths

Reproduce with `npm run test:all` and `npm run verify:live`.

---

## 1. Environments tested

| Environment | Version | How | Result |
| --- | --- | --- | --- |
| Chromium (Playwright headless shell) | 153.0.8010.12 | `npm run test:browser` | 174 / 174 pass, 0 console errors, 0 page errors |
| Chromium, **deployed URL** | same | `npm run verify:live` | 26 / 26 pass, 0 failed asset requests, 0 console errors |
| Chromium, **`file://` protocol** | same | `npm run verify:file` | 8 / 8 pass — the console works opened directly from disk |
| Chromium with `prefers-reduced-motion: reduce` | same | Playwright context option | Full journey completes, 0 errors |
| Print rendering (A4 portrait) | Chromium print pipeline | `npm run test:print` → PDF | Clean single-document report |
| Node.js | v22.23.0 on Windows 11 | `npm test` | 92 / 92 pass |
| Static analysis | `tools/hygiene.js` | `npm run hygiene` | Clean: 24 shipped files, 46 sources scanned |
| Static file server | `tools/serve.js`, no dependencies | `npm start` | Serves on :4173, no caching |
| GitHub Pages (production) | `ayeshh11.github.io` | `npm run verify:live` | Full workflow incl. both downloads |

**Not tested, and this is stated as a limitation rather than glossed over:**

| Environment | Why not | Residual risk |
| --- | --- | --- |
| Safari / WebKit | No macOS or WebKit runtime available in this environment | The code uses `ResizeObserver`, `PointerEvent`, `setPointerCapture` and `localStorage`, all long-standing in Safari, and avoids vendor-prefixed CSS. `backdrop-filter` degrades to a solid background. Unverified, not assumed safe. |
| Firefox | Not available in this environment | Same reasoning. `::-webkit-scrollbar` styling is Chromium-only and purely cosmetic; the scrollbar falls back to the standard one. |
| Real touchscreen / tablet hardware | Viewport sizes were emulated, not driven on a touch device | `touch-action: none` is set on the cutoff grips and the drag uses Pointer Events with capture, which is the standard approach, but it has not been exercised by a finger. |
| Screen-reader run | No assistive technology available here | The markup is semantically correct and every control is labelled, but no NVDA/JAWS/VoiceOver pass was performed. **No WCAG conformance is claimed.** |

---

## 2. Test corpus

`tests/fixtures/build.js` generates 25 adversarial workbooks plus the two shipped
samples. All are committed, so the suite is reproducible without running the
generator.

| # | Fixture | What it exercises |
| --- | --- | --- |
| 01 | `01-valid-standard.xlsx` | 60 students, 3 courses — the happy path at realistic size |
| 02 | `02-spec-headers-apostrophe.xlsx` | Headers written as `Student's BITS ID`, the brief's own wording |
| 03 | `03-messy-headers.xlsx` | `"  bits id  "`, `"COURSE"`, `"total marks "` — padding and case |
| 04 | `04-single-student.xlsx` | One student; undefined standard deviation |
| 05 | `05-identical-marks.xlsx` | 12 students all at 75 — zero standard deviation |
| 06 | `06-boundary-marks.xlsx` | 0, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 99, 100 |
| 07 | `07-extremes-only.xlsx` | Marks of only 0 and 100 |
| 08 | `08-text-marks.xlsx` | Marks stored as text: `9, 10, 82, 100, 64` |
| 09 | `09-invalid-marks.xlsx` | `ABS`, `-5`, `120`, empty, `null`, `82.6`, `82/100`, `0.4`, `"  88  "` |
| 10 | `10-missing-column.xlsx` | No `Total Marks` column |
| 11 | `11-duplicate-and-blank.xlsx` | 3 duplicate IDs in one course, 1 blank ID, 1 blank course, 1 legitimate cross-course repeat |
| 12 | `12-course-name-fragments.xlsx` | `CS101`, `CS101 `, ` cs101`, `CS101` |
| 13 | `13-empty-headers-only.xlsx` | Headers, zero students |
| 14 | `14-extra-columns.xlsx` | `Roll No`, `Attendance %`, `Email` present alongside the required three |
| 15 | `15-instructions-first.xlsx` | `Sheet1` = instructions, `Sheet2` = marks |
| 16 | `16-extreme-skew.xlsx` | 39 students at 2–4, one at 100 |
| 17 | `17-bimodal.xlsx` | 15 near 35, 15 near 85 — a deliberately non-normal shape |
| 18 | `18-large-class-300.xlsx` | 300 students, 2 courses — density and performance |
| 19 | `19-legacy-biff8.xls` | Legacy BIFF8 `.xls` |
| 20 | `20-corrupt-not-a-zip.xlsx` | Plain text wearing an `.xlsx` extension |
| 21 | `21-empty-file.xlsx` | Zero bytes |
| 22 | `22-truncated-zip.xlsx` | Valid zip magic, no central directory |
| 23 | `23-csv-wearing-xlsx.xlsx` | Real CSV bytes, `.xlsx` name |
| 24 | `24-zero-worksheets.xlsx` | Structurally valid zip, `<sheets></sheets>` |
| 25 | `25-title-row-offset.xlsx` | Title row, blank row, then the real header |

---

## 3. Acceptance tests

### Import

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| I1 | Valid `.xlsx` with 3 courses | 60 rows accepted, 0 rejected, 3 unique course names | Exactly that | Pass |
| I2 | Headers as written in the brief | IDs read, not `undefined` | `2024CS0001`, 82 marks | Pass |
| I3 | Messy headers (padding, case) | Matched | 2 rows accepted, IDs read correctly | Pass |
| I4 | `Student ID` / `Course Code` / `Marks Obtained` | Matched by alias | All three resolved | Pass |
| I5 | `Attendance %` as a header | Not mistaken for a marks column | Rejected as a match, reported as an extra column | Pass |
| I6 | Missing `Total Marks` column | Fatal error naming the column and listing the headers found | `MISSING_COLUMN`, headers listed | Pass |
| I7 | Title row above the header | Header detected, 2 rows accepted | Header found on grid row 2 | Pass |
| I8 | Instructions sheet before the marks sheet | Marks sheet read | `sheet.name === 'Marks'`, `Instructions` reported as skipped | Pass |
| I9 | Corrupt file | Specific error with a remedy, not silence | `NOT_A_WORKBOOK` + remedy | Pass |
| I10 | Zero-byte file | Specific error | `FILE_EMPTY` | Pass |
| I11 | Truncated zip | No uncaught exception | Returns a failure result; `readWorkbook` never throws | Pass |
| I12 | Zero-worksheet workbook | Specific error | `NO_WORKSHEET` or `NO_HEADER_ROW` | Pass |
| I13 | CSV wearing an `.xlsx` extension | Read leniently (CSV is unambiguous) | 1 row accepted | Pass |
| I14 | Headers only, no students | Fatal error saying so | `NO_VALID_ROWS` | Pass |
| I15 | Invalid marks | Rejected with row number and remedy; 5 rejected, 5 accepted | Exactly that; every error issue carries a row ≥ 2 and a remedy | Pass |
| I16 | Duplicate IDs | Rejected per course; cross-course repeat allowed | 3 duplicates rejected, 2 accepted, 2 courses | Pass |
| I17 | Blank ID / blank course | Rejected, no `undefined` course | `MISSING_ID` and `MISSING_COURSE` raised | Pass |
| I18 | Course name variants | Merged into one course, merge reported | 1 course, 4 students, merge note lists the variants | Pass |
| I19 | Extra columns | Ignored and reported | `Attendance %` and `Email` listed | Pass |
| I20 | Fractional marks | Rounded and reported; policy is a user choice | `82.6 → 83` under *nearest*; `80.2 → 80` nearest / `81` under *up* | Pass |
| I21 | Text marks | Read as numbers, not concatenated | min 9, max 100, mean 53 | Pass |
| I22 | Repeated upload of the same file | No accumulation | State identical to a first upload | Pass |
| I23 | Second, different upload | Complete replacement | 1 course, no prior course survives | Pass |
| I24 | Blank rows | Skipped but counted | 2 accepted, 2 blank counted | Pass |
| I25 | 300-student, 2-course workbook | Every student graded exactly once per course | 300 accepted; per-course counts sum to the cohort | Pass |
| I26 | Legacy `.xls` | Accepted | 2 rows | Pass |
| I27 | Course options contain no duplicates | 3 options for 3 courses | 3 options, names unique | Pass |

### Analytics

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| A1 | Min tile | Equals the true minimum | Verified against the rendered student table in-page | Pass |
| A2 | Max tile | Equals the true maximum | Verified against the rendered student table | Pass |
| A3 | Mean tile | Correct to 1 dp | Verified in-page | Pass |
| A4 | Median tile | Correct, odd and even cohorts | Verified in-page (34 students → 62) | Pass |
| A5 | Empty cohort | `null`, never `NaN` | Every numeric field finite or `null` | Pass |
| A6 | Single student | Defined mean/median, `null` std dev | `73, 73, 73, null` | Pass |
| A7 | Identical marks | Zero std dev, no `NaN` | `stdDev === 0` | Pass |
| A8 | Median of an even cohort | Mean of the two middle values | `[1,2,3,4] → 2.5` | Pass |
| A9 | Quartiles | Linear interpolation, spreadsheet convention | `PERCENTILE.INC` matches on five test vectors | Pass |
| A10 | Std dev | Sample (n−1); `null` below 2 values | Matches the closed-form value | Pass |
| A11 | Chart follows the selected course | Yes | Re-rendered on course selection | Pass |
| A12 | Mark 100 placement | Top bin, not clamped into 99 | 101 bins; `bins[100]` populated | Pass |
| A13 | Marks outside 0–100 | Ignored, not corrupting a bin | `[-5, 120, 50] → bins[50] === 1` | Pass |
| A14 | Identical-score dataset | Chart still renders | 12 identical marks → one bar; no `Infinity` | Pass |
| A15 | Small class axis | Readable, whole-number ticks | Peak 1 → axis 1; peak 3 → axis 3; no `0.5` gridline | Pass |
| A16 | Large class axis | Readable with headroom | Peak 23 → 25; peak 300 → 300; peak 7 → 10 | Pass |
| A17 | Extreme skew | No `NaN` anywhere | min 2, max 100, finite mean and std dev | Pass |
| A18 | Bimodal class | Both clusters detected | 2 clusters | Pass |
| A19 | No `NaN` / `undefined` / `Infinity` on screen | None | Asserted on the stats grid and the whole review sheet | Pass |
| A20 | Descriptive markers | Median and mean, labelled | Present; no fitted distribution curve | Pass |

### Grading

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| G1 | Default bands | Match the brief | A 80–100 … E 0–19, exactly | Pass |
| G2 | Boundary marks | Correct band for all 17 | Verified mark by mark | Pass |
| G3 | Every mark 0–100 gets exactly one grade | Always | 101/101 across five configurations | Pass |
| G4 | No gaps, no overlaps | Structural | Derived maxima; validated by walking 101 marks | Pass |
| G5 | Illegal value typed (`250`) | Clamped, and the clamp explained | Settles on 100, toast explains why | Pass |
| G6 | 16 hostile edits in sequence | Configuration valid after each | Valid after every one | Pass |
| G7 | Single-mark bands | Expressible | `A = 100–100` and a one-mark E band both valid | Pass |
| G8 | Out-of-scale mark | Refused, not graded | `gradeFor(-1/101/NaN/'82') → null` | Pass |
| G9 | Range change updates outcomes | Immediately | Counts, shares, deltas and affected students all update | Pass |
| G10 | Reset genuinely restores defaults | Exact vector | `[80,70,60,50,40,30,20]` | Pass |
| G11 | Undo restores the previous configuration | Yes | Verified in-page | Pass |
| G12 | Undo is itself logged | Yes | "Undone: …" appears in the history | Pass |
| G13 | No student is ever lost | Counts sum to the cohort | Asserted on every export in the journey | Pass |
| G14 | Impact direction | Correct | `rank` order fixed and unit-tested with a 9-student cohort | Pass |
| G15 | Band deltas net to zero | Yes | Sum of deltas is 0 | Pass |

### Workflow

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| W1 | Timer does not start at page load | `Idle`, `0s` | `Idle`, `0s` | Pass |
| W2 | Timer starts on course selection | `running` | `running` | Pass |
| W3 | Timer stops at finalize | `stopped` | `stopped` | Pass |
| W4 | Timer resets on a new import | `0s`, `idle` | `0s`, `idle` | Pass |
| W5 | Instructor requirement | Non-blocking, resolved at review | Checklist item + one-click "Add your name" | Pass |
| W6 | Instructor edited after grading begins | Finalized record invalidated, and it says so | Warning toast; export step reset | Pass |
| W7 | New file resets relevant state | Course, cutoffs, history, receipt, timer, analytics | All reset | Pass |
| W8 | New course updates everything | Stats, chart, table, bands, timer | All updated | Pass |
| W9 | Grade config does not leak between courses | Reset and stated | Reset on switch, change is in the log | Pass |
| W10 | Final review reflects current state | Yes | Re-rendered from state on every visit | Pass |
| W11 | Repeated finalize | Idempotent, one receipt | Two exports in the journey; receipt each time | Pass |
| W12 | Stage bar reflects real progress | Reachable steps only | Unvisited steps disabled; `aria-current` on the active step | Pass |

### Export

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| E1 | Student IDs | Correct | Every ID matches the cohort | Pass |
| E2 | Marks | Correct | Every mark matches | Pass |
| E3 | Grades | Match the screen exactly | Recomputed in-page and compared row by row | Pass |
| E4 | Selected course only | Yes | Row count equals the cohort, not the file | Pass |
| E5 | Filename | Course and timestamp | `BITSID-grades_CS101_2026-09-26-1432.csv` | Pass |
| E6 | Summary filename | Distinct from the grades file | `…grading-summary_…` | Pass |
| E7 | CSV escaping — comma, quote, newline | RFC 4180 | `Ayesh, "Prof" Kumar` → quoted and doubled | Pass |
| E8 | CSV escaping — instructor with comma and quotes | Grades CSV unaffected | Header row intact; summary contains `"Kumar, ""A."""` | Pass |
| E9 | Formula injection | Neutralised | `=1+1`, `+SUM(A1)`, `-2+3`, `@import` all prefixed | Pass |
| E10 | Negative/decimal marks stay numeric | Not mangled | `-3` written as a number, not `'-3` | Pass |
| E11 | UTF-8 BOM | Present | First code point is `U+FEFF` after download | Pass |
| E12 | Ungradable record | Written, not omitted | `NOT GRADED` row | Pass |
| E13 | Empty cohort | Well-formed file | Header only | Pass |
| E14 | Summary content | Provenance, stats, cutoffs, change log | All asserted present; no `null`/`NaN`/`undefined` | Pass |
| E15 | Repeated downloads | Both files each time | 2 downloads in section 9, 2 in section 11 | Pass |
| E16 | Confirmation count | Exactly one | 1 dialog, 2 actions | Pass |
| E17 | Confirmation content | Names course, instructor, files, distribution | All present | Pass |
| E18 | No native dialogs anywhere | Zero | 0 across 174 assertions | Pass |
| E19 | Deployed site | Full workflow from the public URL | 26 / 26 pass, both files downloaded from `ayeshh11.github.io` | Pass |
| E20 | Assets resolve from a `/<repo>/` subdirectory | Yes | Verified against the live URL; the workflow fails the build on any absolute path | Pass |
| E21 | Brand assets on the live site | Crest, favicon and apple-touch-icon all load | Verified over the network on the deployed URL | Pass |

### UX

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| X1 | First-load empty state | Designed, no blank regions | Dropzone + 3 information panels | Pass |
| X2 | Unusable file state | Designed error with recovery | Specific message + 2 recovery actions | Pass |
| X3 | Onboarding after a successful import | Yields to the data | Collapsed, with a "File format help" affordance | Pass |
| X4 | No-match search state | Designed | Custom empty state naming the query | Pass |
| X5 | Empty course state | Designed | Icon, title, guidance | Pass |
| X6 | Loading state | Exists | Busy file chip with a spinner before parsing | Pass |
| X7 | Success state | Exists | Export receipt with file names and counts | Pass |
| X8 | Clamping feedback | Explains itself | Toast naming the value and the reason | Pass |
| X9 | Toast stacking | Bounded | Max 3 visible | Pass |
| X10 | Keyboard workflow | Complete | Arrow keys, Shift-arrow, Page, Home/End on cutoffs; sliders in the chart; sortable headers; skip link; focus preserved across re-render | Pass |

### Technical

| # | Scenario | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| T1 | Uncaught page errors | 0 | 0 | Pass |
| T2 | Console errors | 0 | 0 | Pass |
| T3 | Dead buttons | None | Every control has a tested effect | Pass |
| T4 | Inaccessible controls | None | 0 unlabelled inputs, 0 unnamed buttons | Pass |
| T5 | Landmarks and headings | `main`, 1 `h1` | Present | Pass |
| T6 | Live regions | ≥ 2 | 4 | Pass |
| T7 | Chart accessibility | Name + data table + sliders | All present | Pass |
| T8 | Reduced motion | Full journey works | Pass | Pass |
| T9 | Responsive at 1920 / 1440 / 1024 / 768 / 390 | No overflow | `scrollWidth ≤ clientWidth` at every width; no overflowing element | Pass |
| T10 | Chart reflows | Tracks its container | SVG width matches the container at every width | Pass |
| T11 | Band rows fit | No clipping | At every width | Pass |
| T12 | Collapsed content is skipped by tab order | Yes | `fileInput` and `loadDemo` not reachable once collapsed | Pass |
| T13 | Print output | Clean A4 report | Rendered to PDF and inspected | Pass |
| T14 | Local draft | Opt-in, single key, removable | Off by default; 1 `localStorage` key; discard clears it | Pass |
| T15 | Draft restore | Rebuilds derived values, not stale ones | `stats` recomputed from records (bug found and fixed this way) | Pass |

---

## 4. Notable edge cases and how they were handled

| Edge case | Handling | Found by |
| --- | --- | --- |
| A marks file whose *first* sheet is a cover page | The sheet holding the marks table is detected by scoring every sheet's header row | Fixture 15 |
| A workbook where the marks sheet is genuinely absent | `NO_HEADER_ROW` naming the sheets and their row counts | Fixture 24 |
| Students spread thinly across 0–100 | 101 bins rather than 10, so a cutoff is exact to one mark | Design review |
| A class smaller than the number of grade bands | The suggestion declines honestly rather than fabricating boundaries | Unit test |
| All students identical | Zero standard deviation, one bar, a defined axis | Fixture 05 |
| A student who appears in two courses | Allowed — uniqueness is per `(course, id)` | Fixture 11 |
| Course names differing only by whitespace or case | Merged, and the merge reported | Fixture 12 |
| Instructor name containing a comma and quotes | Escaped in the summary; the grades file is unaffected | Browser journey §11 |
| An instructor name typed only *after* grading began | Reachable from the header at any time; the review checklist flags it with a one-click fix | Design review |
| A cutoff dragged past its neighbour | Clamped to the legal window and explained | Unit + browser |
| A cutoff typed as `250` | Clamped to 100, with the reason stated | Browser journey §6 |
| Re-selecting the same file after editing it | The input's value is cleared so `change` fires again | Code review |
| A draft larger than the browser can store | Refused with an explanation rather than silently truncated | Code review |
| Two downloads fired 220 ms apart | Collected independently, never assumed ordered | Test-harness fix |
| Print stylesheet with no printable stage marked | Found by rendering the print output: **produced a blank page** | `tests/browser/print.js` |
| A fractional y-axis on a student count | Found by rendering the print output: gridlines at 0.5 | `tests/browser/print.js` |
| A button that cleared its own containing panel | Found by the draft test: "Discard saved session" removed the whole session panel, including its own toggle | Browser journey §16 |
| A DOM helper that wiped base classes | Found when stat tiles rendered unstyled: `class: ""` replaced rather than extended the class list | Browser journey §4 |
| Chart model replaced instead of merged | Found when the cutoffs vanished after a flash timer fired: a partial `setModel` dropped `onCutoff` | Browser journey §6 |
| A course-select handler passed as `undefined` on the upload path | Found by the upload journey (the demo path passed it directly, so only real uploads failed) | Browser journey §11 |
| UTF-8 mojibake introduced by a tooling round-trip | Found by a full-file encoding scan; repaired deterministically by `tools/fix-encoding.js` | Encoding audit |

---

## 5. Bugs found in this submission by its own tests

The test suite earned its keep. These were real defects in the rebuilt console,
caught by the tests and fixed:

| Defect | Caught by | Fix |
| --- | --- | --- |
| Band derivation was off by one, so A became 0–79 | Unit test "default cutoffs produce the bands named in the challenge brief" | Corrected the derivation |
| Impact direction was inverted — "moved up" meant moved down | Unit test "impact counts moves, direction and per-band deltas" | `rank(a) < rank(b)` means up |
| Per-band deltas read the wrong baseline count and did not net to zero | Same test | Deltas computed from both count arrays |
| Cutoff suggestion returned the defaults, then produced a `NaN` cutoff | Unit test "produces seven strictly decreasing, in-range cutoffs" | Seeded one centre per band; repaired ascending → descending |
| An axis maximum of 50 for a peak of 23 | Unit test on `niceMax` | Added a 2.5 and 3 step |
| Undo re-applied the change instead of reverting it | Browser journey "undo changes the configuration" | History stores the *previous* cutoff vector |
| A chart flash timer replaced the model and removed the cutoffs | Browser journey "chart slider is keyboard operable" | Model updates are merge-only |
| A partial re-render lost keyboard focus and the caret | Browser journey "focus survives the re-render" | Focus and selection restored after re-render |
| Number inputs did not respond to arrow keys | Browser journey "arrow keys move the cutoff" | Key handling moved into the field |
| A band row had four children in a three-column grid, so the cutoff wrapped out of alignment | Visual review | Grid corrected to four columns with a 1240px breakpoint |
| The review checklist rendered literal `<b>` tags as text | Visual review | Labels built as DOM nodes instead of HTML strings |
| The print report was a blank page | `tests/browser/print.js` | Printable flag moved to the stage section |
| Student-count axis showed 0.5 / 1.5 gridlines | `tests/browser/print.js` | Integer steps for small peaks |
| A mojibake pass corrupted 11 non-ASCII characters in `app.js` | Encoding audit | `tools/fix-encoding.js` |
| The course list was not cleared on a failed import | Browser journey §10 | `onFailed` clears the picker and the stage bar |
| The review chart was orphaned when the sheet re-rendered, so the distribution vanished from the report after export | Browser journey 9, after the export | The chart element is created once and handed to the panel to place, so a re-render cannot detach it |

---

## 6. Summary

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| Unit and integration (`npm test`) | 92 | 92 | 0 |
| Browser journey (`npm run test:browser`) | 174 | 174 | 0 |
| Deployed site (`npm run verify:live`) | 26 | 26 | 0 |
| `file://` protocol (`npm run verify:file`) | 8 | 8 | 0 |
| Static hygiene (`npm run hygiene`) | 24 files | clean | 0 |
| Print rendering | 1 document | 1 | 0 |
| **Total behavioural tests** | **304** | **304** | **0** |

Uncaught page errors: **0**. Console errors: **0**. Native dialogs: **0**.
Failed network requests on the deployed site: **0**. Static hygiene findings: **0**.

Known limitations are listed in section 1 and in the README's *Honesty notes*.
They are limitations of what was verified, not of what is claimed.
