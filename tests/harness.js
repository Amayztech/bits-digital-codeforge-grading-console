/**
 * Zero-dependency test runner.
 * Loads the app's core modules into the current global scope (they attach to
 * globalThis.CF and touch no DOM) so pure logic can be tested in plain Node.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log('\n\x1b[1m' + name + '\x1b[0m');
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    failed++;
    failures.push({ suite: currentSuite, name, error: e });
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    \x1b[31m' + (e && e.message ? e.message : e) + '\x1b[0m');
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + ' but got ' + a);
  }
}

function ok(value, msg) {
  if (!value) throw new Error(msg || 'expected a truthy value, got ' + JSON.stringify(value));
}

function near(actual, expected, tol, msg) {
  tol = tol === undefined ? 1e-9 : tol;
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg ? msg + ': ' : '') + 'expected ~' + expected + ' but got ' + actual);
  }
}

function throws(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new Error(msg || 'expected the call to throw');
}

/** Load the browser core modules plus the vendored SheetJS build. */
function loadApp() {
  const files = [
    'vendor/xlsx.full.min.js',
    'assets/data/demo-class.js',
    'assets/js/core/util.js',
    'assets/js/core/statistics.js',
    'assets/js/core/grading.js',
    'assets/js/core/workbook.js',
    'assets/js/core/exporters.js',
    'assets/js/core/suggest.js'
  ];
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis.CF;
}

function readFixture(name) {
  const p = path.join(ROOT, 'tests', 'fixtures', 'workbooks', name);
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function analyseFixture(CF, name) {
  return CF.workbook.readWorkbook(readFixture(name), CF.XLSX || globalThis.XLSX, { name, size: 1 });
}

module.exports = {
  suite,
  test,
  eq,
  ok,
  near,
  throws,
  loadApp,
  readFixture,
  analyseFixture,
  ROOT,
  summary: function () {
    return { passed, failed, failures };
  }
};
