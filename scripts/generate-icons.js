import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, colorR, colorG, colorB) {
  // Simple PNG encoder using Node standard library
  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const chunkType = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([chunkType, data]));
    crc.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, chunkType, data, crc]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per channel
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // no interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter byte 0
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  const radius = width / 2;
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      // Rounded corner badge with brand colors (#4f46e5 / indigo)
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Create a nice rounded badge
      const cornerRadius = width * 0.28;
      const rx = Math.max(0, Math.abs(dx) - (cx - cornerRadius));
      const ry = Math.max(0, Math.abs(dy) - (cy - cornerRadius));
      const cornerDist = Math.sqrt(rx * rx + ry * ry);

      let alpha = 255;
      if (cornerDist > cornerRadius) {
        alpha = 0;
      } else if (cornerDist > cornerRadius - 1) {
        alpha = Math.round(255 * (cornerRadius - cornerDist));
      }

      if (alpha === 0) {
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
      } else {
        // Subtle vertical gradient
        const t = y / height;
        const r = Math.round(colorR * (1 - t * 0.2));
        const g = Math.round(colorG * (1 - t * 0.2));
        const b = Math.round(colorB * (1 - t * 0.2));

        // Let's draw an inner shape or spark/letter 'A'
        // For simplicity: A bright cyan/white center dot or diamond
        const innerDist = Math.sqrt(dx * dx + dy * dy);
        if (innerDist < width * 0.22) {
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = 255;
          rawData[offset++] = alpha;
        } else {
          rawData[offset++] = r;
          rawData[offset++] = g;
          rawData[offset++] = b;
          rawData[offset++] = alpha;
        }
      }
    }
  }

  const idatData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve('public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Indigo: #6366f1 -> (99, 102, 241)
const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPng(size, size, 99, 102, 241);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated: ${filePath}`);
}

