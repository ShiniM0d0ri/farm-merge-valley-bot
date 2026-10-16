// scratch/harvest_table.js - the full harvestReward table + the live PseudoRandomness contexts,
// so the loot roll can be reproduced distribution-faithfully.
import fs from 'node:fs';
import { resolveBlueprint } from '../lib/blueprints.js';

const CFG = process.env.FMV_CFG || './config/blueprints_jsonpack.json';
const bps = JSON.parse(fs.readFileSync(CFG, 'utf8'));

const names = process.argv.length > 2 ? process.argv.slice(2) : ['chicken_4', 'cow_4', 'wheat_4', 'carrot_4', 'sugarcane_4', 'goat_4'];
for (const n of names) {
  const bp = resolveBlueprint(bps, n);
  const h = bp?.harvestable;
  if (!h) { console.log(`\n### ${n}: no harvestable`); continue; }
  console.log(`\n### ${n}  harvests=${h.harvests} duration=${h.duration} depleted=${h.depleted} slots=${h.harvestReward.length}`);
  h.harvestReward.forEach((slot, i) => {
    console.log(`  slot ${i}: chance=${slot.chance}  ${slot.items.map((it) => `${it.key}(w${it.weight}${it.unsuccessfulAttemptsThreshhold !== undefined ? `,thr${it.unsuccessfulAttemptsThreshhold},inc${it.increaseWeightAmount}` : ''}${it.cooldownDuration !== undefined ? `,cd${it.cooldownDuration}` : ''})`).join(' ')}`);
  });
  console.log(`  other keys: ${Object.keys(h).filter((k) => !['harvests', 'duration', 'depleted', 'harvestReward', 'sprite'].includes(k)).join(', ')}`);
}

const STATE = process.env.FMV_STATE || 'state.json';
if (fs.existsSync(STATE)) {
  const models = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const pr = models.PseudoRandomnessModel?.json?.data;
  console.log('\n=== live PseudoRandomnessModel ===');
  console.log(JSON.stringify(pr, null, 1)?.slice(0, 2000));
}
