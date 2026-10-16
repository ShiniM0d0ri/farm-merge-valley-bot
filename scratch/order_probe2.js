import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const dir = './config/';
const rec = JSON.parse(fs.readFileSync(dir + 'recipes_jsonpack.json', 'utf8'));
const bld = JSON.parse(fs.readFileSync(dir + 'buildings_jsonpack.json', 'utf8'));

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const inv = models.InventoryModel?.json?.data || {};

console.log('===== OrdersModel =====');
for (const s of models.OrdersModel?.json?.data || []) console.log('  ' + JSON.stringify(s));
console.log('\n===== BuildingsModel =====');
console.log('  ' + JSON.stringify(models.BuildingsModel?.json?.data?.buildings));

const workshops = Object.entries(bld)
  .filter(([k, v]) => k.endsWith('_config') && v?.isWorkshop)
  .map(([, v]) => v);
console.log(`\n${workshops.length} workshops: ${workshops.map((w) => w.ID).join(', ')}`);

const have = (key) => (typeof inv[key] === 'number' ? inv[key] : 0);
console.log('\ncraftable recipes (ingredients already in inventory):');
let any = false;
for (const w of workshops) {
  for (const rid of w.availableRecipes || []) {
    const r = rec[rid];
    if (!r) continue;
    const missing = (r.ingredients || []).filter((i) => have(i.key) < i.amount);
    if (missing.length) continue;
    any = true;
    console.log(
      `  ${w.ID.padEnd(10)} ${rid.padEnd(32)} dur=${String(r.duration).padStart(5)}s` +
        `  cost=${r.ingredients.map((i) => `${i.amount} ${i.key}`).join(' + ')}` +
        `  -> ${r.reward.join(', ')}`
    );
  }
}
if (!any) console.log('  (none)');

console.log('\ningredients on hand:');
for (const k of Object.keys(inv).sort()) {
  if (['exp', 'level', 'coins', 'gems', 'crates', 'energy'].includes(k)) continue;
  if (typeof inv[k] !== 'number' || inv[k] === 0) continue;
  console.log(`  ${k}: ${inv[k]}`);
}
