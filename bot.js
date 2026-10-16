// Farm Merge Valley bot - direct Nakama client.
//   node bot.js                        dry run (default) - prints plan, writes nothing
//   node bot.js --apply                perform merges + collects + loots
//   node bot.js --apply --rounds=5     repeat the plan/save 5 times (cascades merges)
//   node bot.js --apply --rounds=auto  repeat until a round finds nothing to do (max --max-rounds)
//   node bot.js --apply --loop         keep farming forever (default every 30s)
//   node bot.js --apply --loop --every=60
//   node bot.js --apply --loop --cycles=20   stop after 20 cycles
//   node bot.js --apply --no-collect   /  --no-loot  /  --no-work  /  --no-orders  /  --no-crates  /  --min=5
//   node bot.js --apply --no-regen     don't collect regeneration (4h reloads + crate/energy refills)
//   node bot.js --apply --no-producers don't materialise/repair tier-4 producers (merges still arm them)
//   node bot.js --apply --crates=5     open exactly 5 crates (default: auto = all that fit)
//   node bot.js --apply --reserve-energy=50   never spend energy below 50 (for parallel play)
//   node bot.js --apply --loop --max-failures=5  stop after 5 failed cycles in a row (default 10)
//   node bot.js --refresh                allow session auto-renewal (see MECHANICS section 8)
//                                        WARNING: renewal supersedes the live session and can
//                                        disconnect your own game client
//   node bot.js --board                print the board even in loop mode
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf, encodeModelEntry } from './lib/proto.js';
import { printBoard } from './lib/board.js';
import { loadBlueprints, loadProgression } from './lib/blueprints.js';
import { planMerges, buildUpdates, MIN_MERGE } from './lib/solver.js';
import { deepEqual } from './lib/deep.js';
import fs from 'node:fs';

