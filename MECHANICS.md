# Mechanics decoded from the HAR

All of this comes from the 36 `SAVE_PLAYER_DATA_V2` calls in `farm_merge_launch.har`.
Those saves are **partial** — each one carries only the models it touched — so replaying them in
order reconstructs every transition exactly. See `scratch/har_saves.js`,
`scratch/har_transitions.js`, `scratch/har_timers.js` and the generated `transitions.txt`.

Timestamps are epoch ms; the local clock matches the game clock (the `.5` values are just
interpolated fractions). `GET_SERVER_TIME` returns an **opaque encoded string**, not a number.

---

## 1. Resource work — chopping trees, mining rocks, toolboxes

### Start (one worker dispatch)

Observed: `rock_small` @ (60,62), `hitpoints.current 2 -> 1`, energy `185 -> 160`.

```
TilesStateModel_60:62
  - {"blueprint":"rock_small","data":{
       "hitpoints":{"startAsVisible":false,"max":3,"current":2},
       "resourceGate":{"cost":[{"key":"energy","amount":10}],"workers":1,"duration":60}}}
  + {"blueprint":"rock_small","data":{
       "hitpoints":{"startAsVisible":false,"max":3,"current":1},
       "workerData":{"id":1},
       "cooldown":{"timerId":2165}}}

GameWorkersModel  (created on first ever use)
  {"data":{"workers":[{"id":1,"source":{"type":"default"}}],"nextWorkerID":2},"version":3}

TimerModel  (+1 timer, nextTimerId 2163 -> 2166)
  {"id":2164,"label":"WorldToLifeIntervalTimer","state":"ACTIVE","started":...,"duration":68000,"timeSource":"server"}
  {"id":2165,"label":"MapSourceCooldown:60,62","state":"ACTIVE","started":...,"duration":90000,"timeSource":"server"}

WorldToLifeModel
  {"data":{"intervalTimer":2164,"activeAnimations":[]}}     // 2157 -> 2164

InventoryModel      energy 185 -> 160
UserStatsModel      totalSpentEnergy 1665 -> 1690, totalMinedRocks 44 -> 45
```

### What that save actually contains — completion **and** dispatch

The saves are partial, so a single save can hide two events. Re-read carefully, this diff is
**step 2 finishing** and then **step 3 being dispatched**, and that is what explains the `25`:

| event | effect |
|---|---|
| step 2 completes (cost 10) | 4x `stone_1` spawn — exactly step 2's `rewards`; `current` 2 -> 1; **energy -10** |
| step 3 dispatched (cost 15) | gate stripped, `workerData` + `cooldown` added; **energy -15** |

`10 + 15 = 25` — exactly the energy drop **and** the `totalSpentEnergy` rise. So a step's cost is
simply `gate.cost`, charged once per step.

### The rules

Step tables come from the blueprint config (identical schedule for rocks, trees and toolboxes):

```
mapSource.steps["1".."n"] = { cost, duration, rewards }
cost     :  5  10  15  20  25  30  35  40  45  50
duration : 30  60 180 300 500 900 1800 3000 4800 7200   (seconds)
```

`hitpoints.max` equals the step count (`*_small` 3, `*_medium` 5, `*_large` 10), and the persisted
gate is a verbatim copy of the step about to run:

```
stepIndex = hitpoints.max - hitpoints.current + 1
gate.cost     === step.cost
gate.duration === step.duration      (seconds — this IS the work duration)
gate.workers  === 1
```

**Dispatch** (worker goes to the tile):
1. strip `resourceGate`, add `workerData:{id}` + `cooldown:{timerId}`
2. add a `MapSourceCooldown:<row>,<col>` timer, bump `nextTimerId`
3. spend `step.cost` energy, `totalSpentEnergy += step.cost`
4. `totalMinedRocks++` (rock) / `totalChoppedTrees++` (tree)
5. `hitpoints.current` is **not** touched here

**Completion** (once `step.duration` has elapsed):
- non-final step: spawn `step.rewards` onto free cells, `hitpoints.current -= 1`, install the next
  step's gate
- final step (`current == 1`): leave `lootable:{loot:step.rewards, lootingRemovesObject:true}` on
  the tile; looting then spawns the items and clears the node
- either way the tile's `cooldown` timer is removed

### Two loose ends (both benign)

1. **The cooldown timer is not the work timer.** `MapSourceCooldown` was created with
   `duration: 90000`, yet it was cleared ~68s later — i.e. on the next `WorldToLifeIntervalTimer`
   tick, long before it expired. So it is a soft "tile is busy" lock, not the completion clock.
   Completion is `started + step.duration*1000`, and we do it ourselves. The dispatch in that save
   was **step 3** (180s), and `90000 == 180s/2`, so `lib/work.js` uses `duration/2`. A later live
   dispatch of a 180s step produced a 90s cooldown, matching the only sample; still a
   single-sample rule, one line to change.
2. **`totalMinedRocks` placement.** It rose by 1 in a save containing one dispatch, so the counter
   is bumped at dispatch. Toolboxes have no analogous counter, so none is touched for them.

`WorldToLifeIntervalTimer` also ticks in the same save, but it ticks every ~60s regardless — it is
not part of the dispatch.

---

## 2. Opening crates

Observed: one save that opens **4** crates.

```
InventoryModel        crates 175 -> 171          // -4
PseudoRandomnessModel updated (weighted-roll bookkeeping)
DailyChallengeModel   target "spend.crates" progressed

TilesStateModel_61:65  null -> goat_1
TilesStateModel_61:66  null -> wheat_1
TilesStateModel_62:65  null -> chicken_1
TilesStateModel_62:67  NEW  -> goat_1
```

So: **`inventory.crates -= n`, and `n` random tier-1 items spawn onto free tiles.**
`PseudoRandomnessModel` is the weighted-picker state; entries look like:

```json
{"context":"flash_deal_ingredient","items":[
  {"key":"milk","cooldownAmount":1,"weightIncrease":0,"unsuccesfulAttempts":0}
]}
```

Note: `crates` here is an **inventory counter**, separate from `reward_crate_*` tiles (which are
key-gated objects — `reward_crate_silver` needs 2x `reward_crate_key_silver` to open).

**Blocker:** reproducing the item roll requires implementing the exact weighted RNG in
`PseudoRandomnessModel`. Without it the spawned items would be arbitrary rather than authentic.

---

## 3. Orders

The config side is now fully resolved; only the slot state machine is partly inferred.

### Recipes — `recipes_jsonpack.json` (81 entries)

```json
"recipe_apple_cider": {
  "duration": 300,
  "ingredients": [{"key":"apple","amount":8},{"key":"sugarcane","amount":3}],
  "reward": ["coin_3","coin_3"]
}
```

`duration` is in **seconds** and equals the timer exactly — `Order_bakery` was observed at
`duration: 300000` for a 300s recipe. Rewards are coin **blueprints**, i.e. they spawn as tiles.

### Workshops — `buildings_jsonpack.json` (keys are `<id>_config`)

```json
"dairy_config": {"ID":"dairy","isWorkshop":true,"cooldown":3,"defaultState":0,
  "availableRecipes":["recipe_cheese","recipe_butter","recipe_goat_cheese","recipe_goat_yoghurt"]}
```

