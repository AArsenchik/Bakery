import { deflateSync } from 'node:zlib';

const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00110', '00100'],
  ':': ['00000', '00110', '00110', '00000', '00110', '00110', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '01010'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '%': ['11001', '11010', '00100', '01000', '10110', '00110', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

const WIDTH = 1080;
const HEIGHT = 1350;
const TILE_GAP = 28;
const PANEL_X = 72;
const HEADER_Y = 72;
const HEADER_HEIGHT = 286;
const TILE_TOP = 398;
const TILE_HEIGHT = 208;
const TILE_RADIUS = 30;
const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function normalizeColor(color) {
  if (Array.isArray(color)) return color;
  const value = String(color).replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    value.length >= 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(a, b, factor) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * factor),
    Math.round(a[1] + (b[1] - a[1]) * factor),
    Math.round(a[2] + (b[2] - a[2]) * factor),
    Math.round(a[3] + (b[3] - a[3]) * factor),
  ];
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  fill(color) {
    const [r, g, b, a] = normalizeColor(color);
    for (let index = 0; index < this.data.length; index += 4) {
      this.data[index] = r;
      this.data[index + 1] = g;
      this.data[index + 2] = b;
      this.data[index + 3] = a;
    }
  }

  blendPixel(x, y, color, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const [r, g, b, a] = normalizeColor(color);
    const sourceAlpha = clamp((a / 255) * alpha, 0, 1);
    const offset = (y * this.width + x) * 4;
    const destAlpha = this.data[offset + 3] / 255;
    const outAlpha = sourceAlpha + (destAlpha * (1 - sourceAlpha));
    const mix = outAlpha === 0 ? 0 : sourceAlpha / outAlpha;

    this.data[offset] = Math.round((r * mix) + (this.data[offset] * (1 - mix)));
    this.data[offset + 1] = Math.round((g * mix) + (this.data[offset + 1] * (1 - mix)));
    this.data[offset + 2] = Math.round((b * mix) + (this.data[offset + 2] * (1 - mix)));
    this.data[offset + 3] = Math.round(outAlpha * 255);
  }

  verticalGradient(top, bottom) {
    const start = normalizeColor(top);
    const end = normalizeColor(bottom);
    for (let y = 0; y < this.height; y += 1) {
      const mix = y / Math.max(1, this.height - 1);
      const color = mixColor(start, end, mix);
      for (let x = 0; x < this.width; x += 1) {
        this.blendPixel(x, y, color, 1);
      }
    }
  }

  fillRect(x, y, width, height, color) {
    const xStart = Math.max(0, Math.floor(x));
    const yStart = Math.max(0, Math.floor(y));
    const xEnd = Math.min(this.width, Math.ceil(x + width));
    const yEnd = Math.min(this.height, Math.ceil(y + height));

    for (let py = yStart; py < yEnd; py += 1) {
      for (let px = xStart; px < xEnd; px += 1) {
        this.blendPixel(px, py, color, 1);
      }
    }
  }

  fillRoundedRect(x, y, width, height, radius, color) {
    const xStart = Math.max(0, Math.floor(x));
    const yStart = Math.max(0, Math.floor(y));
    const xEnd = Math.min(this.width, Math.ceil(x + width));
    const yEnd = Math.min(this.height, Math.ceil(y + height));
    const clampedRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));

    for (let py = yStart; py < yEnd; py += 1) {
      for (let px = xStart; px < xEnd; px += 1) {
        const dx = Math.min(px - x, x + width - 1 - px);
        const dy = Math.min(py - y, y + height - 1 - py);
        if (dx >= clampedRadius || dy >= clampedRadius) {
          this.blendPixel(px, py, color, 1);
          continue;
        }

        const cx = clampedRadius - dx - 1;
        const cy = clampedRadius - dy - 1;
        if ((cx * cx) + (cy * cy) <= clampedRadius * clampedRadius) {
          this.blendPixel(px, py, color, 1);
        }
      }
    }
  }

  fillCircle(cx, cy, radius, color, alpha = 1) {
    const left = Math.floor(cx - radius);
    const right = Math.ceil(cx + radius);
    const top = Math.floor(cy - radius);
    const bottom = Math.ceil(cy + radius);
    const squared = radius * radius;

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const distance = (dx * dx) + (dy * dy);
        if (distance > squared) continue;
        const softness = clamp(1 - (distance / squared), 0, 1);
        this.blendPixel(x, y, color, alpha * softness);
      }
    }
  }

  drawChar(x, y, char, scale, color) {
    const glyph = FONT[char] ?? FONT['?'];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue;
        this.fillRect(
          x + (column * scale),
          y + (row * scale),
          scale,
          scale,
          color,
        );
      }
    }
  }

  textWidth(text, scale, letterSpacing = scale) {
    const normalized = normalizeText(text);
    if (!normalized) return 0;
    return (normalized.length * (5 * scale)) + ((normalized.length - 1) * letterSpacing);
  }

  drawText(x, y, text, scale, color, options = {}) {
    const normalized = normalizeText(text);
    const letterSpacing = options.letterSpacing ?? scale;
    const align = options.align ?? 'left';
    let cursorX = x;

    if (align === 'center') cursorX -= this.textWidth(normalized, scale, letterSpacing) / 2;
    if (align === 'right') cursorX -= this.textWidth(normalized, scale, letterSpacing);

    for (const char of normalized) {
      this.drawChar(cursorX, y, char, scale, color);
      cursorX += (5 * scale) + letterSpacing;
    }
  }

  drawWrappedText(x, y, maxWidth, text, scale, color, options = {}) {
    const lineHeight = options.lineHeight ?? Math.round(scale * 10);
    const letterSpacing = options.letterSpacing ?? scale;
    const words = normalizeText(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (this.textWidth(candidate, scale, letterSpacing) <= maxWidth || !currentLine) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);

    lines.forEach((line, index) => {
      this.drawText(x, y + (index * lineHeight), line, scale, color, {
        letterSpacing,
        align: options.align,
      });
    });

    return lines.length * lineHeight;
  }

  encodePng() {
    const scanlines = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      const rowOffset = y * (this.width * 4 + 1);
      scanlines[rowOffset] = 0;
      scanlines.set(this.data.subarray(y * this.width * 4, (y + 1) * this.width * 4), rowOffset + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(scanlines)),
      pngChunk('IEND'),
    ]);
  }
}

