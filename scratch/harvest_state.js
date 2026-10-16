// scratch/harvest_state.js - the tier-4 producers currently on the board, in full.
//
// MECHANICS section 4 said "only tier-4 producers are harvestable" and left the
// `cooldown -> lootable` materialisation unimplemented because the board never held one. Print every
// candidate with its exact components so we can see which are producing (cooldown), ready
// (lootable) or depleted, plus the timers they point at.
import fs from 'node:fs';
import { tiles } from '../lib/board.js';

const models = JSON.parse(fs.readFileSync(process.env.FMV_STATE || 'state.json', 'utf8'));
const tm = models.TimerModel?.json?.data;
const byId = new Map((tm?.timers || []).map((t) => [t.id, t]));
const now = Date.now();

const isProducer = (bp) => /_4$/.test(bp) || bp === 'gazebo' || bp === 'greenhouse';
const keys = (d) => Object.keys(d || {});

console.log(`now       = ${new Date(now).toISOString()}`);
console.log(`timerIds  = next ${tm?.nextTimerId}`);
console.log('');

let n = 0;
for (const v of tiles(models).values()) {
  if (!v?.blueprint || !isProducer(v.blueprint)) continue;
  n++;
  const d = v.data || {};
  const parts = [];
  if (d.hitpoints) parts.push(`hitpoints ${d.hitpoints.current}/${d.hitpoints.max}`);
  if (d.cooldown) {
    const t = byId.get(d.cooldown.timerId);
    const left = t ? t.started + t.duration - now : null;
    parts.push(`cooldown timer ${d.cooldown.timerId}${t ? ` [${t.label} dur ${t.duration} left ${Math.round(left / 1000)}s]` : ' (timer missing)'}`);
  }
  if (d.lootable) parts.push(`lootable ${JSON.stringify(d.lootable).slice(0, 120)}`);
  if (d.depleted) parts.push(`depleted ${JSON.stringify(d.depleted)}`);
  if (d.mergeable) parts.push(`mergeable -> ${d.mergeable.target}`);
  console.log(`${v.blueprint} @ (${v.row},${v.col})  keys[${keys(d)}]  ${parts.join('  ')}`);
}
console.log(`\n${n} tier-4/gazebo/greenhouse tile(s)`);
