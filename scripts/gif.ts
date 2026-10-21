/* Renders dither.gif for the README: the field drifting while the palette
 * steps through the presets. A CPU port of src/shader.ts — change one, change
 * the other — and a small GIF encoder, so it needs nothing installed.
 *
 *   npm run gif
 */
import { writeFileSync } from "node:fs";
import { PALETTES, resolvePalette, type PaletteName } from "../src/palettes.ts";

const WIDTH = 720;
const HEIGHT = 300;
const CELL = 3;
const FPS = 20;
const SECONDS_PER_PALETTE = 1.6;
const START = 20; // the reduced-motion frame, so the field is developed

const fract = (x: number) => x - Math.floor(x);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number) {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), ux), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy);
}

// mat2(1.62, 1.18, -1.18, 1.62) is column-major in GLSL.
function fbm(x: number, y: number) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) {
    v += a * noise(x, y);
    [x, y] = [1.62 * x - 1.18 * y, 1.18 * x + 1.62 * y];
    a *= 0.5;
  }
  return v;
}

const b2 = (x: number, y: number) => (2 * x + 3 * y) % 4;
const bayer4 = (cx: number, cy: number) => {
  const x = cx % 4, y = cy % 4;
  return (4 * b2(x % 2, y % 2) + b2(Math.floor(x / 2), Math.floor(y / 2))) / 16;
};

/** Ramp indices for one frame, top row first. */
function frame(cw: number, ch: number, time: number, steps: number, well = 0, seed = 0) {
  const out = new Uint8Array(cw * ch);
  const aspect = cw / ch;
  const ax = aspect >= 1 ? aspect : 1, ay = aspect >= 1 ? 1 : 1 / aspect;
  const t = time * 0.11;
  const n = steps - 1;
  for (let row = 0; row < ch; row++) {
    const fy = ch - 1 - row; // gl_FragCoord is bottom-up
    const vy = (fy + 0.5) / ch;
    for (let col = 0; col < cw; col++) {
      const vx = (col + 0.5) / cw;
      const px = (vx - 0.5) * ax * 2.5 + seed;
      const py = (vy - 0.5) * ay * 2.5 + seed;

      const qx = fbm(px, py + t);
      const qy = fbm(px + 5.2, py - t * 0.8);
      const rx = fbm(px + 2.6 * qx + 1.7 + t * 0.22, py + 2.6 * qy + 9.2 + t * 0.22);
      const ry = fbm(px + 2.6 * qx + 8.3 - t * 0.17, py + 2.6 * qy + 2.8 - t * 0.17);
      const f = fbm(px + 3.1 * rx, py + 3.1 * ry);

      const ripple = Math.sin((rx * 3.4 + ry * 2.2 + f * 5.6) * 3.6 - t * 2.6);
      const ripple2 = Math.sin((qx - qy) * 6.2 + t * 1.7);
      let v = 0.03 + f * 0.54 + ripple * 0.26 + ripple2 * 0.09;

      const lift = 1 - clamp(Math.hypot(vx - 0.24, vy - 0.84) * 0.95);
      v += 0.08 * Math.pow(lift, 2.2);
      v -= 0.08 * Math.pow(1 - clamp(Math.hypot(vx - 0.86, vy - 0.12) * 1.4), 1.4);

      const centre = Math.hypot(vx - 0.5, vy - 0.5);
      v -= well * 0.34 * smoothstep(0.42, 0.02, centre);
      v = Math.pow(clamp(v), 1.55);

      const glint = noise(px * 1.7 + t * 0.9, py * 1.7 - t * 0.6);
      let crest = smoothstep(0.94, 1, ripple) * 0.85;
      crest *= mix(0.4, 1, smoothstep(0.3, 0.7, glint));
      crest *= mix(0.55, 1, smoothstep(0.1, 0.45, v));
      crest *= mix(1, smoothstep(0.22, 0.42, centre), well);

      const d = bayer4(col, fy);
      let s = v * n * 0.75;
      const knee = n * 0.5;
      if (s > knee) s = knee + (s - knee) * 1.3;
      let idx = clamp(Math.floor(s + d), 0, n);
      const h = Math.floor(crest * 2 + d);
      if (h > 1.5) idx = n;
      else if (h > 0.5) idx = Math.max(idx, n - Math.floor(n / 4 + 0.5));
      out[row * cw + col] = idx;
    }
  }
  return out;
}

/* ── GIF89a ── one global table holding every preset, a reserved transparent
   index, and frames that only carry the pixels that changed. */

function lzw(indices: Uint8Array, minCodeSize: number) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let size = minCodeSize + 1, next = eoi + 1;
  let table = new Map<number, number>();
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  const emit = (code: number) => {
    buf |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(buf & 255);
      buf >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      size = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) bytes.push(buf & 255);
  return bytes;
}

const names = Object.keys(PALETTES) as PaletteName[];
const ramps = names.map((name) => resolvePalette(name));
const colours: number[][] = [];
const lookup = ramps.map((ramp) =>
  ramp.map((c) => {
    const rgb = c.map((x) => Math.round(x * 255));
    let i = colours.findIndex((o) => o.every((x, j) => x === rgb[j]));
    if (i < 0) i = colours.push(rgb) - 1;
    return i;
  }),
);
const TRANSPARENT = colours.length;
const tableBits = Math.max(2, Math.ceil(Math.log2(colours.length + 1)));
while (colours.length < 1 << tableBits) colours.push([0, 0, 0]);

const cw = Math.round(WIDTH / CELL), ch = Math.round(HEIGHT / CELL);
const W = cw * CELL, H = ch * CELL;
const le16 = (n: number) => [n & 255, n >> 8];
const out: number[] = [
  ...Buffer.from("GIF89a"), ...le16(W), ...le16(H), 0xf0 | (tableBits - 1), 0, 0,
  ...colours.flat(),
  0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 0x03, 0x01, 0, 0, 0,
];

const perPalette = Math.round(SECONDS_PER_PALETTE * FPS);
let previous: Uint8Array | null = null;
for (let f = 0; f < perPalette * names.length; f++) {
  const p = Math.floor(f / perPalette);
  const cells = frame(cw, ch, START + f / FPS, ramps[p].length);
  const full = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) full[y * W + x] = lookup[p][cells[Math.floor(y / CELL) * cw + Math.floor(x / CELL)]];
  }
  const pixels = full.map((c, i) => (previous && previous[i] === c ? TRANSPARENT : c));
  previous = full;
  const data = lzw(pixels, tableBits);
  out.push(0x21, 0xf9, 0x04, (1 << 2) | 1, ...le16(Math.round(100 / FPS)), TRANSPARENT, 0);
  out.push(0x2c, 0, 0, 0, 0, ...le16(W), ...le16(H), 0, tableBits);
  for (let i = 0; i < data.length; i += 255) {
    const block = data.slice(i, i + 255);
    out.push(block.length);
    for (const b of block) out.push(b);
  }
  out.push(0);
}
out.push(0x3b);

writeFileSync("dither.gif", Uint8Array.from(out));
console.log(`wrote dither.gif (${W}×${H}, ${names.length} palettes, ${(out.length / 1024 / 1024).toFixed(1)} MB)`);
