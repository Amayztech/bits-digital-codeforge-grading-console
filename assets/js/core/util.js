/**
 * Small pure helpers shared across the console.
 * No DOM access here so this file can be unit tested directly in Node.
 */
(function (root) {
  "use strict";

  var CF = (root.CF = root.CF || {});

  /** Marks are defined by the challenge as whole numbers on a 0-100 scale. */
  var MIN_MARK = 0;
  var MAX_MARK = 100;

  /** Classic half-up rounding (ties away from zero). */
  function roundHalfUp(value) {
    return value < 0 ? -Math.round(-value) : Math.round(value);
  }

  function clamp(value, lo, hi) {
    if (!isFinite(value)) return lo;
    return value < lo ? lo : value > hi ? hi : value;
  }

  /**
   * The challenge's file guidance says fractional marks are "rounded to the
   * nearest integer" but its worked example (80.2 -> 81) contradicts that:
   * 80.2 is closer to 80. Rather than pick silently, both policies are
   * implemented and the instructor chooses. `nearest` is the default because it
   * is what the stated rule says.
   */
  function roundMark(value, policy) {
    if (policy === "up") return Math.ceil(value);
    if (policy === "down") return Math.floor(value);
    return roundHalfUp(value);
  }

  function isBlank(value) {
    return (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    );
  }

  /** Case- and whitespace-insensitive key used to match workbook headers. */
  function headerKey(value) {
    if (isBlank(value)) return "";
    return String(value)
      .replace(/\u00a0/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-]+/g, " ")
      .replace(/\s*\(\s*out of 100\s*\)\s*$/i, "")
      .replace(/\s+/g, " ");
  }

  /** Collapses internal whitespace and case so course variants group together. */
  function nameKey(value) {
    if (isBlank(value)) return "";
    return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** First-seen display form of a name, used for course labels and export. */
  function tidyName(value) {
    return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  var PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

  /**
   * RFC 4180 field escaping.
   * Also neutralises spreadsheet formula injection: a marks file is untrusted
   * input and these CSVs are opened in Excel, where "=..." in a cell executes.
   * Plain numbers are never prefixed, so a negative or decimal mark stays a
   * number in the spreadsheet.
   */
  function csvField(value) {
    var s = value === null || value === undefined ? "" : String(value);
    if (s === "") return '""';
    if (!PLAIN_NUMBER.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRow(values) {
    return values.map(csvField).join(",");
  }

  /** Filesystem-safe, human-readable file name fragment. */
  function slugify(value, maxLength) {
    var s = tidyName(value)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/[^\p{L}\p{N}._-]+/gu, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "");
    if (s.length > (maxLength || 48)) s = s.slice(0, maxLength || 48).replace(/-+$/, "");
    return s || "course";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** ISO-like local timestamp for file names: 2026-09-26-1432 */
  function stamp(date) {
    var d = date || new Date();
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      "-" +
      pad2(d.getHours()) +
      pad2(d.getMinutes())
    );
  }

  /** Human timestamp for reports: 26 Sep 2026, 14:32 */
  function humanStamp(date) {
    var d = date || new Date();
    var months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    return (
      pad2(d.getDate()) +
      " " +
      months[d.getMonth()] +
      " " +
      d.getFullYear() +
      ", " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + "h " + pad2(m) + "m";
    if (m > 0) return m + "m " + pad2(s) + "s";
    return s + "s";
  }

  function formatBytes(bytes) {
    if (!isFinite(bytes) || bytes < 0) return "unknown size";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /** Percentage that never renders "NaN%" or "-0%". */
  function percent(part, whole) {
    if (!whole) return 0;
    var v = (part / whole) * 100;
    if (!isFinite(v)) return 0;
    return v;
  }

  function pluralise(n, one, many) {
    return n === 1 ? one : many || one + "s";
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function byKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return null;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Stable unique list preserving first-seen order. */
  function uniqueBy(list, keyFn) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var k = keyFn(list[i]);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(list[i]);
    }
    return out;
  }

  CF.util = {
    MIN_MARK: MIN_MARK,
    MAX_MARK: MAX_MARK,
    clamp: clamp,
    roundHalfUp: roundHalfUp,
    roundMark: roundMark,
    isBlank: isBlank,
    headerKey: headerKey,
    nameKey: nameKey,
    tidyName: tidyName,
    csvField: csvField,
    csvRow: csvRow,
    slugify: slugify,
    pad2: pad2,
    stamp: stamp,
    humanStamp: humanStamp,
    formatDuration: formatDuration,
    formatBytes: formatBytes,
    percent: percent,
    pluralise: pluralise,
    byId: byId,
    byKey: byKey,
    deepEqual: deepEqual,
    uniqueBy: uniqueBy
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
