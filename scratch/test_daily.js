// scratch/test_daily.js - the daily-challenge / seasonal-pass action counters, replayed against the
// captures.
//
// Fixtures are taken verbatim from the two HARs (task / targetAmount / currentAmount / collected /
// reward, in the capture's own order):
//
//   farm_merge_launch.har  save 13 -> save 14:  a single wheat_4 producer loot happened
//     (tile 66,74 `lootable` -> `depleted`, inventory `wheat 6->11`, `milk 1->5`) and the ONLY counter
//     that moved was #6 `harvest` 58 -> 59. Save 31: 4 crates opened, #8/#9/#10 `spend.crates`
//     290 -> 294.
//   farm_merge_level_up.har  save 34: an order was collected -> #1 `order.rewarded` 0 -> 1.
//     Save 48: 15 energy spent dispatching work (`energy 85->70`) -> #3/#7/#9 `spend.energy`
//     0 -> 15.
//
// The live board (2026-10-16) is the case the bot actually writes: ten targets across the rotation,
// with two `harvest` and three `spend.energy` / `spend.crates` each.
import { filledTile } from '../lib/board.js';
import { loadBlueprints, loadProgression } from '../lib/blueprints.js';
import { buildUpdates } from '../lib/solver.js';
import { buildTaskUpdates } from '../lib/daily.js';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const bps = loadBlueprints();
const progression = loadProgression();

// [id, task, targetAmount, currentAmount, collected, rewardKey, rewardTier]
const targets = (rows) => rows.map(([id, task, targetAmount, currentAmount, collected, key, tier]) => ({
  id, task, collected, targetAmount, currentAmount,
  reward: { data: { key, amount: 20 }, type: 'inventory', stickerpackTier: tier },
  localizedTask: 'daily_challenge_x',
}));

// --- farm_merge_launch.har, save 13 (before the wheat_4 loot) ---------------------
const LAUNCH13 = targets([
  [1, 'spend.crates', 40, 40, true, 'energy', 1],
  [2, 'spend.crates', 80, 80, true, 'energy', 2],
  [3, 'spend.crates', 120, 120, true, 'energy', 2],
  [4, 'spend.crates', 160, 160, true, 'energy', 2],
  [5, 'order.rewarded', 20, 20, true, 'coins', 2],
  [6, 'harvest', 65, 58, false, 'crates', 3],
  [7, 'order.rewarded', 28, 28, true, 'coins', 3],
  [8, 'spend.crates', 320, 290, false, 'energy', 4],
  [9, 'spend.crates', 360, 290, false, 'energy', 4],
  [10, 'spend.crates', 400, 290, false, 'energy', 4],
]);
// --- the same capture, save 14: #6 only, 58 -> 59 --------------------------------
const LAUNCH14 = targets(LAUNCH13.map((t) => (t.id === 6 ? [6, 'harvest', 65, 59, false, 'crates', 3] :
  [t.id, t.task, t.targetAmount, t.currentAmount, t.collected, t.reward.data.key, t.reward.stickerpackTier])));

// --- the live board, 2026-10-16 (what the bot is writing against) -----------------
const LIVE = targets([
  [1, 'order.rewarded', 4, 2, false, 'coins', 1],
  [2, 'spend.crates', 80, 80, true, 'energy', 2],
  [3, 'spend.energy', 210, 15, false, 'crates', 2],
  [4, 'harvest', 45, 0, false, 'crates', 2],
  [5, 'harvest', 55, 0, false, 'crates', 2],
  [6, 'spend.crates', 240, 240, true, 'energy', 2],
  [7, 'spend.energy', 490, 15, false, 'crates', 2],
  [8, 'spend.crates', 320, 250, false, 'energy', 4],
  [9, 'spend.energy', 630, 15, false, 'crates', 2],
  [10, 'spend.crates', 400, 250, false, 'energy', 4],
]);

// --- the live seasonal pass (verbatim activeQuest + its neighbours) ---------------
const SEASON = {
  seasonaleventpass: {
    endTime: 1793718000009,
    timerId: 80,
    startTime: 1791295200000,
    eventData: {
      rewards: [],
      playerData: {},
      activeQuest: {
        data: { amount: 3, SppReward: 110, taskAction: 'order.rewarded', localizedTask: 'daily_challenge_complete_order' },
        progress: 1,
      },
      tutorialSeen: true,
      startPopupShown: true,
    },
    eventConfiguration: { themeId: 'cinema', eventType: 'seasonaleventpass', seasonKey: 'seasonal_event_pass_cinema_2' },
  },
};

