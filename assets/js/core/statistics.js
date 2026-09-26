/**
 * Descriptive statistics for a cohort of marks.
 *
 * Every function is total: an empty cohort yields nulls rather than NaN, so the
 * UI can render a designed empty state instead of "NaN" (which is exactly what
 * the starter printed for an empty course).
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});

  /**
   * Numeric sort that is correct even when the source values arrived as text.
   * The starter sorted strings lexicographically, so a class containing 9 and
   * 100 reported a minimum of 100 and a maximum of 9.
   */
  function toNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string") {
      var t = v.trim();
      if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return null;
      var n = parseFloat(t);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function sortedMarks(marks) {
    var out = [];
    for (var i = 0; i < marks.length; i++) {
      var n = toNumber(marks[i]);
      if (n !== null) out.push(n);
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function sum(values) {
    var total = 0;
    for (var i = 0; i < values.length; i++) total += values[i];
    return total;
  }

  /**
   * Linear-interpolated quantile (the "R type 7" / Excel PERCENTILE.INC
   * definition), which is what spreadsheet users already expect.
   */
  function quantile(sorted, p) {
    var n = sorted.length;
    if (n === 0) return null;
    if (n === 1) return sorted[0];
    var pos = (n - 1) * p;
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function median(sorted) {
    if (sorted.length === 0) return null;
    var mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Sample standard deviation (n-1). Null when fewer than two values. */
  function stdDev(sorted) {
    var n = sorted.length;
    if (n < 2) return null;
    var mean = sum(sorted) / n;
    var acc = 0;
    for (var i = 0; i < n; i++) acc += (sorted[i] - mean) * (sorted[i] - mean);
    return Math.sqrt(acc / (n - 1));
  }

  function describe(marks) {
    var s = sortedMarks(marks || []);
    var n = s.length;
    if (n === 0) {
      return {
        count: 0,
        min: null,
        max: null,
        mean: null,
        median: null,
        stdDev: null,
        q1: null,
        q3: null,
        iqr: null,
        range: null,
        sorted: []
      };
    }
    var mean = sum(s) / n;
    var q1 = quantile(s, 0.25);
    var q3 = quantile(s, 0.75);
    return {
      count: n,
      min: s[0],
      max: s[n - 1],
      mean: mean,
      median: median(s),
      stdDev: stdDev(s),
      q1: q1,
      q3: q3,
      iqr: q3 - q1,
      range: s[n - 1] - s[0],
      sorted: s
    };
  }

  /**
   * Per-mark frequency on the inclusive 0-100 scale.
   * One bin per mark is what makes a cutoff position exact on the chart.
   */
  function histogram(marks) {
    var bins = new Array(101);
    for (var i = 0; i <= 100; i++) bins[i] = 0;
    var counted = 0;
    for (var j = 0; j < marks.length; j++) {
      var m = marks[j];
      if (typeof m === "number" && isFinite(m) && m >= 0 && m <= 100) {
        bins[Math.round(m)]++;
        counted++;
      }
    }
    var peak = 0;
    for (var k = 0; k < bins.length; k++) if (bins[k] > peak) peak = bins[k];
    return { bins: bins, peak: peak, counted: counted };
  }

  /**
   * Detect contiguous clusters of marks separated by a gap of at least
   * `minGap` marks. Purely descriptive: it tells the instructor where the
   * class actually separates, without choosing boundaries for them.
   */
  function clusters(marks, minGap) {
    var s = sortedMarks(marks);
    if (s.length === 0) return [];
    var gap = minGap || 6;
    var groups = [];
    var start = 0;
    for (var i = 1; i < s.length; i++) {
      if (s[i] - s[i - 1] > gap) {
        groups.push({ min: s[start], max: s[i - 1], count: i - start });
        start = i;
      }
    }
    groups.push({ min: s[start], max: s[s.length - 1], count: s.length - start });
    return groups;
  }

  /**
   * "Nice" axis maximum so gridlines land on round numbers.
   * Without this a class of 1 student produces a y-axis labelled 1 and a chart
   * with a full-height single bar - mathematically true, visually useless.
   */
  function niceMax(peak) {
    if (!isFinite(peak) || peak <= 0) return 1;
    if (peak <= 4) return Math.max(1, Math.ceil(peak));
    var mag = Math.pow(10, Math.floor(Math.log10(peak)));
    var norm = peak / mag;
    return niceStep(norm) * mag;
  }

  /** Round a normalised magnitude up to a readable axis maximum. */
  function niceStep(norm) {
    if (norm <= 1) return 1;
    if (norm <= 1.5) return 1.5;
    if (norm <= 2) return 2;
    if (norm <= 2.5) return 2.5;
    if (norm <= 3) return 3;
    if (norm <= 4) return 4;
    if (norm <= 5) return 5;
    return 10;
  }

  /** Number of gridlines that reads well at any class size. */
  function axisTicks(peak) {
    var top = niceMax(peak);
    // Student counts are whole numbers: a 0.5 gridline is meaningless.
    if (top <= 4) {
      var whole = [];
      for (var w = 0; w <= top; w++) whole.push(w);
      return { top: top, ticks: whole };
    }
    var raw = top / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var step = Math.max(1, niceStep(raw / mag) * mag);
    var ticks = [];
    for (var v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { top: top, ticks: ticks };
  }

  CF.statistics = {
    toNumber: toNumber,
    sortedMarks: sortedMarks,
    sum: sum,
    quantile: quantile,
    median: median,
    stdDev: stdDev,
    describe: describe,
    histogram: histogram,
    clusters: clusters,
    niceMax: niceMax,
    axisTicks: axisTicks
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
