// Environment loading - zero dependencies.
//
// Every secret and every machine-specific path comes from the environment, and a local `.env`
// (never committed - see .gitignore) is loaded into `process.env` on first import. Real environment
// variables always win, so `FMV_KEY=... node bot.js` still overrides the file.
//
// Any module that reads `process.env` at import time must `import './env.js'` (or import something
// that does) so the file is parsed before those reads run.
'use strict';
import fs from 'node:fs';
import path from 'node:path';

export const ENV_PATH = process.env.FMV_ENV || path.join(process.cwd(), '.env');

/**
 * Parse a .env file into `process.env` (values already present win) and return what it held.
 * Handles `KEY=value`, `export KEY=value`, blank lines, `#` comments, quoted values and trailing
 * `# comment`. A missing file is not an error - the environment may already carry everything.
 */
export function loadEnv(file = ENV_PATH) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      value.length > 1 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0];
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

// loaded on import, so `import './env.js'` is enough to make a module env-aware
loadEnv();

/** Root of the extracted game config (`*_jsonpack.json`). Override with `FMV_CFG`. */
export const CFG_DIR = process.env.FMV_CFG || path.join(process.cwd(), 'config');

/** Path of a config file inside `CFG_DIR`. */
export const cfgPath = (name) => path.join(CFG_DIR, name);

/** Throw one actionable error naming every variable that is missing. */
export function requireEnv(names, hint) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(
      `missing ${missing.join(', ')} - copy .env.example to .env and fill it in` +
        (hint ? ` (${hint})` : '')
    );
  }
}