16 workshops: `bakery, barista, bbq, building_apple_delights, building_avocadofiesta,
building_bee_food_truck, building_casa_de_alpaca, building_pink_pony_club, building_trufflelicious,
catmobile, dairy, dogtruck, loom, market, sweets, tomato_on_wheels`.

`cooldown: 3` is **seconds**, matching the observed `Cooldown_<building>` timer at `duration: 3000`.

### Slot state machine — decoded from the HAR

`OrdersModel.data` is a slot list. Transitions observed in HAR saves [15], [17], [22], [23]:

| state | meaning | evidence |
|---|---|---|
| 0 | idle | `{"state":0,"recipe":"recipe_goat_cheese","buildingID":"dairy"}` |
| 1 | offered, ready to start | `{"state":1,"recipe":"recipe_eggs","buildingID":"market"}` |
| 2 | cooking | gains `timerId` -> the `Order_<building>` timer |
| 3 | cooked, awaiting collect | |

**Start a craft** (state 1 -> 2):
- slot gains `timerId` and `state:2` — save [23]: bakery/pancakes `state:1` -> `state:2, timerId:2162`
- **ingredients are deducted from `InventoryModel`** — save [23]: `egg 7 -> 2`, `sugarcane 18 -> 10`
- a new `Order_<building>` timer is created

**Finish** (state 2 -> 3) happens when that timer elapses. If the recipe is short enough it can
start *and* finish inside one save gap, so a diff may jump `1 -> 3` — save [22]: market/eggs
`state:1` -> `state:3`, with `egg 10 -> 7` confirming the start really happened.

**Collect** (state 3 -> removed):
- the slot is deleted from the list — saves [15] and [17]
- a `Cooldown_<building>` timer (3000 ms) is created **and** `buildings.<id>.cooldownTimerID` is set
  to it — save [23]: `market.cooldownTimerID = 2161`
- `TimedEventModel...activeQuest.progress` increments (`taskAction:"order.rewarded"`);
  save [22] shows it reaching `amount:3`, then resetting to `0` with a fresh `amount:5` quest
- *sometimes* a fresh `state:1` slot is appended for a different building — save [17] appended
  `{"buildingID":"market","recipe":"recipe_eggs","state":1}` while save [15] appended nothing

**Timer duration is `recipe.duration / 2` seconds.** The observed `Order_bakery` timer was
`duration: 300000` for `recipe_pancakes` whose config `duration` is 600. This is the same `/2` seen
for `MapSourceCooldown` (180s step -> 90000ms), so two independent samples agree.

`BuildingsModel.data.buildings.<id>` holds `{level, state, cooldownTimerID?}`. `<id>.state` is a
*building* state (0 broken / 2 built), **not** the order state — live, `dairy` is `state:2` with an
`idle` order while `bakery` is `state:2` with a `cooked` one. `cooldownTimerID` appears only between
collect and the cooldown timer being cleared (save [17] moved it from `market` to `bakery`).

### Resolved: where the reward lands

It was a reading error, not a mystery — the reward **spawns as tiles on the board**, in its own
one-model save. SAVE [16] contains nothing else:

```
  * TilesStateModel_73:71
      NEW: {"data":{"state":{"blueprint":"coin_2","data":{...}}},"version":1}
```

That is the payout for the `recipe_milk` collect in SAVE [15]. Reading only SAVEs [15] and [17] is
what made it look unpaid. `recipe_milk`'s config reward is `["coin_2"]`, an exact match.

### Still unverified — do not guess these

- **The rule for appending a new `state:1` slot** — it happened after one collect and not the other,
  and the replacement's building/recipe looks arbitrary. Almost certainly a server-side offer, so
  not ours to write.
- Whether `state:0` slots are ever started, or are placeholders for a locked building.

Implemented in `lib/orders.js` (start / complete / collect, plus collect-cooldown expiry).
**Completion and collection are chained into one save**: the collect phase reads the in-memory
`work` slot list rather than the pre-save models, so a slot that finishes in this save is collected
in the same write instead of waiting a round-trip for the next one. `orders.js` is the read-only
reporter.

---

## 4. Bonus — harvesting animals and crops

### Only tier-4 producers are harvestable

Resolving every blueprint and looking for a `harvestable` component returns **25 blueprints**, of
which **23 are `*_4`** (the max tier). The exceptions are the two decorative buildings `gazebo` and
`greenhouse`.

```
alpaca_4 apple_4 avocado_4 bee_4 carrot_4 cat_4 chicken_4 coffee_4 corn_4 cow_4 deer_4 dog_4
goat_4 golden_christmas_tree_4 horse_4 pig_4 sheep_4 soybeans_4 sugarcane_4 sunflower_4 tomato_4
trufflepig_4 wheat_4                    plus gazebo, greenhouse
```

Tiers 1–3 have **no** `harvestable` component at all. This is why the live board looks completely
idle: it holds only `chicken_2`, `cow_1`, `goat_2`, `wheat_1`, `carrot_1/2`, `sugarcane_1/2` … and
none of those produce. The HAR's producing tiles were exactly `chicken_4`, `cow_4`, `wheat_4`,
`carrot_4`, `sugarcane_4`, `goat_4`, and `PseudoRandomnessModel` carries matching `*_4` contexts.
So "production materialisation" is real, and after the 2026-10-16 fix it is implemented for the
board's own producers (§4 below).

### Where production timing lives — **solved 2026-10-16**

A new producer is written complete: merging three `*_3` yields

```json
{"cooldown":{"timerId":2129},"hitpoints":{"startAsVisible":false,"max":1,"current":2}}
```

`hitpoints.current` is the `harvests` count from the config (2), not a hit count — and `max` is 1.
**The timer is real and was recorded — just never in a save.** `SAVE_PLAYER_DATA_V2` payloads are
partial: they carry only the *models that changed*, so "the id appears in no save" proves nothing. The
session's **initial read** carries it:

```
GET_ALL_PLAYER_DATA_V2   2026-10-16T09:24:13Z
  {"id":2129,"label":"Cooldown:66,71","state":"ACTIVE","started":1792086244134,
   "duration":1800000,"timeSource":"server"}
```

All six producer timers are there (2115 / 2116 / 2120 / 2123 / 2126 / 2129) and **the duration is
1800000 ms = 30 min**. That pins the scaling rule: `harvestable.duration` 3600 s x **500** ms =
1800000. The label is `Cooldown:<row>,<col>` — the cell the merge *kept*, which is not always where
the tile ends up (2129's label is `66,71` while its tile sits at `66,72`; a moved tile keeps its
original label).

**Materialisation is driven by an expired timer, and the spent timer is deleted.** Replaying the
launch capture with the real per-frame timestamps (`_webSocketMessages[].time` is epoch seconds —
`har_saves.js` had discarded it in favour of the entry's `startedDateTime`, which is identical for
every frame of a socket):

| when | what |
|---|---|
| read 09:24:13Z | six `Cooldown:*` timers, `started` ~15.7 h earlier, `duration` 1800000 |
| save t+0.0 s | all six **deleted** from `TimerModel` (already overdue at load) |
| save t+6.3 s | tiles still carry `cooldown#…` (tile writes lag the timer sweep) |
| save t+10.0 s | tiles materialise: `cooldown` dropped, `lootable` added |

