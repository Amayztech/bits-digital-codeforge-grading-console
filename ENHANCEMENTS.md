# Enhancements — BITS Digital CodeForge V1.0

Each enhancement below exists because of a specific thing an instructor does
wrong, or cannot do, with a basic grading console. The "Instructor Problem"
column is the justification. If a feature cannot be justified there, it is not in
the product.

---

## Summary

| # | Enhancement | Instructor Problem | Status |
| --- | --- | --- | --- |
| E1 | Intelligent import with a data-health report | A grading tool that accepts any file and says nothing leaves the instructor unable to trust the output. | Shipped |
| E2 | Gap-free cutoff model with an impossible-to-misconfigure editor | Independent Min/Max fields let an instructor create a configuration where some students have no grade at all, with no warning. | Shipped |
| E3 | Live grade-impact workspace | "What actually changes if I move this boundary?" is the question that decides whether a cutoff is right, and no basic console answers it. | Shipped |
| E4 | Optional boundary suggestion from the class distribution | Drawing a defensible starting point from scratch is slow; guessing from memory is worse. | Shipped |
| E5 | Deliberate final review with a printable report | Finalizing is a committing act. It should be inspectable, not one click. | Shipped |
| E6 | Single confirmation that doubles as the export receipt | Two stacked `confirm()` dialogs train an instructor to click through. | Shipped |
| E7 | Two-file export with a real audit trail | A grade CSV with no provenance cannot be defended six months later. | Shipped |
| E8 | In-session change history with undo | "What did I change, and can I put it back?" | Shipped |
| E9 | Searchable, sortable student outcome table | An instructor needs to answer "who is in this band?" and "did I miss anyone?" | Shipped |
| E10 | Active grading time | The starter's timer measured how long a browser tab had been open. | Shipped |
| E11 | Demo class, sample data and template | A judge — or a new instructor — should understand the product in under a minute without constructing a spreadsheet. | Shipped |
| E12 | Optional local draft recovery | A refresh losing an hour of cutoff work is the kind of thing that makes people stop trusting a tool. | Shipped |

---

## E1 — Intelligent import with a data-health report

| | |
| --- | --- |
| **Instructor problem** | Marks files are messy. A column is renamed, a mark is typed as `ABS`, one student's ID is entered twice, and the export has a cover sheet in front of the data. A console that loads all of it without comment produces a grade set built on a guess. Worse, a console that loads *some* of it without comment produces a grade set with students quietly missing. |
| **Solution** | Every workbook is analysed before grading is possible. The console finds the sheet that actually contains a marks table, finds the header row even when a title sits above it, and resolves the three required columns through case- and alias-tolerant matching. Every row is then validated into exactly one of three outcomes: accepted, **normalised** (a value the specification permits us to transform, with the original and the result both shown), or **rejected** (with the spreadsheet row number, the offending value, and a specific remedy). Unusable files get a named diagnosis and a recovery action instead of silence. |
| **Why it matters** | It converts "trust the tool" into "check the tool's work". The instructor reads a short report — 92 rows accepted, 3 rejected, 2 normalised — and can open the rejected list, see row 41 says `ABS` in the Total Marks column, and fix the source file. The instructor never has to wonder whether a student was quietly dropped. Course names that differ only by case or padding are merged and the merge is reported, because silently merging academic records is not acceptable either. |
| **Evidence** | BUG_FIX_LOG entries 5–22. `tests/fixtures/workbooks/` contains 25 adversarial workbooks; `tests/run.js` has a dedicated suite over all of them. |

---

## E2 — Gap-free cutoff model with an impossible-to-misconfigure editor

| | |
| --- | --- |
| **Instructor problem** | The starter asked the instructor to maintain sixteen numbers: a minimum and a maximum for each of eight grades. Nothing stopped those numbers from leaving a gap or overlapping, and the consequence was invisible until the export — at which point students were simply absent from the file. |
| **Solution** | The configuration is now **seven ordered cutoffs** and nothing else. A band's maximum is *derived* from the cutoff below it; the top band always reaches 100 and the bottom always starts at 0. A gap or an overlap is therefore not representable, not merely validated against. On top of that, each cutoff is clamped to the window its two neighbours allow, so even typing `250` into the A cutoff cannot produce an invalid state — and when clamping happens the interface says so and explains why. |
| **Why it matters** | It moves safety from "the user must not make a mistake" to "the user cannot make this particular mistake". The number of editable fields drops from sixteen selects of 101 options to seven numeric inputs with steppers, which is also faster to use. Single-mark bands — `A = 100–100` — are now expressible, because they are a normal thing to want. |
| **Evidence** | BUG_FIX_LOG entries 1–3. `tests/run.js` walks all 101 marks against five configurations and applies 16 hostile edits in sequence, re-validating after each. |

