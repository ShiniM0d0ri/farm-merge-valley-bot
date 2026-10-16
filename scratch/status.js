// scratch/status.js - print the "engine" models: inventory, regen timers, workers, orders.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const j = (k) => models[k]?.json?.data;

console.log('inventory:', JSON.stringify(j('InventoryModel')));
console.log('regen    :', JSON.stringify(j('RegenerationServiceModel')));
console.log('workers  :', JSON.stringify(j('GameWorkersModel')));
console.log('orders   :', JSON.stringify(j('OrdersModel')));

const tiles = Object.values(models)
  .filter((m) => m.key.startsWith('TilesStateModel'))
  .map((m) => m.json?.data?.state)
  .filter((s) => s && s.blueprint);

const by = {};
for (const t of tiles) (by[t.blueprint] = by[t.blueprint] || []).push(t);
console.log(`\ntiles=${tiles.length} distinct=${Object.keys(by).length}`);
console.log('crate tiles:', Object.keys(by).filter((k) => k.includes('crate')).map((k) => `${k}x${by[k].length}`).join(', ') || '(none)');
console.log('keys:', JSON.stringify(Object.keys(by).filter((k) => k.includes('key'))));
