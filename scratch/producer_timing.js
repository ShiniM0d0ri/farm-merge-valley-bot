// scratch/producer_timing.js - measure the tier-4 producer cooldown in WALL-CLOCK time.
//
// MECHANICS section 4 is blocked on "how long does a tier-4 producer take to become lootable, and
// where is its cooldown timer?". Reading `harvestable.duration` gives 3600 (seconds, presumably) but
// the ms scaling is unverified, and the tile's `cooldown.timerId` appears in no TimerModel snapshot.
//
// So measure it instead: every WebSocket frame carries `_webSocketMessages[].time` (epoch seconds,
// which har_saves.js discarded in favour of the entry's startedDateTime - the same value for all
// frames of a socket). Replay the saves in order with those times and print every state change of a
// tier-4/gazebo/greenhouse tile with the elapsed wall-clock delta. `cooldown -> lootable` is the
// production duration, directly observed.
import fs from 'node:fs';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { tiles } from '../lib/board.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const saves = [];
har.log.entries.forEach((e) => {
  if (/rpc\/SAVE_PLAYER_DATA_V2/i.test(e.request?.url || '')) {
    const body = e.request.postData?.text;
    const tMs = Date.parse(e.startedDateTime);
    if (body) saves.push({ tMs, payload: body, src: 'http' });
  }
  (e._webSocketMessages || []).forEach((m) => {
    if (m.type !== 'send') return;
    let o;
    try { o = JSON.parse(m.data); } catch { return; }
    if (o?.rpc?.id === 'SAVE_PLAYER_DATA_V2' && o.rpc.payload) {
      saves.push({ tMs: Math.round((m.time || 0) * 1000), payload: o.rpc.payload, src: 'ws' });
    }
  });
});
saves.sort((a, b) => a.tMs - b.tMs);
console.log(`${HAR}\n${saves.length} saves, ${new Date(saves[0].tMs).toISOString()} .. ${new Date(saves[saves.length - 1].tMs).toISOString()}\n`);

const isProducer = (bp) => /_4$/.test(bp || '') || bp === 'gazebo' || bp === 'greenhouse';
const sig = (d) => {
  const p = [];
  if (d.hitpoints) p.push(`hp ${d.hitpoints.current}/${d.hitpoints.max}${d.hitpoints.startAsVisible === false ? ' hidden' : ''}`);
  if (d.cooldown) p.push(`cooldown#${d.cooldown.timerId}`);
  if (d.lootable) p.push(`lootable remove=${!!d.lootable.removeReward} lro=${!!d.lootable.lootingRemovesObject}`);
  if (d.depleted) p.push('depleted');
  if (d.harvestable) p.push(`harvestable ${JSON.stringify(d.harvestable)}`);
  const extra = Object.keys(d).filter((k) => !['hitpoints', 'cooldown', 'lootable', 'depleted', 'harvestable', 'level', 'mergeable'].includes(k));
  p.push(`keys[${Object.keys(d).join(',')}]${extra.length ? '' : ''}`);
  return p.join('  ');
};

const last = new Map();
const t0 = saves[0].tMs;
let firstSave = 0;

for (const s of saves) {
  let models;
  try { models = decodeModels(b64ToBuf(s.payload)); } catch { continue; }
  const tm = models.TimerModel?.json?.data;
  const byId = new Map((tm?.timers || []).map((t) => [t.id, t]));
  const rel = ((s.tMs - t0) / 1000).toFixed(1).padStart(8);

  for (const v of tiles(models).values()) {
    if (!v || !isProducer(v.blueprint)) continue;
    const d = v.data || {};
    const k = `${v.row}:${v.col}`;
    const now = sig(d);
    if (last.get(k) === now) continue;
    const prev = last.get(k);
    const tinfo = d.cooldown ? byId.get(d.cooldown.timerId) : null;
    const parts = [];
    parts.push(`t+${rel}s ${new Date(s.tMs).toISOString().slice(11, 19)}`);
    parts.push(`${v.blueprint} @(${v.row},${v.col})`);
    if (tm) parts.push(`nextTimer=${tm.nextTimerId}`);
    parts.push(tinfo ? `TIMER ${JSON.stringify(tinfo)}` : (d.cooldown ? 'TIMER MISSING' : ''));
    console.log(parts.filter(Boolean).join(' | '));
    console.log(`      ${prev ? `was: ${prev}\n      now:` : 'new:'} ${now}`);
    last.set(k, now);
  }
}
