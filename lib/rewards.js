// Level-up rewards and visitor ("train") rewards.
//
// Both are applied by the CLIENT. `SAVE_PLAYER_DATA_V2` is still the only write path and the server
// never grants anything on its own, so the bot has to make the same inventory edit the game does.
// Decoded from farm_merge_level_up.har (MECHANICS section 9):
//
//   level up   save[85]  InventoryModel  exp 6614 / level 13  ->  exp 2 / level 14   (no reward)
//              save[86]  InventoryModel  crates 0 -> 10, energy 70 -> 80            (= levels.13.rewards)
//   visitor    VisitorRewardModel {reward:[...], player:"NPC_2"} accumulates over several saves;
//              collecting resets it to {reward:[], player:null} and credits each entry to the
//              matching InventoryModel counter in that same save (observed: crates +10, carrot +1,
//              coins +6 = 3x {coins,2}).
'use strict';

/**
 * `progression_per_level.levels.<n>.rewards` for the level being **completed**.
 * Levels 4..130 all grant `crates 10` + `energy 10`.
 */
export function levelRewards(progression, level) {
  const levels = progression?.progression_per_level?.levels || {};
  const lv = levels[String(level)];
  return Array.isArray(lv?.rewards) ? lv.rewards : [];
}

/** Pending visitor rewards (from `VisitorRewardModel`), or `[]` when nothing is waiting. */
export function pendingVisitorRewards(models) {
  const d = models?.VisitorRewardModel?.json?.data;
  if (!d || !Array.isArray(d.reward)) return [];
  return d.reward.filter((r) => r && typeof r.key === 'string');
}
