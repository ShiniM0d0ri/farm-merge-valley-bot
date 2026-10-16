import '../lib/env.js';
// scratch/dc_timeline.js - every DailyChallengeModel change in a capture, paired with the inventory
// delta and the sibling models that changed in the same save. This is how the daily-task semantics
// ("harvest", "spend.energy", "order.rewarded") get pinned to a real player action.
//
//   FMV_IN=har_saves_levelup.json node scratch/dc_timeline.js
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));

let prevDC = null;
let prevInv = null;
let prev = {};

const targets = (dc) => new Map((dc?.json?.data?.targets || []).map((t) => [t.id, t]));

for (const s of saves) {
  const dc = s.models.DailyChallengeModel || { json: prevDC };
  const inv = s.models.InventoryModel?.json?.data || prevInv || {};
  const now = targets({ json: dc.json });

  if (prevDC) {
    const was = targets({ json: prevDC });
    const deltas = [];
    for (const [id, t] of now) {
      const o = was.get(id);
      if (!o) { deltas.push(`#${id} ${t.task} NEW ${t.currentAmount}/${t.targetAmount}`); continue; }
      const bits = [];
      if (o.currentAmount !== t.currentAmount) bits.push(`current ${o.currentAmount}->${t.currentAmount}`);
      if (o.targetAmount !== t.targetAmount) bits.push(`target ${o.targetAmount}->${t.targetAmount}`);
      if (o.collected !== t.collected) bits.push(`collected ${o.collected}->${t.collected}`);
      if (bits.length) deltas.push(`#${id} ${t.task} ${bits.join(', ')}`);
    }
    for (const [id, o] of was) if (!now.has(id)) deltas.push(`#${id} ${o.task} REMOVED`);

    const invDelta = ['coins', 'gems', 'crates', 'energy', 'exp', 'level']
      .filter((k) => prevInv && prevInv[k] !== inv[k])
      .map((k) => `${k} ${prevInv[k]}->${inv[k]}`);
    const who = Object.keys(s.models).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(s.models[k])
      && k !== 'DailyChallengeModel');
    const other = ['OrderModel', 'BuildingsModel', 'InventoryModel', 'TimedEventModel']
      .filter((k) => who.includes(k));

    if (deltas.length) {
      console.log(`\n[save ${String(s.seq).padStart(3)}] t=${s.t ?? '-'} inv: ${invDelta.join(', ') || '(none)'}`);
      deltas.forEach((d) => console.log(`      DC ${d}`));
      console.log(`      changed: ${who.slice(0, 10).join(' ')}`);
      if (other.length) console.log(`      KEY: ${other.join(' ')}`);
    }
  }
  prevDC = dc.json;
  prevInv = inv;
  for (const [k, m] of Object.entries(s.models)) prev[k] = m;
}
