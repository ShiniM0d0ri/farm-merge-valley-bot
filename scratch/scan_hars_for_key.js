// scratch/scan_hars_for_key.js - look for the Nakama server key in every capture in a directory.
//
// The key is the `Authorization: Basic base64("<key>:")` header on authenticate/rpc calls. Chrome's
// sanitized export strips it, so a capture can look empty while a sibling capture has it.
//
//   node scratch/scan_hars_for_key.js "<dir>" [glob]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads');
const pattern = new RegExp(process.argv[3] || 'farm.*\\.har$', 'i');

const files = fs.readdirSync(dir).filter((f) => pattern.test(f));
if (!files.length) {
  console.log(`no captures matching ${pattern} in ${dir}`);
  process.exit(1);
}

const mask = (v, n = 8) => `${String(v).slice(0, n)}… (${String(v).length} chars)`;

for (const f of files) {
  const p = path.join(dir, f);
  const size = (fs.statSync(p).size / 1048576).toFixed(1);
  let har;
  try {
    har = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log(`\n=== ${f} (${size} MB) ===\n  unreadable: ${e.message}`);
    continue;
  }
  const entries = har.log?.entries || [];
  let auth = 0;
  let basic = 0;
  let cookie = 0;
  const keys = new Set();

  for (const e of entries) {
    for (const h of e.request?.headers || []) {
      const name = String(h.name || '').toLowerCase();
      const value = String(h.value || '');
      if (name === 'cookie') cookie++;
      if (name !== 'authorization') continue;
      auth++;
      if (/^basic\s+/i.test(value)) {
        basic++;
        const dec = Buffer.from(value.replace(/^basic\s+/i, ''), 'base64').toString('utf8');
        keys.add(dec.endsWith(':') ? dec.slice(0, -1) : dec);
      }
    }
  }

  console.log(`\n=== ${f} (${size} MB) ===`);
  console.log(`  entries ${entries.length}   authorization ${auth}   basic ${basic}   cookie ${cookie}`);
  if (keys.size) {
    for (const k of keys) console.log(`  KEY: ${mask(k)}   base64(key:) = ${mask(Buffer.from(k + ':').toString('base64'), 12)}`);
  } else {
    console.log('  no basic-auth key in this capture');
  }
}
