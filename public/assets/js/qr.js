/**
 * Generador de Código QR (ISO/IEC 18004 Byte Mode, Nivel L) en SVG puro.
 * Soporta versiones 1 a 6 (hasta 134 bytes UTF-8), ideal para cadenas WiFi.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function polyMul(p, q) {
  const out = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      out[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return out;
}

function rsRemainder(data, ecLen) {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    gen = polyMul(gen, new Uint8Array([1, GF_EXP[i]]));
  }
  const res = new Uint8Array(data.length + ecLen);
  res.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Versiones 1..6 Nivel L: [totalDataBytes, ecBytesPerBlock, numBlocks, alignCenters]
const QR_SPECS = [
  null,
  { dataBytes: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { dataBytes: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { dataBytes: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { dataBytes: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { dataBytes: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { dataBytes: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
];

function encodeDataCodewords(bytes) {
  let ver = 1;
  while (ver <= 6 && bytes.length + 2 > QR_SPECS[ver].dataBytes) ver++;
  if (ver > 6) throw new Error('Cadena QR demasiado extensa');

  const spec = QR_SPECS[ver];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Modo Byte (0100) + longitud 8 bits (v1..v9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = spec.dataBytes * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const pads = [0xec, 0x11];
  let p = 0;
  while (bits.length < maxBits) {
    pushBits(pads[p++ % 2], 8);
  }

  const data = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < spec.dataBytes; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
    data[i] = val;
  }

  const blockLen = Math.floor(spec.dataBytes / spec.blocks);
  const dataBlocks = [];
  const ecBlocks = [];
  for (let i = 0; i < spec.blocks; i++) {
    const slice = data.slice(i * blockLen, (i + 1) * blockLen);
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }

  const stream = [];
  for (let i = 0; i < blockLen; i++) {
    for (const blk of dataBlocks) stream.push(blk[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) stream.push(ec[i]);
  }

  return { ver, spec, codewords: new Uint8Array(stream) };
}

function buildMatrix(ver, spec, codewords) {
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Int8Array(size).fill(-1)); // -1 vacío, 0 blanco, 1 negro
  const isFn = Array.from({ length: size }, () => new Uint8Array(size));

  const setFn = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mod[r][c] = val ? 1 : 0;
      isFn[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const dark =
          (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
          (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        setFn(r, c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Patrones de alineación
  const centers = spec.align;
  for (const r of centers) {
    for (const c of centers) {
      if (isFn[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFn(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Timing
  for (let i = 8; i < size - 8; i++) {
    if (!isFn[6][i]) setFn(6, i, i % 2 === 0);
    if (!isFn[i][6]) setFn(i, 6, i % 2 === 0);
  }

  // Módulo oscuro fijo
  setFn(4 * ver + 9, 8, true);

  // Reservar áreas de formato
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFn[8][i] = 1;
      isFn[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFn[8][size - 1 - i] = 1;
    if (i < 7) isFn[size - 1 - i][8] = 1;
  }

  // Colocar bits en zigzag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let up = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const r = up ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (isFn[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        mod[r][c] = bit;
      }
    }
    up = !up;
  }

  // Evaluar máscaras 0..7 y elegir menor penalización
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  let bestMask = 0;
  let bestScore = Infinity;
  let bestGrid = null;

  for (let m = 0; m < 8; m++) {
    const g = mod.map((row, r) =>
      row.map((val, c) => (isFn[r][c] ? val : val ^ (maskFn[m](r, c) ? 1 : 0)))
    );
    applyFormat(g, size, m);
    const sc = penaltyScore(g, size);
    if (sc < bestScore) {
      bestScore = sc;
      bestMask = m;
      bestGrid = g;
    }
  }

  applyFormat(bestGrid, size, bestMask);
  return { grid: bestGrid, size };
}

function applyFormat(grid, size, mask) {
  const data = (0b01 << 3) | mask; // Nivel L = 01
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >>> (i + 10)) & 1) rem ^= 0x537 << i;
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i < 6; i++) {
    const b = (bits >>> i) & 1;
    grid[8][i] = b;
    grid[size - 1 - i][8] = b;
  }
  grid[8][7] = (bits >>> 6) & 1;
  grid[size - 7][8] = (bits >>> 6) & 1;
  grid[8][8] = (bits >>> 7) & 1;
  grid[8][size - 8] = (bits >>> 7) & 1;
  grid[7][8] = (bits >>> 8) & 1;
  grid[8][size - 7] = (bits >>> 8) & 1;
  for (let i = 9; i < 15; i++) {
    const b = (bits >>> i) & 1;
    grid[14 - i][8] = b;
    grid[8][size - 15 + i] = b;
  }
}

function penaltyScore(g, size) {
  let score = 0;
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (g[r][c] === g[r][c - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (g[r][c] === g[r - 1][c]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  return score;
}

export function renderWifiQrSvg(ssid, password) {
  const esc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
  const payload = password
    ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`
    : `WIFI:T:nopass;S:${esc(ssid)};;`;

  const bytes = new TextEncoder().encode(payload);
  const { ver, spec, codewords } = encodeDataCodewords(bytes);
  const { grid, size } = buildMatrix(ver, spec, codewords);

  const quiet = 3;
  const full = size + quiet * 2;
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 1) {
        d += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="QR WiFi ${ssid}">
    <rect width="${full}" height="${full}" rx="3" fill="#F8FAFC"/>
    <path d="${d}" fill="#041B2D"/>
  </svg>`;
}
