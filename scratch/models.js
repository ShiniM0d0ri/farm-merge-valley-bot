// scratch/models.js - list model keys + which look like timers.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const keys = Object.keys(models);
const prefix = (k) => (k.includes('_') ? k.replace(/_\d+.*$/, '') : k);
const counts = {};
for (const k of keys) counts[prefix(k)] = (counts[prefix(k)] || 0) + 1;
console.log('distinct prefixes:');
for (const [p, n] of Object.entries(counts).sort()) console.log(`  ${p} x${n}`);

console.log('\ntimer-ish models:');
for (const k of keys) {
  if (/timer/i.test(k)) console.log(`  ${k}: ${JSON.stringify(models[k].json?.data)}`);
}
