// Diff two snapshots to learn what a real in-game action persists.
//   node diff.js before after
import fs from 'node:fs';

const [, , aName, bName] = process.argv;
const A = JSON.parse(fs.readFileSync(`snaps/${aName.replace(/[^\w.-]/g, '_')}.json`, 'utf8'));
const B = JSON.parse(fs.readFileSync(`snaps/${bName.replace(/[^\w.-]/g, '_')}.json`, 'utf8'));

const J = (m) => (m ? JSON.stringify(m.json) : undefined);
const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();

function short(s, n = 400) {
  if (s === undefined) return '(absent)';
  return s.length > n ? s.slice(0, n) + ` …(+${s.length - n} chars)` : s;
}

let same = 0;
const added = [], removed = [], changed = [];
for (const k of keys) {
  const a = J(A[k]), b = J(B[k]);
  if (a === b) { same++; continue; }
  if (a === undefined) added.push(k);
  else if (b === undefined) removed.push(k);
  else changed.push(k);
}

console.log(`=== ${aName} -> ${bName} ===`);
console.log(`unchanged ${same} | added ${added.length} | removed ${removed.length} | changed ${changed.length}\n`);

if (added.length) {
  console.log('ADDED:');
  for (const k of added) console.log(`  + ${k}\n      ${short(J(B[k]))}`);
  console.log();
}
if (removed.length) {
  console.log('REMOVED:');
  for (const k of removed) console.log(`  - ${k}`);
  console.log();
}

// For changed models, show which top-level fields differ.
const tileRe = /^TilesStateModel_\d+:\d+$/;
const tilesChanged = changed.filter((k) => tileRe.test(k));
const modelsChanged = changed.filter((k) => !tileRe.test(k));

function fieldDiff(k) {
  const a = A[k]?.json ?? {};
  const b = B[k]?.json ?? {};
  const fk = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const out = [];
  for (const f of fk) {
    const av = JSON.stringify(a[f]), bv = JSON.stringify(b[f]);
    if (av !== bv) out.push({ f, av, bv });
  }
  return out;
}

if (modelsChanged.length) {
  console.log(`CHANGED models (${modelsChanged.length}):`);
  for (const k of modelsChanged) {
    console.log(`\n  * ${k}`);
    for (const { f, av, bv } of fieldDiff(k)) {
      console.log(`      ${f}: ${short(av, 260)}`);
      console.log(`      ${' '.repeat(f.length)}  -> ${short(bv, 260)}`);
    }
  }
  console.log();
}

if (tilesChanged.length) {
  console.log(`CHANGED tiles (${tilesChanged.length}):`);
  for (const k of tilesChanged) {
    const a = A[k]?.json?.data?.state;
    const b = B[k]?.json?.data?.state;
    console.log(`\n  * ${k}`);
    console.log(`      before: ${short(JSON.stringify(a), 300)}`);
    console.log(`      after : ${short(JSON.stringify(b), 300)}`);
  }
}