A producer whose `cooldown.timerId` points at **no** timer never materialises — the client has no
timer to expire. Together with the empty-`data` bug below, that is why the live producers sat inert
for hours.

`PseudoRandomnessModel` is the producers' **pity state**, not a clock: a flat list of per-context roll
state (`{"items":[{"key":"upgrade_card_1","cooldownAmount":0,"weightIncrease":19.125,
"unsuccesfulAttempts":0},{"key":"wheat",…}],"context":"wheat_4"}`), one context per producer family.
It is updated by the loot roll (§5).

**Consequence:** production is fully reproducible. `lib/harvest.js` arms a new producer with exactly
the tile and timer above and materialises any producer whose timer has elapsed (or vanished), rolling
the loot from `harvestable.harvestReward` (§5).

### The inert producers — fixed by `planRepairs`

The live board (2026-10-16) held **19 tier-4 producers** — `goat_4` x4, `wheat_4` x3, `carrot_4` x3,
`cow_4` x3, `chicken_4` x3, `sugarcane_4` x3 — every one with **empty tile data (`{}`)**, because
`persistedState` only carries `PERSISTED_KEYS` and `harvestable` is not among them. So the merge write
produced *inert* producers where the game produces working ones: they cannot merge, cannot be looted
and never produce. `planRepairs` gives each a fresh 30-minute cooldown, after which the normal path
takes over.

### The `harvestable` config

Every producer shares the same shape:

| field | value |
|---|---|
| `harvests` | `2` |
| `duration` | `3600`; the timer that lands it carries `3600 x 500 = 1800000` ms (**30 min**, observed) |
| `harvestReward` | 4 rounds of **5 / 6 / 7 / 8** chance-gated drops |
| `removeReward` | the final-stage loot list (see below) |
| `removalCost` | `{cost:{key:"energy",amount:0},duration:0}` — free for all 25 |

Each group is a list of independent drops, so a harvest yields roughly 4–8 items:

```json
{"chance":100,"items":[{"key":"egg","weight":250},
                       {"key":"upgrade_card_1","weight":0.25,
                        "unsuccessfulAttemptsThreshhold":1,"increaseWeightAmount":0.375}]}
```

`harvestReward` is indexed **`[round][slot]`**, and `round` is the producer's harvest index
(`harvests - hitpoints.current`, so a fresh producer is round 0). Round 0 of *every* tier-4 producer is
the same shape — chances `100, 100, 100, 50, 25` — and later rounds add slots (`100/100/100/100/50/50`,
then 7, then 8). Each slot rolls `chance`; if it fires, one `items` entry is drawn by weight. With all
five slots firing and `egg` winning every pick, round 0 yields exactly five eggs — which is the
capture's own `chicken_4` loot, and `cow_4`'s four milks are the same round with the 25 % slot failing.
`scratch/test_harvest.js` feeds those two rng values in and asserts both arrays byte-for-byte.

Animals give their produce (`egg`, `milk`, `goatmilk`, `bacon`, `wool`) or `coin_2`; the dual-purpose
animals (`alpaca`, `bee`, `cat`, `deer`, `dog`, `horse`, `trufflepig`) also give a collectible
(`alpacawool`, `honey`, `catbell`, `fur`, `dogball`, `horseshoe`, `truffle`); crops give `<crop>_1`.
Every producer can additionally drop `upgrade_card_1`, and that's the only entry with pity fields —
exactly the pattern section 5 describes. The pity state is the producer's `PseudoRandomnessModel`
context, so `lib/harvest.js` advances it with the roll.

Note the loot keys are **not** consistently ingredients: `egg`, `milk`, `goatmilk`, `wheat`, `carrot`
and `sugarcane` are `InventoryModel` counters (looting credits them), while `upgrade_card_1` is a tile
that spawns on the board. `lib/solver.js` already routes on exactly that distinction.

### The `cooldown -> lootable` transition

Production finishes when the `duration` timer elapses:

```
chicken_4  {cooldown:{timerId:2129}, hitpoints:{max:1,current:2}}
        -> {hitpoints:{max:1,current:2}, lootable:{loot:["egg","egg","egg","egg","egg"], lootingRemovesObject:false}}

cow_4      -> lootable loot ["milk" x4]
wheat_4    -> lootable loot ["wheat" x5]
carrot_4   -> lootable loot ["carrot" x4]
sugarcane_4-> lootable loot ["sugarcane" x6]
```

The observed quantities (5, 4, 5, 4, 6) all fall inside the 5–8 drop range above, which is a good
sanity check on the reading.

Looting it:

```
chicken_4 -> {depleted:{}, hitpoints:{max:1,current:1}, lootable:{loot:["coin_2"], lootingRemovesObject:true}}
wheat_4   -> {depleted:{}, hitpoints:{max:1,current:1}, lootable:{loot:["wheat_1","wheat_1"], lootingRemovesObject:true}}
```

**These two are now confirmed against the config, not just observed.** `removeReward` in the
blueprint *is* that `loot` list: `chicken_4` is `["coin_2"]` and `wheat_4` is
`["wheat_1","wheat_1"]` — an exact match, including the duplicate. The dual-purpose and crop
producers carry a two-element `removeReward` (two tiles), the plain ones a single element.

So a producer has **two loot stages**: the production (`lootingRemovesObject:false`, resources into
inventory) then an exhausted stage (`lootingRemovesObject:true`) that drops `removeReward` onto the
board and then disappears.

Other models seen: `DetachedObjectsModel` holds an object mid-drag/relocation
(`{"<row>:<col>":{blueprint,data}}`), `StorageBubbleModel`, `PseudoRandomnessModel`,
`DailyChallengeModel`, `AnalyticsModel.onboardingSteps`.


---

## 5. Loot spawning - "controlled randomness"

This is the piece that gates crate opening and the final depleted loot (production *completion*
turned out to be timer-driven, not a roll - §4). It is **not** a black box: the pools are in
`controlled_randomness_jsonpack.json`, and producer drops use the same machinery with the table
carried in the blueprint's `harvestable.harvestReward` (§4).

```json
"controlled_randomness_coins_config": [
  {"key":"coin_1","weight":100,"unsuccessfulAttemptsThreshhold":0,"increaseWeightAmount":0,
   "cooldownDuration":0,"spawnFromLevel":1},
  {"key":"coin_2","weight":10, ...}
]
```

Config keys: `controlled_randomness_{coins,gems,crate,reward_crate,reward_crate_key,item_tier}_config`.

The state side is `PseudoRandomnessModel`, a pity/streak system:

```json
{"context":"flash_deal_ingredient","items":[
  {"key":"milk","cooldownAmount":1,"weightIncrease":0,"unsuccesfulAttempts":0}
]}
```

Reading the two together, a spawn is:

1. build the candidate pool for the context (config `weight`, filtered by `spawnFromLevel`)
2. an item whose `cooldownAmount > 0` is unavailable (it was just drawn)
3. once its `unsuccesfulAttempts` passes `unsuccessfulAttemptsThreshhold`, its weight is raised
   by `increaseWeightAmount`
4. draw a weighted item; reset that item's `unsuccesfulAttempts` and set
   `cooldownAmount = cooldownDuration`; increment the others

Only the underlying PRNG sequence is unknown, so rolls would match the **distribution** exactly
but not any specific historical sequence. That is enough to drive crates and production.

