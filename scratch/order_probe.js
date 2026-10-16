import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const dir = './config/';
const rec = JSON.parse(fs.readFileSync(dir + 'recipes_jsonpack.json', 'utf8'));
console.log('recipes top-level keys:', Object.keys(rec).slice(0, 6).join(', '));
const rk = Object.keys(rec);
console.log(`\n${rk.length} recipes. first 5:`);
for (const k of rk.slice(0, 5)) console.log(`  ${k}: ${JSON.stringify(rec[k])}`);

const bld = JSON.parse(fs.readFileSync(dir + 'buildings_jsonpack.json', 'utf8'));
console.log('\nbuildings keys:', Object.keys(bld).length, '|', Object.keys(bld).slice(0, 8).join(', '));
console.log('buildings_index:', JSON.stringify(bld.buildings_index).slice(0, 700));
for (const k of ['dairy_config', 'bakery_config', 'bbq_config', 'market_config']) {
  console.log(`\n===== ${k} =====`);
  console.log(JSON.stringify(bld[k], null, 1).slice(0, 1400));
}

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
console.log('\n===== live OrdersModel =====');
console.log(JSON.stringify(models.OrdersModel?.json, null, 1));
console.log('\n===== live BuildingsModel =====');
console.log(JSON.stringify(models.BuildingsModel?.json, null, 1));
const inv = models.InventoryModel?.json?.data;
console.log('\ninventory:', JSON.stringify(inv));
