/**
 * Export generation.
 *
 * Two artefacts:
 *   1. grades CSV  - clean tabular, one row per student, exactly what the
 *                    screen showed at the moment of export.
 *   2. summary CSV - the audit record: who, what, when, the cutoffs used and
 *                    the resulting distribution.
 *
 * Both are RFC 4180 escaped (see util.csvField), which also neutralises
 * spreadsheet formula injection, and both carry a UTF-8 BOM so Excel on Windows
 * renders non-ASCII names correctly instead of mojibake.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var U = CF.util;

  var BOM = "\uFEFF";

  function studentCsv(records, cutoffs, options) {
    options = options || {};
    var lines = [];
    lines.push(U.csvRow(["BITS ID", "Total Marks", "Grade"]));
    var out = records.map(function (r) {
      var grade = CF.grading.gradeFor(r.marks, cutoffs) || "NOT GRADED";
      return {
        id: r.id,
        marks: r.marks,
        grade: grade
      };
    });
    if (options.sortById !== false) {
      out.sort(function (a, b) {
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });
    }
    out.forEach(function (r) {
      lines.push(U.csvRow([r.id, r.marks, r.grade]));
    });
    return BOM + lines.join("\r\n") + "\r\n";
  }

  function summaryCsv(ctx) {
    var lines = [];
    var bands = CF.grading.bandsFromCutoffs(ctx.cutoffs);
    var counts = bands.map(function () {
      return 0;
    });
    var ungraded = 0;
    (ctx.records || []).forEach(function (r) {
      var g = CF.grading.gradeFor(r.marks, ctx.cutoffs);
      if (g === null) {
        ungraded++;
        return;
      }
      counts[CF.grading.GRADES.indexOf(g)]++;
    });
    var s = ctx.stats || CF.statistics.describe((ctx.records || []).map(function (r) { return r.marks; }));

    lines.push(U.csvRow(["BITS Pilani Digital - Grading Summary"]));
    lines.push("");
    lines.push(U.csvRow(["Field", "Value"]));
    lines.push(U.csvRow(["Instructor", ctx.instructor || ""]));
    lines.push(U.csvRow(["Course", ctx.course || ""]));
    lines.push(U.csvRow(["Source file", (ctx.fileName && ctx.fileName.name) || "unknown"]));
    lines.push(U.csvRow(["Source sheet", (ctx.sheet && ctx.sheet.name) || "unknown"]));
    lines.push(U.csvRow(["Generated at", U.humanStamp(ctx.generatedAt || new Date())]));
    lines.push(U.csvRow(["Active grading time", U.formatDuration(ctx.elapsedMs || 0)]));
    lines.push(U.csvRow(["Rows accepted from workbook", ctx.counts ? ctx.counts.accepted : ""]));
    lines.push(U.csvRow(["Rows rejected", ctx.counts ? ctx.counts.rejected : ""]));
    lines.push(U.csvRow(["Marks normalised", ctx.counts ? ctx.counts.normalised : ""]));
    lines.push("");

    lines.push(U.csvRow(["Cohort statistics"]));
    lines.push(U.csvRow(["Measure", "Value"]));
    lines.push(U.csvRow(["Students graded", s.count]));
    lines.push(U.csvRow(["Minimum", fmt(s.min)]));
    lines.push(U.csvRow(["Maximum", fmt(s.max)]));
    lines.push(U.csvRow(["Mean", fmt2(s.mean)]));
    lines.push(U.csvRow(["Median", fmt2(s.median)]));
    lines.push(U.csvRow(["Q1", fmt2(s.q1)]));
    lines.push(U.csvRow(["Q3", fmt2(s.q3)]));
    lines.push(U.csvRow(["Standard deviation", fmt2(s.stdDev)]));
    lines.push("");

    lines.push(U.csvRow(["Final grade cutoffs"]));
    lines.push(U.csvRow(["Grade", "Marks from", "Marks to", "Students", "Share of class"]));
    bands.forEach(function (b, i) {
      lines.push(
        U.csvRow([
          b.grade,
          b.min,
          b.max,
          counts[i],
          U.percent(counts[i], s.count).toFixed(1) + "%"
        ])
      );
    });
    lines.push("");

    if (ctx.changedFrom && ctx.changedFrom.length === ctx.cutoffs.length) {
      var diff = CF.grading.impact(ctx.records || [], ctx.cutoffs, ctx.changedFrom);
      lines.push(U.csvRow(["Change from previous configuration"]));
      lines.push(U.csvRow(["Students affected", diff.changed]));
      lines.push(U.csvRow(["Moved up a grade", diff.up]));
      lines.push(U.csvRow(["Moved down a grade", diff.down]));
      lines.push("");
    }

    if (ctx.history && ctx.history.length) {
      lines.push(U.csvRow(["Change log"]));
      lines.push(U.csvRow(["#", "Time", "Change"]));
      ctx.history.forEach(function (h, i) {
        lines.push(U.csvRow([i + 1, h.time, h.text]));
      });
      lines.push("");
    }

    lines.push(
      U.csvRow([
        "Note",
        "Generated in the instructor's browser. No student data was transmitted."
      ])
    );

    return BOM + lines.join("\r\n") + "\r\n";
  }

  function rejectedRowsCsv(analysis) {
    var lines = [U.csvRow(["Row", "Severity", "Problem", "Value in file", "What to do"])];
    (analysis.issues || []).forEach(function (i) {
      if (i.severity === "info") return;
      lines.push(U.csvRow([i.row === null ? "" : i.row, i.severity, i.problem, i.raw, i.remedy]));
    });
    return BOM + lines.join("\r\n") + "\r\n";
  }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return "";
    return String(Math.round(v * 100) / 100);
  }

  function fmt2(v) {
    if (v === null || v === undefined || !isFinite(v)) return "";
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function gradesFileName(course, date) {
    return "BITSID-grades_" + U.slugify(course) + "_" + U.stamp(date) + ".csv";
  }

  function summaryFileName(course, date) {
    return "BITSID-grading-summary_" + U.slugify(course) + "_" + U.stamp(date) + ".csv";
  }

  function rejectedFileName(date) {
    return "BITSID-rejected-rows_" + U.stamp(date) + ".csv";
  }

  CF.exporters = {
    studentCsv: studentCsv,
    summaryCsv: summaryCsv,
    rejectedRowsCsv: rejectedRowsCsv,
    gradesFileName: gradesFileName,
    summaryFileName: summaryFileName,
    rejectedFileName: rejectedFileName
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
