import fs from "node:fs";
import zlib from "node:zlib";

const output = "src-tauri/icons/icon.png";
const scale = 4;
const size = 128;
const width = size * scale;
const height = size * scale;
const pixels = new Uint8ClampedArray(width * height * 4);

function rgba(hex, alpha = 255) {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    alpha
  ];
}

function blendPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (Math.floor(y) * width + Math.floor(x)) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inverse);
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inverse);
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inverse);
  pixels[index + 3] = Math.round(255 * alpha + pixels[index + 3] * inverse);
}

function fillRoundedRect(x, y, w, h, radius, topColor, bottomColor) {
  x *= scale;
  y *= scale;
  w *= scale;
  h *= scale;
  radius *= scale;

  for (let py = Math.floor(y); py < y + h; py += 1) {
    const t = (py - y) / h;
    const color = topColor.map((value, index) => Math.round(value * (1 - t) + bottomColor[index] * t));
    for (let px = Math.floor(x); px < x + w; px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + w - radius));
      const dy = Math.max(y + radius - py, 0, py - (y + h - radius));
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(px, py, color);
      }
    }
  }
}

function fillCircle(cx, cy, r, color) {
  cx *= scale;
  cy *= scale;
  r *= scale;
  for (let y = Math.floor(cy - r); y <= cy + r; y += 1) {
    for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= r) {
        blendPixel(x, y, color);
      }
    }
  }
}

function strokeCircle(cx, cy, r, thickness, color) {
  cx *= scale;
  cy *= scale;
  r *= scale;
  thickness *= scale;
  for (let y = Math.floor(cx - r - thickness); y <= cx + r + thickness; y += 1) {
    for (let x = Math.floor(cy - r - thickness); x <= cy + r + thickness; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (Math.abs(distance - r) <= thickness / 2) {
        blendPixel(x, y, color);
      }
    }
  }
}

function drawLine(x1, y1, x2, y2, thickness, color) {
  x1 *= scale;
  y1 *= scale;
  x2 *= scale;
  y2 *= scale;
  thickness *= scale;
  const minX = Math.floor(Math.min(x1, x2) - thickness);
  const maxX = Math.ceil(Math.max(x1, x2) + thickness);
  const minY = Math.floor(Math.min(y1, y2) - thickness);
  const maxY = Math.ceil(Math.max(y1, y2) + thickness);
  const lengthSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSq));
      const projectionX = x1 + t * (x2 - x1);
      const projectionY = y1 + t * (y2 - y1);
      if (Math.hypot(x - projectionX, y - projectionY) <= thickness / 2) {
        blendPixel(x, y, color);
      }
    }
  }
}

function fillPolygon(points, color) {
  const scaled = points.map(([x, y]) => [x * scale, y * scale]);
  const minY = Math.floor(Math.min(...scaled.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...scaled.map((point) => point[1])));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < scaled.length; i += 1) {
      const [x1, y1] = scaled[i];
      const [x2, y2] = scaled[(i + 1) % scaled.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      for (let x = Math.floor(intersections[i]); x <= intersections[i + 1]; x += 1) {
        blendPixel(x, y, color);
      }
    }
  }
}

function downsample() {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * width + (x * scale + sx)) * 4;
          acc[0] += pixels[index];
          acc[1] += pixels[index + 1];
          acc[2] += pixels[index + 2];
          acc[3] += pixels[index + 3];
        }
      }
      const target = (y * size + x) * 4;
      out[target] = Math.round(acc[0] / (scale * scale));
      out[target + 1] = Math.round(acc[1] / (scale * scale));
      out[target + 2] = Math.round(acc[2] / (scale * scale));
      out[target + 3] = Math.round(acc[3] / (scale * scale));
    }
  }
  return out;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function writePng(rgbaBuffer) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), rgbaBuffer.subarray(y * size * 4, (y + 1) * size * 4)]));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(output, png);
}

fillRoundedRect(8, 8, 112, 112, 26, rgba("#0f7ae5"), rgba("#0b326d"));
fillRoundedRect(14, 14, 100, 100, 22, rgba("#1a8cf0", 210), rgba("#0e4d9a", 210));

for (const x of [32, 64, 96]) drawLine(x, 22, x - 12, 106, 1.2, rgba("#ffffff", 35));
for (const y of [36, 62, 88]) drawLine(22, y, 106, y + 8, 1.2, rgba("#ffffff", 28));

drawLine(26, 86, 48, 64, 5, rgba("#49d6c7", 180));
drawLine(48, 64, 76, 76, 5, rgba("#49d6c7", 180));
drawLine(76, 76, 98, 46, 5, rgba("#49d6c7", 180));
fillCircle(26, 86, 4.5, rgba("#dffefa"));
fillCircle(48, 64, 4.5, rgba("#dffefa"));
fillCircle(76, 76, 4.5, rgba("#dffefa"));

fillCircle(73, 61, 29, rgba("#071f43", 55));
fillCircle(70, 58, 24, rgba("#ffffff", 238));
fillCircle(70, 58, 15, rgba("#0f69c8", 255));
fillCircle(70, 58, 8, rgba("#ffffff", 40));
drawLine(88, 76, 104, 92, 10, rgba("#ffffff", 238));
drawLine(91, 79, 104, 92, 5, rgba("#0b326d", 150));

fillCircle(95, 34, 13, rgba("#ffcf32", 255));
fillPolygon(
  [
    [86, 43],
    [104, 43],
    [95, 62]
  ],
  rgba("#ffcf32", 255)
);
fillCircle(95, 34, 5, rgba("#083e84", 230));

fillRoundedRect(31, 80, 32, 24, 4, rgba("#ffffff", 235), rgba("#d7efff", 235));
fillRoundedRect(36, 88, 6, 16, 1.5, rgba("#0f69c8", 255), rgba("#0f69c8", 255));
fillRoundedRect(45, 84, 6, 20, 1.5, rgba("#0f69c8", 255), rgba("#0f69c8", 255));
fillRoundedRect(54, 91, 5, 13, 1.5, rgba("#0f69c8", 255), rgba("#0f69c8", 255));

writePng(downsample());
console.log(`Generated ${output}`);
