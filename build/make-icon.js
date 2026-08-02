#!/usr/bin/env node
// Generates build/icon.png (1024x1024). electron-builder converts this into
// the .ico and .icns the Windows and macOS installers need, so no image
// tooling is required on the build machine.
//
// Run with: npm run icon
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 1024;

// Palette matches the app UI (src/renderer/styles.css).
const BG = [26, 25, 23];
const ACCENT = [217, 122, 61];
const HOT = [245, 197, 66];

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Antialiased coverage from a signed distance (1 inside, 0 outside). */
function coverage(d) {
  return Math.min(Math.max(0.5 - d, 0), 1);
}

function over(dst, i, rgb, alpha) {
  if (alpha <= 0) return;
  dst[i] = rgb[0] * alpha + dst[i] * (1 - alpha);
  dst[i + 1] = rgb[1] * alpha + dst[i + 1] * (1 - alpha);
  dst[i + 2] = rgb[2] * alpha + dst[i + 2] * (1 - alpha);
  dst[i + 3] = 255 * alpha + dst[i + 3] * (1 - alpha);
}

const px = new Float64Array(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const cx = x + 0.5;
    const cy = y + 0.5;

    // Rounded-square app background.
    over(px, i, BG, coverage(sdRoundRect(cx, cy, 512, 512, 512, 512, 200)));

    // Monitor body: an outlined rounded rect (ring = |distance| - halfStroke).
    const body = sdRoundRect(cx, cy, 512, 470, 330, 240, 56);
    over(px, i, ACCENT, coverage(Math.abs(body) - 30));

    // Stand neck and base.
    over(px, i, ACCENT, coverage(sdRoundRect(cx, cy, 512, 754, 46, 62, 12)));
    over(px, i, ACCENT, coverage(sdRoundRect(cx, cy, 512, 826, 168, 30, 26)));

    // The "vision" pupil — signals that the app is watching.
    over(px, i, ACCENT, coverage(sdCircle(cx, cy, 512, 470, 118)));
    over(px, i, HOT, coverage(sdCircle(cx, cy, 512, 470, 62)));
  }
}

// Pack into raw RGBA scanlines, each prefixed with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    raw[p++] = Math.round(px[i]);
    raw[p++] = Math.round(px[i + 1]);
    raw[p++] = Math.round(px[i + 2]);
    raw[p++] = Math.round(px[i + 3]);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "icon.png");
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);