---

## E3 — Live grade-impact workspace

| | |
| --- | --- |
| **Instructor problem** | Designing grade bands is a judgement about consequences. The basic console let an instructor change a number and see a count change, with no way to answer the question that actually matters: *which students does this move, and in which direction?* |
| **Solution** | Every cutoff is drawn on the distribution itself. It can be dragged with a pointer, or operated from the keyboard — including on the chart, where each boundary is a real `role="slider"` with arrow-key, Shift-arrow, Page and Home/End support. On any change the interface immediately shows the student count and share for every band, the change against the previous configuration, the number of students who moved up and down, and a list of the affected students with their ID, mark, old grade and new grade. The marks whose grade just changed are flashed in copper on the chart. When the configuration matches the baseline, the panel says so and says nothing more — a clean state stays clean. |
| **Why it matters** | The instructor moves a boundary and immediately sees the human consequence, not a number in isolation. That is what makes a cutoff decision defensible rather than arbitrary. The 1-mark-per-bar histogram is what makes it exact: a cutoff at 82 is a specific mark, not somewhere inside a 10-wide bin. |
| **Evidence** | BUG_FIX_LOG entries 31, 46. Browser journey section 6 asserts the counts, the direction split, the before/after table, the affected-student list, keyboard operation of both the number field and the chart slider, and that clamping is explained rather than silent. |

---

## E4 — Optional boundary suggestion from the class distribution

| | |
| --- | --- |
| **Instructor problem** | Drawing a defensible set of cutoffs from 34 marks by eye is slow, and doing it from memory of last year's bands ignores the class in front of you. |
| **Solution** | An optional panel offers cutoffs derived from **1-D k-means (Jenks-style natural breaks)** fitted to this course's marks, seeded from quartiles so the result is deterministic. Each boundary is placed in the middle of the widest empty gap between two groups of students, snapped to a whole mark, and repaired so the seven cutoffs are strictly decreasing. The method is stated in the panel in plain language. The panel shows the exact proposed cutoffs and previews how many students would change grade and in which direction **before** anything is applied. A single explicit button applies it; the application is undoable. |
| **Why it matters** | It is a starting point the instructor can argue with, not an answer. The obvious alternative — fit a normal curve and cut at standard deviations — was deliberately rejected: it quietly assumes the class is normally distributed, which is frequently false, and would push a 37-mark cluster into a C simply because the mean was 61. The console makes no claim about the shape of the distribution anywhere, and says why. |
| **Evidence** | `tests/run.js` asserts the suggestion is deterministic, produces seven strictly decreasing in-range cutoffs, is never simply the defaults, grades every student when applied, and declines honestly when the class has fewer than three distinct marks. |

---

## E5 — Deliberate final review with a printable report

| | |
| --- | --- |
| **Instructor problem** | Finalizing publishes grades. A tool that lets you do that in one click from anywhere gives you no chance to notice that the bands are wrong, and no artefact to file afterwards. |
| **Solution** | Finalizing requires navigating to a review stage that reads like a document rather than a screen. It carries a masthead with the course, instructor, student count, active grading time and generation timestamp; a safety checklist that states each requirement as pass or fail (instructor recorded, file validated, course selected, every mark from 0 to 100 covered by exactly one grade, source is not the demo class) with a one-click fix for anything blocking; the cohort statistics; the distribution with the final cutoffs drawn on it; the final band table; the impact of the instructor's changes against the defaults; and anything worth knowing. A print stylesheet turns the same sheet into a clean A4 report with no application chrome. |
| **Why it matters** | It makes the committing step inspectable, and it produces the artefact an instructor actually needs to keep. The checklist is not decoration: it is the same `checks()` function that decides whether the finalize button is enabled, so the display and the gate cannot disagree. |
| **Evidence** | BUG_FIX_LOG entries 38, 49. `tests/browser/print.js` renders the report to PDF; the printable flag on the stage is what the print stylesheet keys on, and its absence was a real bug found this way (a blank printed page). |

---

## E6 — Single confirmation that doubles as the export receipt

