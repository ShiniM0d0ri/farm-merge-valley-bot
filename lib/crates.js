// Opening inventory crates (`InventoryModel.crates`).
//
// Decoded: opening N crates does `crates -= N`, spawns N tier-1..3 objects on free cells,
// and advances the "controlled randomness" pity state.
//
// The draw is config-driven (controlled_randomness_jsonpack.json) and the pity state lives in
// PseudoRandomnessModel, so no black box is involved — only the underlying PRNG sequence is
// unknown, so results match the *distribution* exactly and are drawn independently each time.
//
//   crateItemContent     : object 250 | reward_crate_key 0.25 | reward_crate 0.25
//   object  -> tier from item_tier_config (tier_1 100, tier_2 10, tier_3 1) + a uniform family
//   reward_crate  -> controlled_randomness_reward_crate_config
//   reward_crate_key -> controlled_randomness_reward_crate_key_config
//
// Pity rules (single-sample reconstruction — see MECHANICS.md §5):
//   picked  : unsuccesfulAttempts = 0, weightIncrease = 0, cooldownAmount = cooldownDuration
//   missed  : cooldownAmount -= 1, unsuccesfulAttempts += 1, and once attempts exceed
//             unsuccessfulAttemptsThreshhold, weightIncrease += increaseWeightAmount
'use strict';
import fs from 'node:fs';
import { tiles, freeCells, filledTile } from './board.js';
import { persistedState, unlockedFamilies } from './blueprints.js';
import { cfgPath } from './env.js';

const CONFIG_PATH =
  process.env.FMV_RANDOMNESS || cfgPath('controlled_randomness_jsonpack.json');

// Fallback used only when no progression is supplied: exactly the families unlocked at
// level 13, which is how this list was originally pinned. Real draws derive the pool
// from the level table (`objectPool`), so later families (soybeans L14, pig L17, ...
// dog L120) and higher tiers join automatically with no code change.
export const OBJECT_FAMILIES = ['wheat', 'chicken', 'cow', 'sugarcane', 'carrot', 'goat'];

export function loadRandomness(path = CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * The `family_tier` candidates a crate's `object` result can pick.
 * Families = the player's level unlocks; tiers = `controlled_randomness_item_tier_config`
 * (which already carries `tier_4` at weight 0, so it is simply never drawn until the game
 * raises it). Only ids that actually exist as blueprints are kept, so a partially
 * implemented family can never produce a phantom tile.
 */
export function objectPool(randomness, { bps, progression, level } = {}) {
  const families = progression ? unlockedFamilies(progression, level, bps) : [];
  const list = families.length ? families : OBJECT_FAMILIES;
  const out = [];
  for (const t of randomness.controlled_randomness_item_tier_config || []) {
    const tier = Number(String(t.key).replace(/^tier_/, ''));
    if (!Number.isFinite(tier) || !(t.weight > 0)) continue;
    if ((t.spawnFromLevel ?? 1) > (level ?? 1)) continue;
    for (const family of list) {
      const id = `${family}_${tier}`;
      if (bps && !bps[id]) continue;
      out.push({ key: id, weight: t.weight });
    }
  }
  return out;
}

/** Weighted pick. `items` = [{key, weight}]. Returns null when nothing is eligible. */
function pickWeighted(items, rng) {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r < 0) return i.key;
  }
  return items[items.length - 1].key;
}

/**
 * Draw one key from a PseudoRandomness context, then advance that context's pity state.
 * Mutates `ctx` in place. `poolConfig` is the matching controlled_randomness_* array.
 */
