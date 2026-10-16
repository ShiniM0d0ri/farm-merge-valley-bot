import '../lib/env.js';
// scratch/har_model.js - replay the decoded saves and print a model's final JSON (pretty),
// optionally showing every change.
//
//   FMV_IN=har_saves_levelup.json node scratch/har_model.js DailyChallengeModel
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const names = process.argv.slice(2).map((s) => s.toLowerCase());
if (!names.length) { console.log('usage: node har_model.js <ModelName> [ModelName...]'); process.exit(1); }

const state = {};
const history = new Map();

for (const s of saves) {
  for (const [k, m] of Object.entries(s.models)) {
    if (JSON.stringify(state[k]) === JSON.stringify(m)) continue;
    state[k] = m;
    if (!history.has(k)) history.set(k, []);
    history.get(k).push({ seq: s.seq, t: s.t, json: m.json });
  }
}

for (const want of names) {
  const key = Object.keys(state).find((k) => k.toLowerCase() === want) ||
    Object.keys(state).find((k) => k.toLowerCase().includes(want));
  if (!key) { console.log(`\n### ${want}: NOT PRESENT`); continue; }
  const h = history.get(key) || [];
  console.log(`\n### ${key}  (${h.length} distinct version(s))`);
  console.log(JSON.stringify(state[key].json, null, 2));
  if (process.env.FMV_HIST) {
    console.log(`\n--- history ---`);
    h.forEach((e) => console.log(`[save ${e.seq}] ${JSON.stringify(e.json).slice(0, 600)}`));
  }
}
