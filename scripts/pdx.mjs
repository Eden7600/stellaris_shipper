// Minimal Paradox (Clausewitz) script parser.
// Blocks become objects; repeated keys become arrays; bare values go in `_list`.
// Each object also keeps `_entries` ([key, op, value]) so order/operators survive.

const TOKEN = /\s+|#[^\n]*|"((?:[^"\\]|\\.)*)"|(<=|>=|!=|==|=|<|>|\{|\})|([^\s=<>!{}"#]+)/gy;

export function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while (TOKEN.lastIndex < src.length && (m = TOKEN.exec(src))) {
    if (m[1] !== undefined) out.push({ s: m[1], q: true });
    else if (m[2]) out.push({ s: m[2], op: true });
    else if (m[3]) out.push({ s: m[3] });
  }
  return out;
}

export function parse(src, vars = {}) {
  const t = tokenize(src.replace(/^﻿/, ''));
  let i = 0;
  const scalar = (tok) => {
    if (tok.q) return tok.s;
    if (tok.s.startsWith('@') && !tok.s.startsWith('@[')) {
      return tok.s in vars ? vars[tok.s] : tok.s;
    }
    return /^-?\d+(\.\d+)?$/.test(tok.s) ? Number(tok.s) : tok.s;
  };
  function block(top) {
    const obj = { _entries: [] };
    while (i < t.length) {
      const tok = t[i++];
      if (tok.op && tok.s === '}') {
        if (top) continue; // tolerate stray closing braces
        return obj;
      }
      let value;
      if (tok.op && tok.s === '{') {
        value = block(false);
        (obj._list ??= []).push(value);
        continue;
      }
      const next = t[i];
      if (next && next.op && next.s !== '{' && next.s !== '}') {
        const op = next.s;
        i++;
        const vt = t[i++];
        value = vt && vt.op && vt.s === '{' ? block(false) : scalar(vt ?? { s: '' });
        // top-level @var definitions feed later lookups in the same file
        if (top && tok.s.startsWith('@') && op === '=') {
          vars[tok.s] = value;
          continue;
        }
        add(obj, tok.s, value, op);
      } else {
        (obj._list ??= []).push(scalar(tok));
      }
    }
    return obj;
  }
  return block(true);
}

function add(obj, key, value, op) {
  obj._entries.push([key, op, value]);
  if (key in obj) {
    if (!Array.isArray(obj[key]) || !obj[key]._multi) {
      const arr = [obj[key]];
      arr._multi = true;
      obj[key] = arr;
    }
    obj[key].push(value);
  } else obj[key] = value;
}

/** Always return an array of the values stored under `key`. */
export function all(obj, key) {
  if (!obj || !(key in obj)) return [];
  const v = obj[key];
  return Array.isArray(v) && v._multi ? v : [v];
}

/** List contents of a `{ a b c }` block. */
export const list = (v) => (v && typeof v === 'object' ? (v._list ?? []) : v == null ? [] : [v]);
