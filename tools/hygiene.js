/**
 * Static hygiene check.
 *   node tools/hygiene.js
 *
 * Scope: the shipped application (index.html and assets/). The supplied starter
 * is deliberately excluded - it is evidence, and the point of BUG_FIX_LOG.md is
 * that it contains these problems.
 *
 * Checks: dead exports, unresolved markers, raw-HTML sinks, dynamic code
 * execution, native dialogs, console noise, outbound network references, and
 * source encoding. This keeps the "no dead code, no console noise, no unexpected
 * requests" claims honest as the project grows.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

function walk(dir, out, filter) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out, filter);
    else if (filter(name)) out.push(full);
  }
  return out;
}

const sourceFilter = (n) => /\.(js|css|html|md|json)$/.test(n);

/** Everything in the repository that could legitimately use an export. */
const allSource = walk(ROOT, [], sourceFilter)
  .filter((f) => !/(node_modules|vendor|artifacts)/.test(f))
  .map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));
const everything = allSource.map((s) => s.text).join('\n');

/** Only the code that actually ships to the browser. */
const appFiles = [
  ...walk(path.join(ROOT, 'assets'), [], sourceFilter),
  path.join(ROOT, 'index.html')
].map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));

const findings = [];
const add = (kind, where, detail) => findings.push({ kind, where, detail });

/* --- 1. Dead exports ---------------------------------------------------- */
// An export is dead only if nothing at all references it. Internal use of a
// helper is fine; the check exists to catch genuinely unreachable API surface.
const CORE = ['util', 'statistics', 'grading', 'workbook', 'exporters', 'suggest'];
for (const mod of CORE) {
  const file = path.join(ROOT, 'assets', 'js', 'core', mod + '.js');
  const text = fs.readFileSync(file, 'utf8');
  const block = text.match(new RegExp('CF\\.' + mod + ' = \\{([\\s\\S]*?)\\n  \\};'));
  if (!block) {
    add('structure', rel(file), 'could not locate the export block');
    continue;
  }
  const names = block[1]
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter((s) => /^[A-Za-z_]\w*$/.test(s));
  for (const n of names) {
    // Reachable means: used as a property somewhere, or called somewhere other
    // than its own declaration. `function NAME(` and `NAME: NAME,` in the
    // export block do not count as uses.
    const asProperty = (everything.match(new RegExp('\\.\\s*' + n + '\\b', 'g')) || []).length;
    const asCall = (everything.match(new RegExp('\\b' + n + '\\s*\\(', 'g')) || []).length;
    const declared = (text.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length;
    if (asProperty === 0 && asCall - declared <= 0) {
      add('unreachable export', rel(file), n);
    }
  }
}

/* --- 2. Noise, sinks and native dialogs in shipped code ----------------- */
const NOISE = [
  [/console\s*\.\s*(log|debug|info|warn|trace)\s*\(/, 'console call'],
  [/\bdebugger\b/, 'debugger statement'],
  [/\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/, 'unresolved marker'],
  [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\s*\.\s*write/, 'raw HTML sink'],
  [/\beval\s*\(|new\s+Function\s*\(/, 'dynamic code execution'],
  [/(?<![\w.])(window\s*\.\s*)?alert\s*\(/, 'native alert'],
  [/(?<![\w.])(window\s*\.\s*)?confirm\s*\(/, 'native confirm'],
  [/(?<![\w.])(window\s*\.\s*)?prompt\s*\(/, 'native prompt']
];
for (const s of appFiles) {
  const lines = s.text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // documentation, not code
    for (const [re, label] of NOISE) {
      if (re.test(line)) add(label, rel(s.file) + ':' + (i + 1), line.trim().slice(0, 96));
    }
  });
}

/* --- 3. Outbound network references ------------------------------------- */
for (const s of appFiles) {
  s.text.split('\n').forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
    const urls = line.match(/["'(](https?:\/\/[^"')\s]+)/g) || [];
    for (const url of urls) {
      if (/w3\.org|schemas\.|localhost/.test(url)) continue;
      add('outbound URL', rel(s.file) + ':' + (i + 1), url);
    }
  });
}

/* --- 4. Source encoding and shape ---------------------------------------- */
for (const s of appFiles) {
  if (s.text.charCodeAt(0) === 0xfeff) add('encoding', rel(s.file), 'UTF-8 BOM at the start of the file');
  if (/[\u00c2\u00e2]/.test(s.text)) add('encoding', rel(s.file), 'possible mojibake');
  if (/\r\n/.test(s.text)) add('line endings', rel(s.file), 'CRLF');
  const long = s.text.split('\n').filter((l) => l.length > 320);
  if (long.length) add('long line', rel(s.file), long.length + ' line(s) over 320 characters');
}

/* --- 5. The starter must stay untouched --------------------------------- */
const STARTER = path.join(ROOT, 'starter-reference', 'BITS_Digital_CodeForge_Challenge.ORIGINAL.html');
const ORIGINAL = path.join(ROOT, 'BITS_Digital_CodeForge_Challenge.html');
if (!fs.existsSync(STARTER)) add('evidence', 'starter-reference', 'the original starter copy is missing');
if (!fs.existsSync(ORIGINAL)) add('evidence', 'BITS_Digital_CodeForge_Challenge.html', 'the supplied brief/starter file is missing');
if (fs.existsSync(STARTER) && fs.existsSync(ORIGINAL)) {
  const a = fs.readFileSync(STARTER, 'utf8').replace(/\r\n/g, '\n');
  const b = fs.readFileSync(ORIGINAL, 'utf8').replace(/\r\n/g, '\n');
  if (a !== b) add('evidence', 'starter-reference', 'the preserved copy no longer matches the supplied file');
}

/* --- Report -------------------------------------------------------------- */
if (!findings.length) {
  console.log('hygiene: clean');
  console.log('  ' + appFiles.length + ' shipped files scanned');
  console.log('  ' + allSource.length + ' source files scanned for dead exports');
  process.exit(0);
}
const byKind = new Map();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}
for (const [kind, items] of byKind) {
  console.log('\n' + kind + ' (' + items.length + ')');
  items.slice(0, 30).forEach((i) => console.log('  ' + i.where + '  ' + i.detail));
  if (items.length > 30) console.log('  ... and ' + (items.length - 30) + ' more');
}
console.log('\n' + findings.length + ' finding(s)');
process.exit(1);
