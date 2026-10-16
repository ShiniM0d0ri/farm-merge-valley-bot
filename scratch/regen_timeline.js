import '../lib/env.js';
// scratch/regen_timeline.js - correlate RegenerationServiceModel changes with inventory deltas.
// Shows, per save, which generator timers started/stopped and what the counters did.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));
const KEYS = ['coins', 'gems', 'crates', 'energy', 'tickets', 'exp', 'level'];
let prevInv = null;
let prevRegen = null;

const short = (t) => (t ? new Date(t).toISOString().slice(11, 19) : '-');

for (const s of saves) {
  const inv = s.models.InventoryModel?.json?.data;
  const regen = s.models.RegenerationServiceModel?.json?.data;

  const invDelta = [];
  if (inv) {
    for (const k of KEYS) if (prevInv && prevInv[k] !== inv[k]) invDelta.push(`${k} ${prevInv[k]}->${inv[k]}`);
  }

  const regenDelta = [];
  if (regen) {
    for (const [name, v] of Object.entries(regen)) {
      const before = prevRegen?.[name];
      if (!before) continue;
      if (before.timerId !== v.timerId || before.lastStartTime !== v.lastStartTime) {
        regenDelta.push(`${name}: timer ${before.timerId}->${v.timerId} start ${short(before.lastStartTime)}->${short(v.lastStartTime)}`);
      }
    }
  }

  if (invDelta.length || regenDelta.length) {
    console.log(`[${String(s.seq).padStart(2)}]${invDelta.length ? `  INV: ${invDelta.join(', ')}` : ''}`);
    for (const r of regenDelta) console.log(`        ${r}`);
  }
  if (inv) prevInv = inv;
  if (regen) prevRegen = regen;
}
