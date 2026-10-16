// Minimal protobuf reader/writer for the Farm Merge Valley save format.
// Entry:  field1 = key (string)
//         field2 = wrapper { 1: JSON bytes, 2: md5 string, 3: timestamp varint }
'use strict';

export function encodeVarint(value) {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  const bytes = [];
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) bytes.push(b | 0x80);
    else { bytes.push(b); break; }
  }
  return Buffer.from(bytes);
}

export function decodeVarint(buf, pos) {
  let shift = 0n, val = 0n, b;
  do {
    if (pos >= buf.length) throw new Error('truncated varint');
    b = buf[pos++];
    val |= BigInt(b & 0x7f) << shift;
    shift += 7n;
  } while (b & 0x80);
  return [val, pos];
}

export function parseFields(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = decodeVarint(buf, i);
    const f = Number(key >> 3n);
    const wt = Number(key & 7n);
    if (wt === 0) {
      let v; [v, i] = decodeVarint(buf, i);
      out.push({ f, wt, v });
    } else if (wt === 2) {
      let len; [len, i] = decodeVarint(buf, i);
      len = Number(len);
      out.push({ f, wt, v: buf.subarray(i, i + len) });
      i += len;
    } else if (wt === 5) {
      out.push({ f, wt, v: buf.subarray(i, i + 4) }); i += 4;
    } else if (wt === 1) {
      out.push({ f, wt, v: buf.subarray(i, i + 8) }); i += 8;
    } else {
      throw new Error(`unknown wire type ${wt} at ${i}`);
    }
  }
  return out;
}

export const get = (fields, f, wt) =>
  fields.filter((x) => x.f === f && (wt === undefined || x.wt === wt)).map((x) => x.v);

export const getOne = (fields, f, wt) => get(fields, f, wt)[0];

export function enc(f, wt, payload) {
  const key = encodeVarint((BigInt(f) << 3n) | BigInt(wt));
  if (wt === 2) return Buffer.concat([key, encodeVarint(payload.length), payload]);
  if (wt === 0) return Buffer.concat([key, encodeVarint(payload)]);
  throw new Error('unsupported wire type ' + wt);
}

export function encodeModelEntry(key, jsonValue, md5, ts) {
  const jsonBuf = Buffer.from(JSON.stringify(jsonValue), 'utf8');
  const parts = [enc(1, 2, jsonBuf)];
  if (md5) parts.push(enc(2, 2, Buffer.from(md5, 'utf8')));
  if (ts !== null && ts !== undefined) parts.push(enc(3, 0, ts));
  const wrapper = Buffer.concat(parts);
  // entry = { 1: key, 2: wrapper }, and the outer list wraps each entry in field 1
  const entry = Buffer.concat([
    enc(1, 2, Buffer.from(key, 'utf8')),
    enc(2, 2, wrapper),
  ]);
  return enc(1, 2, entry);
}

export function decodeModels(buf) {
  const models = {};
  for (const entry of get(parseFields(buf), 1, 2)) {
    const f = parseFields(entry);
    const keyB = getOne(f, 1, 2);
    const key = keyB ? keyB.toString('utf8') : '?';
    const wrapB = getOne(f, 2, 2);
    let json = null, md5 = null, ts = null, rawJson = null;
    if (wrapB) {
      const wf = parseFields(wrapB);
      const jb = getOne(wf, 1, 2);
      if (jb) {
        rawJson = jb;
        try { json = JSON.parse(jb.toString('utf8')); }
        catch { json = jb.toString('utf8'); }
      }
      const mb = getOne(wf, 2, 2);
      if (mb) md5 = mb.toString('utf8');
      const tb = getOne(wf, 3, 0);
      if (tb !== undefined) ts = tb;
    }
    models[key] = { key, json, md5, ts, rawJson };
  }
  return models;
}

export function b64ToBuf(text) {
  let t = (text || '').trim();
  t += '='.repeat((4 - (t.length % 4)) % 4);
  return Buffer.from(t, 'base64');
}
