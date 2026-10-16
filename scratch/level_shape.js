import { loadProgression } from '../lib/blueprints.js';

const p = loadProgression();
const L = p.progression_per_level.levels;

console.log('progression_per_level keys:', Object.keys(p.progression_per_level));
console.log('top-level keys:', Object.keys(p));

console.log('\n=== level 1 ===');
console.log(JSON.stringify(L['1'], null, 1).slice(0, 1500));
console.log('\n=== level 13 ===');
console.log(JSON.stringify(L['13'], null, 1).slice(0, 1500));

// any field whose value changes across levels and looks like a cap
const fields = new Set();
for (const v of Object.values(L)) Object.keys(v || {}).forEach((k) => fields.add(k));
console.log('\nfields seen across levels:', [...fields].join(', '));
