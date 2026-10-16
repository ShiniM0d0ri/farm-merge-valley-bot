import fs from 'node:fs';
import path from 'node:path';

const DIR = './config';
const RE = /regen|refill|restore|maxenergy|maxcrate|max_energy|max_crates|capacity|autofill/i;

function walk(node, p, out, depth = 0) {
  if (depth > 10 || node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (RE.test(k)) out.push({ path: `${p}.${k}`, value: JSON.stringify(v).slice(0, 160) });
    walk(v, `${p}.${k}`, out, depth + 1);
  }
}

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const out = [];
  walk(j, f, out);
  if (!out.length) continue;
  console.log(`\n##### ${f} (${out.length} hits)`);
  const seen = new Set();
  for (const o of out) {
    const key = o.path.split('.').slice(-2).join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${o.path}\n      = ${o.value}`);
    if (seen.size > 14) break;
  }
}

// energy-related keys in the inventory model definition, if present
const sm = JSON.parse(fs.readFileSync(path.join(DIR, 'state_models_full.json'), 'utf8'));
console.log('\n##### top-level keys of state_models_full.json');
console.log(Object.keys(sm).slice(0, 40).join(', '));