| | |
| --- | --- |
| **Instructor problem** | The starter reset its grade ranges behind two consecutive `confirm()` dialogs. Modal confirmation theatre teaches people to click through, which is exactly the wrong reflex to build around a committing action. |
| **Solution** | There is one confirmation, and it is not a browser dialog. Finalizing moves the workspace into a review state that states the course, the instructor, the student count and the distribution. From there, one dialog confirms, and that same dialog becomes the receipt: after the files are written it shows their exact names and what they contain. Escape and "Keep editing" both back out safely; focus is trapped while open and restored on close. |
| **Why it matters** | One deliberate step, with the actual numbers in front of the instructor at the moment of the decision, and a designed success state afterwards. The browser journey asserts **zero** native dialogs across 157 assertions, which is a stronger guarantee than any single check. |
| **Evidence** | BUG_FIX_LOG entries 4, 42, 43. |

---

## E7 — Two-file export with a real audit trail

| | |
| --- | --- |
| **Instructor problem** | `grades.csv` is not a filename; it is an absence of one. Two courses exported on the same day collide, and six months later nobody can say which cutoffs produced the file or who approved them. |
| **Solution** | Two files, both RFC 4180 escaped and BOM-prefixed so Excel renders them correctly. **Grades** — one row per student: `BITS ID, Total Marks, Grade`, named `BITSID-grades_<course>_<timestamp>.csv`. **Summary** — instructor, course, source file and sheet, generation timestamp, active grading time, accepted/rejected/normalised counts, cohort statistics, the exact cutoffs used, the impact against the defaults, and the full change log, named `BITSID-grading-summary_<course>_<timestamp>.csv`. A third exportable artefact, the rejected-rows report, is offered from the import panel. |
| **Why it matters** | The summary is the difference between a spreadsheet someone edited and a grade set someone produced. It answers "how were these grades arrived at?" without anyone having to remember. The exporter is also hardened against a real threat: a marks file is untrusted input and these CSVs are opened in Excel, so a field beginning with `=`, `+`, `-` or `@` is neutralised — while plain numbers are explicitly excluded, so a negative or decimal mark stays a number. |
| **Evidence** | BUG_FIX_LOG entries 32–38. `tests/run.js` asserts escaping, the BOM, filename shape, that a record that cannot be graded is written as `NOT GRADED` rather than omitted, and that the summary contains no `null`, `NaN` or `undefined`. |

---

## E8 — In-session change history with undo

| | |
| --- | --- |
| **Instructor problem** | Academic grading should never feel like editing a mystery spreadsheet during an earthquake. An instructor who nudges a cutoff four times needs to know what they did and be able to put any of it back. |
| **Solution** | Every meaningful change is logged with a time, a description (`A minimum: 82 → 87`), and the configuration as it stood *before* it, so undo restores rather than re-applies. The log is shown newest-first with a per-entry **Undo**, plus undo-last and clear-log actions. "Reset to defaults" is not gated behind a dialog; it applies immediately and offers Undo in the toast, which re-logs itself so the audit trail remains complete. The change log is also written into the exported summary. |
| **Why it matters** | It makes experimentation cheap, which is precisely what an instructor needs in order to find the right cutoffs. Nothing is server-persisted and nothing pretends to be: the log is explicitly labelled as session-only, and the exported summary is the durable record. |
| **Evidence** | BUG_FIX_LOG entries 4, 44, 46. Browser journey asserts that undo changes the configuration, that the undo is itself logged, that reset restores the exact default vector, and that the applied suggestion is undoable. |

---

## E9 — Searchable, sortable student outcome table

| | |
| --- | --- |
| **Instructor problem** | Aggregates answer "how many"; they do not answer "who". An instructor reconciling a grade set against a department list, or tracking down one student, needs the individual records. |
| **Solution** | A table of `BITS ID`, `Marks`, `Grade` and the `Band` each mark falls into, sortable by ID, marks or grade with `aria-sort` exposed, filterable by ID, mark or grade, with a sticky header, grade chips, a designed no-match state, and changed rows highlighted against the previous configuration. Rendering is capped at 500 rows with an explicit note, because the export and the report always contain every student. |
| **Why it matters** | It closes the loop between the distribution and the individual, and it is where an instructor actually verifies that a cutoff change did what they expected. The Band column answers "which band is this mark in?" without making them re-derive it. |
| **Evidence** | Browser journey section 5 asserts search narrows correctly, no-match is designed, all three sort orders are numerically and lexically correct, and `aria-sort` is present. |

---

