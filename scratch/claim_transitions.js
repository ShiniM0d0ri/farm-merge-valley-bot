import '../lib/env.js';
// scratch/claim_transitions.js - find the saves where a task/reward flag flips, and show the
// paired InventoryModel delta in the SAME save (rewards are client-applied).
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));
const state = {};

// fields worth reporting from InventoryModel
const INV_KEYS = ['coins', 'gems', 'crates', 'energy', 'tickets', 'exp', 'level'];

function invDelta(before, after) {
  const a = before?.json?.data || {};
  const b = after?.json?.data || {};
  const out = [];
  for (const k of INV_KEYS) if (a[k] !== b[k]) out.push(`${k} ${a[k]}->${b[k]}`);
  return out.join(', ');
}

function dcSummary(m) {
  const d = m?.json?.data;
  if (!d) return '(none)';
  const parts = [];
  for (const t of d.targets || []) {
    if (t.currentAmount >= t.targetAmount && !t.collected) parts.push(`READY id${t.id} ${t.task} ${t.currentAmount}/${t.targetAmount} -> ${t.reward?.data?.key} ${t.reward?.data?.amount}`);
  }
  const claimed = (d.targets || []).filter((t) => t.collected).map((t) => `id${t.id}`);
  return `claimed=[${claimed.join(',')}] ready=[${parts.join(' | ')}] mainCollected=${d.mainChallenge?.collected}`;
}

for (const s of saves) {
  const beforeInv = state.InventoryModel;
  for (const [k, m] of Object.entries(s.models)) {
    if (k === 'InventoryModel') continue;
    const prev = state[k];
    if (JSON.stringify(prev) === JSON.stringify(m)) continue;
    const interesting = /DailyChallenge|NextObjective|VisitorReward|TimelineEvent|CrateContent/.test(k);
    if (interesting) {
      const inv = s.models.InventoryModel ? `  [inv ${invDelta(beforeInv, s.models.InventoryModel)}]` : '';
      console.log(`\nsave[${s.seq}] ${k}${inv}`);
      if (k === 'DailyChallengeModel') console.log(`   ${dcSummary(m)}`);
      else console.log(`   ${JSON.stringify(m.json).slice(0, 300)}`);
    }
    state[k] = m;
  }
  if (s.models.InventoryModel) state.InventoryModel = s.models.InventoryModel;
}
