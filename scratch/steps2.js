import fs from 'node:fs';
const dir = './config/';
const j = JSON.parse(fs.readFileSync(dir + 'blueprints_jsonpack.json', 'utf8'));

const base = (id) => {
  const chain = [];
  const seen = new Set();
  let cur = j[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    cur = cur.extends ? j[cur.extends] : null;
  }
  const merged = {};
  for (const cid of [...chain].reverse()) Object.assign(merged, j[cid].components || {});
  return { merged, chain };
};

for (const id of ['rock_small', 'rock_medium', 'rock_large', 'tree_small', 'tree_medium', 'tree_large', 'toolbox_small', 'toolbox_medium', 'toolbox_large']) {
  if (!j[id]) { console.log(`\n${id}: MISSING`); continue; }
  const { merged, chain } = base(id);
  const steps = merged.mapSource?.steps;
  console.log(`\n===== ${id}   chain: ${chain.join(' -> ')}   mapSource.type=${merged.mapSource?.type} =====`);
  if (!steps) { console.log('  (no steps)'); continue; }
  for (const [k, s] of Object.entries(steps)) {
    console.log(`  step ${k}: cost=${s.cost} duration=${s.duration}  rewards=${JSON.stringify(s.rewards)}`);
  }
}
