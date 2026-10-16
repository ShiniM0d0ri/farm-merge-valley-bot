import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { tiles } from '../lib/board.js';

let models;
if (process.argv.includes('--local')) {
  const fs = await import('node:fs');
  models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
} else {
  models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
}

console.log('orders:', JSON.stringify(models.OrdersModel?.json?.data, null, 1));

const b = models.BuildingsModel?.json?.data?.buildings || {};
console.log('\nbuildings (workshops):');
for (const id of ['bakery', 'market', 'dairy', 'bbq', 'loom']) {
  if (b[id]) console.log(`  ${id.padEnd(8)} ${JSON.stringify(b[id])}`);
}

const timers = models.TimerModel?.json?.data?.timers || [];
console.log(`\ntimers (nextTimerId=${models.TimerModel?.json?.data?.nextTimerId}):`);
for (const t of timers) {
  if (/^(Order_|Cooldown_|MapSource)/.test(t.label)) {
    console.log(`  ${String(t.id).padStart(5)} ${t.label.padEnd(26)} dur=${t.duration} started=${t.started}`);
  }
}

console.log('\ncoin/energy tiles on the board:');
for (const v of tiles(models).values()) {
  if (v?.blueprint && /^(coin_|energy_)/.test(v.blueprint)) {
    console.log(`  (${v.row},${v.col}) ${v.blueprint} ${JSON.stringify(v.data?.collectable?.reward || [])}`);
  }
}

const inv = models.InventoryModel?.json?.data || {};
console.log(`\ninventory: milk=${inv.milk} coins=${inv.coins} energy=${inv.energy} level=${inv.level} exp=${inv.exp}`);
