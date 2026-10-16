import { loadBlueprints, loadProgression, unlockedFamilies, splitTier, maxTier, isMaxTier } from '../lib/blueprints.js';
import { loadRandomness, objectPool, OBJECT_FAMILIES, drawCrate } from '../lib/crates.js';

const bps = loadBlueprints();
const prog = loadProgression();
const rnd = loadRandomness();

const at = (lvl) => unlockedFamilies(prog, lvl, bps);
const fams13 = at(13);
console.log('unlockedFamilies(L13) =', fams13.join(','));
console.log('OBJECT_FAMILIES       =', OBJECT_FAMILIES.join(','));
console.log('match:', JSON.stringify(fams13) === JSON.stringify(OBJECT_FAMILIES), '\n');

for (const lvl of [1, 13, 14, 17, 30, 60, 120, 130]) {
  const pool = objectPool(rnd, { bps, progression: prog, level: lvl });
  const tiers = [...new Set(pool.map((p) => splitTier(p.key).tier))].sort();
  console.log(`L${String(lvl).padStart(3)}  families=${String(at(lvl).length).padStart(2)}  pool=${String(pool.length).padStart(3)}  tiers=${tiers.join(',')}`);
}

console.log('\n=== tier helpers ===');
for (const id of ['wheat_1', 'wheat_4', 'chicken_2', 'golden_christmas_tree_4', 'reward_crate_gold', 'tile_x']) {
  console.log(`  ${id.padEnd(24)} -> ${JSON.stringify(splitTier(id))}  maxTier=${maxTier(bps, splitTier(id).family)}  isMax=${isMaxTier(bps, id)}`);
}

console.log('\n=== object draw sim (deterministic rng), 30000 each ===');
function sim(level, fn) {
  let s = 12345;
  const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hist = {};
  for (let i = 0; i < 30000; i++) {
    const k = fn(level, rng);
    hist[k] = (hist[k] || 0) + 1;
  }
  return hist;
}
// draw the object pool directly (bypassing the crate's top-level pool) so tier odds show clearly
const direct = (level, rng) => {
  const pool = objectPool(rnd, { bps, progression: prog, level });
  const tot = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng() * tot;
  for (const p of pool) { r -= p.weight; if (r < 0) return p.key; }
  return pool[pool.length - 1].key;
};
for (const lvl of [13, 17]) {
  const h = sim(lvl, direct);
  const byTier = {};
  for (const [k, v] of Object.entries(h)) {
    const t = splitTier(k).tier;
    byTier[t] = (byTier[t] || 0) + v;
  }
  console.log(`L${lvl}: ${(30000 / 111)}% expected on each family`);
  console.log('  by tier:', JSON.stringify(byTier));
  const fams = {};
  for (const [k, v] of Object.entries(h)) { const f = splitTier(k).family; fams[f] = (fams[f] || 0) + v; }
  console.log('  by family:', Object.entries(fams).map(([f, v]) => `${f}:${(v / 300).toFixed(1)}%`).join(' '));
}

// and once through the real crate path, to prove nothing throws
const prData = [{ context: 'crateItemContent', items: [{ key: 'object', cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 0 }] }];
console.log('\ncrate path @L13 ->', drawCrate(rnd, prData, 13, () => 0.5, { bps, progression: prog }));
console.log('crate path @L13 (no opts) ->', drawCrate(rnd, prData, 13, () => 0.5));
