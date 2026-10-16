// Blueprint config: resolve `extends` chains and extract the persisted state subset.
'use strict';
import fs from 'node:fs';
import { cfgPath } from './env.js';

export const BLUEPRINTS_PATH =
  process.env.FMV_BLUEPRINTS || cfgPath('blueprints_jsonpack.json');

export const PROGRESSION_PATH =
  process.env.FMV_PROGRESSION || cfgPath('progression_jsonpack.json');

// Component keys that the game serialises into tile.state.data.
export const PERSISTED_KEYS = [
  'mergeable', 'collectable', 'currency', 'lootable', 'depleted',
  'hitpoints', 'resourceGate', 'cooldown', 'crateReward', 'upgradeCard',
];

export function loadBlueprints(path = BLUEPRINTS_PATH) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function loadProgression(path = PROGRESSION_PATH) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/** Resolve a blueprint's components, following `extends`. */
export function resolveBlueprint(bps, id, depth = 0) {
  const b = bps[id];
  if (!b || depth > 12) return {};
  const base = b.extends ? resolveBlueprint(bps, b.extends, depth + 1) : {};
  return { ...base, ...(b.components || {}) };
}

/** The persisted subset of a resolved component map. */
export function persistedState(bps, id) {
  const comp = resolveBlueprint(bps, id);
  const out = {};
  for (const k of PERSISTED_KEYS) if (comp[k] !== undefined) out[k] = comp[k];
  return out;
}

// ---- tiers & unlocks --------------------------------------------------------
// Items are named `<family>_<tier>` (wheat_1, chicken_4, ...). Tiers are not fixed at
// 1..3: the configs already carry `tier_4`, so everything here is derived, never pinned.

const TIER_RE = /^(.*)_(\d+)$/;

/** Split a blueprint id into `{ family, tier }`; `tier` is null when the id isn't tiered. */
export function splitTier(id) {
  const s = String(id ?? '');
  const m = TIER_RE.exec(s);
  return m ? { family: m[1], tier: Number(m[2]) } : { family: s, tier: null };
}

/** The highest `_N` sibling that actually exists for `family` (0 when there are none). */
export function maxTier(bps, family) {
  let n = 0;
  while (bps?.[`${family}_${n + 1}`]) n++;
  return n;
}

/** True when `id` is at its family's top tier (so it can never merge again). */
export function isMaxTier(bps, id) {
  const { family, tier } = splitTier(id);
  return tier !== null && tier >= maxTier(bps, family);
}

/** Every blueprint id unlocked at or below `level` (`progression.items_unlocked`). */
export function unlocksAt(progression, level) {
  const levels = progression?.progression_per_level?.levels || {};
  const out = [];
  for (let l = 1; l <= level; l++) out.push(...(levels[String(l)]?.items_unlocked || []));
  return out;
}

/**
 * Tiered families the player has unlocked so far — an item family counts as soon as
 * its `_1` appears in the level table. This is the level gate for crate `object`
 * spawns: at level 13 it is exactly wheat, chicken, cow, sugarcane, carrot, goat.
 * Later families (soybeans L14, pig L17, ... dog L120) join automatically.
 */
export function unlockedFamilies(progression, level, bps) {
  const fams = new Set();
  for (const id of unlocksAt(progression, level)) {
    const { family } = splitTier(id);
    if (bps && !bps[`${family}_1`]) continue;
    fams.add(family);
  }
  return [...fams];
}

/** level/exp curve: apply exp, rolling over as many levels as needed. */
export function applyExp(progression, level, exp, gained) {
  const levels = progression?.progression_per_level?.levels || {};
  let lvl = level, xp = exp + gained, ups = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const need = levels[String(lvl)]?.exp_to_next_level;
    if (need === undefined || xp < need) break;
    xp -= need; lvl += 1; ups += 1;
  }
  return { level: lvl, exp: xp, levelUps: ups };
}
