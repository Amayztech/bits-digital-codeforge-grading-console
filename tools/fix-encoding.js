/**
 * Encoding repair utility.
 *
 * A PowerShell round-trip once re-encoded two source files as UTF-8 bytes read
 * through Windows-1252, which turns every non-ASCII character into mojibake.
 * This undoes exactly that transformation and strips any BOM, so the repair is
 * deterministic rather than a hand-written find-and-replace.
 *
 *   node tools/fix-encoding.js <files...>
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Windows-1252 high range, which Node's latin1 encoder does not cover.
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f
};
const REVERSE = new Map(Object.entries(CP1252_HIGH).map(([u, b]) => [Number(u), b]));

/** Undo one round of UTF-8 bytes misread as Windows-1252. */
function repair(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (cp < 0x80) { out.push(cp); i++; continue; }
    if (REVERSE.has(cp)) { out.push(REVERSE.get(cp)); i++; continue; }
    if (cp <= 0xff) { out.push(cp); i++; continue; }
    out.push(...Array.from(text[i]).map((c) => c.codePointAt(0)));
    i++;
  }
  return Buffer.from(out).toString('utf8');
}

const SUSPECT = /[\u00c2\u00e2]/g;
const files = process.argv.slice(2);
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const fixed = repair(raw.replace(/^\uFEFF/, ''));
  const before = (raw.match(SUSPECT) || []).length;
  const after = (fixed.match(SUSPECT) || []).length;
  if (before === 0 && !hadBom) {
    console.log(path.basename(f) + ': already clean');
    continue;
  }
  fs.writeFileSync(f, fixed, 'utf8');
  console.log(
    path.basename(f) +
      ': bom=' + hadBom +
      ' suspicious ' + before + ' -> ' + after +
      ' arrows=' + (fixed.match(/\u2192/g) || []).length +
      ' middots=' + (fixed.match(/\u00b7/g) || []).length
  );
}
