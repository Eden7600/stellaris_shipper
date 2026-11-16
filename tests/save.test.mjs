import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readSave } from '../src/lib/save.js';

/** Minimal one-file zip (deflate), enough for readSave. */
function zip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(n.length, 28);
  const cdOffset = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, central, n, eocd]);
}

test('readSave: players, techs and used naval capacity of a country', async () => {
  const gamestate = [
    'version="Cygnus v4.5.4"', 'name="Test Empire"', 'date="2250.01.01"',
    'player=\n{\n\t{\n\t\tname="Alice"\n\t\tcountry=1\n\t}\n}',
    'country=\n{\n\t0=\n\t{\n\t\ttech_status=\n\t\t{\n\t\t\ttechnology="tech_lasers_1"\n\t\t}\n\t\tused_naval_capacity=3\n\t}',
    '\t1=\n\t{\n\t\tname=\n\t\t{\n\t\t\tkey="Blorg Union"\n\t\t}\n\t\ttech_status=\n\t\t{\n\t\t\ttechnology="tech_corvettes"\n\t\t\tlevel=1\n\t\t\ttechnology="tech_destroyers"\n\t\t\tlevel=1\n\t\t}\n\t\tused_naval_capacity=42\n\t}\n}',
  ].join('\n');
  const save = await readSave(new Blob([zip('gamestate', gamestate)]));
  assert.deepEqual(save.players, [{ name: 'Alice', country: 1 }]);
  assert.equal(save.meta.date, '2250.01.01');
  const c = save.country(1);
  assert.deepEqual(c.techs, ['tech_corvettes', 'tech_destroyers']);
  assert.equal(c.navalUsed, 42);
  assert.equal(c.name, 'Blorg Union');
  await assert.rejects(readSave(new Blob([Buffer.from('not a zip')])));
});
