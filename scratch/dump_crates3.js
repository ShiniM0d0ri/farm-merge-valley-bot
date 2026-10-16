// scratch/dump_crates3.js - compact table of every reward-crate / key tile.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const rows = [];
for (const m of Object.values(models)) {
  if (!m.key.startsWith('TilesStateModel')) continue;
  const st = m.json?.data?.state;
  if (!st || !st.blueprint) continue;
  if (!/crate|key/.test(st.blueprint)) continue;
  const d = st.data || {};
  const cr = d.crateReward || {};
  rows.push({
    cell: m.key.replace('TilesStateModel_', ''),
    bp: st.blueprint,
    dataKeys: Object.keys(d).join('|'),
    cd: d.cooldown ? d.cooldown.timerId : '',
    rews: cr.rewards ? cr.rewards.length : '',
    life: cr.crateRewardLifetime ?? '',
    req: cr.crateRewardUnlockRequirement != null ? JSON.stringify(cr.crateRewardUnlockRequirement) : '',
    merge: st.mergeable ? st.mergeable.target : '',
  });
}
rows.sort((a, b) => a.bp.localeCompare(b.bp));
for (const r of rows) console.log(JSON.stringify(r));