## E10 — Active grading time

| | |
| --- | --- |
| **Instructor problem** | The starter's timer started at page load. Opening the console to check a file and closing it an hour later reported a "grading time" of one hour, which is not a measurement of anything. |
| **Solution** | The timer starts when a course is opened for grading, resets on a new import, and stops at finalize. It measures **active** time: it pauses when the tab is hidden, because an instructor reading a marking rubric in another tab is not grading. It renders synchronously rather than on a tick, so it is never blank, and its state (`Idle`, `Active`, `Paused`, `Final`) is always visible. The elapsed figure is written into the review sheet and the exported summary. |
| **Why it matters** | A number that means nothing is worse than no number. This one can be quoted in a review, because it measures the thing it claims to measure. |
| **Evidence** | BUG_FIX_LOG entries 39–41. Browser journey asserts the timer is idle at `0s` on load, running after a course is selected, stopped after finalize, and reset after a new import. |

---

## E11 — Demo class, sample data and template

| | |
| --- | --- |
| **Instructor problem** | A judge opening a URL with no context, and an instructor evaluating whether the tool is worth adopting, both face the same problem: nothing happens until a correctly formatted spreadsheet exists. |
| **Solution** | Three entry points, all clearly labelled. **Load demo class** builds four synthetic courses with deliberately different shapes — a normal class, a strong class, a weak class with one high outlier, and a nine-student tight class — and runs them through the *identical* validation pipeline as a real upload, including two recoverable imperfections so the health report has something honest to report. **Sample data** is a real 90-student `.xlsx` across three courses. **Template** is a two-sheet workbook: a `Marks` sheet with one worked example row, and a `How to use` sheet stating each column's rule. |
| **Why it matters** | The whole product can be understood in about forty seconds without leaving the browser. The demo is marked `Demo data` in the file chip, the review sheet flags it as a blocking issue with "do not submit it", and the exported summary records it — so a demo grade set can never be mistaken for a real one. Because the demo goes through the real pipeline rather than a shortcut, it demonstrates the validation story rather than bypassing it. |
| **Evidence** | `tools/build-demo.js` generates the dataset deterministically. `tests/run.js` asserts the demo class yields zero rejections, at least two reported normalisations, and that every course grades completely. |

---

## E12 — Optional local draft recovery

| | |
| --- | --- |
| **Instructor problem** | Nudging cutoffs is exploratory, and exploratory work is exactly what is lost to an accidental refresh. |
| **Solution** | An **opt-in** checkbox, off by default. When enabled, the selected course, cutoffs, change history and instructor name are stored in `localStorage` under one key, with the raw rows needed to rebuild the session. On the next visit the console offers to restore, showing when the draft was saved, and the offer includes a Discard. Restoring produces a visible notice. Classes whose draft would exceed 1.5 MB are refused with an explanation rather than silently truncated, and a storage failure degrades to a warning. |
| **Why it matters** | It respects the privacy of student records by defaulting to off, while still being available to the instructor who wants it. Nothing is transmitted, there is no analytics, and the copy in the interface says exactly what is stored and where. |
| **Evidence** | Browser journey asserts the toggle is present, that the draft is stored under a single known key, and that clearing removes it. |

---

## Deliberately not included

| Rejected | Why |
| --- | --- |
| Dark mode | The brief allows it only if the core product is already excellent. One very good light theme beats two mediocre themes, and a half-finished dark theme would read as an unfinished submission. |
| A framework | Vanilla HTML, CSS and classic scripts deliver this product with no build step, no `node_modules` in production, and no bundler. It also means the console works when `index.html` is opened directly from disk, which is how a judge may first try it. |
| A chatbot or "AI grading assistant" | Grade boundaries are an academic policy decision. Automating them would be both wrong and a distraction from the changes that actually improve the product. |
| Login, server or database | The challenge is a browser console. A backend would add risk, require infrastructure, and contradict the privacy guarantee. |
| PDF generation library | The print stylesheet produces a clean A4 report from the browser's own print pipeline — no dependency, no extra failure mode, and the instructor gets a PDF via "Save as PDF". |
| Infinite-scroll or virtualised tables | A 300-student class renders comfortably. Virtualisation would add complexity for a case that does not yet exist, and would break Ctrl+F on the student's name. |
| Animated number counters and entrance animations | Motion should explain a change, not decorate a page. The only animation in the product is the 1.5-second flash on marks whose grade just changed, and the 240ms transitions on bars and values. |