## 6. Tiers and level unlocks

Items are named `<family>_<tier>` (`wheat_1`, `chicken_4`, …). Every family tops out at **tier 4**
(`lib/blueprints.js: maxTier`), and the only way to get a tier-4 item is to merge up to it — which
is why tier-4 producers are both the most valuable and the hardest to reach.

### What each level unlocks

`progression_jsonpack.json` → `progression_per_level.levels.<n>.items_unlocked` is the level gate.
130 levels, and it lists **only** the tiered item families (resource nodes, tools and crates all
come from elsewhere). First appearance of each family:

| L | family | L | family | L | family | L | family |
|---|---|---|---|---|---|---|---|
| 1 | wheat | 26 | corn | 65 | trufflepig | 101 | bee |
| 3 | chicken | 30 | sheep | 71 | apple | 110 | cat |
| 4 | cow | 37 | coffee | 81 | alpaca | 120 | dog |
| 7 | sugarcane | 43 | deer | 91 | horse | | |
| 9 | carrot | 50 | tomato | | | | |
| 11 | goat | 55 | avocado | | | | |
| 14 | soybeans | | | | | | |
| 17 | pig | | | | | | |
| 21 | sunflower | | | | | | |

That is 22 families. Levels that unlock nothing (`2, 5, 6, 8, 10, 12, 13, 15, 16, …`) exist too —
they only carry `exp_to_next_level`.

### Why this matters — the crate family pool

A crate's `object` result is **family × tier**, and the two halves come from different places:

- **family** — uniformly over the families unlocked *at the player's level*
- **tier** — `controlled_randomness_item_tier_config`: `tier_1` 100, `tier_2` 10, `tier_3` 1,
  `tier_4` **0** (present but never drawn until the game raises it)

At level 13 that is exactly `wheat, chicken, cow, sugarcane, carrot, goat` — the list that used to be
hardcoded in `lib/crates.js`. So the old constant was a *snapshot of the player's level*, not a game
constant, and it silently goes stale. `objectPool()` now derives it, so soybeans (L14), pig (L17) …
dog (L120) join automatically, along with any future tier the config gains.

Verified: `unlockedFamilies(progression, 13, bps)` is byte-identical to the old constant, and a
30k-draw simulation reproduces the configured tier odds (~100 : 10 : 1) with a uniform family split.

### Cross-check: only tier 4 produces

The 25 harvestable blueprints (§4) line up with this table: 23 are `*_4`, the max tier, and the
`PseudoRandomnessModel` contexts are `wheat_4`, `chicken_4`, `cow_4`, `sugarcane_4`, `carrot_4`,
`goat_4` — the tier-4 forms of the families unlocked at the level that save was taken from.

### Merging — 3 -> 1, and the 5-merge bonus — **solved 2026-10-17**

`mergeable` is only `{target, expReward}`: there is **no merge-amount, group-size or bonus field
anywhere** in `blueprints_jsonpack.json` / `config_jsonpack.json`, and `expReward` is `3/9/27` by tier
(`wheat_1 -> wheat_2` 3, `coin_2 -> coin_3` 9, `sugarcane_2 -> sugarcane_3` 9, `cow_3 -> cow_4` 27).
So the rule has to be read off the saves, and **EXP is the reliable signal**: HAR tile-count deltas
are noisy because drags relocate displaced tiles and ~300 of ~400 board cells never appear in a
capture at all, but a save's `exp` delta and `UserStatsModel` deltas are exact.

Two group sizes exist, and **EXP is paid per output tile**:

| group | result | EXP | counter |
|---|---|---|---|
| **3 identical** | 1 x next tier | `expReward(source)` | `totalNormalMerges` |
| **5 identical** | **2 x next tier** | **2 x `expReward(source)`** | `totalBonusMerges` |

The evidence (`farm_merge_level_up.har`, `scratch/dc_harvest_pair.js` dumps before/after tile JSON):

| save | counters | `exp` | tiles |
|---|---|---|---|
| **21** | `totalBonusMerges` 303 -> 304 | +6 | **all five inputs visible**: `wheat_1` at `62,65` / `70,70` / `71,74` -> empty, at `71,72` / `71,73` -> `wheat_2` |
| **28** | `totalBonusMerges` 305 -> 306 | +18 | `cow_2` -> **two** `cow_3` (`69,71`, `69,72`) with `70,71` / `70,72` consumed; 18 = 2 x 9 |
| **38**, **58** | `totalBonusMerges` +1 | +6 | `carrot_1` -> **two** `carrot_2`; 6 = 2 x 3 |
| **35** | `totalNormalMerges` 1195 -> 1196 **and** `totalBonusMerges` 306 -> 307 | +9 | one 3-merge **and** one 5-merge of `sugarcane_1`: 3 + 6 = 9. The same write also carries a drag (`sugarcane_2` -> empty at `67,71`), so it is cited for the counters, not the tile count |
| **36** | `totalBonusMerges` *unchanged* | +18 | 6 `sugarcane_2` -> 2 `sugarcane_3` = **two 3-merges**, not a bonus |

Save 36 is the control: **exactly 5** is the trigger, not "5 or more". Save 35 settles the counters —
a bonus merge bumps `totalBonusMerges` *only*, so a save with one of each moves both by one.

The client agrees from three directions: the effect alias `merge_bonus_effect` is driven by the image
**`Merge_5_Floter`**; the onboarding has `merge_bonus_1` / `merge_bonus_2` steps alongside
`onboarding_merge_info` and `merge_2_tooltip`; and `UserStatsModel` carries `totalBonusMerges` next to
`totalNormalMerges` (live 309 / 1240). `totalMergedCrops` and `totalMergedAnimals` are both **0**
despite those 1240 merges, so they are not per-merge counters and are left alone.

#### Maximising output — `lib/solver.js bestSplit`

Because EXP is per output tile, **maximising output tiles maximises EXP**. For `n` identical tiles,
choosing `b` 5-groups and `a` 3-groups gives `outputs = 2b + a` subject to `5b + 3a <= n`, and
`f(b) = floor((n-5b)/3) + 2b` is non-decreasing in `b`, so the optimum is at the largest legal `b`:

```
b = floor(n / 5)          a = floor((n mod 5) / 3)
outputs(n) = 2*floor(n/5) + floor((n mod 5)/3)
```

Ties (`n = 6, 7, 12, 14, 27, …`, where an all-3 split reaches the same output count) go to the split
with **more 5-groups**, because it spends fewer tiles per output and the tiles it does not spend stay
on the board as banked value, merging as soon as supply arrives. `n = 27` is five 5-groups (25 tiles
spent, 2 banked) rather than three 5-groups plus four 3-groups (27 spent, none banked): both give 10
outputs, but the second destroys 2 tiles for nothing.

The gain over the old 3-merges-only policy is ~20% of output:

| board | 3-merges only | maximising split |
|---|---|---|
| 5 tiles | 1 output, 3 exp | **2 outputs, 6 exp** |
| 8 tiles | 2 outputs, 6 exp | **3 outputs, 9 exp** |
| 27 tiles | 13 outputs, 81 exp | **15 outputs, 93 exp** |

