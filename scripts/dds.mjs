// DDS (uncompressed masked RGB(A) and DXT1/3/5, first mip only) -> RGBA -> PNG.
import zlib from 'node:zlib';

export function decodeDDS(buf) {
  if (buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('not a DDS file');
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const fourCC = buf.toString('latin1', 84, 88);
  const bits = buf.readUInt32LE(88);
  const masks = [92, 96, 100, 104].map((o) => buf.readUInt32LE(o));
  const data = fourCC === 'DX10' ? 148 : 128;
  const out = Buffer.alloc(width * height * 4);

  if (fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5') {
    decodeDXT(buf, data, width, height, fourCC, out);
  } else if (fourCC === '\0\0\0\0') {
    const bpp = bits / 8;
    const chan = masks.map((m) => {
      if (!m) return null;
      const lo = 31 - Math.clz32(m & -m); // index of lowest set bit
      return { m, lo, max: m >>> lo };
    });
    for (let p = 0; p < width * height; p++) {
      let v = 0;
      for (let b = 0; b < bpp; b++) v |= buf[data + p * bpp + b] << (8 * b);
      v >>>= 0;
      for (let c = 0; c < 4; c++) {
        const ch = chan[c];
        out[p * 4 + c] = ch ? Math.round((((v & ch.m) >>> ch.lo) / ch.max) * 255) : 255;
      }
    }
  } else throw new Error(`unsupported DDS format ${JSON.stringify(fourCC)}`);
  return { width, height, rgba: out };
}

function rgb565(c) {
  return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
}

function decodeDXT(buf, off, w, h, kind, out) {
  const blockSize = kind === 'DXT1' ? 8 : 16;
  for (let by = 0; by < Math.ceil(h / 4); by++) {
    for (let bx = 0; bx < Math.ceil(w / 4); bx++) {
      const o = off + (by * Math.ceil(w / 4) + bx) * blockSize;
      const alpha = new Array(16).fill(255);
      let co = o;
      if (kind === 'DXT3') {
        for (let k = 0; k < 16; k++) alpha[k] = ((buf[o + (k >> 1)] >> ((k & 1) * 4)) & 15) * 17;
        co = o + 8;
      } else if (kind === 'DXT5') {
        const a0 = buf[o], a1 = buf[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let k = 1; k < 7; k++) pal.push(((7 - k) * a0 + k * a1) / 7);
        else { for (let k = 1; k < 5; k++) pal.push(((5 - k) * a0 + k * a1) / 5); pal.push(0, 255); }
        let bitsLo = buf.readUInt32LE(o + 2) >>> 0, bitsHi = buf.readUInt16LE(o + 6);
        const all = BigInt(bitsLo) | (BigInt(bitsHi) << 32n);
        for (let k = 0; k < 16; k++) alpha[k] = pal[Number((all >> BigInt(3 * k)) & 7n)];
        co = o + 8;
      }
      const c0 = buf.readUInt16LE(co), c1 = buf.readUInt16LE(co + 2);
      const p0 = rgb565(c0), p1 = rgb565(c1);
      const cols = [p0, p1];
      if (c0 > c1 || kind !== 'DXT1') {
        cols.push(p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3));
      } else {
        cols.push(p0.map((v, i) => (v + p1[i]) / 2), [0, 0, 0]);
      }
      const idx = buf.readUInt32LE(co + 4);
      for (let k = 0; k < 16; k++) {
        const x = bx * 4 + (k & 3), y = by * 4 + (k >> 2);
        if (x >= w || y >= h) continue;
        const ci = (idx >>> (2 * k)) & 3;
        const p = (y * w + x) * 4;
        const c = cols[ci];
        out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2];
        out[p + 3] = kind === 'DXT1' && c0 <= c1 && ci === 3 ? 0 : alpha[k];
      }
    }
  }
}

/** Crop to frame `frame` (0-based) of a horizontal sprite strip with `frames` frames. */
export function cropFrame(img, frames, frame = 0) {
  if (frames <= 1) return img;
  const fw = Math.floor(img.width / frames);
  const out = Buffer.alloc(fw * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    img.rgba.copy(out, y * fw * 4, (y * img.width + frame * fw) * 4, (y * img.width + (frame + 1) * fw) * 4);
  }
  return { width: fw, height: img.height, rgba: out };
}

export function encodePNG({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Box-filter downscale by an integer factor. */
export function downscale(img, f) {
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += img.rgba[((y * f + dy) * img.width + x * f + dx) * 4 + c];
    out[(y * w + x) * 4 + c] = sum / (f * f);
  }
  return { width: w, height: h, rgba: out };
}