function normalizeText(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,:+\-/$%()#&?]/g, '?');
}

function fittedScale(canvas, text, maxWidth, preferredScale, minimumScale) {
  for (let scale = preferredScale; scale >= minimumScale; scale -= 1) {
    if (canvas.textWidth(text, scale) <= maxWidth) return scale;
  }
  return minimumScale;
}

function drawTile(canvas, tile, index) {
  const tileWidth = (WIDTH - (PANEL_X * 2) - TILE_GAP) / 2;
  const column = index % 2;
  const row = Math.floor(index / 2);
  const x = PANEL_X + (column * (tileWidth + TILE_GAP));
  const y = TILE_TOP + (row * (TILE_HEIGHT + TILE_GAP));
  const accent = tile.accent ?? '#49d6d0';

  canvas.fillRoundedRect(x + 10, y + 12, tileWidth, TILE_HEIGHT, TILE_RADIUS, [1, 12, 20, 78]);
  canvas.fillRoundedRect(x, y, tileWidth, TILE_HEIGHT, TILE_RADIUS, '#0e2030');
  canvas.fillRoundedRect(x, y, tileWidth, 3, TILE_RADIUS, accent);
  canvas.fillRect(x + 26, y + 26, 48, 4, accent);

  canvas.drawText(x + 26, y + 42, tile.label, 4, '#b8d8d7');

  const valueScale = fittedScale(canvas, tile.value, tileWidth - 52, 8, 5);
  canvas.drawText(x + 26, y + 86, tile.value, valueScale, tile.valueColor ?? '#ffe089');

  if (tile.subvalue) {
    const subScale = fittedScale(canvas, tile.subvalue, tileWidth - 52, 4, 3);
    canvas.drawText(x + 26, y + 166, tile.subvalue, subScale, tile.subvalueColor ?? '#8de5da');
  }
}

function drawBackground(canvas) {
  canvas.verticalGradient('#06131d', '#123246');
  canvas.fillCircle(176, 178, 190, '#1ed7c644', 0.9);
  canvas.fillCircle(934, 230, 240, '#1d9bf066', 0.65);
  canvas.fillCircle(844, 1120, 280, '#ffd1661c', 0.65);
  canvas.fillCircle(246, 1180, 220, '#0cf2b933', 0.45);
  canvas.fillRoundedRect(40, 40, WIDTH - 80, HEIGHT - 80, 44, '#193345cc');
  canvas.fillRoundedRect(56, 56, WIDTH - 112, HEIGHT - 112, 40, '#091722');
}

export function renderStatCardPng(card) {
  const canvas = new Canvas(WIDTH, HEIGHT);
  drawBackground(canvas);

  canvas.fillRoundedRect(PANEL_X, HEADER_Y, WIDTH - (PANEL_X * 2), HEADER_HEIGHT, 36, '#173246');
  canvas.fillRoundedRect(PANEL_X, HEADER_Y, WIDTH - (PANEL_X * 2), 4, 36, '#51e5d9');
  const headerTextX = 108;

  canvas.drawText(headerTextX, 96, card.title ?? 'SEASON CHECK', 4, '#8adfd8');
  const nameScale = fittedScale(canvas, card.name, WIDTH - 220, 8, 5);
  canvas.drawText(headerTextX, 144, card.name, nameScale, '#f6f3df');
  canvas.drawText(headerTextX, 224, card.address, 3, '#9bc8d6');
  const clanScale = fittedScale(canvas, card.clan, WIDTH - 220, 4, 3);
  canvas.drawWrappedText(headerTextX, 258, WIDTH - 220, card.clan, clanScale, '#ffd88c', { lineHeight: 36 });

  card.tiles.forEach((tile, index) => {
    drawTile(canvas, tile, index);
  });

  return canvas.encodePng();
}