`planMerges` emits the whole cascade in **one plan**: each tier's outputs are fed back in and the
planner iterates to a fixpoint, so 27 `wheat_1` resolves `wheat_2` -> `wheat_3` -> `wheat_4` without
waiting for a second round. Moves are emitted lowest tier first, so replaying them never consumes a
tile that does not exist yet. A move carries `keeps` (1 cell for a 3-merge, **2** for a bonus merge),
`consume` (3 or 4 cells) and `bonus`; a cascade legitimately rewrites a cell it produced (the spine of
the cascade), which is safe because `SAVE_PLAYER_DATA_V2` is a map keyed by cell, so only the final
state goes on the wire. A bonus merge that lands on a tier-4 producer produces **two** producers, each
getting its own `Cooldown:<row>,<col>` timer (§4).

`--min=N` is the smallest group size allowed: `3` (default) uses both sizes, `5` uses bonus merges
only, anything higher merges nothing.

`scratch/test_merge_max.js` checks the split against an **exhaustive DP over group sizes** for every
`n = 1..60`, the 27-tile cascade (move order, residues, 15 outputs, 93 exp, both counters, the
`InventoryModel` write, and that each cell ends in the state of the last move touching it), a bonus
merge into a tier-4 producer (two tiles, two timers), and the `--min` gates — **PASS** (56 checks).

## 7. Regeneration ceilings, and why "open everything" is correct

### The generators

`RegenerationServiceModel` tracks per-source generators as `{timerId, lastStartTime}`, and the
matching timers live in `TimerModel`:

| generator key | timer label | duration | meaning |
|---|---|---|---|
| `crates_generator` | `regenerate_crates_generator` | **300000 ms** | +1 crate every **5 min** |
| `energy_generator` | `regenerate_energy_generator` | **180000 ms** | +1 energy every **3 min** |
| `crates_10_no_ads` | `regenerate_crates_10_no_ads` | **14400000 ms** | +10 crates / 4 h (ad-free refill) |
| `energy_5_no_ads` | `regenerate_energy_5_no_ads` | **14400000 ms** | +5 energy / 4 h |
| `gems_5_no_ads` | `regenerate_gems_5_no_ads` | **14400000 ms** | +5 gems / 4 h |
| `tle_energy_generator` | `regenerate_tle_energy_generator` | **180000 ms** | +1 time-limited-event energy / 3 min |
| `*_rv` | — | 14400000 ms | rewarded-video versions, `timerId: null` when unused |
| `*_premium` | — | 14400000 ms | premium-gated versions, `timerId: null` |
| `mp_flash_deals` | `mp_flash_deals` | — | marketplace, not a resource |

The three `*_no_ads` refills and the two per-minute stock refills are decoded **end to end** (reward
amount, duration, and the exact client write that carries them) — §10 is the authoritative section.

**The cap itself is not in any config file.** `progression_jsonpack.json` carries only
`items_unlocked`, `recipes_unlocked`, `exp_to_next_level` and `rewards` per level — no ceiling.
The cap is hardcoded in the (string-table-obfuscated) client, so it has to be observed, not read.

**Observed: the client renders the crate stock as `N/40`, but 40 is not a hard counter cap.** The
player saw `40/40` while parked, yet the very next read showed `crates: 75` — i.e. 40 is the
**generator's** stock ceiling (`crates_generator`, +1 / 5 min), while other sources (daily bonus,
orders, seasonal pass) add crates on top of it. The **energy** ceiling is likewise still unobserved
(the live account sat at 270+ without clipping).

### The consequence, and the strategy

Because regeneration stops at the ceiling, **time parked at the cap is regeneration permanently
lost** — at 5 min/crate that is up to ~288 crates/day, and at 3 min/energy ~480 energy/day.
So holding a big crate pile is not "saving up", it is throwing the generator away. This is why
**opening as many crates as the board can take is the correct default**, not just a way to get loot.

`bot.js --crates=auto` implements exactly that: spend down to whatever the board can accommodate,
bounded by the crate count, so the generator keeps running.

### Throughput: the single worker is the bottleneck

A measured 40-cycle loop (`--cycles=40 --every=20`, ~13 min) gained only **+87 exp** (6125 → 6212)
while spending energy **180 → 95**. The limiter is **`GameWorkersModel` holding exactly one worker**:
work is serialised, each step is 30 s–2 h, and every step yields only a handful of items — so exp
accrues at roughly **6–10 per minute** once the board is drained. Two consequences:

- Levelling is **game-rate-limited, not bot-limited**. Reaching the next level (≈400 exp here) is
  ~40–60 min of unattended loop, and the bot will exhaust energy long before that.
- Energy is a **shared** resource between bot and human. `bot.js --reserve-energy=N` refuses any
  dispatch that would drop energy below `N`, so you can keep a buffer for your own play. Free
  completions (already-finished steps materialising) are never blocked.

### Coin and energy orbs are mergeable — and merging strictly dominates collecting

`coin_N` / `energy_N` carry **both** components:

```json
{"blueprint":"coin_2","data":{
  "mergeable":{"target":"coin_3","expReward":9},
  "collectable":{"reward":[{"key":"coins","amount":3}]},
  "currency":{}}}
```

Values are exactly 3x per tier (`coin_1..4` = 1/3/9/27, confirmed live: a `coin_4` tile collects to
**27** coins). So 3x `coin_2` = 9 coins and 1x `coin_3` = 9 coins: **merging is value-neutral but
pays EXP** (9 here, 3/9/27/81 by tier). Orbs merge by the same rule as everything else (§6): 3 -> 1,
or **5 -> 2** as a bonus merge, which pays **double** EXP — so a 5-group of orbs is worth 2x what a
3-group pays. Therefore:

- never collect an orb you might still complete a group of 3 (or 5) for — collecting gains nothing
  and forfeits the EXP
- only collect when you actually need the resource, or to reclaim board space

`lib/solver.js` already does this: merge first (5-groups preferred), collect only leftovers that
cannot reach a group of 3 (`--no-collect` disables it entirely).

### Two things this session newly decoded

- **Level-up `rewards` exist per level.** `progression_per_level.levels.<n>.rewards` is a list of
  `{key, amount}` — level 13 grants `crates 10` and `energy 10`. That is the payload behind the
  "level-up reward claim" gap, which was previously listed as having no observed transition.
- **Opening inventory crates yields reward crates and keys.** The `crateItemContent` pool has a
  0.25-weight `reward_crate` branch and a 0.25-weight `reward_crate_key` branch; a 151-crate draw
  produced `reward_crate_bronze`, `reward_crate_silver` and `reward_crate_key_bronze`. So
  `reward_crate_*` tiles are reachable without any external source — the mechanic only needs a
  key of the matching colour, and opening crates is how you get them.

### Exp is *within-level*, not cumulative

`InventoryModel.exp` is the progress inside the current level, not a lifetime total:

```
applyExp:  need = levels[level].exp_to_next_level;  if (exp + gained >= need) { exp -= need; level++ }
```

Level 13's `exp_to_next_level` is `6615`, and the live account sat at `exp: 5789`, i.e. ~87% of the
way to level 14 — **not** 5789 of a cumulative 16351. `UserStatsModel.totalEarnedXP` is the lifetime
figure and is kept separately (§6, merging). Level-up `rewards` are confirmed **client-applied** (no
claim round-trip) — see §9.

---

## 8. Session and transport constraints (`single_socket`) — **read this before running anything**

