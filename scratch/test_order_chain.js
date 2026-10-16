// scratch/test_order_chain.js - prove completion+collection land in ONE save.
// Builds a models object with a COOKED (timer-elapsed) state-2 order and asserts a single
// buildOrderUpdates call completes AND collects it.
import { buildOrderUpdates, loadRecipes, loadBuildings } from '../lib/orders.js';
import { loadBlueprints } from '../lib/blueprints.js';

const bps = loadBlueprints();
const recipes = loadRecipes();
const buildings = loadBuildings();

const now = Date.now();
const models = {
  OrdersModel: { key: 'OrdersModel', json: { data: [{ state: 2, recipe: 'recipe_milk', buildingID: 'market', timerId: 999 }], version: 1 } },
  TimerModel: { key: 'TimerModel', json: { data: { timers: [{ id: 999, label: 'Order_market', state: 'ACTIVE', started: now - 120000, duration: 60000, timeSource: 'server' }], nextTimerId: 1000 }, version: 1 } },
  InventoryModel: { key: 'InventoryModel', json: { data: { milk: 0, coins: 0 }, version: 1 } },
  BuildingsModel: { key: 'BuildingsModel', json: { data: { buildings: { market: { level: 1, state: 2 } } }, version: 1 } },
  'TilesStateModel_70:70': { key: 'TilesStateModel_70:70', json: { data: { state: null }, version: 1 } },
};

const r = buildOrderUpdates(models, { bps, recipes, buildings, timerData: models.TimerModel.json.data, blocked: new Set(), now });

console.log('completed =', r.completed);
console.log('collected =', r.collected);
console.log('summaries =', JSON.stringify(r.summaries, null, 0));
console.log('orders now =', JSON.stringify(r.updates.get('OrdersModel')?.data));
console.log('buildings  =', JSON.stringify(r.updates.get('BuildingsModel')?.data));
console.log('timers     =', JSON.stringify(r.timerData?.timers));

const ok =
  r.completed === 1 &&
  r.collected === 1 &&
  Array.isArray(r.updates.get('OrdersModel')?.data) &&
  r.updates.get('OrdersModel').data.length === 0 &&
  r.updates.get('BuildingsModel')?.data?.buildings?.market?.cooldownTimerID !== undefined &&
  (r.timerData?.timers || []).some((t) => t.label === 'Cooldown_market') &&
  !(r.timerData?.timers || []).some((t) => t.label === 'Order_market');

console.log('\nCHAIN IN ONE SAVE:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
