import '../lib/env.js';
// scratch/stock_timeline.js - MarketplaceModel.data.stock over time.
//
// The stock is the refill counter (0 -> 1 when a refill lands, 1 -> 0 when collected), so its flips
// are the ground truth for refill cadence - independent of the TimerModel durations. That matters
// for `event_energy_5_no_ads`, which is live at stock 1 with *no* timer at all, so its duration can
// only be inferred from how the stock moves here.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));

let prev = null;
let prevSeq = null;
for (const s of saves) {
  const mp = s.models.MarketplaceModel;
  if (!mp) continue;
  const stock = mp.json?.data?.stock;
  if (!stock) continue;

  const diff = [];
  if (prev) {
    for (const k of Object.keys(stock)) {
      if (prev[k] !== stock[k]) diff.push(`${k}: ${prev[k]} -> ${stock[k]}`);
    }
    for (const k of Object.keys(prev)) {
      if (!(k in stock)) diff.push(`${k}: ${prev[k]} -> (removed)`);
    }
  } else {
    diff.push(`first snapshot: ${Object.entries(stock).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  const ts = mp.ts || s.ts;
  if (diff.length) {
    console.log(`save ${String(s.seq).padStart(2)} ${ts ? new Date(ts).toISOString().slice(11, 19) : ''}${prev && s.seq - prevSeq > 1 ? `  (skipped ${s.seq - prevSeq - 1} save(s) with no MarketplaceModel)` : ''}`);
    for (const d of diff) console.log(`    ${d}`);
  }
  prev = stock;
  prevSeq = s.seq;
}

console.log('\n=== final stock ===');
console.log(JSON.stringify(prev, null, 1));
