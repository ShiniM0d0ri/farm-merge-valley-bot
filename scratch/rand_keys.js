import { loadRandomness } from '../lib/crates.js';

const r = loadRandomness();
console.log('top-level keys:');
for (const k of Object.keys(r)) console.log('  ' + k);

const show = (k) => {
  console.log(`\n===== ${k} =====`);
  console.log(JSON.stringify(r[k], null, 1).slice(0, 1200));
};
for (const k of Object.keys(r)) {
  if (/family|object|tier|item/i.test(k)) show(k);
}
