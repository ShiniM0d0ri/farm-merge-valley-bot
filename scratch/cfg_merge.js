import '../lib/env.js';
// scratch/cfg_merge.js - hunt for a global merge rule (merge amount / 5-merge bonus) in the configs.
import fs from 'node:fs';

const DIR = process.env.FMV_CFG || './config';
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const txt = fs.readFileSync(`${DIR}/${f}`, 'utf8');
  const keys = [...txt.matchAll(/"([A-Za-z_]*(?:merge|Merge)[A-Za-z_]*)"/g)].map((m) => m[1]);
  const uniq = [...new Set(keys)];
  if (uniq.length) console.log(`${f}: ${uniq.slice(0, 40).join(', ')}`);
}

// top-level keys of the general config
const cfg = JSON.parse(fs.readFileSync(`${DIR}/config_jsonpack.json`, 'utf8'));
console.log('\nconfig_jsonpack.json top-level keys:');
console.log(Object.keys(cfg).join(', '));
for (const [k, v] of Object.entries(cfg)) {
  const s = JSON.stringify(v);
  if (s && s.length < 300) console.log(`  ${k} = ${s}`);
  else console.log(`  ${k} = <${s?.length ?? 0} bytes>`);
}