const has = (f) => process.argv.includes(f);
const numArg = (name, dflt) =>
  Number((process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt);

const APPLY = has('--apply');
const COLLECT = !has('--no-collect');
const LOOT = !has('--no-loot');
const WORK = !has('--no-work');
const ORDERS = !has('--no-orders');
const LOOP = has('--loop');
const SHOW_BOARD = !LOOP || has('--board');
// Rounds are repeats of (plan -> save -> re-read) inside one cycle. One plan already resolves the
// whole cascade (the planner feeds a merge's output back in until nothing merges), so rounds now
// only catch what the board can pay for *after* the save: loot that materialised, crates, orders.
// `auto` keeps going until a round finds nothing to do, bounded by --max-rounds.
const ROUNDS_ARG = (process.argv.find((a) => a.startsWith('--rounds=')) || '').split('=')[1];
const ROUNDS = ROUNDS_ARG === 'auto' ? Infinity : numArg('rounds', 1);
const MAX_ROUNDS = numArg('max-rounds', 25);
const ROUND_LIMIT = Number.isFinite(ROUNDS) ? ROUNDS : MAX_ROUNDS;
// Smallest group size the merge planner may use: 3 = both 3-merges (1 output) and 5-merges
// (bonus, 2 outputs), 5 = bonus merges only. The planner picks the split that maximises output.
const MIN = numArg('min', MIN_MERGE);
const EVERY = numArg('every', 30) * 1000;
const CYCLES = numArg('cycles', 0); // 0 = unlimited (loop forever)
// keep this much energy untouched so a human playing in parallel still has some
const RESERVE_ENERGY = numArg('reserve-energy', 0);
// unattended safety: stop the loop after this many failed cycles in a row (0 = never stop)
const MAX_FAILURES = numArg('max-failures', 10);
// Session renewal is opt-in: it supersedes the live session, so it can knock your own client
// off with "Disconnected - Connection lost" (MECHANICS section 8).
if (has('--refresh')) process.env.FMV_ALLOW_REFRESH = '1';
// Crates: default = "auto" (open as many as the board can accommodate, bounded by your
// crate count) so the 5-minute crate generator never sits idle at its 40 crate ceiling.
//   --crates=N      open exactly N
//   --crates=auto   explicit auto (same as default)
//   --no-crates     never open crates
const NO_CRATES = has('--no-crates');
// Level-up rewards + visitor ("train") rewards are client-applied (MECHANICS section 9).
const LEVEL_REWARDS = !has('--no-level-rewards');
const VISITOR_REWARDS = !has('--no-visitors');
// Regeneration is client-applied too (MECHANICS section 10): a reload whose duration has elapsed is
// credited by the client, and the crate/energy stock refills are topped up by it as time passes. The
// three fixed 4-hour reloads and the two stock refills (ceilings from the config pack) are automated.
const REGEN = !has('--no-regen');
// Tier-4 producers (MECHANICS section 4): merging into one starts a 30-minute cooldown and the tile
// materialises when it lands. `--no-producers` skips the materialise/repair half; a merge's cooldown
// is always written, because a producer without one can never loot, merge or produce.
const PRODUCERS = !has('--no-producers');
const CRATES_ARG = (process.argv.find((a) => a.startsWith('--crates=')) || '').split('=')[1];
const CRATES = NO_CRATES
  ? 0
  : CRATES_ARG === undefined || /^(auto|max)$/i.test(CRATES_ARG)
    ? Infinity
    : Number(CRATES_ARG);

const session = loadSession();
const bps = loadBlueprints();
const progression = loadProgression();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async () => decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

const summaryLine = (m) => {
  const i = m.InventoryModel?.json?.data;
  return i ? `level ${i.level}, exp ${i.exp}, coins ${i.coins}, gems ${i.gems}, energy ${i.energy}, crates ${i.crates}` : '(no inventory)';
};

async function cycle(runNo) {
  let models = await read();
  if (fs.existsSync('state.json')) fs.copyFileSync('state.json', 'state.bak.json');
  fs.writeFileSync('state.json', JSON.stringify(models));

  if (SHOW_BOARD) {
    console.log(`run ${runNo} | ${APPLY ? 'APPLY' : 'DRY RUN'} | minMerge=${MIN} | rounds=${Number.isFinite(ROUNDS) ? ROUNDS : 'auto'} | collect=${COLLECT} | loot=${LOOT} | work=${WORK} | orders=${ORDERS} | crates=${CRATES === Infinity ? 'auto' : CRATES}\n`);
    printBoard(models);
  }
  console.log(`inventory: ${summaryLine(models)}`);

  for (let round = 1; round <= ROUND_LIMIT; round++) {
    const moves = planMerges(models, { minMerge: MIN, bps });
    const { updates, expGained, levelInfo, summaries, collectSummaries, lootSummaries, workSummaries, crateSummaries, orderSummaries, rewardSummaries, harvestSummaries, taskSummaries, gains, cratesOpened, normalMerges, bonusMerges } =
      buildUpdates(models, moves, {
        bps, progression, collect: COLLECT, loot: LOOT, work: WORK, crates: CRATES, orders: ORDERS,
        reserveEnergy: RESERVE_ENERGY,
        levelUpRewards: LEVEL_REWARDS, visitorRewards: VISITOR_REWARDS, regen: REGEN, producers: PRODUCERS,
      });

    if (!moves.length && !collectSummaries.length && !lootSummaries.length &&
        !workSummaries.length && !crateSummaries.length && !orderSummaries.length &&
        !rewardSummaries.length && !harvestSummaries.length) {
      console.log(`round ${round}: nothing to do (need ${MIN} identical to merge).`);
      break;
    }

    const parts = [];
    if (moves.length) {
      parts.push(`${moves.length} merge(s)${bonusMerges ? ` (${bonusMerges} bonus)` : ''}`);
    }
    if (collectSummaries.length) parts.push(`${collectSummaries.length} collect(s)`);
    if (lootSummaries.length) parts.push(`${lootSummaries.length} loot(s)`);
    if (workSummaries.length) parts.push(`${workSummaries.length} work`);
    if (orderSummaries.length) parts.push(`${orderSummaries.length} order(s)`);
    if (crateSummaries.length) parts.push(`${cratesOpened} crate(s)`);
    if (rewardSummaries.length) parts.push(`${rewardSummaries.length} reward(s)`);
    if (harvestSummaries.length) parts.push(`${harvestSummaries.length} producer(s)`);
    if (taskSummaries.length) parts.push(`${taskSummaries.length} task(s)`);
    console.log(`=== round ${round}: ${parts.join(', ')} ===`);
    for (const line of summaries) console.log('  ' + line);
    if (harvestSummaries.length) {
      console.log(`  producers:`);
      for (const line of harvestSummaries) console.log('    p ' + line);
    }
    if (collectSummaries.length) {
      console.log(`  collect ${collectSummaries.length} tile(s):`);
      for (const line of collectSummaries) console.log('    + ' + line);
    }
    if (lootSummaries.length) {
      console.log(`  loot ${lootSummaries.length} tile(s):`);
      for (const line of lootSummaries) console.log('    ~ ' + line);
    }
    if (workSummaries.length) {
      console.log(`  dispatch ${workSummaries.length} worker(s):`);
      for (const line of workSummaries) console.log('    w ' + line);
    }
    if (orderSummaries.length) {
      console.log(`  orders:`);
      for (const line of orderSummaries) console.log('    o ' + line);
    }
    if (crateSummaries.length) {
      console.log(`  crates:`);
      for (const line of crateSummaries) console.log('    c ' + line);
    }
    if (rewardSummaries.length) {
      console.log(`  rewards:`);
      for (const line of rewardSummaries) console.log('    * ' + line);
    }
    if (taskSummaries.length) {
      console.log(`  daily / pass progress:`);
      for (const line of taskSummaries) console.log('    d ' + line);
    }
    if (Object.keys(gains).length) {
      console.log(`    totals: ${Object.entries(gains).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    }
    console.log(`  exp +${expGained}` +
      (levelInfo
        ? `  level ${models.InventoryModel?.json?.data?.level} -> ${levelInfo.level} (exp ${levelInfo.exp})${levelInfo.levelUps ? `  *** LEVEL UP x${levelInfo.levelUps} ***` : ''}`
        : ''));
    console.log(`  models to write: ${updates.size}`);

    if (!APPLY) {
      console.log('  dry run - nothing written. re-run with --apply');
      return models;
    }

    const payload = Buffer.concat(
      [...updates].map(([key, json]) =>
        encodeModelEntry(key, json, models[key]?.md5 || '', models[key]?.ts ?? null)
      )
    );
    await httpRpc('SAVE_PLAYER_DATA_V2', payload);
    models = await read();

    const ok = [...updates].every(([k, json]) => deepEqual(models[k]?.json, json));
    console.log(`  saved, re-read ${Object.keys(models).length} models, verified: ${ok}`);
  }

  return models;
}

if (LOOP) {
  console.log(`loop mode: every ${EVERY / 1000}s${CYCLES ? `, ${CYCLES} cycle(s)` : ''}${MAX_FAILURES ? `, stop after ${MAX_FAILURES} failed cycle(s) in a row` : ''}, ${APPLY ? 'APPLYING' : 'DRY RUN'} (Ctrl+C to stop)`);
  let n = 0;
  let failures = 0;
  for (;;) {
    try {
      console.log(`\n----- cycle ${++n} @ ${new Date().toLocaleTimeString()} -----`);
      await cycle(n);
      failures = 0;
    } catch (e) {
      failures++;
      console.log(`cycle ${n} failed (${failures} in a row): ${e.message}`);
    }
    if (CYCLES && n >= CYCLES) break;
    if (MAX_FAILURES && failures >= MAX_FAILURES) {
      console.log(`\nstopping: ${failures} consecutive failures - nothing is being written.`);
      break;
    }
    await sleep(EVERY);
  }
  console.log(`\nstopped after ${n} cycle(s).`);
} else {
  const models = await cycle(1);
  if (APPLY && SHOW_BOARD) {
    console.log('\nfinal board:');
    printBoard(models);
  }
}
