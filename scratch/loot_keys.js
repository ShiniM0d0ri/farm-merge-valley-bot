import fs from 'node:fs';
import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';
const bps = loadBlueprints();
const keys = ['egg', 'milk', 'goatmilk', 'wheat', 'carrot', 'sugarcane', 'upgrade_card_1', 'coin_2', 'wheat_1', 'egg_1'];
for (const k of keys) {
  const bp = bps[k] ? resolveBlueprint(bps, k) : null;
  console.log(`${k.padEnd(15)} blueprint=${!!bps[k]}  components=${bp ? Object.keys(bp).join(',') : '-'}`);
}
console.log('\nblueprints starting with egg/milk/goatmilk:', Object.keys(bps).filter((k) => /^(egg|milk|goatmilk)/.test(k)).join(' '));
console.log('wheat*:', Object.keys(bps).filter((k) => /^wheat/.test(k)).join(' '));
console.log('upgrade_card*:', Object.keys(bps).filter((k) => /^upgrade_card/.test(k)).slice(0, 8).join(' '));
console.log('\nmaxTier checks:');
for (const f of ['wheat', 'chicken', 'cow', 'carrot', 'sugarcane', 'goat', 'wood', 'tool']) {
  const tiers = Object.keys(bps).filter((k) => new RegExp(`^${f}_\\d+$`).test(k)).sort();
  console.log(`  ${f}: ${tiers.join(' ')}`);
}
const live = JSON.parse(fs.readFileSync('state.json', 'utf8'));
console.log('\nInventoryModel keys:', Object.keys(live.InventoryModel?.json?.data || {}).join(' '));
