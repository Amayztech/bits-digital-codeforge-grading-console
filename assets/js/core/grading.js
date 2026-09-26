/**
 * Grading model.
 *
 * The starter application stored an independent Min and Max for every grade
 * band, which is precisely how gaps, overlaps and uncovered marks were created
 * (marks outside every band were then silently dropped from the export).
 *
 * Here a configuration is seven ordered cutoffs and nothing else:
 *
 *   bands[i].min = cutoffs[i - 1]      (cutoffs[0] is always 0)
 *   bands[i].max = cutoffs[i] - 1      (cutoffs[7] is always 100)
 *
 * Because Max is *derived* rather than stored, a gap or an overlap is not
 * representable. The only remaining invariant is that cutoffs are strictly
 * increasing, and the editor clamps every input to its legal window so an
 * invalid configuration cannot be reached through the UI at all.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var U = CF.util;

  var GRADES = ["A", "A-", "B", "B-", "C", "C-", "D", "E"];

  /*
   * cutoffs[i] is the LOWEST mark that earns GRADES[i], for i = 0..6 (A..D).
   * E is not editable: the bottom band always starts at 0.
   * The top band always reaches 100.
   *
   *   A  = [cutoffs[0], 100]
   *   A- = [cutoffs[1], cutoffs[0] - 1]
   *   ...
   *   E  = [0, cutoffs[6] - 1]
   */
  var EDITABLE = GRADES.length - 1;

  var DEFAULT_CUTOFFS = [80, 70, 60, 50, 40, 30, 20]; // min for A, A-, B, B-, C, C-, D

  function defaults() {
    return DEFAULT_CUTOFFS.slice();
  }

  /** Expand seven cutoffs into eight contiguous [min, max] bands. */
  function bandsFromCutoffs(cutoffs) {
    var bands = [];
    for (var i = 0; i < GRADES.length; i++) {
      var min = i === EDITABLE ? U.MIN_MARK : cutoffs[i];
      var max = i === 0 ? U.MAX_MARK : cutoffs[i - 1] - 1;
      bands.push({
        grade: GRADES[i],
        index: i,
        min: min,
        max: max,
        editable: i < EDITABLE,
        // The lowest bands are the ones most institutions define by hand, so
        // the chart gives them a lighter fill.
        tone: i < 3 ? "deep" : i < 6 ? "mid" : "low"
      });
    }
    return bands;
  }

  function defaultBands() {
    return bandsFromCutoffs(defaults());
  }

  function cloneCutoffs(cutoffs) {
    return cutoffs.slice();
  }

  /**
   * Legal window for cutoffs[i], derived purely from its neighbours.
   * Returns null for the fixed bottom bound (E) or out-of-range indices.
   */
  function windowFor(cutoffs, i) {
    if (i < 0 || i >= EDITABLE) return null;
    var lo = (i === EDITABLE - 1 ? U.MIN_MARK : cutoffs[i + 1]) + 1;
    var hi = i === 0 ? U.MAX_MARK : cutoffs[i - 1] - 1;
    if (lo > hi) return null;
    return { lo: lo, hi: hi };
  }

  /**
   * Force a cutoff into its legal window.
   * Returns { cutoffs, clampedTo } so the UI can explain what happened rather
   * than silently changing a value behind the instructor's back.
   */
  function applyCutoff(cutoffs, i, value) {
    var next = cloneCutoffs(cutoffs);
    if (i < 0 || i >= EDITABLE) return { cutoffs: next, clampedTo: null };
    var w = windowFor(cutoffs, i);
    if (!w) return { cutoffs: next, clampedTo: null };
    var requested = U.roundHalfUp(Number(value));
    if (!isFinite(requested)) return { cutoffs: next, clampedTo: null };
    var n = U.clamp(requested, w.lo, w.hi);
    next[i] = n;
    return { cutoffs: next, clampedTo: n === requested ? null : n };
  }

  /**
   * Full validation, used as a safety net and in the exported report.
   * With cutoffs as the only input this should never fail, which is the point.
   */
  function validate(cutoffs) {
    if (!Array.isArray(cutoffs)) {
      return { valid: false, problems: ["Grade configuration is missing."] };
    }
    if (cutoffs.length !== GRADES.length - 1) {
      return {
        valid: false,
        problems: [
          "Expected " + (GRADES.length - 1) + " cutoffs but received " + cutoffs.length + "."
        ]
      };
    }
    var problems = [];
    for (var i = 0; i < cutoffs.length; i++) {
      var v = cutoffs[i];
      if (typeof v !== "number" || !isFinite(v)) {
        problems.push("Cutoff " + (i + 1) + " is not a number.");
        continue;
      }
      if (v !== U.roundHalfUp(v)) {
        problems.push("Cutoff " + (i + 1) + " must be a whole number.");
      }
      if (v < U.MIN_MARK || v > U.MAX_MARK) {
        problems.push(
          "Cutoff " + (i + 1) + " (" + v + ") is outside the 0-100 mark range."
        );
      }
      if (i > 0 && v >= cutoffs[i - 1]) {
        problems.push(
          GRADES[i] +
            " must start below " +
            GRADES[i - 1] +
            " (" +
            cutoffs[i - 1] +
            ")."
        );
      }
    }
    // Coverage proof: walking 0..100 must land in exactly one band each time.
    var bands = bandsFromCutoffs(cutoffs);
    for (var m = U.MIN_MARK; m <= U.MAX_MARK; m++) {
      var hits = 0;
      for (var b = 0; b < bands.length; b++) {
        if (m >= bands[b].min && m <= bands[b].max) hits++;
      }
      if (hits !== 1) {
        problems.push(
          "Mark " + m + " falls in " + hits + " grade bands; every mark must fall in exactly one."
        );
        break;
      }
    }
    return { valid: problems.length === 0, problems: problems, bands: bands };
  }

  /** Grade for a mark. Returns null only if the mark is out of scale. */
  function gradeFor(mark, cutoffs) {
    if (typeof mark !== "number" || !isFinite(mark)) return null;
    if (mark < U.MIN_MARK || mark > U.MAX_MARK) return null;
    for (var i = 0; i < cutoffs.length; i++) {
      if (mark >= cutoffs[i]) return GRADES[i];
    }
    return GRADES[GRADES.length - 1];
  }

  /**
   * Assign grades to records and tally per band in a single pass.
   * `records` needs { id, marks, course }.
   */
  function gradeAll(records, cutoffs) {
    var bands = bandsFromCutoffs(cutoffs);
    var counts = bands.map(function () {
      return 0;
    });
    var ungraded = [];
    var graded = records.map(function (r) {
      var g = gradeFor(r.marks, cutoffs);
      if (g === null) {
        ungraded.push(r);
        return { record: r, grade: null };
      }
      var idx = GRADES.indexOf(g);
      counts[idx]++;
      return { record: r, grade: g, bandIndex: idx };
    });
    return { bands: bands, counts: counts, graded: graded, ungraded: ungraded };
  }

  /**
   * Compare two configurations for the same cohort.
   * `baseline` may be null, which means "no previous decision to compare to".
   */
  function impact(records, cutoffs, baseline) {
    var now = gradeAll(records, cutoffs);
    var result = {
      total: records.length,
      changed: 0,
      up: 0,
      down: 0,
      moved: [],
      bandDelta: now.counts.map(function (n) {
        return { count: n, before: null, delta: null };
      }),
      hasBaseline: !!baseline && baseline.length === cutoffs.length
    };

    if (!result.hasBaseline) {
      result.bandDelta = now.counts.map(function (n) {
        return { count: n, before: null, delta: null };
      });
      return result;
    }

    var before = gradeAll(records, baseline);
    result.bandDelta = now.counts.map(function (n, i) {
      var was = before.counts[i];
      return { count: n, before: was, delta: n - was };
    });
    // A better grade has a lower index, so "up" means the index decreased.
    var rank = function (g) {
      return g === null ? -1 : GRADES.indexOf(g);
    };
    for (var i = 0; i < now.graded.length; i++) {
      var a = now.graded[i];
      var b = before.graded[i];
      if (a.grade === b.grade) continue;
      result.changed++;
      var dir = rank(a.grade) < rank(b.grade) ? "up" : "down";
      if (dir === "up") result.up++;
      else result.down++;
      result.moved.push({
        id: a.record.id,
        marks: a.record.marks,
        from: b.grade,
        to: a.grade,
        dir: dir
      });
    }
    return result;
  }

  /** Compact "80-100" label, collapsing single-mark bands to "80". */
  function rangeLabel(band) {
    if (band.min === band.max) return String(band.min);
    return band.min + "-" + band.max;
  }

  function describeCutoffs(cutoffs) {
    var bands = bandsFromCutoffs(cutoffs);
    return GRADES.map(function (g, i) {
      return g + ": " + rangeLabel(bands[i]);
    }).join(" | ");
  }

  CF.grading = {
    GRADES: GRADES,
    defaults: defaults,
    defaultBands: defaultBands,
    bandsFromCutoffs: bandsFromCutoffs,
    windowFor: windowFor,
    applyCutoff: applyCutoff,
    validate: validate,
    gradeFor: gradeFor,
    gradeAll: gradeAll,
    impact: impact,
    rangeLabel: rangeLabel,
    describeCutoffs: describeCutoffs
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