The game's Nakama socket is running in **`single_socket` mode**: only **one live WebSocket per
account** is allowed. The client's own SDK spells out the consequence (string found in the HAR's
`game.*.js`):

```js
_onNotification(e) {
  "single_socket" === e.subject && (
    warn("NK - Logged in from another device/window, connection will be closed"),
    this._singleSocketDisconnect = true,
    this.onDisconnectBySingleSocket.fire()
  )
}
```

When a **second socket** connects for the same user, Nakama notifies the *older* socket with subject
`single_socket`, and the client deliberately **does not auto-reconnect** — that is exactly the
in-game screen *"Disconnected — Connection lost. Please restart the game."* The player has to
restart the Activity by hand.

Practical rules this imposes:

| Rule | Why |
|---|---|
| **Never open a WebSocket while the player may be in-game** | A `wsRpc` connection is a second socket and will boot the player's session. `watch.js` is recon-only for this reason. |
| The main loop is HTTP-only | `bot.js` uses `httpRpc` (`POST /v2/rpc/...`), which does **not** create a socket, so the loop is the safe way to run alongside the player. |
| Do not `authenticate` needlessly | A fresh login is a new session; treat the stored token as long-lived and leave it alone. |
| **Never renew the session while you are playing** | `/v2/account/session/refresh` is plain HTTP, but it **supersedes the session your client is holding** — the game then shows *"Disconnected — Connection lost"* and does not recover by itself. Auto-renew is therefore **opt-in** (`--refresh`). |

### Session lifetime — renewal is **opt-in**, because it disturbs your client

`session.json` carries the Nakama pair (`session_token` — a JWT, ~24 h) plus the Discord pair, for
your own `uid` (the `uid` claim of the token; it is account-identifying, so it is not written down
here). The JWT has **no `sid` claim** — it decodes to `{tid, uid, usn, vrs, exp, iat}` —
so session identity lives only server-side.

**Learned the hard way.** Calling `POST /v2/account/session/refresh` (server key as HTTP Basic) does
**not** leave the player alone. Immediately after a renewal, the player's client came up on
*"Disconnected — Connection lost. Please restart the game."*, and restarting Discord did **not** clear
it; it only recovered later, once the rival session was displaced. A socket connect with the bot's
token confirmed it: the server immediately reported the **old session leaving**
(`status_presence_event.leaves`, a different `session_id` than ours). The account behaves as
**one session per user**, so a renewal supersedes whatever session the client is holding, and the
client — which deliberately never auto-reconnects — cannot recover without a fresh re-login.

`lib/nakama.js` is therefore **fail-closed**:

| Mode | Behaviour on `exp` / `401` |
|---|---|
| **default** | **throws** with a recovery hint; never touches the session |
| `--refresh` / `FMV_ALLOW_REFRESH=1` | renews once, retries the call, writes the new pair to `session.json` |

**Recovery when the token has expired:** restart the Farm Merge Valley activity (the client
re-authenticates with Discord), then re-capture a token (README "Recon tooling").

Verified for the opt-in path: renewal extends expiry (`2026-10-17 12:39` → `15:55 UTC`), Nakama
rotates the refresh token, and `GET_SERVER_TIME` succeeds straight after. Exports for scripts:
`refreshAllowed()`, `refreshSession(s)`, `tokenExpired(s)`, `expiry(s)`.

### The full RPC surface (both HARs: 955 + 1032 WebSocket frames)

```
reads   GET_ALL_PLAYER_DATA(_V2), GET_PLAYER_DATA_V2, GET_PLAYER_PROFILE(S),
        GET_SERVER_TIME (259x), GET_CONFIGURATIONS, GET_REWARD_DATA, GET_NEW_REWARD_CLAIMS,
        GET_ACTIVE_TIMED_CONFIGURATIONS, CAN_CLAIM_VOUCHERS,
        GET_FRIEND_FARM_ACTIONS, GET_VISITED_FRIENDS,
        GET_STICKERBOOK_*, GET_PLAYER_STICKERBOOK_* (9 variants), LIST_USER_GROUPS
writes  SAVE_PLAYER_DATA_V2 (87x), SETUP_ACCOUNT_V2, CLAIM_REWARD,
        GRANT/OPEN/CONSUME_PLAYER_STICKERBOOK_*, MODIFY_PLAYER_STICKERBOOK_STICKERS_METADATA,
        CREATE_GROUP, CONSUME_FRIEND_FARM_ACTION
```

- **`CLAIM_REWARD` / `GET_REWARD_DATA` are notification calls that return nothing.** Both take a
  single protobuf string field (`0a <len> <str>`) holding a reward id — either a **UUID**
  (`<reward-uuid>`) or a constant **`mock-<epoch-ms>`** id
  (`mock-1662043090350`). Every response is empty, and the ids never appear in any save, so the
  server does no state work: the reward is applied by the client's next `SAVE_PLAYER_DATA_V2` (§9).
  The two `mock-…` claims line up with the **visitor** events (frames 624 and 773, right after the
  saves that spend a ticket and create `VisitorRewardModel`).
- The stickerbook (`*_STICKERBOOK_*`), friend-visit (`*_FRIEND_FARM_ACTION`, `GET_VISITED_FRIENDS`)
  and clan (`LIST/CREATE_GROUP`) families are entire subsystems that are **out of scope** — the goal
  is automating the player's own farm, not touching other players (the stated red line).
- **There is no server-side reward grant at all.** `SAVE_PLAYER_DATA_V2` remains the only write path
  that changes game state, which is why every reward below is implemented as an inventory edit.

## 9. Rewards are client-applied — level-ups and visitors

Decoded from `farm_merge_level_up.har` (**87 saves**, 1032 WS frames). The capture caught the
**13 → 14 level-up**, which settles the last open question: the server never grants a reward — the
client writes it into `InventoryModel` on the next save.

### Level-up — two saves, not one

```
save[85]   InventoryModel   exp 6614, level 13  ->  exp 2, level 14     (no reward, crates unchanged)
save[86]   InventoryModel   crates 0 -> 10, energy 70 -> 80            (= levels[13].rewards)
```

Worth spelling out:

- **Exp rolls over.** `6614 + 3` merge exp `= 6617`, and `levels[13].exp_to_next_level = 6615`, so
  `6617 - 6615 = 2` — exactly `exp: 2` at level 14. The within-level rule of §7 in action.
- **The reward is keyed by the level being *completed***, not the level reached: 13 → 14 grants
  `levels[13].rewards`.
- **Every level 4–130 grants `crates 10` + `energy 10`** (127 of 130 levels carry a `rewards` list;
  levels 1–3 have none).

Implemented as `lib/rewards.js levelRewards()` + `lib/solver.js`, which grants **every level passed
through** on a multi-level jump (`for (let L = oldLevel; L < newLevel; L++)`).

### Visitor ("train") rewards — `VisitorRewardModel`

Spending a **ticket** sends a visit; the visitor's reward then accumulates in `VisitorRewardModel`
over several saves before the player collects it:

```
save[3]  VisitorRewardModel NEW  {reward:[{crates,10}], player:"NPC_2"}     tickets 3 -> 2
save[4]                          + {carrot,1,bonus:false} + {coins,2}
save[5]                          + {coins,2} + {coins,2}
save[7]  VisitorRewardModel      -> {reward:[], player:null}
         InventoryModel          coins 288->294 (+6 = 3x{coins,2}), crates 40->50 (+10), carrot 1->2 (+1)
```

