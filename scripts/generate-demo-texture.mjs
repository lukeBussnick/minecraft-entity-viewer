import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'examples', 'copper-beetle', 'copper-beetle.png');
const WIDTH = 64;
const HEIGHT = 64;
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);

function setPixel(x, y, [red, green, blue, alpha = 255]) {
  const offset = (y * WIDTH + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

function fillRect(x, y, width, height, base, accent = base, cadence = 5) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const patterned = ((column - x) + (row - y) * 2) % cadence === 0;
      setPixel(column, row, patterned ? accent : base);
    }
  }
}

fillRect(0, 0, WIDTH, HEIGHT, [28, 22, 23]);
fillRect(0, 0, 28, 13, [171, 72, 42], [205, 102, 57], 7);
fillRect(0, 48, 28, 13, [143, 54, 38], [181, 74, 46], 7);
fillRect(0, 16, 36, 14, [70, 40, 33], [87, 49, 38], 9);
fillRect(32, 0, 24, 8, [107, 52, 36], [132, 64, 41], 8);
fillRect(32, 10, 12, 5, [82, 40, 31], [99, 49, 35], 6);
fillRect(48, 10, 4, 4, [232, 184, 63], [255, 219, 93], 3);
fillRect(40, 16, 12, 6, [53, 31, 28], [72, 39, 32], 6);
fillRect(0, 32, 20, 6, [47, 31, 29], [65, 40, 34], 7);
fillRect(24, 32, 14, 8, [38, 27, 27], [58, 37, 33], 7);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8;
header[9] = 6;

const scanlines = [];
for (let row = 0; row < HEIGHT; row += 1) {
  scanlines.push(Buffer.from([0]), pixels.subarray(row * WIDTH * 4, (row + 1) * WIDTH * 4));
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.concat(scanlines), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, png);
console.log(`Generated ${OUTPUT}`);
