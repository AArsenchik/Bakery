import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

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
const TILE_GAP = 30;
const PANEL_X = 86;
const HEADER_Y = 104;
const HEADER_HEIGHT = 264;
const TILE_TOP = 406;
const TILE_HEIGHT = 206;
const TILE_RADIUS = 34;
const AVATAR_SIZE = 112;
const AVATAR_X = PANEL_X + 34;
const AVATAR_Y = HEADER_Y + 74;
const FRAME_X = 44;
const FRAME_Y = 36;
const FRAME_RADIUS = 58;
const avatarImageCache = new Map();
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

function scaleAlpha(color, factor) {
  const [r, g, b, a] = normalizeColor(color);
  return [r, g, b, Math.round(a * factor)];
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

  fillRoundedRectGradient(x, y, width, height, radius, startColor, endColor, options = {}) {
    const xStart = Math.max(0, Math.floor(x));
    const yStart = Math.max(0, Math.floor(y));
    const xEnd = Math.min(this.width, Math.ceil(x + width));
    const yEnd = Math.min(this.height, Math.ceil(y + height));
    const clampedRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
    const start = normalizeColor(startColor);
    const end = normalizeColor(endColor);
    const direction = options.direction ?? 'vertical';
    const denom = Math.max(1, (direction === 'horizontal' ? width : height) - 1);

    for (let py = yStart; py < yEnd; py += 1) {
      for (let px = xStart; px < xEnd; px += 1) {
        const dx = Math.min(px - x, x + width - 1 - px);
        const dy = Math.min(py - y, y + height - 1 - py);
        let inside = false;

        if (dx >= clampedRadius || dy >= clampedRadius) {
          inside = true;
        } else {
          const cx = clampedRadius - dx - 1;
          const cy = clampedRadius - dy - 1;
          inside = (cx * cx) + (cy * cy) <= clampedRadius * clampedRadius;
        }

        if (!inside) continue;

        const factor = clamp(
          direction === 'horizontal' ? (px - x) / denom : (py - y) / denom,
          0,
          1,
        );
        this.blendPixel(px, py, mixColor(start, end, factor), 1);
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

function isPngBuffer(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
}

function isJpegBuffer(buffer) {
  return buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
}

function decodeAvatarBuffer(buffer, contentType = '') {
  const lowerType = String(contentType).toLowerCase();
  if (lowerType.includes('png') || isPngBuffer(buffer)) {
    const image = PNG.sync.read(buffer);
    return {
      width: image.width,
      height: image.height,
      data: image.data,
    };
  }

  if (lowerType.includes('jpeg') || lowerType.includes('jpg') || isJpegBuffer(buffer)) {
    const image = jpeg.decode(buffer, { useTArray: true });
    return {
      width: image.width,
      height: image.height,
      data: image.data,
    };
  }

  throw new Error('Unsupported avatar image format');
}

async function fetchAvatarImage(avatarUrl) {
  const normalized = String(avatarUrl ?? '').trim();
  if (!normalized) return null;
  if (avatarImageCache.has(normalized)) return avatarImageCache.get(normalized);

  const promise = (async () => {
    const response = await fetch(normalized, {
      headers: { accept: 'image/png,image/jpeg,image/*;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`GET ${normalized} failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await response.arrayBuffer());
    return decodeAvatarBuffer(buffer, contentType);
  })().catch(() => null);

  avatarImageCache.set(normalized, promise);
  return promise;
}

function drawAvatar(canvas, avatar, x, y, size) {
  if (!avatar?.data || !avatar.width || !avatar.height) return;

  const radius = size / 2;
  const cx = x + radius;
  const cy = y + radius;
  const innerRadius = radius - 4;
  const srcWidth = avatar.width;
  const srcHeight = avatar.height;
  const cropWidth = Math.min(srcWidth, srcHeight);
  const cropHeight = cropWidth;
  const cropX = (srcWidth - cropWidth) / 2;
  const cropY = (srcHeight - cropHeight) / 2;

  canvas.fillCircle(cx, cy, radius + 24, '#7dbdff22', 1);
  canvas.fillCircle(cx, cy, radius + 10, '#92dbff55', 0.9);
  canvas.fillCircle(cx, cy, radius + 2, '#f1fbff66', 0.9);
  canvas.fillCircle(cx, cy, radius - 1, '#0a1931', 1);

  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      const deltaX = (px + 0.5) - cx;
      const deltaY = (py + 0.5) - cy;
      if ((deltaX * deltaX) + (deltaY * deltaY) > innerRadius * innerRadius) continue;

      const srcX = Math.min(srcWidth - 1, Math.max(0, Math.floor(cropX + ((dx + 0.5) / size) * cropWidth)));
      const srcY = Math.min(srcHeight - 1, Math.max(0, Math.floor(cropY + ((dy + 0.5) / size) * cropHeight)));
      const offset = (srcY * srcWidth + srcX) * 4;
      const alpha = avatar.data[offset + 3] / 255;
      if (alpha <= 0) continue;

      canvas.blendPixel(px, py, [
        avatar.data[offset],
        avatar.data[offset + 1],
        avatar.data[offset + 2],
        avatar.data[offset + 3],
      ], alpha);
    }
  }
}

function drawSoftShadow(canvas, x, y, width, height, radius, color, spread = 22, steps = 7) {
  for (let index = steps; index >= 1; index -= 1) {
    const growth = Math.round((spread / steps) * index);
    const alpha = 0.11 * (index / steps);
    canvas.fillRoundedRect(
      x - growth,
      y - growth,
      width + (growth * 2),
      height + (growth * 2),
      radius + growth,
      scaleAlpha(color, alpha),
    );
  }
}

function drawGlassPanel(canvas, x, y, width, height, radius, options = {}) {
  const borderColor = options.borderColor ?? '#9cc3ff26';
  const topColor = options.topColor ?? '#244f99e6';
  const bottomColor = options.bottomColor ?? '#24345fd8';
  const glossColor = options.glossColor ?? '#ffffff14';
  const shadowColor = options.shadowColor ?? '#030c1fcc';
  const shadowSpread = options.shadowSpread ?? 18;
  const shadowSteps = options.shadowSteps ?? 6;
  const inset = options.inset ?? 3;

  drawSoftShadow(canvas, x, y, width, height, radius, shadowColor, shadowSpread, shadowSteps);
  canvas.fillRoundedRect(x, y, width, height, radius, borderColor);
  canvas.fillRoundedRectGradient(
    x + inset,
    y + inset,
    width - (inset * 2),
    height - (inset * 2),
    Math.max(0, radius - inset),
    topColor,
    bottomColor,
  );

  const glossHeight = Math.round(height * 0.48);
  canvas.fillRoundedRectGradient(
    x + inset,
    y + inset,
    width - (inset * 2),
    glossHeight,
    Math.max(0, radius - inset),
    glossColor,
    [255, 255, 255, 0],
  );
  canvas.fillRoundedRect(x + 18, y + 18, width - 36, 2, Math.max(0, radius - 18), '#ffffff26');
}

function badgeGlyph(label) {
  const normalized = normalizeText(label);
  if (normalized.startsWith('1K')) return '1K';
  if (normalized.includes('COOKIE')) return 'CK';
  if (normalized.includes('COOK')) return 'TX';
  if (normalized.includes('GAS')) return 'G';
  if (normalized.includes('REWARD')) return 'R';
  if (normalized.includes('ROI')) return '%';
  return normalized.slice(0, 2) || '?';
}

function drawIconBadge(canvas, x, y, size, accent, glyph) {
  const accentColor = normalizeColor(accent);
  const badgeTop = mixColor(accentColor, normalizeColor('#6d8dff'), 0.45);
  const badgeBottom = mixColor(accentColor, normalizeColor('#1a2450'), 0.72);
  const glowColor = [accentColor[0], accentColor[1], accentColor[2], 88];

  canvas.fillCircle(x + (size / 2), y + (size / 2), size * 0.78, glowColor, 0.85);
  drawGlassPanel(canvas, x, y, size, size, 22, {
    topColor: badgeTop,
    bottomColor: badgeBottom,
    borderColor: scaleAlpha('#ffffff', 0.16),
    glossColor: [255, 255, 255, 32],
    shadowColor: scaleAlpha(accent, 0.22),
    shadowSpread: 14,
    shadowSteps: 5,
    inset: 2,
  });

  const scale = glyph.length >= 2 ? 4 : 5;
  canvas.drawText(
    x + (size / 2),
    y + Math.round((size - (7 * scale)) / 2) - 2,
    glyph,
    scale,
    '#f5f7ff',
    { align: 'center', letterSpacing: Math.max(1, scale - 1) },
  );
}

function drawTile(canvas, tile, index) {
  const tileWidth = (WIDTH - (PANEL_X * 2) - TILE_GAP) / 2;
  const column = index % 2;
  const row = Math.floor(index / 2);
  const x = PANEL_X + (column * (tileWidth + TILE_GAP));
  const y = TILE_TOP + (row * (TILE_HEIGHT + TILE_GAP));
  const accent = tile.accent ?? '#49d6d0';
  const accentColor = normalizeColor(accent);
  const topColor = mixColor(accentColor, normalizeColor('#225d9c'), 0.72);
  const bottomColor = mixColor(accentColor, normalizeColor('#2f214f'), 0.82);

  drawGlassPanel(canvas, x, y, tileWidth, TILE_HEIGHT, TILE_RADIUS, {
    topColor: scaleAlpha(topColor, 0.9),
    bottomColor: scaleAlpha(bottomColor, 0.96),
    borderColor: '#dfeeff2e',
    glossColor: [255, 255, 255, 28],
    shadowColor: scaleAlpha(accent, 0.18),
    shadowSpread: 18,
    shadowSteps: 6,
    inset: 2,
  });

  drawIconBadge(canvas, x + 26, y + 34, 72, accent, badgeGlyph(tile.label));

  canvas.drawText(x + 118, y + 48, tile.label, 3, scaleAlpha(accent, 0.95), {
    letterSpacing: 2,
  });

  const valueScale = fittedScale(canvas, tile.value, tileWidth - 52, 7, 4);
  canvas.drawText(x + 28, y + 98, tile.value, valueScale, tile.valueColor ?? '#f6f7e6');

  if (tile.subvalue) {
    const subScale = fittedScale(canvas, tile.subvalue, tileWidth - 56, 4, 3);
    canvas.drawText(x + 28, y + 162, tile.subvalue, subScale, tile.subvalueColor ?? '#d7e9f6');
  }
}

function drawBackground(canvas) {
  canvas.verticalGradient('#07264b', '#151a38');
  canvas.fillCircle(236, 172, 250, '#6ae4ff33', 0.95);
  canvas.fillCircle(760, 168, 320, '#4f7fff2a', 0.82);
  canvas.fillCircle(870, 1130, 340, '#f4a2ff20', 0.72);
  canvas.fillCircle(250, 1190, 260, '#60b7ff1a', 0.65);
  drawGlassPanel(canvas, FRAME_X, FRAME_Y, WIDTH - (FRAME_X * 2), HEIGHT - (FRAME_Y * 2), FRAME_RADIUS, {
    topColor: '#2b4c86c4',
    bottomColor: '#5e5ea06c',
    borderColor: '#d7ecff2d',
    glossColor: [255, 255, 255, 24],
    shadowColor: '#020816d4',
    shadowSpread: 26,
    shadowSteps: 7,
    inset: 3,
  });
  canvas.fillRoundedRectGradient(
    FRAME_X + 24,
    FRAME_Y + 24,
    WIDTH - (FRAME_X * 2) - 48,
    HEIGHT - (FRAME_Y * 2) - 48,
    FRAME_RADIUS - 18,
    '#13284fb8',
    '#16172db8',
  );
}

export async function renderStatCardPng(card) {
  const canvas = new Canvas(WIDTH, HEIGHT);
  const avatar = card.avatarUrl ? await fetchAvatarImage(card.avatarUrl) : null;
  drawBackground(canvas);

  drawGlassPanel(canvas, PANEL_X, HEADER_Y, WIDTH - (PANEL_X * 2), HEADER_HEIGHT, 40, {
    topColor: '#24529ee6',
    bottomColor: '#28448de0',
    borderColor: '#d6ebff30',
    glossColor: [255, 255, 255, 34],
    shadowColor: '#08142ab2',
    shadowSpread: 20,
    shadowSteps: 6,
    inset: 2,
  });

  if (avatar) {
    drawAvatar(canvas, avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE);
  } else {
    drawIconBadge(canvas, AVATAR_X + 18, AVATAR_Y + 12, 88, '#8a92ff', 'S');
  }

  const headerTextX = avatar ? AVATAR_X + AVATAR_SIZE + 34 : AVATAR_X + 132;
  canvas.drawText(headerTextX, HEADER_Y + 40, card.title ?? 'SEASON CHECK', 4, '#b8d8ff', {
    letterSpacing: 2,
  });
  const headerTextWidth = WIDTH - headerTextX - 110;
  const nameScale = fittedScale(canvas, card.name, headerTextWidth, 8, 5);
  canvas.drawText(headerTextX, HEADER_Y + 88, card.name, nameScale, '#f5f7ff');
  canvas.drawText(headerTextX, HEADER_Y + 160, card.address, 3, '#a8c6ef');

  const clanScale = fittedScale(canvas, card.clan, headerTextWidth - 48, 3, 2);
  const clanTextWidth = canvas.textWidth(card.clan, clanScale, Math.max(1, clanScale - 1));
  const clanPillWidth = Math.min(headerTextWidth, clanTextWidth + 34);
  const clanPillY = HEADER_Y + 196;
  drawGlassPanel(canvas, headerTextX, clanPillY, clanPillWidth, 42, 21, {
    topColor: '#5867f2d6',
    bottomColor: '#4b5dddcc',
    borderColor: '#ffffff20',
    glossColor: [255, 255, 255, 22],
    shadowColor: '#203b9a66',
    shadowSpread: 12,
    shadowSteps: 5,
    inset: 2,
  });
  canvas.drawText(headerTextX + 18, clanPillY + 11, card.clan, clanScale, '#e7ecff', {
    letterSpacing: Math.max(1, clanScale - 1),
  });

  card.tiles.forEach((tile, index) => {
    drawTile(canvas, tile, index);
  });

  return canvas.encodePng();
}
