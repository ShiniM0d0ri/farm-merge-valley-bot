// Order / recipe inspector.
//   node orders.js            live report
//   node orders.js --local    use state.json instead of a live read
//
// Read-only: it reports the slot list and which recipes the current inventory can pay for.
// The write path (start/complete/collect) is in lib/orders.js — see MECHANICS.md §3.
'use strict';
import fs from 'node:fs';
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';

// config loaders live in lib/orders.js so the bot and this reporter share one definition
import { loadRecipes, loadBuildings, RECIPES_PATH, BUILDINGS_PATH } from './lib/orders.js';
export { loadRecipes, loadBuildings, RECIPES_PATH, BUILDINGS_PATH };

export const STATE_LABEL = { 0: 'idle', 1: 'offered', 2: 'cooking', 3: 'finished' };

const COIN_VALUE = { coin_1: 1, coin_2: 3, coin_3: 9, coin_4: 27, coin_5: 81, coin_6: 243 };

/** Recipes whose ingredients are all in the inventory, with a total coin value. */
export function craftableRecipes(inv, recipes, buildings) {
  const have = (k) => (typeof inv[k] === 'number' ? inv[k] : 0);
  const out = [];
  for (const [key, b] of Object.entries(buildings)) {
    if (!key.endsWith('_config') || !b?.isWorkshop) continue;
    for (const rid of b.availableRecipes || []) {
      const r = recipes[rid];
      if (!r) continue;
      const missing = (r.ingredients || []).filter((i) => have(i.key) < i.amount);
      if (missing.length) continue;
      const value = (r.reward || []).reduce((s, k) => s + (COIN_VALUE[k] || 0), 0);
      out.push({ buildingID: b.ID, recipe: rid, duration: r.duration, ingredients: r.ingredients, reward: r.reward, value });
    }
  }
  return out.sort((a, b) => b.value - a.value || a.duration - b.duration);
}

const isMain = process.argv[1] && process.argv[1].endsWith('orders.js');
if (isMain) {
  const models = process.argv.includes('--local')
    ? JSON.parse(fs.readFileSync('state.json', 'utf8'))
    : decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

  const recipes = loadRecipes();
  const buildings = loadBuildings();
  const inv = models.InventoryModel?.json?.data || {};

  console.log('order slots:');
  for (const s of models.OrdersModel?.json?.data || []) {
    const r = recipes[s.recipe];
    console.log(
      `  ${String(STATE_LABEL[s.state] ?? s.state).padEnd(9)} ${(s.buildingID || '?').padEnd(10)} ` +
        `${(s.recipe || '?').padEnd(32)}${r ? `dur=${r.duration}s -> ${r.reward.join(', ')}` : ''}` +
        `${s.timerId !== undefined ? `  timerId=${s.timerId}` : ''}`
    );
  }

  const done = (models.OrdersModel?.json?.data || []).filter((s) => s.state === 3);
  if (done.length) console.log(`\n${done.length} finished order(s) awaiting claim (no write path implemented).`);

  const list = craftableRecipes(inv, recipes, buildings);
  console.log(`\ncraftable now: ${list.length}`);
  for (const c of list) {
    console.log(
      `  ${c.buildingID.padEnd(10)} ${c.recipe.padEnd(30)} ${String(c.duration).padStart(5)}s` +
        `  ${c.ingredients.map((i) => `${i.amount} ${i.key}`).join(' + ').padEnd(30)} -> ${c.reward.join(', ')} (${c.value} coins)`
    );
  }
}
