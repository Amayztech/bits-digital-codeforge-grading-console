/**
 * Workbook import and row validation.
 *
 * Design intent: academic records are not "best effort" input. Every mark that
 * cannot be graded must be *visible* with a row number, the offending value and
 * a remedy - never silently dropped, never silently coerced. Values that the
 * challenge specification explicitly permits us to normalise (fractional marks,
 * which its own file guidance rounds to the nearest whole number) are reported
 * as warnings with before and after values so the transformation is auditable.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var U = CF.util;

  /* Accepted spellings per required column. Matching is case- and
     whitespace-insensitive, so "  total marks " and "TOTAL MARKS" both work.
     The header actually matched is surfaced in the import report. */
  var FIELD_ALIASES = {
    id: [
      "bits id",
      "bitsid",
      "student's bits id",
      "students bits id",
      "student bits id",
      "student id",
      "bits id no",
      "bits id number",
      "registration no",
      "reg no",
      "enrollment no",
      "enrolment no",
      "id"
    ],
    course: [
      "course",
      "course code",
      "course name",
      "course code name",
      "course code and name",
      "subject",
      "subject code",
      "paper"
    ],
    marks: [
      "total marks",
      "total mark",
      "total",
      "marks",
      "mark",
      "total score",
      "score",
      "marks obtained",
      "obtained marks",
      "total marks obtained",
      "final marks"
    ]
  };

  var FIELD_LABEL = { id: "BITS ID", course: "Course", marks: "Total Marks" };

  var ISSUE = {
    MISSING_ID: { severity: "error", label: "Missing BITS ID" },
    DUPLICATE_ID: { severity: "error", label: "Duplicate BITS ID" },
    MISSING_COURSE: { severity: "error", label: "Missing Course" },
    MISSING_MARKS: { severity: "error", label: "Missing Total Marks" },
    INVALID_MARKS: { severity: "error", label: "Invalid Total Marks" },
    MARKS_OUT_OF_RANGE: { severity: "error", label: "Mark outside 0-100" },
    ROUNDED_MARKS: { severity: "warning", label: "Fractional mark rounded" },
    FRACTION_MARKS: { severity: "warning", label: "Score written as a fraction" },
    PERCENT_MARKS: { severity: "warning", label: "Score written as a percentage" },
    PADDED_MARKS: { severity: "warning", label: "Whitespace in numeric value" },
    TEXT_MARKS: { severity: "warning", label: "Mark stored as text" },
    COURSE_NAME_MERGED: { severity: "info", label: "Course name variants merged" }
  };

  function matchField(key) {
    if (!key) return null;
    for (var f in FIELD_ALIASES) {
      if (!Object.prototype.hasOwnProperty.call(FIELD_ALIASES, f)) continue;
      if (FIELD_ALIASES[f].indexOf(key) !== -1) return f;
    }
    return null;
  }

  /**
   * Parse a raw cell into a mark.
   * `policy` selects how a fractional mark is handled: "nearest" (the default,
   * matching the challenge's stated rule), "up" or "down".
   * Returns { ok, value, issues: [{code, ...}] }.
   */
  function parseMark(raw, policy) {
    var issues = [];
    var value;

    if (U.isBlank(raw)) {
      return { ok: false, value: null, issues: [issue("MISSING_MARKS", raw, "The cell is empty.")] };
    }

    if (typeof raw === "number") {
      if (!isFinite(raw)) {
        return {
          ok: false,
          value: null,
          issues: [issue("INVALID_MARKS", raw, "The cell holds a value Excel cannot read as a number.")]
        };
      }
      value = raw;
    } else {
      var s = String(raw).replace(/\u00a0/g, " ");
      var trimmed = s.trim();
      if (trimmed === "") {
        return { ok: false, value: null, issues: [issue("MISSING_MARKS", raw, "The cell is empty.")] };
      }
      if (trimmed !== s) {
        issues.push(
          issue("PADDED_MARKS", raw, "Surrounding whitespace was removed.", { value: trimmed })
        );
      }

      var m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*100$/.exec(trimmed);
      if (m) {
        value = parseFloat(m[1]);
        issues.push(
          issue("FRACTION_MARKS", raw, "Read as " + value + " out of 100.", { value: value })
        );
      } else {
        m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%$/.exec(trimmed);
        if (m) {
          value = parseFloat(m[1]);
          issues.push(
            issue("PERCENT_MARKS", raw, "Read as " + value + " out of 100.", { value: value })
          );
        } else if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
          value = parseFloat(trimmed);
          issues.push(
            issue("TEXT_MARKS", raw, "Stored as text; read as the number " + value + ".", {
              value: value
            })
          );
        } else {
          return {
            ok: false,
            value: null,
            issues: [
              issue(
                "INVALID_MARKS",
                raw,
                "Expected a whole number from 0 to 100 (for example 82)."
              )
            ]
          };
        }
      }
    }

    if (value < U.MIN_MARK || value > U.MAX_MARK) {
      return {
        ok: false,
        value: null,
        issues: issues.concat(
          issue(
            "MARKS_OUT_OF_RANGE",
            raw,
            "Marks must be between 0 and 100; this value is " + value + "."
          )
        )
      };
    }

    if (value !== U.roundMark(value, policy)) {
      var rounded = U.roundMark(value, policy);
      // Rounding is a judgement call, so it is always reported with both the
      // original and the value used.
      issues = issues.filter(function (i) {
        return i.code !== "TEXT_MARKS" && i.code !== "FRACTION_MARKS" && i.code !== "PERCENT_MARKS";
      });
      issues.push(
        issue("ROUNDED_MARKS", raw, "Rounded to the nearest whole mark: " + value + " to " + rounded + ".", {
          value: rounded
        })
      );
      value = rounded;
    }

    return { ok: true, value: value, issues: issues };
  }

  function issue(code, value, remedy, extra) {
    var meta = ISSUE[code];
    var o = {
      code: code,
      severity: meta.severity,
      label: meta.label,
      problem: meta.label + ": " + describeValue(value),
      remedy: remedy,
      raw: value === undefined ? "" : String(value)
    };
    if (extra && extra.value !== undefined) o.resolved = extra.value;
    return o;
  }

  function describeValue(value) {
    if (U.isBlank(value)) return '"" (empty)';
    if (typeof value === "number") return String(value);
    return '"' + String(value) + '"';
  }

  /**
   * Score a row as a candidate header row. A row is scored by how many required
   * fields it can supply, so a workbook with a title row above the real header
   * is still detected correctly.
   */
  function scoreHeaderRow(cells) {
    var seen = {};
    var matches = [];
    for (var i = 0; i < cells.length; i++) {
      var field = matchField(U.headerKey(cells[i]));
      if (field && !seen[field]) {
        seen[field] = true;
        matches.push({ field: field, index: i, header: U.tidyName(cells[i]) });
      }
    }
    // Nudge known noise out of the way so a real header always wins.
    var filled = cells.filter(function (c) {
      return !U.isBlank(c);
    }).length;
    var penalty = filled > 4 ? (filled - 3) * 0.1 : 0;
    return { score: matches.length - penalty, matches: matches, filled: filled };
  }

  /**
   * Core pipeline, operating on an array-of-arrays plus a location.
   * Shared by real workbook imports and by demo data so both travel the same
   * validation path.
   */
  function analyseRows(rows, meta) {
    meta = meta || {};
    var policy = meta.rounding || "nearest";
    var maxScan = Math.min(rows.length, 12);
    var best = { score: 0, rowIndex: -1, matches: [] };

    for (var r = 0; r < maxScan; r++) {
      var s = scoreHeaderRow(rows[r] || []);
      if (s.score > best.score) {
        best = { score: s.score, rowIndex: r, matches: s.matches, filled: s.filled };
      }
    }

    if (best.rowIndex === -1 || best.score < 1) {
      return {
        ok: false,
        fatal: fatal(
          "NO_HEADER_ROW",
          "No marks table was found",
          "None of the first rows look like a header row for the required columns.",
          "Check that the sheet has a header row containing " +
            FIELD_LABEL.id +
            ", " +
            FIELD_LABEL.course +
            " and " +
            FIELD_LABEL.marks +
            ", and that it starts within the first 12 rows."
        ),
        meta: meta
      };
    }

    var columns = { id: null, course: null, marks: null };
    best.matches.forEach(function (m) {
      if (!columns[m.field]) columns[m.field] = m;
    });
    var missing = ["id", "course", "marks"].filter(function (f) {
      return !columns[f];
    });

    if (missing.length) {
      var headerCells = (rows[best.rowIndex] || []).map(function (c, i) {
        return { index: i, text: U.isBlank(c) ? "(blank)" : U.tidyName(c) };
      });
      return {
        ok: false,
        fatal: fatal(
          "MISSING_COLUMN",
          "Required " + (missing.length > 1 ? "columns are" : "column is") + " missing",
          "The header row is missing: " +
            missing
              .map(function (f) {
                return FIELD_LABEL[f];
              })
              .join(", ") +
            ".",
          "Headers found on row " +
            (best.rowIndex + 1) +
            ": " +
            (headerCells.length
              ? headerCells.map(function (h) { return h.text; }).join(" | ")
              : "(empty)") +
            ". Rename the " +
            missing.map(function (f) { return '"' + FIELD_LABEL[f] + '"'; }).join(" and ") +
            " column, or download the template and copy your data into it.",
          { columns: columns, headerRow: best.rowIndex, foundHeaders: headerCells }
        ),
        meta: meta
      };
    }

    /* ---- row validation ------------------------------------------------ */
    var records = [];
    var issues = [];
    var seenIds = Object.create(null);
    var blankRows = 0;
    var fractionalCount = 0;
    var dataStart = best.rowIndex + 1;

    for (var i = dataStart; i < rows.length; i++) {
      var row = rows[i] || [];
      var rowNumber = i + 1; // 1-based, matches what Excel shows
      var rawId = row[columns.id.index];
      var rawCourse = row[columns.course.index];
      var rawMarks = row[columns.marks.index];

      if (U.isBlank(rawId) && U.isBlank(rawCourse) && U.isBlank(rawMarks)) {
        blankRows++;
        continue;
      }

      var rowOk = true;

      if (U.isBlank(rawId)) {
        rowOk = false;
        issues.push(
          withRow(
            issue(
              "MISSING_ID",
              rawId,
              "Add the student's BITS ID, or delete the row if the student was not in the exam."
            ),
            rowNumber
          )
        );
      }
      var id = U.isBlank(rawId) ? "" : U.tidyName(rawId);
      var idKey = U.nameKey(rawId);

      if (U.isBlank(rawCourse)) {
        rowOk = false;
        issues.push(
          withRow(
            issue("MISSING_COURSE", rawCourse, "Enter the course code this mark belongs to."),
            rowNumber
          )
        );
      }
      var course = U.isBlank(rawCourse) ? "" : U.tidyName(rawCourse);
      var courseKey = U.nameKey(rawCourse);

      var mark = parseMark(rawMarks, policy);
      mark.issues.forEach(function (m) {
        if (m.code === "ROUNDED_MARKS") fractionalCount++;
      });
      if (!mark.ok) {
        rowOk = false;
        mark.issues.forEach(function (m) {
          issues.push(withRow(m, rowNumber));
        });
      } else {
        mark.issues.forEach(function (m) {
          issues.push(withRow(m, rowNumber));
        });
      }

      if (idKey && courseKey) {
        var dedupeKey = courseKey + " " + idKey;
        if (seenIds[dedupeKey] !== undefined) {
          rowOk = false;
          issues.push(
            withRow(
              issue(
                "DUPLICATE_ID",
                id,
                "Row " +
                  (seenIds[dedupeKey] + 1) +
                  " already has this BITS ID for " +
                  course +
                  ". Keep one row, or correct the ID on one of them."
              ),
              rowNumber
            )
          );
        } else {
          seenIds[dedupeKey] = i;
        }
      }

      if (rowOk) {
        records.push({
          row: rowNumber,
          id: id,
          marks: mark.value,
          course: course,
          courseKey: courseKey
        });
      }
    }

    /* ---- course name variants ------------------------------------------ */
    var courseFirstSeen = Object.create(null);
    var variants = Object.create(null);
    records.forEach(function (r) {
      if (courseFirstSeen[r.courseKey] === undefined) courseFirstSeen[r.courseKey] = r.course;
      if (!variants[r.courseKey]) variants[r.courseKey] = {};
      variants[r.courseKey][r.course] = (variants[r.courseKey][r.course] || 0) + 1;
    });
    records.forEach(function (r) {
      r.course = courseFirstSeen[r.courseKey] || r.course;
    });
    Object.keys(variants).forEach(function (k) {
      var names = Object.keys(variants[k]);
      if (names.length > 1) {
        issues.push({
          code: "COURSE_NAME_MERGED",
          severity: "info",
          label: ISSUE.COURSE_NAME_MERGED.label,
          problem:
            'Course written ' + names.length + ' different ways: ' + names.map(describeValue).join(", "),
          remedy:
            "Treated as one course and displayed as " +
            describeValue(courseFirstSeen[k]) +
            ". Clean the spelling in the source file to keep them separate.",
          row: null,
          raw: names.join(" | ")
        });
      }
    });

    /* ---- extra columns --------------------------------------------------- */
    var usedIndexes = {};
    ["id", "course", "marks"].forEach(function (f) {
      usedIndexes[columns[f].index] = true;
    });
    var headerRow = rows[best.rowIndex] || [];
    var ignoredColumns = [];
    headerRow.forEach(function (h, i) {
      if (usedIndexes[i]) return;
      if (U.isBlank(h)) return;
      ignoredColumns.push(U.tidyName(h));
    });

    /* ---- cohort rollup --------------------------------------------------- */
    var courses = buildCourseList(records);
    var allMarks = records.map(function (r) {
      return r.marks;
    });

    var errors = issues.filter(function (i) {
      return i.severity === "error";
    });
    var warnings = issues.filter(function (i) {
      return i.severity === "warning";
    });
    var infos = issues.filter(function (i) {
      return i.severity === "info";
    });

    var result = {
      ok: records.length > 0,
      meta: meta,
      rounding: policy,
      fractionalCount: fractionalCount,
      // Kept so the instructor can switch rounding policy without re-uploading.
      sourceRows: rows,
      columns: columns,
      headerRow: best.rowIndex,
      records: records,
      issues: issues,
      courses: courses,
      ignoredColumns: ignoredColumns,
      blankRows: blankRows,
      dataRowCount: Math.max(0, rows.length - dataStart),
      counts: {
        accepted: records.length,
        rejected: errors.length,
        normalised: warnings.length,
        notes: infos.length,
        blank: blankRows
      },
      stats: CF.statistics.describe(allMarks)
    };

    if (!result.ok) {
      result.fatal = fatal(
        "NO_VALID_ROWS",
        "No rows could be graded from this file",
        errors.length + " data " + U.pluralise(errors.length, "row") + " were found but none were valid.",
        "Open the rejected rows list below to see exactly what each row contains, then correct the source file and upload it again."
      );
    }

    return result;
  }

  function withRow(iss, rowNumber) {
    iss.row = rowNumber;
    return iss;
  }

  function fatal(code, title, detail, remedy, extra) {
    var o = { code: code, title: title, detail: detail, remedy: remedy };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    }
    return o;
  }

  function buildCourseList(records) {
    var map = Object.create(null);
    records.forEach(function (r) {
      if (!map[r.courseKey]) map[r.courseKey] = { key: r.courseKey, name: r.course, marks: [] };
      map[r.courseKey].marks.push(r.marks);
    });
    return Object.keys(map)
      .map(function (k) {
        var c = map[k];
        var d = CF.statistics.describe(c.marks);
        return {
          key: c.key,
          name: c.name,
          count: d.count,
          min: d.min,
          max: d.max,
          mean: d.mean
        };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }

  /* ======================================================================
     Workbook reading
     ====================================================================== */

  var XLSX_MIME =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
    "application/vnd.ms-excel," +
    "application/vnd.ms-excel.sheet.macroEnabled.12," +
    "application/octet-stream,text/csv,text/plain";

  function supportedTypes() {
    return XLSX_MIME;
  }

  function fileAccept() {
    return ".xlsx,.xls,.xlsm,.csv,text/csv";
  }

  function isSupportedName(name) {
    return /\.(xlsx|xls|xlsm|csv)$/i.test(String(name || ""));
  }

  /**
   * Read an ArrayBuffer into an analysis result.
   * `readWorkbook(arrayBuffer, XLSX, meta)` - XLSX is injected so this module
   * never reaches for a global and can be unit tested with any implementation.
   */
  function readWorkbook(arrayBuffer, XLSX, meta) {
    meta = meta || {};
    var bytes = arrayBuffer.byteLength || 0;
    if (bytes === 0) {
      return {
        ok: false,
        fatal: fatal(
          "FILE_EMPTY",
          "That file is empty",
          "The file contains no data at all.",
          "Re-export the marks sheet from your spreadsheet and upload the file again."
        ),
        meta: meta
      };
    }

    var wb;
    try {
      wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    } catch (e) {
      return {
        ok: false,
        fatal: fatal(
          "NOT_A_WORKBOOK",
          "That file could not be read as a spreadsheet",
          "The file is " + U.formatBytes(bytes) + " and is not a readable Excel or CSV workbook.",
          "Check that you exported the sheet as .xlsx or .xls (or saved it as CSV) and that the file finished downloading before you opened it."
        ),
        meta: meta
      };
    }

    if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
      return {
        ok: false,
        fatal: fatal(
          "NO_WORKSHEET",
          "The workbook has no worksheets",
          "There is no sheet to read marks from.",
          "Open the workbook, add a sheet containing the marks table, save it as .xlsx and upload it again."
        ),
        meta: meta
      };
    }

    // Score every sheet and read the one that actually looks like a marks table.
    // The starter always read SheetNames[0], which silently consumed an
    // instructions or cover sheet.
    var candidates = [];
    wb.SheetNames.forEach(function (name) {
      var sheet = wb.Sheets[name];
      if (!sheet) return;
      var rows;
      try {
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null, raw: true });
      } catch (e) {
        rows = [];
      }
      var probe = probeSheet(rows);
      candidates.push({ name: name, rows: rows, header: probe });
    });

    var usable = candidates
      .filter(function (c) {
        return c.header.score >= 1;
      })
      .sort(function (a, b) {
        if (b.header.score !== a.header.score) return b.header.score - a.header.score;
        return a.name.localeCompare(b.name);
      });

    if (!usable.length) {
      var firstNonEmpty = candidates.filter(function (c) {
        return c.rows.length > 0;
      })[0];
      return {
        ok: false,
        fatal: fatal(
          "NO_HEADER_ROW",
          "No marks table was found in this workbook",
          firstNonEmpty
            ? "Sheet \"" +
                firstNonEmpty.name +
                "\" has " +
                firstNonEmpty.rows.length +
                " rows, but none of the first rows contain the required column headers."
            : "The workbook contains " + wb.SheetNames.length + " empty sheet(s).",
          "The marks table needs a header row with " +
            FIELD_LABEL.id +
            ", " +
            FIELD_LABEL.course +
            " and " +
            FIELD_LABEL.marks +
            ". Download the template to see the expected layout."
        ),
        meta: meta,
        sheets: wb.SheetNames.map(function (n) {
          return { name: n, rows: candidates.filter(function (c) { return c.name === n; })[0].rows.length };
        })
      };
    }

    var chosen = usable[0];
    var analysis = analyseRows(chosen.rows, meta);
    analysis.sheet = {
      name: chosen.name,
      skipped: wb.SheetNames.filter(function (n) {
        return n !== chosen.name;
      }),
      candidates: candidates.map(function (c) {
        return { name: c.name, rows: c.rows.length, headerScore: c.header.score };
      })
    };
    if (analysis.fatal && analysis.fatal.sheets === undefined) {
      analysis.fatal.sheets = analysis.sheet.candidates;
    }
    return analysis;
  }

  function probeSheet(rows) {
    var maxScan = Math.min(rows.length, 12);
    var best = { score: 0, rowIndex: -1, matches: [] };
    for (var r = 0; r < maxScan; r++) {
      var s = scoreHeaderRow(rows[r] || []);
      if (s.score > best.score) best = { score: s.score, rowIndex: r, matches: s.matches };
    }
    return best;
  }

  /**
   * Build an analysis from raw array-of-arrays. Used by demo mode and by tests
   * so both exercise the identical validation pipeline as a real upload.
   */
  function readRows(rows, meta) {
    return analyseRows(rows, meta);
  }

  CF.workbook = {
    FIELD_ALIASES: FIELD_ALIASES,
    FIELD_LABEL: FIELD_LABEL,
    ISSUE: ISSUE,
    matchField: matchField,
    parseMark: parseMark,
    scoreHeaderRow: scoreHeaderRow,
    analyseRows: analyseRows,
    readWorkbook: readWorkbook,
    readRows: readRows,
    fileAccept: fileAccept,
    supportedTypes: supportedTypes,
    isSupportedName: isSupportedName
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
