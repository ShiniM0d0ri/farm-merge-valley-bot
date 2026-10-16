// scratch/producer_lifecycle.js - the exact JSON of a tier-4 producer at every stage.
//
// Now that the cooldown timers are found (label `Cooldown:<row>,<col>`, duration 1800000 ms, present
// in the capture's initial GET_ALL_PLAYER_DATA_V2 read), dump the literal tile data of every stage so
// the bot can reproduce the writes:
//   merge -> { cooldown:{timerId}, hitpoints:{startAsVisible:false,max:1,current:2} }
//   materialise -> lootable{...}  (cooldown dropped, timer removed from TimerModel?)
//   loot -> depleted + hitpoints.current 1 + lootable{removeReward, lootingRemovesObject:true}
import fs from 'node:fs';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { tiles } from '../lib/board.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const saves = [];
har.log.entries.forEach((e) => {
  (e._webSocketMessages || []).forEach((m) => {
    if (m.type !== 'send') return;
    let o;
    try { o = JSON.parse(m.data); } catch { return; }
    // include the initial read so we see the pre-state too
    if (o?.rpc?.id === 'SAVE_PLAYER_DATA_V2' && o.rpc.payload) {
      saves.push({ tMs: Math.round((m.time || 0) * 1000), payload: o.rpc.payload, rpc: 'SAVE' });
    }
  });
});
// the initial read, for the timer list before any save
let initial = null;
for (const e of har.log.entries) {
  for (const m of e._webSocketMessages || []) {
    if (m.type !== 'receive') continue;
    let o;
    try { o = JSON.parse(m.data); } catch { continue; }
    if (!/^GET_ALL_PLAYER_DATA(_V2)?$/.test(o?.rpc?.id || '')) continue;
    const models = (() => { try { return decodeModels(b64ToBuf(o.rpc.payload)); } catch { return null; } })();
    if (models?.TimerModel && !initial) initial = models;
  }
}
saves.sort((a, b) => a.tMs - b.tMs);
const t0 = saves[0].tMs;

const isProducer = (bp) => /_4$/.test(bp || '') || bp === 'gazebo' || bp === 'greenhouse';

if (initial) {
  const tm = initial.TimerModel.json.data;
  console.log('=== initial read (before any save) ===');
  console.log(`nextTimerId=${tm.nextTimerId}`);
  for (const t of tm.timers) if (/^Cooldown:/.test(t.label) || /RewardCrateCooldown/.test(t.label)) {
    console.log(`  ${JSON.stringify(t)}`);
    console.log(`     ready at ${new Date(t.started + t.duration).toISOString()} (${((t.started + t.duration - t0) / 1000).toFixed(0)}s vs first save)`);
  }
  console.log('');
}

const seen = new Set();
for (const s of saves) {
  let models;
  try { models = decodeModels(b64ToBuf(s.payload)); } catch { continue; }
  const rel = ((s.tMs - t0) / 1000).toFixed(1).padStart(7);
  const tmIn = models.TimerModel?.json?.data;
  for (const v of tiles(models).values()) {
    if (!v || !isProducer(v.blueprint)) continue;
    const d = v.data || {};
    const stage = d.cooldown ? 'cooldown' : d.depleted ? 'depleted' : d.lootable ? 'lootable' : 'other';
    const k = `${v.blueprint}@${v.row}:${v.col} ${stage} ${JSON.stringify(d).length}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`t+${rel}s ${new Date(s.tMs).toISOString().slice(11, 19)}  ${v.blueprint} @(${v.row},${v.col})  stage=${stage}   payloadModels=[${Object.keys(models).slice(0, 6).join(',')}${Object.keys(models).length > 6 ? '…' : ''}]`);
    console.log(`   tile: ${JSON.stringify(d)}`);
    if (tmIn) console.log(`   TimerModel IN THIS SAVE: next=${tmIn.nextTimerId} count=${(tmIn.timers || []).length}`);
    else console.log('   TimerModel: not in this save payload');
  }
}
