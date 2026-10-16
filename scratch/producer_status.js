// scratch/producer_status.js - live report of every tier-4 producer: stage, cooldown timer, elapsed.
//
// Materialisation is driven by an EXPIRED TimerModel entry (the launch capture deletes the 6 producer
// timers in the first save, then writes `lootable` 10s later). A tile whose `cooldown.timerId` points
// at no timer therefore never materialises - which is exactly the state the live board was reported
// to be in. Confirm it before deciding how to repair it.
import { httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { tiles } from '../lib/board.js';
import { resolveBlueprint } from '../lib/blueprints.js';

const bps = JSON.parse(await (await import('node:fs/promises')).readFile(
  process.env.FMV_CFG || './config/blueprints_jsonpack.json', 'utf8'));

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const tm = models.TimerModel?.json?.data;
const byId = new Map((tm?.timers || []).map((t) => [t.id, t]));
const now = Date.now();
const DUR = 1800000;

console.log(`now = ${new Date(now).toISOString()}   nextTimerId = ${tm?.nextTimerId}   timers = ${(tm?.timers || []).length}`);
const cooldownTimers = (tm?.timers || []).filter((t) => /^Cooldown:/.test(t.label));
console.log(`Cooldown:* timers currently in TimerModel: ${cooldownTimers.length}`);

let n = 0;
const counts = {};
for (const v of tiles(models).values()) {
  if (!v?.blueprint) continue;
  const h = resolveBlueprint(bps, v.blueprint)?.harvestable;
  const d = v.data || {};
  if (!h && !d.hitpoints && !d.lootable) continue;
  n++;
  const stage = d.cooldown ? 'cooldown' : d.depleted ? 'depleted' : d.lootable ? 'lootable' : 'other';
  counts[`${v.blueprint} ${stage}`] = (counts[`${v.blueprint} ${stage}`] || 0) + 1;
  if (n <= 30) {
    const t = d.cooldown ? byId.get(d.cooldown.timerId) : null;
    const when = t ? (t.started + t.duration <= now ? `EXPIRED ${Math.round((now - t.started - t.duration) / 1000)}s ago` : `ready in ${Math.round((t.started + t.duration - now) / 1000)}s`) : '';
    console.log(
      `  ${v.blueprint.padEnd(14)} @(${v.row},${v.col}) ${stage.padEnd(9)} ` +
      `hp ${d.hitpoints?.current}/${d.hitpoints?.max}${d.hitpoints?.startAsVisible === false ? ' hidden' : ''}  ` +
      (d.cooldown ? `timer ${d.cooldown.timerId} ${t ? `[${t.label} dur ${t.duration} ${when}]` : '(MISSING)'}` : '') +
      (d.lootable ? `  loot ${JSON.stringify(d.lootable.loot)} remove=${!!d.lootable.removeReward} lro=${!!d.lootable.lootingRemovesObject}` : '') +
      `  harvestable=${h ? `harvests ${h.harvests} dur ${h.duration}` : 'NO'}`
    );
  }
}
console.log(`\n${n} producer-like tile(s)`);
console.log(JSON.stringify(counts, null, 1));
const pr = models.PseudoRandomnessModel?.json?.data;
console.log(`PseudoRandomness contexts: ${JSON.stringify((pr?.data ? pr.data.map((c) => c.context) : []))}`);
