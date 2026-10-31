// scratch/probe_key_validity.js - is a candidate FMV_KEY accepted by this deployment?
//
// Safe: it calls /v2/account/session/refresh with a syntactically valid but unknown
// refresh token, so the server cannot rotate or revoke anything. It never opens a
// socket and never touches the session in session.json.
//
// Usage:
//   node scratch/probe_key_validity.js                 # tests FMV_KEY from .env
//   node scratch/probe_key_validity.js <key> [<key>]   # tests explicit candidates
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { httpBase } from '../lib/nakama.js';

const sessionPath = process.env.FMV_SESSION || path.join(process.cwd(), 'session.json');
const s = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const BOGUS = '00000000-0000-0000-0000-000000000000';

const candidates = process.argv.slice(2);
if (!candidates.length) candidates.push(process.env.FMV_KEY || '');

const mask = (k) => (!k ? '(none)' : k.length <= 6 ? k : `${k.slice(0, 4)}…${k.slice(-2)} (len ${k.length})`);

const variants = [
  ...candidates.map((k) => ({ label: `candidate ${mask(k)}`, key: k })),
  { label: 'known-bad "defaultkey"', key: 'defaultkey' },
  { label: 'no Authorization header', key: null },
];

for (const v of variants) {
  const headers = { 'Content-Type': 'application/json', Origin: s.origin };
  if (v.key !== null) headers.Authorization = 'Basic ' + Buffer.from(v.key + ':').toString('base64');
  let out;
  try {
    const res = await fetch(httpBase(s) + '/v2/account/session/refresh', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: BOGUS }),
    });
    out = `HTTP ${res.status}  ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    out = `request failed: ${e.message}`;
  }
  console.log(`${v.label.padEnd(34)} -> ${out}`);
}
