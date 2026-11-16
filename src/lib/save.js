// Reads a Stellaris .sav (a zip with a plain-text `gamestate`) entirely in the browser.
// Pulls the players, and for a chosen country its researched techs and used naval capacity.

/** Extract one file from a zip archive (stored or deflated). */
async function unzipEntry(buf, wanted) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a Stellaris save (no zip directory found).');
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = new Uint8Array(buf, start, size);
      if (method === 0) return dec.decode(data);
      if (method !== 8) throw new Error(`Unsupported zip compression (${method}).`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`"${wanted}" not found in the save.`);
}

/** Text of the `{ ... }` block that starts at or after `from` (brace-matched). */
function blockAt(text, from) {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

export async function readSave(file) {
  const gs = await unzipEntry(await file.arrayBuffer(), 'gamestate');
  const meta = { version: gs.match(/^version="([^"]*)"/m)?.[1], name: gs.match(/^name="([^"]*)"/m)?.[1], date: gs.match(/^date="([^"]*)"/m)?.[1] };
  const players = [...blockAt(gs, gs.indexOf('\nplayer=')).matchAll(/name="([^"]*)"\s*country=(\d+)/g)].map((m) => ({ name: m[1], country: Number(m[2]) }));
  const countriesAt = gs.search(/\ncountry=\n\{/);
  if (countriesAt < 0) throw new Error('No countries found in the save.');
  return {
    meta, players,
    /** Researched techs and used naval capacity of one country. */
    country(id) {
      const at = gs.indexOf(`\n\t${id}=\n\t{`, countriesAt);
      if (at < 0) throw new Error(`Country ${id} not found.`);
      const techs = [...blockAt(gs, gs.indexOf('tech_status=', at)).matchAll(/technology="([^"]+)"/g)].map((m) => m[1]);
      const naval = gs.slice(at, at + 2_000_000).match(/\n\t\tused_naval_capacity=([\d.]+)/);
      const name = gs.slice(at, at + 100_000).match(/\n\t\tname=\n\t\t\{\n\t\t\tkey="([^"]*)"/)?.[1];
      return { techs, navalUsed: naval ? Math.round(Number(naval[1])) : null, name };
    },
  };
}
