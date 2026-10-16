// scratch/dump_crates2.js - show only the silver crate + keys, compact reward shape.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
for (const m of Object.values(models)) {
  if (!m.key.startsWith('TilesStateModel')) continue;
  const st = m.json?.data?.state;
  if (!st || !st.blueprint) continue;
  if (!/key_silver|key_bronze|_silver$/.test(st.blueprint)) continue;
  const d = st.data || {};
  console.log(`\n=== ${m.key}  ${st.blueprint}  (state field of tile) ===`);
  console.log('  top keys :', Object.keys(st).join(', '));
  console.log('  data keys:', Object.keys(d).join(', '));
  if (d.cooldown) console.log('  cooldown :', JSON.stringify(d.cooldown));
  if (d.crateReward) {
    console.log('  level    :', d.crateReward.crateRewardLevel);
    console.log('  rewards  :', JSON.stringify(d.crateReward.rewards));
    console.log('  contentN :', d.crateReward.crateRewardContent?.length);
    console.log('  other    :', Object.keys(d.crateReward).join(', '));
  }
  if (st.mergeable) console.log('  mergeable:', JSON.stringify(st.mergeable));
}