So **collecting = credit each entry to the matching `InventoryModel` counter, then reset the model to
`{reward:[], player:null}`** — in one save. Every observed reward key is an `InventoryModel` counter
(`crates`, `coins`, `carrot`, `milk`, `sugarcane`), never a board tile. The visitor is an **NPC**
(`NPC_1`, `NPC_2`) — the account has no real friends, so the game substitutes them, which keeps this
inside the red line (no other player is touched).

The paired `CLAIM_REWARD` carries the constant `mock-1662043090350` id (§8) and is bookkeeping only.

Implemented as `lib/rewards.js pendingVisitorRewards()` + `lib/solver.js` (`--no-visitors` to skip).

### Tickets

Tickets come from opening inventory crates: `CrateContentModel.queue = [{blueprint:"ticket", remaining:N}]`
counts down as tickets are drawn (25 → 15 → 2 → 0, then a fresh queue at 28). `tickets` itself is an
`InventoryModel` counter.

### Daily-challenge / seasonal-pass counters — solved 2026-10-16

`DailyChallengeModel.data.targets[]` is the daily rotation: ten `{id, task, targetAmount,
currentAmount, collected, reward}` entries plus a `timerID` (the daily reset) and a `mainChallenge`
with its own recycled `rewards[]`. A rotation carries several entries per task at escalating
`targetAmount` (live: `spend.crates` 80/240/320/400, `spend.energy` 210/490/630, `harvest` 45/55,
`order.rewarded` 4) and every entry sharing a task advances **in lockstep** - the same delta lands on
all of them in the same save.

`timerID` is a normal `TimerModel` entry with an **empty label** and `duration 86400000` (live id
`2198`) — the 24 h reset. The bot never touches it.

The counters are advanced by the client for the player's own moves (§1 again: nothing is
server-granted). `scratch/dc_timeline.js` pairs every `DailyChallengeModel` change in a capture with
the inventory delta and the sibling models of that save; `scratch/dc_harvest_pair.js` dumps the full
inventory delta plus the before/after tile JSON of the saves where `harvest` moved:

| task | unit | capture evidence |
|---|---|---|
| `harvest` | +1 per producer loot tap | launch 13->14: tile `66,74` `lootable`->`depleted`, `wheat 6->11`, `milk 1->5`, `#6 harvest 58->59` - **one**, not the 5 wheat and not the 4 collected `milk` tiles; launch 19->20: `59->60` |
| `spend.energy` | += energy spent dispatching work | level-up 47->48: `energy 85->70`, `#3/#7/#9 spend.energy 0->15` |
| `spend.crates` | += crates opened | level-up 11/14/23/...: `crates 49->40`, `#6/#8/#10 spend.crates 155->165` |
| `order.rewarded` | += orders **collected** | level-up 33->34: `OrdersModel`+`BuildingsModel` change, `#1 0->1` |

The seasonal pass keeps the same shape inside `TimedEventModel.<event>.eventData.activeQuest` -
`{data:{amount, SppReward, taskAction}, progress}` - so the same deltas bump it, matched on
`taskAction`. Live `seasonaleventpass` is `order.rewarded` `1/3`, and all four of its `questConfigs`
are `order.rewarded` too, so this season only order collections move it.

Implemented as `lib/daily.js buildTaskUpdates(models, deltas)`. `lib/solver.js` sums the round's own
actions (`harvest` = loot taps, `spend.energy` = work energy, `spend.crates` = crates opened,
`order.rewarded` = orders collected) and writes both models once, clamped at `targetAmount`. It
replaces the two one-off hooks that used to live in `lib/crates.js` (`spend.crates`, §7) and
`lib/orders.js` (the pass quest, §6) - keeping either would have double-counted.
`scratch/test_daily.js` replays the four rows above plus clamping, `collected`, unknown-task, all-zero
and seasonal cases (**PASS**, 25 checks).

### Still open

- **`DailyChallengeModel` claims** — the counters themselves now advance (§9 above), but the client
  flips `collected: true` at `targetAmount` **with no payout observed in that save** (target `id6`,
  reward `energy 20`, energy stayed 70), so the bot only moves progress and leaves the claim to the
  player.
- **`mainChallenge`** — its recycled `rewards[]` list has the same unobserved `collected` flip.
- **`NextObjectiveModel`** — `{currentProgress, completedObjectives:[objective_001…006], isEligible}`;
  the completion write is unobserved.
- **`MapAreaModel`** — `{A2..A13: 2, A14: 1, A15: 1}`, first written at the level-up save.
- **7 pending reward UUIDs** are queried with `GET_REWARD_DATA` at load and one is claimed
  (`<reward-uuid>`); the model they come from is unidentified.

## 10. Time-based reloads (regeneration) — the client is the clock

The **ad-free** generators from §7 are the "reloads" the Activity shows as a collectable icon. Like
every other reward in this game they are **client-applied**, and the proof is negative: at
`2026-10-16T17:41Z` (`scratch/regen_status.js`) `crates_generator` was already **946 s overdue**
while `InventoryModel.crates` was still `0` — and it stayed `0` across the whole idle loop. Nothing
regenerates on its own; the state only moves when a client writes it.

### The state

```json
"crates_10_no_ads": { "timerId": 2258, "lastStartTime": 1792171303471.5 }
```

paired with

```json
{ "id": 2258, "started": 1792171521012, "state": "ACTIVE",
  "label": "regenerate_crates_10_no_ads", "duration": 14400000, "timeSource": "server" }
```

`timerId: null` means no cooldown is running, i.e. the reload is **ready**. Ready is
`now >= lastStartTime + duration`, and the duration is read from the paired `regenerate_<name>`
timer rather than hardcoded, so the client's own value wins.

### The collects the HAR actually contains

| save | counter | transition | generator | duration |
|---|---|---|---|---|
| `save[29]` | `crates` | **0 → 10** | `crates_10_no_ads` | 14400000 ms |
| `save[46]` | `gems` | **175 → 180** | `gems_5_no_ads` | 14400000 ms |
| `save[47]` | `energy` | **80 → 85** | `energy_5_no_ads` | 14400000 ms |

All three are the same save shape: the counter increments,
`RegenerationServiceModel.<name>.lastStartTime` jumps forward, and a fresh `regenerate_<name>` timer
appears with a new id. `scratch/regen_timeline.js` correlates both sides across the whole capture.

### Availability has two signals — `stock` **and** the timer

`MarketplaceModel.data.stock` is keyed by the same generator names and holds how many refills are
banked (`*_rv` / `*_premium` bank 5; the ad-free ones hold 1):

```json
{"gems_5_no_ads":1,"energy_5_no_ads":1,"crates_10_no_ads":0,"gems_5_rv":5, …}
```

The HAR shows it decrementing exactly when a refill is collected — `gems_5_no_ads 1 -> 0` in the
same save as `gems 175 -> 180`, and `energy_5_no_ads 1 -> 0` with `energy 80 -> 85` — and
`scratch/stock_timeline.js` confirms those are the only two flips in the capture.

**`stock` is the authority on availability, and the timer is the backstop. Neither alone works:**