const models = (targetList, season) => ({
  DailyChallengeModel: { key: 'DailyChallengeModel', json: { data: { targets: targetList, timerID: 2198 }, version: 2 } },
  ...(season ? { TimedEventModel: { key: 'TimedEventModel', json: { data: season, version: 1 } } } : {}),
});
const gotTargets = (r, id) => r.updates.get('DailyChallengeModel')?.data?.targets?.find((t) => t.id === id);

// ---- 1. the launch capture: one producer loot moves `harvest` by exactly one -----
{
  const r = buildTaskUpdates(models(LAUNCH13), { harvest: 1 });
  check('launch 13 + 1 loot -> the capture\'s own save-14 targets',
    eq(r.updates.get('DailyChallengeModel').data.targets, LAUNCH14),
    JSON.stringify(gotTargets(r, 6)));
  check('the delta goes to a `harvest` target, not the three spend.crates ones',
    r.updates.get('DailyChallengeModel').data.targets.filter((t) => t.currentAmount !== LAUNCH13.find((o) => o.id === t.id).currentAmount).map((t) => t.id).join() === '6');
  check('summary line', eq(r.summaries, ['daily #6 harvest 58 -> 59/65']), r.summaries.join('|'));
}

// ---- 2. the launch capture: 4 crates move all three spend.crates targets ---------
{
  const r = buildTaskUpdates(models(LAUNCH13), { 'spend.crates': 4 });
  check('launch 13 + 4 crates -> #8/#9/#10 290->294, exactly the capture\'s save 31',
    [8, 9, 10].every((id) => gotTargets(r, id).currentAmount === 294) && gotTargets(r, 6).currentAmount === 58);
  check('a task absent from the deltas is untouched', r.summaries.length === 3);
}

// ---- 3. clamping, `collected`, and unrelated tasks -------------------------------
{
  const r = buildTaskUpdates(models(LIVE), { 'spend.crates': 10 });
  check('live + 10 crates -> #8 250->260, #10 250->260',
    gotTargets(r, 8).currentAmount === 260 && gotTargets(r, 10).currentAmount === 260);
  check('a `collected` target stops counting (#2 80/80, #6 240/240)',
    gotTargets(r, 2).currentAmount === 80 && gotTargets(r, 6).currentAmount === 240);

  const big = buildTaskUpdates(models(LIVE), { 'spend.energy': 1000 });
  check('a big delta clamps at targetAmount (#3 -> 210, #7 -> 490, #9 -> 630)',
    gotTargets(big, 3).currentAmount === 210 && gotTargets(big, 7).currentAmount === 490 && gotTargets(big, 9).currentAmount === 630);
  check('clamping says "claimable"', /claimable/.test(big.summaries[0]), big.summaries[0]);

  const non = buildTaskUpdates(models(LIVE), { merge: 9, 'spend.gems': 3 });
  check('a task the rotation does not carry writes nothing', non.updates.size === 0 && non.summaries.length === 0);

  const zero = buildTaskUpdates(models(LIVE), { harvest: 0, 'spend.crates': 0, 'spend.energy': 0, 'order.rewarded': 0 });
  check('all-zero deltas are a no-op', zero.updates.size === 0);
  check('no DailyChallengeModel does not throw', buildTaskUpdates({}, { harvest: 1 }).updates.size === 0);
}

