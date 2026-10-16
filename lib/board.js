// Board / model helpers for Farm Merge Valley save data.
'use strict';

export const ABBR = {
  wheat: 'W', carrot: 'C', sunflower: 'F', corn: 'N', egg: 'E', milk: 'M',
  cow: 'K', chicken: 'H', tree: 'T', stone: 'S', wood: 'O',
};

const TILE_RE = /^TilesStateModel_(\d+):(\d+)$/;

/** An empty cell in the persisted tile format. */
export const emptyTile = () => ({ data: { state: null }, version: 1 });

/** A cell holding `blueprint` with the given component data. */
export const filledTile = (blueprint, data) => ({
  data: { state: { data, blueprint } },
  version: 1,
});

export function tiles(models) {
  const out = new Map();
  for (const [key, m] of Object.entries(models)) {
    const match = TILE_RE.exec(key);
    if (!match) continue;
    const row = Number(match[1]);
    const col = Number(match[2]);
    const state = m.json?.data?.state;
    if (!state) { out.set(`${row}:${col}`, null); continue; }
    const d = state.data || {};
    out.set(`${row}:${col}`, {
      row, col, key,
      blueprint: state.blueprint ?? null,
      data: d,
      level: d.level ?? null,
      mergeable: d.mergeable ?? null,
      raw: state,
    });
  }
  return out;
}

export function printBoard(models, { verbose = false } = {}) {
  const t = tiles(models);
  const filled = [...t.values()].filter(Boolean);
  console.log(`models=${Object.keys(models).length} tiles=${t.size} filled=${filled.length}`);
  if (!filled.length) return;
  const rows = filled.map((v) => v.row);
  const cols = filled.map((v) => v.col);
  const r0 = Math.min(...rows), r1 = Math.max(...rows);
  const c0 = Math.min(...cols), c1 = Math.max(...cols);
  console.log(`bbox rows ${r0}..${r1} cols ${c0}..${c1}`);
  console.log('     ' + Array.from({ length: c1 - c0 + 1 }, (_, i) => String(c0 + i).padStart(4)).join(''));
  for (let r = r0; r <= r1; r++) {
    let line = String(r).padStart(4) + ' ';
    for (let c = c0; c <= c1; c++) {
      const v = t.get(`${r}:${c}`);
      if (!v) { line += '   .'; continue; }
      const bp = v.blueprint || '?';
      const base = bp.replace(/_?\d+$/, '');
      const ch = ABBR[base] || bp[0] || '?';
      line += (ch + (v.blueprint?.match(/_(\d+)$/)?.[1] ?? '')).padStart(4);
    }
    console.log(line);
  }
  if (verbose) {
    console.log('\ntiles:');
    for (const v of filled.sort((a, b) => a.row - b.row || a.col - b.col)) {
      console.log(`  (${v.row},${v.col}) ${v.blueprint} merge=${JSON.stringify(v.mergeable)}`);
    }
  }
}

/** Group mergeable tiles by blueprint -> list of cells. */
export function byBlueprint(models) {
  const groups = new Map();
  for (const v of tiles(models).values()) {
    if (!v || !v.blueprint) continue;
    if (!v.mergeable) continue;
    if (!groups.has(v.blueprint)) groups.set(v.blueprint, []);
    groups.get(v.blueprint).push(v);
  }
  return groups;
}

/**
 * Existing-but-empty cells inside (plus one ring around) the occupied bbox,
 * nearest to `near` first. Used whenever something spawns new tiles.
 */
export function freeCells(models, near = { row: 0, col: 0 }) {
  const t = tiles(models);
  const filled = [...t.values()].filter(Boolean);
  if (!filled.length) return [];
  const rows = filled.map((v) => v.row);
  const cols = filled.map((v) => v.col);
  const out = [];
  for (let r = Math.min(...rows) - 1; r <= Math.max(...rows) + 1; r++) {
    for (let c = Math.min(...cols) - 1; c <= Math.max(...cols) + 1; c++) {
      if (!t.get(`${r}:${c}`)) out.push({ row: r, col: c, key: `TilesStateModel_${r}:${c}` });
    }
  }
  const d = (x) => Math.abs(x.row - near.row) + Math.abs(x.col - near.col);
  out.sort((a, b) => d(a) - d(b) || a.row - b.row || a.col - b.col);
  return out;
}
