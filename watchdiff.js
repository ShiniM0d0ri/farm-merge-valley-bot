// Show every change between consecutive snapshots captured by watch.js.
//   node watchdiff.js            (watch/ dir)
//   node watchdiff.js 000 001    (just those two)
import fs from 'node:fs';
import { deepEqual } from './lib/deep.js';

const dir = 'watch';
const args = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (!files.length) { console.log(`no snapshots in ${dir}/`); process.exit(0); }

const pairs = [];
if (args.length === 2) pairs.push([args[0], args[1]]);
else for (let i = 1; i < files.length; i++) pairs.push([files[i - 1], files[i]]);

const load = (f) => JSON.parse(fs.readFileSync(`${dir}/${f.replace(/\.json$/, '')}.json`, 'utf8'));
const J = (m) => (m ? m.json : undefined);
const short = (s, n = 500) => {
  const t = s === undefined ? '(absent)' : JSON.stringify(s);
  return t.length > n ? t.slice(0, n) + ` …(+${t.length - n})` : t;
};

for (const [a, b] of pairs) {
  const A = load(a), B = load(b);
  console.log(`\n======== ${a} -> ${b} ========`);
  let n = 0;
  for (const k of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
    const av = J(A[k]), bv = J(B[k]);
    if (deepEqual(av, bv)) continue;
    n++;
    console.log(`\n  * ${k}`);
    if (av === undefined) console.log(`      NEW: ${short(bv)}`);
    else if (bv === undefined) console.log(`      REMOVED: ${short(av)}`);
    else console.log(`      - ${short(av)}\n      + ${short(bv)}`);
  }
  if (!n) console.log('  (no changes)');
}
