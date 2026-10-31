// one-off: was this HAR exported sanitized (auth headers stripped)?
import fs from 'node:fs';

const har = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const entries = har.log.entries || [];

let withCookies = 0;
let withCookieHeader = 0;
let withAuth = 0;
let withSetCookie = 0;
const headerNames = new Set();

for (const e of entries) {
  const req = e.request || {};
  if (Array.isArray(req.cookies) && req.cookies.length) withCookies++;
  const res = e.response || {};
  if (Array.isArray(res.cookies) && res.cookies.length) withSetCookie++;
  for (const h of req.headers || []) {
    headerNames.add(String(h.name).toLowerCase());
    if (String(h.name).toLowerCase() === 'cookie') withCookieHeader++;
    if (String(h.name).toLowerCase() === 'authorization') withAuth++;
  }
}

console.log(`entries: ${entries.length}`);
console.log(`request.cookies[] non-empty : ${withCookies}`);
console.log(`response.cookies[] non-empty: ${withSetCookie}`);
console.log(`Cookie header              : ${withCookieHeader}`);
console.log(`Authorization header       : ${withAuth}`);
console.log(`\nhar.log keys: ${Object.keys(har.log).join(', ')}`);
console.log(`creator: ${JSON.stringify(har.log.creator)}`);
console.log(`\nheader names (${headerNames.size}): ${[...headerNames].sort().join(', ')}`);