// ---- 4. one save with every action: the multi-task write -------------------------
{
  const r = buildTaskUpdates(models(LIVE), { harvest: 1, 'spend.energy': 15, 'spend.crates': 10, 'order.rewarded': 2 });
  const want = { 1: 4, 2: 80, 3: 30, 4: 1, 5: 1, 6: 240, 7: 30, 8: 260, 9: 30, 10: 260 };
  const got = Object.fromEntries(gotTargets(r, 1) && r.updates.get('DailyChallengeModel').data.targets.map((t) => [t.id, t.currentAmount]));
  check('live + {1 loot, 15 energy, 10 crates, 2 orders} -> every matching target advances',
    eq(got, want), JSON.stringify(got));
  check('#1 order.rewarded reaches its target of 4 (claimable)', /#1 order.rewarded 2 -> 4\/4 \(claimable\)/.test(r.summaries.join('|')), r.summaries.join('|'));
  check('the non-target fits are untouched (timerID, rewards, localizedTask)',
    r.updates.get('DailyChallengeModel').data.timerID === 2198 &&
    gotTargets(r, 4).reward.data.key === 'crates' && gotTargets(r, 4).localizedTask === 'daily_challenge_x');
}

// ---- 5. the seasonal pass keeps the same counter under `taskAction` --------------
{
  const r = buildTaskUpdates(models(LIVE, SEASON), { 'order.rewarded': 2 });
  const q = r.updates.get('TimedEventModel').data.seasonaleventpass.eventData.activeQuest;
  check('season order.rewarded 1 -> 3/3', q.progress === 3 && q.data.amount === 3);
  check('the quest config survives (SppReward, localizedTask)',
    q.data.SppReward === 110 && q.data.localizedTask === 'daily_challenge_complete_order');
  check('the event around it survives (config, timerId, flags)',
    eq(r.updates.get('TimedEventModel').data.seasonaleventpass.eventConfiguration, SEASON.seasonaleventpass.eventConfiguration) &&
    r.updates.get('TimedEventModel').data.seasonaleventpass.eventData.startPopupShown === true);

  const clamp = buildTaskUpdates(models(LIVE, SEASON), { 'order.rewarded': 99 });
  check('season progress clamps at amount', clamp.updates.get('TimedEventModel').data.seasonaleventpass.eventData.activeQuest.progress === 3);

  const other = buildTaskUpdates(models(LIVE, SEASON), { harvest: 1, 'spend.energy': 15 });
  check('the season only counts the task it names (this season: order.rewarded)',
    other.updates.size === 1 && !other.updates.has('TimedEventModel'), [...other.updates.keys()].join());

  const done = buildTaskUpdates({ TimedEventModel: { key: 'TimedEventModel', json: { data: { e: { eventData: { activeQuest: { data: { amount: 3, taskAction: 'order.rewarded' }, progress: 3 } } } }, version: 1 } } }, { 'order.rewarded': 1 });
  check('a maxed season quest is not rewritten', done.updates.size === 0);
}

// ---- 6. solver integration: the bot's own actions feed the counters --------------
{
  const loot = { hitpoints: { startAsVisible: false, max: 1, current: 2 }, lootable: { loot: ['milk', 'milk', 'milk', 'milk'], lootingRemovesObject: false } };
  const key = 'TilesStateModel_66:73';
  const m = {
    [key]: { key, json: filledTile('cow_4', loot) },
    InventoryModel: { key: 'InventoryModel', json: { data: { level: 14, exp: 419, milk: 0 }, version: 1 } },
    DailyChallengeModel: { key: 'DailyChallengeModel', json: { data: { targets: LIVE, timerID: 2198 }, version: 2 } },
    TimedEventModel: { key: 'TimedEventModel', json: { data: SEASON, version: 1 } },
  };
  const r = buildUpdates(m, [], {
    bps, progression, collect: false, loot: true, work: false, orders: false, crates: 0,
    regen: false, producers: false, levelUpRewards: false, visitorRewards: false,
  });
  check('solver: looting one producer bumps exactly one `harvest` target +1',
    r.lootSummaries.length === 1 && r.updates.get('DailyChallengeModel').data.targets.find((t) => t.id === 4).currentAmount === 1 &&
    r.updates.get('DailyChallengeModel').data.targets.find((t) => t.id === 5).currentAmount === 1,
    r.taskSummaries.join('|'));
  check('solver: taskSummaries is exported', Array.isArray(r.taskSummaries) && r.taskSummaries.length === 2);
  check('solver: the season quest is not touched by a harvest', !r.updates.has('TimedEventModel'));
  check('solver: no crates -> no spend.crates write',
    r.updates.get('DailyChallengeModel').data.targets.find((t) => t.id === 8).currentAmount === 250);
}

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASS'}`);
process.exit(fails ? 1 : 0);
