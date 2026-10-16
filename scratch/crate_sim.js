import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRandomness, drawCrate } from '../lib/crates.js';
import { loadBlueprints, loadProgression } from '../lib/blueprints.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const models = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'state.json'), 'utf8'));
const randomness = loadRandomness();
const bps = loadBlueprints();
const progression = loadProgression();
const level = models.InventoryModel.json.data.level;

const run = (N) => {
  const pr = JSON.parse(JSON.stringify(models.PseudoRandomnessModel.json.data.data));
  const counts = new Map();
  const snaps = {};
  for (let i = 1; i <= N; i++) {
    const bp = drawCrate(randomness, pr, level, Math.random, { bps, progression });
    counts.set(bp, (counts.get(bp) || 0) + 1);
    if (i === 40 || i === 60) {
      const c = pr.find((x) => x.context === 'crateItemContent');
      snaps[i] = JSON.stringify(c.items);
    }
  }
  return { pr, counts, snaps };
};

const { pr, counts, snaps } = run(20000);

// invariant from the live save: an item on cooldown must NOT accumulate misses
for (const [i, s] of Object.entries(snaps)) {
  const key = JSON.parse(s).find((x) => x.key === 'reward_crate_key');
  console.log(`after ${i} draws: reward_crate_key cooldownAmount=${key.cooldownAmount} unsuccesfulAttempts=${key.unsuccesfulAttempts}`);
}

console.log(`\nover 20000 draws:`);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${((v / 20000) * 100).toFixed(3)}%  ${k}`);
}
const c = pr.find((x) => x.context === 'crateItemContent');
console.log('\nfinal crateItemContent:', JSON.stringify(c.items));