- **The stock is not a mirror of the 4 h timer.** `gems_5_no_ads` was collected only **65 min** after
  its `lastStartTime` (16:18:41 → 17:23:37), and `crates_10_no_ads` 70 min after (16:11:53 →
  17:21:43). Both were collected because their refill was already **banked at stock 1**, not because
  their clock elapsed. That resolves the earlier "70 minutes vs a 4 h timer" anomaly entirely.
- **The timer is not redundant either.** Live on 2026-10-16T17:58Z all three ad-free entries read
  **stock 0 while their 4 h clocks were still running** (ready in ~12.2 ks). Nothing is banked, so
  the only way to know a refill has landed is the clock.

So `lib/regen.js` collects when `stock >= 1` **or** when `lastStartTime + duration <= now`, and in
the same save it consumes the stock and re-arms the timer. Two details fall out of that:

- a **banked** collect resets `lastStartTime` to *now*; keeping the stale `lastStart + duration`
  would land in the past and re-fire on every subsequent save (a runaway),
- refilling and consuming collapse into the same net state the HAR's collect save shows (stock
  `1 -> 0` as usual, `0 -> 0` when the clock is what triggered it), so the write is identical
  either way.

`scratch/test_regen.js` asserts both paths, the stock spend, and re-plans the *written* state to
prove it yields no further plans.

### Why `event_energy_5_no_ads` is still not automated

It is a fourth ad-free refill and it is live at **stock 1** (available) with `timerId: null`, so the
stock rule would collect it. It is held back on the *reward* side, not the timing side:
`time_limited_event_energy` reads exactly **150 in every save of both captures** (51/51 and 16/16
where the model is present), which looks like a hard cap. Granting `+5` would write `155` — a value
the game itself would clamp — so the cap needs confirming first.

### Implementation — `lib/regen.js`

`planRegen` → `buildRegenUpdates`, wired into `lib/solver.js` (`regen: true`, disable with
`--no-regen`). It runs after orders, so the `TimerModel` it edits already carries the work + order
timers.

- Only the three fixed 4-hour refills are automated. Ad-gated (`*_rv`), premium (`*_premium`),
  event-only (`tle_energy_generator`, `event_energy_5_no_ads`) and the per-minute stock refills
  (`*_generator`) are listed in `NOT_AUTOMATED` with a reason and left alone.
- **Availability is `stock >= 1` OR the clock having elapsed** — see above. A banked collect resets
  the clock to now so it can never re-fire.
- **Catch-up is clamped to one cycle per generator per save.** `lastStartTime` advances by exactly
  the cycles credited, so a long idle period drains one refill per save instead of landing as a
  single enormous write — never more than the game would eventually grant anyway.
- The payout is folded into `gains`, so `InventoryModel` is still written **once**, together with
  every other counter change in that save.
- A refill is credited only when its duration has genuinely elapsed, measured on this machine's
  clock, which reads a few minutes *behind* the client's own timestamps (one observation:
  `energy_generator.lastStartTime` was 2.5 min ahead of local `Date.now()`). The error direction is
  safe: a refill can be collected slightly late, never early.

### Why the per-minute refills are not automated

`crates_generator` (+1 / 5 min, ceiling 40 per §7) and `energy_generator` (+1 / 3 min) are *stock*
refills rather than reloads the player taps, and their ceiling lives in the obfuscated client. It was
never observed being hit — crates peaked at **175**, energy at **185**, gems at **180** across both
captures — so a catch-up grant after any idle period would be unbounded. Automating them needs a
capture that parks at the cap.

### Verifying

`node scratch/test_regen.js` replays all three HAR collects and asserts the writes (38 checks):
amount, both availability paths, cycle preservation, the clamp, the timer re-arm (`nextTimerId`
advance, label, duration), the stock spend, untouched generators staying byte-identical,
re-planning the written state to prove no runaway, and the solver writing `InventoryModel` exactly
once. `node scratch/regen_status.js` prints live readiness per generator, and
`node scratch/stock_timeline.js` diffs `MarketplaceModel.data.stock` across a capture.

## Summary of what is safe to implement

| Action | Status | Blocker |
|---|---|---|
| Merge | **done + verified** | groups of **3 -> 1** (`totalNormalMerges`) and **5 -> 2** bonus merges (`totalBonusMerges`, exp paid per output tile); `planMerges` resolves the whole cascade in one plan and `bestSplit` maximises output (5-groups first, then 3s). `--min=5` for bonus merges only (§6) |
| Collect currency orbs | **done + verified** | — |
| Loot producers (`lootable`) | **done + verified** | — |
| Resource work start (dispatch a worker) | **done + verified** | — |
| Resource work completion | **done + verified** | cooldown-timer value is a cosmetic guess |
| Open `reward_crate_*` tiles | not implemented | rewards pre-rolled (7–9 items), `crateRewardLifetime`/`RewardCrateCooldown` = **259200000 ms (3 days)**, and `crateRewardUnlockRequirement` = **2x key of the matching colour**; keys arrive from opening inventory crates (§7) but the key-spend transition is still unobserved |
| Open inventory `crates` | **done + verified** | generator cap is **40**; `--crates=N`, default **`--crates=auto`**, `--no-crates` to skip (the `weightIncrease` reset divergence is documented in `lib/crates.js`) |
| Harvest / materialise tier-4 producers (`cooldown` -> `lootable`) | **done + pending live verify** | the timer is `Cooldown:<row>,<col>`, **duration 1800000 ms (30 min)**, and is in the capture's initial *read* (not any save) (§4). The bot arms a new producer with the exact tile + timer the game writes, materialises any producer whose timer has landed (deleting the spent timer), rolls the loot from `harvestable.harvestReward[round][slot]`, and repairs the 19 live producers whose data was `{}` from the pre-fix merge write. `--no-producers` skips the materialise/repair half |
| Orders — start / complete / collect | **done + verified** | `--no-orders` to skip; completion + collection are chained into one save |
| Claim level-up rewards (§9) | **done + verified** | `+10 crates +10 energy` per level (4–130); `--no-level-rewards` to skip. Applied by the client, so the bot makes the same inventory edit |
| Collect visitor rewards (§9) | **done + verified** | `--no-visitors` to skip; credits `VisitorRewardModel.reward[]` then resets it to `{reward:[],player:null}` |
| Collect time-based reloads (§10) | **done + verified** | `--no-regen` to skip; `+10 crates` / `+5 gems` / `+5 energy` per 4 h, credited when `MarketplaceModel.data.stock` is banked **or** the clock has landed, catch-up clamped to one refill per generator per save, and the stock spent in the same write. Per-minute `*_generator` refills deliberately excluded (ceiling unobserved) |
| Daily challenges (`DailyChallengeModel`) | **progress done + verified**, claims not | the four counter units are pinned and advanced by the bot (`harvest` per loot tap, `spend.energy`, `spend.crates`, `order.rewarded`) — §9. The `collected` **claim** payout is still unobserved, so the bot stops at `targetAmount` and leaves the claim to the player |

**Operational constraint (§8):** the account allows only **one WebSocket**. The bot's loop is
HTTP-only and therefore safe to run next to the player; anything using `wsRpc` (i.e. `watch.js`) will
boot the player's session with the "Disconnected" screen until they restart the Activity.
