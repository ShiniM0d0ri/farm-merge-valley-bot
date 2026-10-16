import '../lib/env.js';
// scratch/inv_timeline.js - one line per save showing only the fields that matter, with the
// models that changed. Makes reward vs. spend correlations obvious.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));
const KEYS = ['coins', 'gems', 'crates', 'energy', 'tickets', 'exp', 'level', 'time_limited_event_energy'];
const prevInv = {};
const prev = {};
const changed = {};

for (const s of saves) {
  const inv = (s.models.InventoryModel || prev.InventoryModel)?.json?.data || {};
  const now = {};
  for (const k of KEYS) now[k] = inv[k];
  const deltas = KEYS.filter((k) => prevInv[k] !== undefined && prevInv[k] !== now[k])
    .map((k) => `${k} ${prevInv[k]}->${now[k]}`);
  const who = Object.keys(s.models).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(s.models[k]));
  console.log(
    `[${String(s.seq).padStart(2)}] lvl${String(now.level).padStart(2)} exp${String(now.exp).padStart(5)} ` +
    `coins${String(now.coins).padStart(4)} gems${String(now.gems).padStart(4)} crates${String(now.crates).padStart(3)} ` +
    `energy${String(now.energy).padStart(4)} tk${String(now.tickets).padStart(2)}` +
    (deltas.length ? `\n      >> ${deltas.join(', ')}` : '') +
    `\n      models: ${who.slice(0, 8).map((w) => w.replace('TilesStateModel_', 'T').replace('Model', '')).join(' ')}`
  );
  Object.assign(prevInv, now);
  for (const [k, m] of Object.entries(s.models)) prev[k] = m;
}
