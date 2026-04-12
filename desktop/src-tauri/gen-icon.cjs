const fs = require('fs');
const zlib = require('zlib');

const w = 256, h = 256;
const raw = Buffer.alloc(h * (w * 4 + 1));
for (let y = 0; y < h; y++) {
  raw[y * (w * 4 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + (y * w + x) * 4;
    raw[o] = 80; raw[o+1] = 130; raw[o+2] = 186; raw[o+3] = 255;
    if (x > 32 && x < 224 && y > 32 && y < 224) { raw[o] = 255; raw[o+1] = 255; raw[o+2] = 255; }
  }
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([len, Buffer.from(type), data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);

const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[10] = 1; ico[12] = 32;
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);

fs.writeFileSync(__dirname + '/icons/icon.ico', ico);
console.log('Created ICO:', ico.length, 'bytes');
