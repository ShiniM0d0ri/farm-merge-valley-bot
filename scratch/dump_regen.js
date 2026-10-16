import fs from 'node:fs';

const sm = JSON.parse(fs.readFileSync('./config/state_models_full.json', 'utf8'));

console.log('=== RegenerationServiceModel ===');
console.log(JSON.stringify(sm.RegenerationServiceModel, null, 1));

const names = Object.keys(sm).filter((k) => !/^TilesStateModel_/.test(k));
console.log(`\n=== non-tile models (${names.length}) ===`);
console.log(names.join('\n'));

console.log('\n=== models mentioning both a numeric max and crates/energy ===');
for (const n of names) {
  const t = JSON.stringify(sm[n]);
  if (/max/i.test(t) && /(crates|energy)/i.test(t)) {
    console.log(`\n--- ${n} ---`);
    console.log(t.slice(0, 900));
  }
}