function drawFromContext(ctx, poolConfig, level, rng) {
  if (!ctx) return null;
  const cfgFor = (key) => poolConfig.find((c) => c.key === key) || null;

  const eligible = [];
  for (const it of ctx.items) {
    const cfg = cfgFor(it.key);
    if (!cfg) continue;
    if ((cfg.spawnFromLevel ?? 1) > level) continue;
    if ((it.cooldownAmount || 0) > 0) continue;
    eligible.push({ key: it.key, weight: (cfg.weight || 0) + (it.weightIncrease || 0) });
  }

  const picked = pickWeighted(eligible, rng);
  const eligibleKeys = new Set(eligible.map((e) => e.key));

  for (const it of ctx.items) {
    const cfg = cfgFor(it.key);
    if (!cfg) continue;

    if (it.key === picked) {
      // on a hit the whole pity state resets.
      // NOTE: the live save has reward_crate at weightIncrease 4.875 with
      // unsuccesfulAttempts 0, so the game *may* retain weightIncrease across a hit.
      // We reset it because the live value is small after ~51 crates, whereas letting it
      // persist compounds without bound (it reached 218 in a 20k-draw simulation, which
      // would swamp the pool). Resetting keeps drawing near the configured weights.
      it.unsuccesfulAttempts = 0;
      it.weightIncrease = 0;
      it.cooldownAmount = cfg.cooldownDuration || 0;
      continue;
    }

    if ((it.cooldownAmount || 0) > 0) it.cooldownAmount -= 1;
    // only available items accumulate misses (live save: reward_crate_key sat at
    // cooldownAmount 49 for ~51 draws yet still has unsuccesfulAttempts 0)
    if (!eligibleKeys.has(it.key)) continue;
    it.unsuccesfulAttempts = (it.unsuccesfulAttempts || 0) + 1;
    if (it.unsuccesfulAttempts > (cfg.unsuccessfulAttemptsThreshhold || 0)) {
      it.weightIncrease = (it.weightIncrease || 0) + (cfg.increaseWeightAmount || 0);
    }
  }
  return picked;
}

/**
 * One crate's contents. Returns a blueprint id, or null.
 * `opts.bps` / `opts.progression` refine the `object` pool; without them the
 * level-13 fallback family list is used, so older callers keep working.
 */
export function drawCrate(randomness, prData, level, rng = Math.random, opts = {}) {
  const find = (ctx) => prData.find((c) => c.context === ctx) || null;

  const top = drawFromContext(find('crateItemContent'), randomness.controlled_randomness_crate_config, level, rng);
  if (!top) return null;

  if (top === 'reward_crate') {
    return drawFromContext(
      find('crateItemContentRewardCrate'),
      randomness.controlled_randomness_reward_crate_config, level, rng
    );
  }
  if (top === 'reward_crate_key') {
    return drawFromContext(
      find('crateItemContentCrateKey'),
      randomness.controlled_randomness_reward_crate_key_config, level, rng
    );
  }
  if (top === 'object') {
    // family from the level table x tier from item_tier_config, weighted in one draw
    return pickWeighted(objectPool(randomness, { ...opts, level }), rng);
  }
  return null;
}

/**
 * Plan N crate openings. Returns the model writes plus what would be produced.
 * `updates` includes InventoryModel and PseudoRandomnessModel.
 *
 *   count = how many crates to open (0 = off)
 *   rng   = injectable for deterministic tests
 */
export function buildCrateUpdates(models, { bps, progression, randomness, count = 0, rng = Math.random, blocked } = {}) {
  const updates = new Map();
  const summaries = [];
  const spawned = [];
  const inv = models.InventoryModel?.json;
  const pr = models.PseudoRandomnessModel?.json;
  const invData = inv?.data || {};
  const have = invData.crates ?? 0;
  const n = Math.min(count, have);
  if (!n || !pr?.data?.data) return { updates, summaries, spawned, opened: 0 };

  const level = invData.level ?? 1;
  // work on a deep copy so the caller's model is never mutated
  const prData = JSON.parse(JSON.stringify(pr.data.data));

  for (let i = 0; i < n; i++) {
    const bp = drawCrate(randomness, prData, level, rng, { bps, progression });
    if (!bp) break;
    spawned.push(bp);
  }
  if (!spawned.length) return { updates, summaries, spawned, opened: 0 };

  // place the results on free cells, avoiding cells another action already claimed
  const taken = blocked ? new Set(blocked) : new Set();
  const cells = freeCells(models, { row: 0, col: 0 }).filter((c) => !taken.has(c.key));
  const placed = [];
  let full = false;
  for (const bp of spawned) {
    const cell = cells.shift();
    if (!cell) { full = true; break; }
    taken.add(cell.key);
    updates.set(cell.key, filledTile(bp, persistedState(bps, bp)));
    placed.push(`${bp}@(${cell.row},${cell.col})`);
  }

  const opened = placed.length;
  updates.set('PseudoRandomnessModel', { data: { ...pr.data, data: prData }, version: pr.version ?? 1 });

  // daily-challenge progress for `spend.crates` is applied by lib/daily.js, which sums every action
  // in the save - keeping a second copy here would double-count.

  summaries.push(
    `opened ${opened} crate(s) -> ${placed.join(', ')}${full ? ' (board full)' : ''}`
  );
  return { updates, summaries, spawned, opened };
}
