/**
 * Optional boundary suggestion.
 *
 * This is a *starting point for the instructor to accept, edit or ignore* - it
 * never runs automatically and never decides a grade. The method is stated up
 * front in the UI and is statistically defensible:
 *
 *   1-D k-means (Jenks-style natural breaks) on this course's marks, seeded
 *   from quartiles so the result is deterministic.
 *   Each boundary is then placed in the middle of the widest empty gap between
 *   two adjacent groups, snapped to a whole mark, and repaired so the seven
 *   cutoffs are strictly increasing.
 *
 * The alternative - fitting a normal curve and cutting at standard deviations -
 * is deliberately avoided: it quietly assumes the class is normally
 * distributed, which is frequently false and would push a 37-mark cluster into
 * a "C" simply because the mean was 61.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});
  var U = CF.util;
  var S = CF.statistics;

  var METHOD =
    "Natural breaks (1-D k-means) fitted to this course's marks, seeded from " +
    "quartiles. Each cutoff is placed in the middle of the widest gap between " +
    "two groups of students, snapped to a whole mark. No normal-distribution " +
    "assumption is made.";

  var METHOD_SHORT = "Natural breaks (1-D k-means)";

  function lloyd(sorted, k, seedValues) {
    var centres = seedValues.slice();
    var assign = new Array(sorted.length);
    for (var iter = 0; iter < 100; iter++) {
      var moved = false;
      for (var i = 0; i < sorted.length; i++) {
        var best = 0;
        var bestD = Infinity;
        for (var c = 0; c < centres.length; c++) {
          var d = Math.abs(sorted[i] - centres[c]);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (assign[i] !== best) {
          assign[i] = best;
          moved = true;
        }
      }
      var sums = new Array(centres.length);
      var counts = new Array(centres.length);
      for (var j = 0; j < centres.length; j++) {
        sums[j] = 0;
        counts[j] = 0;
      }
      for (var m = 0; m < sorted.length; m++) {
        sums[assign[m]] += sorted[m];
        counts[assign[m]]++;
      }
      var changed = false;
      for (var n = 0; n < centres.length; n++) {
        if (counts[n] === 0) continue;
        var next = sums[n] / counts[n];
        if (next !== centres[n]) {
          centres[n] = next;
          changed = true;
        }
      }
      if (!moved && !changed) break;
    }
    centres.sort(function (a, b) {
      return a - b;
    });
    return centres;
  }

  /** Widest-gap boundary between two adjacent cluster centres. */
  function boundaryBetween(sorted, leftCentre, rightCentre) {
    if (!isFinite(leftCentre) || !isFinite(rightCentre)) return NaN;
    var lower = [];
    var upper = [];
    for (var i = 0; i < sorted.length; i++) {
      var v = sorted[i];
      if (v <= leftCentre) lower.push(v);
      else if (v >= rightCentre) upper.push(v);
    }
    if (lower.length && upper.length) {
      var lo = lower[lower.length - 1];
      var hi = upper[0];
      if (hi > lo) return Math.floor((lo + hi) / 2);
      return lo;
    }
    // One side is empty (a cluster with no members): fall back to the midpoint
    // between the two centres rather than inventing a boundary from nothing.
    return Math.round((leftCentre + rightCentre) / 2);
  }

  /**
   * Turn ascending raw boundaries into the strictly decreasing cutoff vector
   * the grading model uses (cutoffs[0] is A's minimum, cutoffs[6] is D's).
   * Falls back to the defaults if the input cannot be made valid.
   */
  function repair(raw) {
    var asc = raw.map(function (c) {
      if (!isFinite(c)) return null;
      return U.clamp(Math.round(c), 1, U.MAX_MARK);
    });
    for (var k = 0; k < asc.length; k++) {
      if (asc[k] === null) asc[k] = Math.round(((k + 1) * U.MAX_MARK) / (asc.length + 1));
    }
    // Guarantee seven distinct ascending integers inside 1..100.
    for (var i = 1; i < asc.length; i++) {
      if (asc[i] <= asc[i - 1]) asc[i] = asc[i - 1] + 1;
    }
    for (var j = asc.length - 1; j >= 0; j--) {
      var cap = j === asc.length - 1 ? U.MAX_MARK : asc[j + 1] - 1;
      if (asc[j] > cap) asc[j] = cap;
    }
    var out = asc.slice().reverse();
    if (CF.grading.validate(out).valid) return out;
    return CF.grading.defaults();
  }

  /**
   * Suggest cutoffs for a cohort.
   * Returns { ok, cutoffs, method, reason } - never throws, never mutates.
   */
  function suggest(marks, bandCount) {
    var k = bandCount || CF.grading.GRADES.length; // 8 bands -> 7 cutoffs
    var sorted = S.sortedMarks(marks);
    if (sorted.length < 3) {
      return {
        ok: false,
        reason:
          "This course has " +
          sorted.length +
          " " +
          U.pluralise(sorted.length, "mark") +
          ", which is too few to suggest meaningful grade boundaries."
      };
    }
    var distinct = U.uniqueBy(sorted, function (m) { return String(m); });
    if (distinct.length < 3) {
      return {
        ok: false,
        reason:
          "Every student in this course has the same mark, so there is no separation to find."
      };
    }

    var cutCount = k - 1;
    // One seed centre per band, spread across the observed quantiles, so the
    // fit is deterministic and starts from a sensible ordering.
    var seed = [];
    for (var i = 0; i < k; i++) {
      seed.push(S.quantile(sorted, k === 1 ? 0.5 : i / (k - 1)));
    }
    var centres = lloyd(sorted, k, seed);

    var raw = [];
    for (var c = 0; c < cutCount; c++) {
      raw.push(boundaryBetween(sorted, centres[c], centres[c + 1]));
    }

    return {
      ok: true,
      cutoffs: repair(raw),
      method: METHOD,
      methodShort: METHOD_SHORT
    };
  }

  /** Which students change grade between two configurations. */
  function preview(records, from, to) {
    return CF.grading.impact(records, to, from);
  }

  CF.suggest = {
    suggest: suggest,
    preview: preview,
    repair: repair
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
