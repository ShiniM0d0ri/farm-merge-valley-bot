import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const dir = './config/';
const cr = JSON.parse(fs.readFileSync(dir + 'controlled_randomness_jsonpack.json', 'utf8'));
for (const k of Object.keys(cr)) {
  if (!/item_tier|crate/i.test(k)) continue;
  console.log(`\n===== ${k} =====`);
  console.log(JSON.stringify(cr[k]).slice(0, 1400));
}

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const pr = models.PseudoRandomnessModel?.json?.data?.data || [];
for (const name of ['crateItemContent', 'crateItemContentObject', 'crateItemContentRewardCrate', 'crateItemContentCrateKey']) {
  const c = pr.find((x) => x.context === name);
  console.log(`\n===== live ${name} =====`);
  console.log(JSON.stringify(c));
}
