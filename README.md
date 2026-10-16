# Farm Merge Valley bot

A standalone Node.js client that plays **Farm Merge Valley** (a Discord Activity) by talking
directly to its Nakama backend. No browser, no CDP, no Discord client automation.

## How it works

The game is **client-authoritative**: there is no "merge" or "harvest" RPC. The client computes
the new board state and persists it with a single write RPC. Everything else is a read.

- **Write path:** `SAVE_PLAYER_DATA_V2` — the only one (36 occurrences in the captured HAR).
- **Read path:** `GET_ALL_PLAYER_DATA_V2` returns every model as protobuf-encoded entries.
- **Auth:** the bot reuses the player's Nakama session token from `session.json` over **HTTP only**.
  The game server runs with **`single_socket` enabled** — only **one WebSocket per account**. The
  bot's loop never opens a socket (`httpRpc` = `POST /v2/rpc/...`), so it does **not** disturb the
  player's session. Any `wsRpc` connection *does* and will boot the player with the in-game
  *"Disconnected — Connection lost"* screen (which does not auto-reconnect). See
  [`MECHANICS.md` §8](MECHANICS.md) before running recon while playing.

### Transport rules (learned from the HAR)

| Thing | Rule |
|---|---|
| HTTP RPC body | **base64 text** (raw bytes -> `illegal base64 data`) |
| WS RPC payload | base64 inside `{cid, rpc:{id, payload}}` |
| WS ping | reply `{pong}` to `{ping}` |
| Server key | `Authorization: Basic base64("<key>:")` — Bearer fails |
| `?unwrap=true` | returns the payload as a base64 **string** |
| Session expiry | fail-closed: `httpRpc` throws a recovery hint on `exp`/`401`; renewal only with `--refresh` (it supersedes your live session — see below) |

Model entry shape (protobuf):

```
field1(2) = <wrapper of the whole entry>          <-- the level that was easy to miss
wrapper.1 = JSON bytes
wrapper.2 = md5 string   (server-owned; client value is ignored)
wrapper.3 = timestamp varint (often absent on tiles)
```

An empty board cell is `{data:{state:null},version:1}`.

## Setup

Node **≥ 22** (built-in `fetch` and `WebSocket`). **No npm dependencies** — there is no install step.

```
git clone https://github.com/ShiniM0d0ri/farm-merge-valley-bot.git
cd farm-merge-valley-bot
cp .env.example .env      # then fill it in (below)
npm run config            # download the game's jsonpacks into ./config
npm test                  # the fixture tests (no network, no writes)
npm run dry               # read-only: prints the board and the plan, writes nothing
npm run apply             # one full round: merges + collects + loots + work + orders + crates
```

