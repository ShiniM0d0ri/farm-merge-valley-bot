// lib/daily.js - the action counters the game advances for the player's OWN moves.
//
// Nothing in this game is server-granted: level-up rewards, visitor rewards, time-based reloads,
// producer loot and also the daily-challenge / seasonal-pass progress are all numbers the CLIENT
// writes into a saved model when the player does something. Live the bot *is* the player, so unless
// it bumps them itself the challenges sit at 0 however much work it does - which is exactly the
// state the live account was in (a fresh `spend.energy 15/210`, `harvest 0/45`).
//
// Semantics pinned from the captures (`scratch/dc_timeline.js` diffs every DailyChallengeModel change
// against the inventory delta and the sibling models in the same save, and
// `scratch/dc_harvest_pair.js` dumps the full inventory delta + the before/after tile JSON of the
// saves where `harvest` moved):
//
//   task            unit                        HAR evidence
//   -------------------------------------------------------------------------------------------
//   harvest         +1 per producer loot tap    launch 14: wheat_4 lootable -> depleted, inv
//                                               `wheat 6->11`, DC #6 58->59.  launch 19:
//                                               sugarcane_4 lootable -> depleted, DC #6 59->60.
//                                               (+1, NOT +5 for the 5 wheat - it counts taps, and
//                                               the 4 collected `milk` tiles in save 14 are not
//                                               counted at all.)
//   spend.energy    += energy spent on work     level-up 48: `energy 85->70`, DC #3/#7/#9 0->15.
//   spend.crates    += crates opened            level-up 11/14/17/23/...: `crates 49->40`, DC
//                                               #6/#8/#10 all 155->165.
//   order.rewarded  += orders COLLECTED         level-up 34: OrdersModel+BuildingsModel change,
//                                               DC #1 0->1.
//
// One standing approximation: only the *first* tap on a producer was ever observed (launch 14/19), so
// the second one - the `removeReward` tap that deletes the tile - is counted the same way, as a loot
// tap. Both are "a harvest" in the UI, and getting it wrong would only overshoot the counter by one
// per producer. (`AnalyticsModel.onboardingSteps.harvestTaps` moves +1 in the same saves, but it also
// resets 4->0 on its own, so its lifetime is not understood and it is deliberately left alone.)
//
// Two details matter: every target with the same task advances in lockstep (so the delta goes to
// each of them), and the seasonal pass keeps the same counters in
// `TimedEventModel.<event>.eventData.activeQuest` keyed by `taskAction` (live: `order.rewarded`
// progress 1/3) - so the same deltas bump that too.

/**
 * Apply this save's action deltas to every counter that tracks them.
 *
 * `deltas` maps a task name to how many units the bot performed in this save, e.g.
 * `{ harvest: 2, 'spend.energy': 15, 'spend.crates': 10, 'order.rewarded': 1 }`. A task that is
 * absent is left completely alone, so nothing is ever zeroed or invented.
 *
 * @returns {{updates: Map<string, object>, summaries: string[]}} updates for the caller to merge
 *          into its own save payload.
 */
export function buildTaskUpdates(models, deltas = {}) {
  const updates = new Map();
  const summaries = [];

  // ---- daily challenges: `data.targets[]` ------------------------------------------------
  const dc = models.DailyChallengeModel?.json;
  if (dc?.data?.targets) {
    let hit = false;
    const targets = dc.data.targets.map((t) => {
      const n = deltas[t.task] || 0;
      // A collected target is done for the day - the client stops counting it too.
      if (!n || t.collected) return t;
      const from = t.currentAmount || 0;
      const to = Math.min(from + n, t.targetAmount ?? Infinity);
      if (to === from) return t;
      hit = true;
      summaries.push(
        `daily #${t.id} ${t.task} ${from} -> ${to}/${t.targetAmount}` +
        (to >= (t.targetAmount ?? Infinity) ? ' (claimable)' : '')
      );
      return { ...t, currentAmount: to };
    });
    if (hit) updates.set('DailyChallengeModel', { data: { ...dc.data, targets }, version: dc.version ?? 1 });
  }

  // ---- seasonal pass: `eventData.activeQuest.progress`, keyed by `taskAction` -------------
  const te = models.TimedEventModel?.json;
  if (te?.data) {
    let hit = false;
    const next = { ...te.data };
    for (const [k, ev] of Object.entries(next)) {
      const q = ev?.eventData?.activeQuest;
      const n = q ? (deltas[q.data?.taskAction] || 0) : 0;
      if (!n || typeof q.progress !== 'number') continue;
      const amount = q.data?.amount ?? Infinity;
      const to = Math.min(q.progress + n, amount);
      if (to === q.progress) continue;
      hit = true;
      summaries.push(`season ${q.data.taskAction} progress ${q.progress} -> ${to}/${amount}`);
      next[k] = { ...ev, eventData: { ...ev.eventData, activeQuest: { ...q, progress: to } } };
    }
    if (hit) updates.set('TimedEventModel', { data: next, version: te.version ?? 1 });
  }

  return { updates, summaries };
}
