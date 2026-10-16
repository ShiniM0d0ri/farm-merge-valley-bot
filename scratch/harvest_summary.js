import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';

const bps = loadBlueprints();
const ids = Object.keys(bps).filter((id) => {
  if (/^base_/.test(id) || /_moveable$/.test(id) || /_test$/.test(id)) return false;
  return !!resolveBlueprint(bps, id).harvestable;
});

const rows = [];
for (const id of ids) {
  const h = resolveBlueprint(bps, id).harvestable;
  const stages = h.harvestReward || [];
  const keys = new Set();
  stages.forEach((st) => st.forEach((d) => d.items.forEach((i) => keys.add(i.key))));
  rows.push({
    id,
    harvests: h.harvests,
    duration: h.duration,
    drops: stages.map((st) => st.length).join('/'),
    rewardKeys: [...keys].join(','),
    remove: JSON.stringify(h.removeReward),
  });
}

const w = (s, n) => String(s).padEnd(n);
console.log(w('blueprint', 26) + w('harv', 5) + w('dur(s)', 7) + w('drops', 9) + w('remove', 10) + 'rewardKeys');
for (const r of rows) {
  console.log(w(r.id, 26) + w(r.harvests, 5) + w(r.duration, 7) + w(r.drops, 9) + w(r.remove, 10) + r.rewardKeys);
}
console.log(`\n${rows.length} harvestable blueprints; ${rows.filter((r) => /_4$/.test(r.id)).length} end in _4.`);