`npm run config` is required — the configs are game assets, so they are downloaded rather than
committed ([Game config](#game-config)). `npm run dry` / `apply` / `loop` / `verify` wrap the common
`node bot.js …` invocations; the flags themselves are in [Usage](#usage).

### Secrets — everything lives in `.env`

`.env` is **git-ignored** and is the only place credentials exist; `.env.example` is the tracked
template. Nothing belonging to your account is committed — not `.env`, not `session.json`, not
`state.json`, not the HAR captures or anything decoded from them. `.gitignore` lists all of it.

| key | what it is | how to get it |
|---|---|---|
| `FMV_KEY` | Nakama **server key** — game-wide, not personal | Any HAR of the activity: find a `POST /v2/rpc/...` request, base64-decode its `Authorization: Basic <b64>` header — the result is `<key>:`. It is also in the client bundle's string table. |
| `FMV_APP_ID` | the Activity's Discord **application id** — game-wide | It is the subdomain of the activity host (`https://<APP_ID>.discordsays.com/…`) and the `client_id` in the activity URL, so any HAR shows it. |
| `FMV_DISCORD_ID` | **your** Discord user id — this identifies the account the bot drives | Discord → *Settings → Advanced* → enable **Developer Mode**, then right-click your avatar → **Copy User ID**. |
| `FMV_CFG` | directory holding the extracted game config | see [Game config](#game-config) (`./config` by default) |

Optional keys: `FMV_SESSION` (path of the session file, default `./session.json`) and
`FMV_ALLOW_REFRESH=1` (let the bot renew its own token — read the warning below first).

### The session token (`session.json`)

The bot drives **your** session, so it needs the Nakama token your game client is already using.

1. Open the Farm Merge Valley activity in Discord.
2. DevTools → **Network**, then export the HAR (right-click → *Save all as HAR*).
3. The token is the `?token=<jwt>` query parameter of the `/nakama/ws` request; any
   `Authorization: Bearer <jwt>` header carries the same value.
4. Save it as `session.json` (git-ignored):

```json
{
  "origin": "https://<APP_ID>.discordsays.com",
  "proxy": "/.proxy/nakama",
  "session_token": "<the jwt>",
  "nakama_refresh_token": "<optional — only used with --refresh>",
  "discord_access_token": "<optional — only the scratch/ probes use this>"
}
```

`node scratch/jwt.js` decodes the stored and the captured token side by side (`sid`, `uid`, `exp`),
so you can check what you captured before spending a run on it. A token lasts ~24 h; when it expires,
re-capture it. **Never renew while you are playing:** renewal supersedes the session your client
holds and the game shows *"Disconnected — Connection lost"* ([§8](MECHANICS.md)).

### Game config

The bot reads the game's own config jsonpacks (blueprints, progression, crate odds, recipes). They are
plain static files the activity loads at start — no auth, no capture, no account involved — so the
repo downloads them instead of committing them (they are game assets, and `config/` is git-ignored):

```
node fetch_config.js        # or: npm run config
```

That writes the six packs into `FMV_CFG` (`./config` by default). Under the hood, for each pack:

1. `https://<APP_ID>.discordsays.com/jsonpackmap.json` is the index: it maps every id to the pack that
   defines it, e.g. `"alpaca_1": "blueprints"`.
2. Each pack is a single file, `https://<APP_ID>.discordsays.com/.proxy/json/<pack>/jsonpack.json?v=<version>`
   (the version is cosmetic — the host accepts any value).

| file | what the bot uses it for |
|---|---|
| `blueprints_jsonpack.json` | every tile's components (`mergeable`, `harvestable`, `hitpoints`, …) |
| `progression_jsonpack.json` | levels, `items_unlocked`, level-up `rewards` |
| `controlled_randomness_jsonpack.json` | crate contents and their weights |
| `recipes_jsonpack.json`, `buildings_jsonpack.json` | orders and workshops |
| `config_jsonpack.json` | the regeneration ceilings (`crate_regeneration_config`, `energy_regeneration_config`) |

`node fetch_config.js --all` pulls the remaining packs (`npcs`, `tasks`, `shop`, `objectives`, …) that
only the recon probes read. Run this **before `npm test`**: the fixture suites read `blueprints`,
`progression` and `config` from `CFG_DIR`.

### Safety

The bot touches only **your own farm**, through the same `SAVE_PLAYER_DATA_V2` write your game client
uses. It does not read or modify Discord, other players, friend farms, clans or the stickerbook, and
it never opens a second WebSocket unless you run a `wsRpc` tool on purpose. `npm run dry` is
read-only, and every write is re-read and compared — a run reports `verified: true` only when the
server stored exactly what was planned.

## Verified behaviour

- Every action is re-read after write and compared **semantically** (`lib/deep.js canonical`),
  because the server re-orders JSON keys: `verified: true` on every round.
- Multi-round and loop runs confirmed: `--rounds=6`, `--rounds=20`, and `--loop` cycles all
  `verified: true`, with the board draining to "nothing to do" and refilling from work/regen.
- `InventoryModel` (`exp`, `level`) and `UserStatsModel` (`totalEarnedXP`, `totalNormalMerges`,
  `totalHarvestedItems`, `totalSpentEnergy`) land exactly as computed.
- Currency collection, looting finished producers, work dispatch **and** completion, inventory-crate
  opening, full order start/complete/collect, level-up rewards and visitor rewards have all been
  applied live and verified.
- **Level-up, visitor and reload rewards are replayed exactly.** `scratch/test_rewards.js` feeds the
  HAR's own numbers (level 13 `exp 6614` + a 3-exp merge, and a `VisitorRewardModel` holding
  `crates 10, carrot 1, coins 2x3`) into the solver and asserts the HAR's outcome: `level 14,
  exp 2`, `crates 20`, `energy 80`, `carrot 2`, `coins 311`, visitor model reset — **PASS**.
  `scratch/test_regen.js` does the same for the three time-based reloads in that capture
  (`crates 0→10`, `gems 175→180`, `energy 80→85`), including both availability signals, the timer
  re-arm, the stock spend, the catch-up clamp and a no-runaway re-plan — **PASS** (38 checks).
  `scratch/test_harvest.js` replays the launch capture's producer lifecycle — the merged tile and its
  `Cooldown:<row>,<col>` timer, the materialised tile, the deleted spent timer, the repaired inert
  tile — and reproduces the capture's own loot arrays (`egg` x5, `milk` x4) from the decoded table —
  **PASS** (47 checks).
  `scratch/test_daily.js` pins the four daily/pass counter units against the captures (a producer loot
  moves `harvest` by exactly 1; 4 crates move all three `spend.crates` targets 290→294; 15 energy
  moves all three `spend.energy` targets 0→15; a collected order moves `order.rewarded` 0→1),
  plus the clamp, `collected`, unknown-task and seasonal cases — **PASS** (25 checks).
  `scratch/test_merge_max.js` checks the merge planner's split against an exhaustive DP over group
  sizes, replays the 27-tile cascade (move order, residues, 15 outputs, 93 exp, both
  `UserStatsModel` counters, the `InventoryModel` write), arms a bonus merge into a tier-4 producer
  (two tiles, two cooldown timers) and the `--min` gates — **PASS** (56 checks).
- A 151-crate dry run placed every crate; applying drove `crates` to 0, the generator refilled toward
  its stock ceiling, and a later 75-crate run was applied in full.
- **Parallel-safety caveat:** verified only in the sense that the stored session keeps working over
  HTTP. The account is `single_socket` (one WebSocket), so do **not** run `wsRpc` while playing
  (§8 of MECHANICS.md).
- **Session renewal is opt-in and does disturb your client.** `httpRpc` now **fails closed** on token
  `exp`/`401` with a recovery hint. Enabling renewal (`--refresh`) works — it extended the expiry
  `2026-10-17 12:39` → `15:55 UTC` and rotated the refresh token — but it **supersedes the session your
  client holds**: right after a renewal the game came up on *"Disconnected — Connection lost"*, and
  restarting Discord did not clear it. Never renew while you are playing (MECHANICS §8).

## Mechanics

Tile components that persist (`lib/blueprints.js: PERSISTED_KEYS`):
`mergeable, collectable, currency, lootable, depleted, hitpoints, resourceGate, cooldown, crateReward, upgradeCard`

| Kind | Persisted components | Action |
|---|---|---|
| Items (wood, stone, wheat, animals, tools) | `mergeable` | merge 3 → 1 next tier, or 5 → 2 (bonus) |
| Currency orbs (`coin_*`, `energy_*`) | `collectable, currency, mergeable` | merge **or** collect |
| Resource nodes (trees, rocks, toolboxes) | `hitpoints, resourceGate` | pay energy, timed, yields loot |
| Harvestables — **tier-4 only** (`carrot_4`, `sugarcane_4`, …) | `hitpoints, lootable` | loot |
| Reward crates (`reward_crate_*` tiles) | `cooldown, crateReward` | needs N keys, timed |
| Inventory `crates` counter | *(none)* | drawn via controlled randomness (§5) |
| Workshops (`bbq`, `bakery`, `market`, `dairy`) | *(none)* | production recipes |
| `upgrade_card_1` | `mergeable, upgradeCard` | targeted merge |

**Tiers are data-driven.** Items are named `<family>_<tier>` and every family tops out at tier 4.
Which families exist is gated by level (`progression.items_unlocked`), and the crate `object` pool is
derived from that table — at level 13 it is exactly `wheat, chicken, cow, sugarcane, carrot, goat`,
which is the list that used to be hardcoded. Nothing pins a tier or family list any more. See
[`MECHANICS.md` §6](MECHANICS.md).

**Merging maximises output (§6 of MECHANICS.md).** Two group sizes exist: **3 identical → 1** of the
next tier, and **5 identical → 2** (the game's bonus merge, `totalBonusMerges` — the client's effect
sprite is literally `Merge_5_Floter`). EXP is paid **per output tile**, so the split that maximises
output tiles also maximises EXP: use `floor(n/5)` five-groups, then `floor((n mod 5)/3)` three-groups,
and keep the leftovers on the board. `planMerges` resolves the whole cascade in one plan, so 27
`wheat_1` becomes `wheat_2 → wheat_3 → wheat_4` in a single save. `--min=5` restricts it to bonus
merges only.

**Merge vs collect policy:** every tier is worth exactly **3x** the previous
(coin 1/3/9/27, energy 10/30/270), so merging is *value-neutral* in coins but pays **EXP**
(3/9/27/81 by tier, doubled for a 5-merge). Therefore the bot merges first and only collects
leftovers that cannot reach a group of 3. Disable with `--no-collect`.

Since regeneration stops at a ceiling, sitting at the cap loses regen permanently — the crate
generator makes **+5 crates per 5 min up to 40** and the energy generator **+1 energy per 3 min up to
50** (§7 of MECHANICS.md). So the default is to spend crates down to whatever the board can hold,
rather than hoarding.

**Time-based reloads are collected too** (§10). The `*_no_ads` refills are client-applied like every
other reward, so an idle bot must write them itself: `+10 crates`, `+5 gems` and `+5 energy` each
4 h, credited when `MarketplaceModel.data.stock` says a refill is banked **or** when the 4 h clock
has elapsed — the HAR's own collects happen at 65–70 min because the stock was already banked, not
because a clock ran out. `--no-regen` disables it.

**The passive stock refills are automated as well** (§10). `crates_generator` and
`energy_generator` have no button to tap: the client tops the counter up as time passes and stalls at
its ceiling, and the ceilings are in `config_jsonpack.json` (40 crates / 50 energy), not in the
obfuscated client. This is why a full crate pile can look "unopened" — the counter refills itself to
`40/40` the moment it is emptied, because everything accrued while it was parked lands at once. The
bot credits `min(accrued intervals, ceiling - current)`, resets the clock to now and arms
`regenerate_<name>`, exactly like the client's own write. `--no-regen` covers both, and if the config
pack is missing the refills are skipped rather than guessed (fail closed).

**Tier-4 producers are kept producing** (§4). Merging into a producer starts a 30-minute
`Cooldown:<row>,<col>` timer; when it lands the tile materialises into `lootable` and the bot loots it
(ingredients into the inventory, `upgrade_card_1` onto the board), spending one of the producer's two
harvests. The bot also **repairs** producers left inert by the pre-fix merge write (tile data `{}`):
they cannot merge, loot or produce at all, so they get a fresh cooldown. `--no-producers` skips the
materialise/repair half — a merge's cooldown is always written, because a producer without one is
dead weight.

**The daily-challenge and seasonal-pass counters are kept up to date** (§9). They are plain numbers
in a saved model that the *client* bumps when the player acts — so without the bot doing it too, the
challenges stall at 0 no matter how much work it does (the live account sat at `harvest 0/45`,
`spend.energy 15/210`). The units are pinned against the captures: `harvest` is **+1 per producer
loot tap**, `spend.energy` is the energy spent dispatching work, `spend.crates` is the crates opened
and `order.rewarded` is the orders **collected**; every target sharing a task advances together, and
the seasonal pass quest (`TimedEventModel.activeQuest`, matched on `taskAction`) moves with them. The
bot stops at `targetAmount` — the claim payout is still unobserved, so it leaves that to you. Note
this means your own play and the bot both advance the same counters; nothing double-counts.

## Usage

```
node bot.js                    # dry run (default) - prints board + plan, writes nothing
node bot.js --apply            # merges + collects + loots + work + orders + opens crates
node bot.js --apply --rounds=5 # repeat the plan/save 5 times (lets merges cascade)
node bot.js --apply --rounds=auto   # repeat until a round finds nothing to do (--max-rounds=25)
node bot.js --apply --loop     # keep farming forever (every 30s)
node bot.js --apply --loop --every=60
node bot.js --apply --loop --cycles=20 # bounded loop: stop after 20 cycles
node bot.js --apply --no-collect      # skip currency orbs
node bot.js --apply --no-loot         # skip finished producers
node bot.js --apply --no-work         # skip resource work (rocks/trees/toolboxes)
node bot.js --apply --no-orders       # skip workshop orders
node bot.js --apply --no-crates       # never open crates
node bot.js --apply --crates=20       # open exactly 20 crates
node bot.js --apply --no-visitors     # don't collect pending visitor rewards
node bot.js --apply --no-level-rewards   # don't apply per-level crates/energy
node bot.js --apply --no-regen        # don't collect regeneration (4h reloads + crate/energy refills)
node bot.js --apply --reserve-energy=50  # never spend energy below 50 (leave some for yourself)
node bot.js --apply --loop --max-failures=0   # never auto-stop a long unattended run
node bot.js --apply --refresh         # allow session auto-renewal - will disconnect your client!
node bot.js --min=5                   # only 5-groups (bonus merges); default --min=3 uses both sizes
node bot.js --board                   # print the board even in loop mode
```

If you play **in parallel**, `--reserve-energy=N` keeps an energy buffer for you (the bot spends
shared energy on resource work otherwise). Crate/ingredient spending is not reservable.

**Crates default to `auto`**: open as many as the board can fit, bounded by your crate count. That is
the correct default because the generator stops at its stock ceiling, so hoarding throws regen away.
Use `--crates=N` for a fixed number or `--no-crates` to disable.

Loop mode keeps going on errors (it logs and retries next cycle), so it is safe to leave running.
Ctrl+C to stop.

**A plan already cascades merges.** `planMerges` feeds each merge's output back in until nothing can
merge again, so one round resolves the whole chain (27 `wheat_1` → `wheat_2` → `wheat_3` → `wheat_4`).
`--rounds=N` still repeats the full plan → save → re-read cycle N times, which now only catches what
becomes mergeable *after* the save (loot that materialised, crates that were opened, orders that
completed). The default is 1 round; `--rounds=auto` keeps going until a round finds nothing to do,
bounded by `--max-rounds` (default 25).

`state.json` is refreshed on every read; `state.bak.json` holds the previous snapshot so a bad
write can be diffed and rolled back.

## Recon tooling

> ⚠️ **`watch.js` opens a WebSocket.** The account allows only one socket (`single_socket`, §8 of
> MECHANICS.md), so running live capture **while you are playing** will boot your own session with
> the "Disconnected" screen. Close the game first, or accept that you will have to restart it.

The HARs' saves are *partial* (only the models each one touched), which is why replaying them
reconstructs real transitions. For anything **not** in the HARs, capture it live:

```
node watch.js 3 watch      # in one terminal - poll every 3s, snapshot on change
   ... play one action in-game ...
   Ctrl+C
node watchdiff.js          # shows exactly what that action persisted
```

```
node snap.js <label>              # snapshot live state -> snaps/<label>.json
node diff.js <a> <b>              # show exactly what changed between two snapshots
node watch.js 3 watch             # poll every 3s, save a snapshot whenever state changes
node watchdiff.js                 # show every change between consecutive watch/ snapshots
node verify.js                    # diff intended writes vs. what the server stored
node timers.js                    # correlate TimerModel with tile cooldown/resourceGate refs
node check_work.js                # live report of dispatched workers, gates and MapSource timers
node orders.js                    # read-only order report: slot states + craftable recipes
node scratch/check_session.js     # is the account still reachable over HTTP? (server up? token ok?)
node scratch/probe_socket_slot.js 30   # hold the socket 30s; reports if another session boots us
node scratch/regen_status.js      # live: per-generator readiness (due / ready-in / stock refill accrual)
```

The recon probes read their inputs from the repo root and honour `.env`: HAR scripts take the capture
from `FMV_HAR` (default `./capture_launch.har`; the level-up capture is `./capture_levelup.har`) and
the config dumps from `FMV_CFG` (default `./config`) — copy your exports in under those names, or set
the variables. `FMV_OUT`/`FMV_IN` name the intermediate JSON, `FMV_TRANS` the diff output:

```
FMV_HAR=...farm_merge_level_up.har   FMV_OUT=har_saves_levelup.json   node scratch/har_saves.js
FMV_IN=har_saves_levelup.json        FMV_TRANS=transitions_levelup.txt node scratch/har_transitions.js
FMV_IN=har_saves_levelup.json node scratch/inv_timeline.js   # one line per save: coins/crates/energy/level
FMV_IN=har_saves_levelup.json node scratch/claim_transitions.js  # reward-flag flips + the paired inventory delta
FMV_IN=har_saves_levelup.json node scratch/har_model.js DailyChallengeModel  # a model's final JSON
FMV_IN=har_saves_levelup.json node scratch/regen_timeline.js  # generator timer change vs. inventory delta, per save
FMV_HAR=... node scratch/har_rpc.js CLAIM_REWARD   # one RPC: sends paired with responses by cid
FMV_HAR=... node scratch/har_frame_order.js        # frame-ordered saves + reward calls, for alignment
```

```
node scratch/har_saves.js         # every SAVE_PLAYER_DATA_V2 in the HAR -> har_saves.json
node scratch/har_transitions.js   # replay those saves -> transitions.txt (every real transition)
node scratch/har_timers.js        # timers/workers/orders created by each action
node scratch/har_rpcs.js          # every HTTP request/URL in the captured HAR
node scratch/har_ws.js            # every RPC id sent/received over the HAR WebSocket
node scratch/har_frame.js <SUB>   # print the WS frames whose body contains <SUB>
node scratch/har_resp.js <SUB>    # print response bodies matching a URL substring
node scratch/har_ctx.js <SUB>     # print context around a substring anywhere in the HAR
node scratch/inspect_tiles.js     # group board tiles by component set, dump a sample of each
node scratch/timer_list2.js [SUB] # the final TimerModel as a table (id / label / duration / state)
node scratch/initial_timers.js    # TimerModels in a capture's READS (+ producer ids) - saves are partial
node scratch/producer_timing.js   # every tier-4 producer state change with real frame-to-frame deltas
node scratch/producer_lifecycle.js# the literal tile JSON at each stage (merge / materialised / depleted)
node scratch/producer_timer_removal.js # does the spent Cooldown timer get deleted on materialisation?
node scratch/producer_status.js   # live: each producer's stage, cooldown timer, elapsed
node scratch/harvestable.js       # the full `harvestable` component of each producer
node scratch/harvest_rounds.js    # harvestReward[round][slot]: chances + weights + removeReward
node scratch/daily_tasks.js       # live: every DailyChallengeModel target + TimedEventModel quest
node scratch/dc_timeline.js [IN]  # every DC counter change in a capture vs. the inventory delta
node scratch/dc_harvest_pair.js N # the full inv delta + tile before/after for save(s) N (the `harvest` pin)
node scratch/dc_snapshot.js N...  # a capture's DailyChallengeModel targets as save N wrote them
node scratch/te_dump.js           # live TimedEventModel (seasonal-pass quest + configs)
node scratch/nakama_surface.js    # every HTTP URL + WS rpc id in a capture, with shapes
node scratch/har_urls.js          # entries grouped by host + path prefix (is there any HTTP RPC?)
node scratch/regen_ceiling.js     # max crates/energy/gems reached across a capture (the ceiling hunt)
node scratch/dump_bp.js [ids...]  # resolved (inherited) blueprint components + which persist
node scratch/dump_mapsource.js    # resource-node step tables (cost/duration/rewards)
node scratch/dump_stats.js        # lifetime stats + level/exp progress
node scratch/status.js            # inventory/workers/orders + the regen timers
node scratch/levels.js            # per-level exp_to_next_level + rewards
node scratch/dump_models.js       # every non-tile model, compact
node scratch/jwt.js               # decode uid/exp of the stored vs. captured session tokens
```

The planner tests replay **real HAR numbers** and assert the exact outcomes (safe: no network):

```
node scratch/test_merge_max.js    # merge split + cascade, vs an exhaustive DP (PASS, 56 checks)
node scratch/test_rewards.js      # level-up + visitor rewards, HAR-exact (PASS, 8 checks)
node scratch/test_regen.js        # the three 4 h reloads + the two stock refills (PASS, 61 checks)
node scratch/test_harvest.js      # tier-4 producers: merge / materialise / repair, HAR-exact (PASS, 47 checks)
node scratch/test_daily.js        # daily + season counters: the four task units, HAR-exact (PASS, 25 checks)
node scratch/test_order_chain.js  # order completion + collection land in one save
node scratch/test_refresh.js      # session renewal extends expiry and rotates the refresh token
```

All of them except `test_refresh.js` are pure fixtures (no network, no writes) — that is what
`npm test` runs. `test_refresh.js` talks to the server and **renews your session**, so run it only
when you are not playing.

## Files

| Path | Role |
|---|---|
| `fetch_config.js` | downloads the game's config jsonpacks into `CFG_DIR` (`npm run config`) |
| `package.json` | scripts (`config` / `dry` / `apply` / `loop` / `verify` / `test`) and `engines: node >= 22` |
| `bot.js` | CLI entry point / loop |
| `watch.js` / `watchdiff.js` | live state polling + consecutive-snapshot diffing |
| `snap.js` / `diff.js` | labeled before/after snapshots |
| `verify.js` | diff intended writes vs. what the server stored |
| `lib/proto.js` | protobuf encode/decode, `encodeModelEntry`, `decodeModels` |
| `lib/nakama.js` | `httpRpc`, `wsRpc`, session load/refresh |
| `lib/solver.js` | `planMerges` (+`bestSplit`, `MERGE_SIZES`), `planLoots`, `buildUpdates` (merges + collects + loots + work + orders + producers + crates + rewards + bookkeeping) |
| `lib/env.js` | `.env` loader + `CFG_DIR`/`cfgPath` (zero deps); every secret and path comes from here |
| `lib/harvest.js` | tier-4 producers: `isProducer`, `producerState`, `drawHarvest`, `planMaterialisations`, `planRepairs`, `buildHarvestUpdates` (§4) |
| `lib/work.js` | resource work: `planWork` (dispatch), `planCompletions`, `buildWorkUpdates` |
| `lib/crates.js` | crate opening: `objectPool`, `drawCrate`, `buildCrateUpdates` |
| `lib/orders.js` | orders: `planOrderStarts/Collects/Completions`, `buildOrderUpdates` |
| `lib/rewards.js` | client-applied rewards: `levelRewards`, `pendingVisitorRewards` (§9) |
| `lib/regen.js` | regeneration: `GENERATORS` (4 h reloads), `PASSIVE` (crate/energy stock refills), `loadCeilings`, `planRegen`/`planPassive`, `buildRegenUpdates`, `NOT_AUTOMATED` (§10) |
| `lib/daily.js` | daily-challenge + seasonal-pass counters: `buildTaskUpdates` (§9) |
| `lib/blueprints.js` | `resolveBlueprint`, `persistedState`, `applyExp`, `splitTier`, `unlockedFamilies` |
| `lib/board.js` | `tiles`, `printBoard`, `byBlueprint`, `freeCells`, `emptyTile`, `filledTile` |
| `lib/deep.js` | `canonical`, `deepEqual` (the server re-orders JSON keys) |
| `lib/creds.js` | `SERVER_KEY`, `DISCORD_ID`, `APP_ID` — read from `.env` (no hardcoded values) |
| `timers.js` | correlate `TimerModel` with tile `cooldown`/`resourceGate` refs |
| `check_work.js` | live report of dispatched workers, gates and `MapSource` timers |
| `orders.js` | read-only order report: slot states + currently craftable recipes |
| `scratch/` | 117 one-off probes/dumps used during decoding, plus 7 `test_*` fixture suites; kept for reference (they read their inputs from `FMV_HAR` / `FMV_CFG`) |
| `har_saves.json` / `transitions.txt` | generated: the `farm_merge_launch.har` decode, diffed — git-ignored |
| `har_saves_levelup.json` / `transitions_levelup.txt` | generated: the `farm_merge_level_up.har` decode (87 saves) — git-ignored |
| `state.json` | the bot's last-known board/inventory/timers (written by `--apply`) — git-ignored |
| `session.json` | the stored Nakama session (player's token, used over HTTP only — see §8) — **git-ignored** |
| `.env` / `.env.example` | credentials and paths — `.env` is **git-ignored**, `.env.example` is the tracked template |
| `.gitignore` | excludes `.env`, `session.json`, `state*.json`, `snaps/`, `watch/`, `*.har`, `config/` — no secret or game asset is committed |
| `MECHANICS.md` | every transition decoded from the HAR |

## Status

**See [`MECHANICS.md`](MECHANICS.md)** — the HARs' saves are *partial*, so replaying them in order
reconstructs every transition exactly. Mining, crate-opening, orders, level-up rewards and visitor
rewards are all decoded there.

| Action | Status | Notes |
|---|---|---|
| Merge | done + verified | groups of **3 → 1** (`totalNormalMerges`) and **5 → 2** bonus merges (`totalBonusMerges`); EXP is per output tile, so the planner maximises output (5-groups first, then 3s) and resolves the whole cascade in one plan. `--min=5` for bonus merges only (§6) |
| Collect currency orbs | done + verified | |
| Loot producers (`lootable`) | done + verified | `loot` is already rolled — no RNG needed |
| Resource work start (dispatch a worker) | done + verified | `--no-work` to skip |
| Resource work completion | done + verified | |
| Open inventory `crates` | done + verified | `N/40` is the generator's stock ceiling, not a counter cap (`crates` reached 75); defaults to `--crates=auto` (all that fit), `--crates=N`, `--no-crates` |
| Harvest tier-4 producers (`cooldown` -> `lootable`) | **done + pending live verify** | the cooldown timer is `Cooldown:<row>,<col>` at **1800000 ms (30 min)**; the bot arms new producers, materialises landed ones, and repairs the 19 inert ones (§4). `--no-producers` to skip |
| Open `reward_crate_*` tiles | not implemented | keys now arrive from opening crates (§7); the key-spend transition is unobserved |
| Orders — start / complete / collect | **done + verified** | `--no-orders` to skip; completion + collection chained into one save |
| Claim level-up rewards | **done + verified** | captured 13 → 14 (§9): level-up save has no reward, the **next** save adds `crates +10`, `energy +10`; every level 4–130 pays the same. `--no-level-rewards` to skip |
| Collect visitor ("train") rewards | **done + verified** | `VisitorRewardModel.reward[]` is credited to the inventory and the model reset to `{reward:[],player:null}`; `--no-visitors` to skip |
| Collect time-based reloads | **done + verified** | `+10 crates` / `+5 gems` / `+5 energy` per 4 h (§10); credited when `MarketplaceModel.data.stock` says a refill is banked **or** the 4 h clock has landed, catch-up clamped to one refill per generator per save, and the stock is spent in the same save; `--no-regen` to skip |
| Passive stock refills | **done + verified** | `crates_generator` **+5 crates / 5 min** (ceiling **40**) and `energy_generator` **+1 energy / 3 min** (ceiling **50**) (§7, §10); ceilings read from `config_jsonpack.json`, grant clamped to the ceiling, clock reset to now and `regenerate_<name>` re-armed exactly like the client's own write; skipped fail-closed if the config pack is missing |
| Daily challenges (`DailyChallengeModel`) | progress done + verified, claims not | the counter units are pinned (§9); the `collected` claim payout is still unobserved, so the bot stops at `targetAmount` |
| Seasonal pass quest (`TimedEventModel`) | **done + verified** | `activeQuest.progress` for `order.rewarded`, matched on `taskAction` (§9) |

Not touched on purpose: `UserStatsModel` counters other than XP/merges, and Discord itself.

### The `duration / 2` rule

Three independent samples agree that a persisted config `duration` (in seconds) becomes a timer of
`duration * 500` ms:

| source | config `duration` | timer created |
|---|---|---|
| `mapSource` step (tree_medium, step 3) | 180 s | `MapSourceCooldown:60,62` -> **90000 ms** |
| `recipe` (`recipe_pancakes`, bakery) | 600 s | `Order_bakery` -> **300000 ms** |
| `harvestable` (chicken_4, tier-4 producer) | 3600 s | `Cooldown:66,71` -> **1800000 ms** |

The earlier confusion over the mining timer was a misreading: `60,62` in that label is the tile's
**row,col**, not a duration, and the persisted gate being compared against was the *next* step's
gate, not the dispatched one. `lib/work.js` implements the rule as `COOLDOWN_MS(d) = d * 500`.

