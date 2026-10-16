import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const dir = './config/';
const cr = JSON.parse(fs.readFileSync(dir + 'controlled_randomness_jsonpack.json', 'utf8'));
console.log('===== controlled_randomness_crate_config =====');
console.log(JSON.stringify(cr.controlled_randomness_crate_config, null, 1).slice(0, 2500));

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const pr = models.PseudoRandomnessModel?.json?.data?.data || [];
console.log(`\n===== PseudoRandomnessModel: ${pr.length} contexts =====`);
for (const c of pr) console.log(`  context=${c.context}  items=${c.items?.length}`);

const crateCtx = pr.find((c) => /crate/i.test(String(c.context)));
if (crateCtx) {
  console.log('\n-- crate context sample --');
  console.log(JSON.stringify(crateCtx, null, 1).slice(0, 900));
}

console.log('\n===== CrateContentModel =====');
console.log(JSON.stringify(models.CrateContentModel?.json, null, 1).slice(0, 600));

console.log('\n===== DailyChallengeModel =====');
console.log(JSON.stringify(models.DailyChallengeModel?.json, null, 1).slice(0, 900));

const inv = models.InventoryModel?.json?.data;
console.log(`\ncrates=${inv?.crates}`);
const crateBp = JSON.parse(fs.readFileSync(dir + 'blueprints_jsonpack.json', 'utf8')).crate;
console.log('\n===== blueprint "crate" =====');
console.log(JSON.stringify(crateBp, null, 1).slice(0, 900));
