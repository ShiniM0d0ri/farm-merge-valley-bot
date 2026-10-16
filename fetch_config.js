// fetch_config.js - download the game's config jsonpacks from the activity's own static files.
//
// Every pack is one file: `/.proxy/json/<pack>/jsonpack.json`, and `jsonpackmap.json` is the index
// that names the packs (it maps each id, e.g. `alpaca_1`, to the pack that defines it, e.g.
// `blueprints`). This fetches them and writes the `<pack>_jsonpack.json` maps the bot and the tests
// read from `CFG_DIR` (`./config` by default).
//
// These are public static files - no auth, no capture, no account involved. Run it once after
// cloning; `config/` is git-ignored, so the repo never carries game assets (see README "Game config").
//
//   node fetch_config.js          # the five packs the bot needs
//   node fetch_config.js --all    # every pack the index names
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID } from './lib/creds.js';
import { CFG_DIR, requireEnv } from './lib/env.js';

/** The packs the bot (and the fixture tests) actually read. */
const NEEDED = ['blueprints', 'progression', 'controlled_randomness', 'recipes', 'buildings'];
/** Asset version. The static host ignores it, but the client's own is the safe value. */
const V = process.env.FMV_VERSION || '1.80.4-1';

const ALL = process.argv.slice(2).includes('--all');

requireEnv(['FMV_APP_ID'], 'the config lives at https://<APP_ID>.discordsays.com');
const base = `https://${APP_ID}.discordsays.com`;

/** Fetch a URL as text, retrying once without the `?v=` query (the host accepts either). */
async function get(url) {
  for (const u of [url, url.replace(/\?v=[^&]*$/, '')]) {
    const r = await fetch(u);
    if (r.ok) return r.text();
  }
  throw new Error(`not found: ${url}`);
}

console.log(`config host: ${base}  (version ${V})`);

const index = await get(`${base}/jsonpackmap.json`);
const packsInIndex = [...new Set(Object.values(JSON.parse(index)))].sort();
console.log(`index: ${Object.keys(JSON.parse(index)).length} ids -> ${packsInIndex.length} packs`);

const packs = ALL ? packsInIndex : NEEDED;
console.log(`downloading: ${packs.join(', ')}\n`);

fs.mkdirSync(CFG_DIR, { recursive: true });

let failed = 0;
for (const pack of packs) {
  const url = `${base}/.proxy/json/${pack}/jsonpack.json?v=${V}`;
  const out = path.join(CFG_DIR, `${pack}_jsonpack.json`);
  let text;
  try {
    text = await get(url);
  } catch (e) {
    console.log(`SKIP ${pack}: ${e.message}`);
    failed++;
    continue;
  }
  const obj = JSON.parse(text);
  const before = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  fs.writeFileSync(out, JSON.stringify(obj, null, 2));

  // If a file was already there, say whether the download matches it.
  let note = '';
  if (before !== null) {
    const same = JSON.stringify(JSON.parse(before)) === JSON.stringify(obj);
    note = same ? '  [matches the existing file]' : '  [DIFFERS from the existing file]';
  }
  console.log(`wrote ${path.relative(process.cwd(), out).replace(/\\/g, '/')}  (${Object.keys(obj).length} entries)${note}`);
}

console.log(`\ndone -> ${CFG_DIR}${failed ? `  (${failed} pack(s) unavailable)` : ''}`);
