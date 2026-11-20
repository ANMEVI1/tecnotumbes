const LABEL_FONT = '10px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FALLOFF_STEPS = 8;
const SPRING = 320;
const INHERIT = /^(currentcolor|inherit)$/i;
const INTRO_DELAY = 0.15;
const KICK_DECAY = 0.62;

const DEFAULTS = {
  text: 'TECNO · TUMBES',
  lines: null,
  fontFamily: '',
  fontWeight: 600,
  fontSize: 150,
  letterSpacing: -0.05,
  lineHeight: 1.22,
  edgePadding: null,
  color: 'currentColor',
  accentColor: 'currentColor',
  align: 'center',
  reach: 200,
  softness: 0.7,
  dashLength: 4,
  dashGap: 2,
  strokeWidth: 1.5,
  lineStyle: 'dashed',
  reveal: 'letter',
  specks: 15,
  selection: true,
  labels: true,
  draggable: true,
  bounce: 0.4,
  sweep: true,
  speed: 1,
  clickKick: true,
  intro: 'none',
  introDuration: 2,
  guides: false
};

const approach = (current, target, dt, seconds) => current + (target - current) * (1 - Math.exp(-dt / seconds));

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const noise = (...values) => {
  let h = 2166136261;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
};

const signed = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0');

export function createTechText(container, initialOptions = {}) {
  const canvas = container?.querySelector('.tech-text-canvas');
  const ctx = canvas?.getContext('2d');
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d');
  if (!container || !canvas || !ctx || !scratchCtx) {
    return { update: () => {}, destroy: () => {}, wake: () => {} };
  }

  let settings = { ...DEFAULTS, ...initialOptions };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let last = performance.now();
  let visible = true;
  let alive = true;
  let layoutKey = '';
  let sizeDirty = true;
  let requestedFont = '';
  let word = null;
  let glyphs = [];
  let presence = 0;
  let clock = 0;
  let pulse = 0;
  let placed = false;
  let dragging = -1;
  let cursor = '';
  let introClock = 0;
  let introKind = '';
  let introducing = false;
  let fontsReady = !document.fonts;
  let guideAlpha = 0;

  const kicks = [];
  const press = { x: 0, y: 0, time: 0, index: -1 };
  const pointer = { x: 0, y: 0, inside: false };
  const grab = { x: 0, y: 0 };
  const lens = { x: 0, y: 0 };
  const frame = { x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0, index: -1 };

  const invalidateLayout = () => {
    layoutKey = '';
    wake();
  };

  const fontsLoaded = () => {
    fontsReady = true;
    invalidateLayout();
  };

  const family = (s) => s.fontFamily || getComputedStyle(container).fontFamily || 'sans-serif';
  const fontFor = (s, size) => `${s.fontWeight} ${size}px ${family(s)}`;

  const resolveColor = (value, fallback) =>
    !value || INHERIT.test(String(value).trim()) ? fallback : String(value);

  const palette = (s) => {
    const current = getComputedStyle(container).color || '#f0f9ff';
    return {
      ink: resolveColor(s.color, current),
      accent: resolveColor(s.accentColor, current)
    };
  };

  const normalizeLines = (s, ink, accent) => {
    if (Array.isArray(s.lines) && s.lines.length > 0) {
      return s.lines.map((item) => ({
        text: String(item?.text ?? ''),
        color: resolveColor(item?.color, ink),
        accentColor: resolveColor(item?.accentColor, accent)
      }));
    }
    const raw = String(s.text ?? '').split('\n');
    return raw.map((lineText) => ({
      text: lineText,
      color: ink,
      accentColor: accent
    }));
  };

  const setFont = (target, s, size) => {
    target.font = fontFor(s, size);
    if ('letterSpacing' in target) target.letterSpacing = `${s.letterSpacing * size}px`;
    target.textAlign = 'left';
    target.textBaseline = 'alphabetic';
  };

  const sprite = (s, view, glyph, stroke, ink) => {
    const pad = Math.ceil(s.strokeWidth * 2 + 4);
    const left = glyph.box.x1 - pad;
    const top = glyph.box.y1 - pad;
    const w = glyph.box.x2 - glyph.box.x1 + pad * 2;
    const h = glyph.box.y2 - glyph.box.y1 + pad * 2;
    const image = document.createElement('canvas');
    image.addEventListener('contextrestored', invalidateLayout);
    image.width = Math.max(1, Math.ceil(w * dpr));
    image.height = Math.max(1, Math.ceil(h * dpr));
    const c = image.getContext('2d');
    if (!c) return { image, left, top };
    c.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr);
    setFont(c, s, view.size);
    if (stroke) {
      c.lineJoin = 'round';
      c.lineWidth = s.strokeWidth * 2;
      c.lineCap = 'butt';
      c.strokeStyle = ink;
      if (s.lineStyle !== 'solid') c.setLineDash([Math.max(1, s.dashLength), Math.max(1, s.dashGap)]);
      c.strokeText(glyph.char, glyph.x, view.baseline);
      c.setLineDash([]);
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000000';
      c.fillText(glyph.char, glyph.x, view.baseline);
      c.globalCompositeOperation = 'source-over';
    } else {
      c.fillStyle = ink;
      c.fillText(glyph.char, glyph.x, view.baseline);
    }
    return { image, left, top };
  };

  const ensureLayout = (s, ink, defaultAccent) => {
    const lineDefs = normalizeLines(s, ink, defaultAccent);
    const key = [
      JSON.stringify(lineDefs),
      family(s),
      s.fontWeight,
      s.fontSize,
      s.letterSpacing,
      s.lineHeight,
      s.edgePadding,
      s.align,
      s.dashLength,
      s.dashGap,
      s.strokeWidth,
      s.lineStyle,
      width,
      height,
      dpr
    ].join('|');
    if (key === layoutKey && word) return word;
    layoutKey = key;

    const sampleText = lineDefs.map((l) => l.text).join('') || 'A';
    const wanted = fontFor(s, 64);
    if (document.fonts && wanted !== requestedFont) {
      requestedFont = wanted;
      document.fonts.load(wanted, sampleText).then(invalidateLayout, invalidateLayout);
    }

    const probe = scratchCtx;
    setFont(probe, s, s.fontSize);

    const cap0 = Math.max(probe.measureText('H').actualBoundingBoxAscent || s.fontSize * 0.7, 1);
    const lineHeightFactor = Number(s.lineHeight) || 1.22;
    const rowStep0 = cap0 * lineHeightFactor;

    let maxInkWidth = 0;
    let maxAscent0 = 0;
    let maxDescent0 = 0;
    lineDefs.forEach((def) => {
      const lm = probe.measureText(def.text || ' ');
      maxInkWidth = Math.max(maxInkWidth, lm.actualBoundingBoxLeft + lm.actualBoundingBoxRight);
      maxAscent0 = Math.max(maxAscent0, lm.actualBoundingBoxAscent);
      maxDescent0 = Math.max(maxDescent0, lm.actualBoundingBoxDescent);
    });

    const totalInkHeight0 =
      lineDefs.length === 1
        ? maxAscent0 + maxDescent0
        : (lineDefs.length - 1) * rowStep0 + maxAscent0 + maxDescent0;

    const hasCustomEdge = s.edgePadding !== null && s.edgePadding !== undefined && s.edgePadding !== '';
    const edgePad = hasCustomEdge ? Math.max(0, Number(s.edgePadding) || 0) : width * 0.05;
    const hRatio = hasCustomEdge ? Math.max(0.5, (width - edgePad * 2) / Math.max(width, 1)) : 0.9;
    const vRatio = lineDefs.length > 1 ? 0.68 : 0.66;

    const fit = Math.min(
      1,
      (width * hRatio) / Math.max(maxInkWidth, 1),
      (height * vRatio) / Math.max(totalInkHeight0, 1)
    );
    const size = s.fontSize * fit;

    setFont(probe, s, size);
    const scaledCap = Math.max(probe.measureText('H').actualBoundingBoxAscent || size * 0.7, 1);
    const scaledXHeight = probe.measureText('x').actualBoundingBoxAscent;
    const scaledAscender = probe.measureText('d').actualBoundingBoxAscent;
    const scaledDescender = probe.measureText('p').actualBoundingBoxDescent;
    const rowStep = scaledCap * lineHeightFactor;

    const measuredLines = lineDefs.map((def) => ({
      def,
      m: probe.measureText(def.text || ' ')
    }));
    let scaledMaxAscent = 0;
    let scaledMaxDescent = 0;
    measuredLines.forEach(({ m: lm }) => {
      scaledMaxAscent = Math.max(scaledMaxAscent, lm.actualBoundingBoxAscent);
      scaledMaxDescent = Math.max(scaledMaxDescent, lm.actualBoundingBoxDescent);
    });
    const blockHeight =
      measuredLines.length === 1
        ? scaledMaxAscent + scaledMaxDescent
        : (measuredLines.length - 1) * rowStep + scaledMaxAscent + scaledMaxDescent;
    const firstBaseline = (height - blockHeight) / 2 + scaledMaxAscent;

    const previous = glyphs;
    glyphs = [];
    const lineViews = [];
    const lineGlyphBuckets = [];

    let globalLeft = Infinity;
    let globalRight = -Infinity;
    let globalTop = Infinity;
    let globalBottom = -Infinity;

    measuredLines.forEach(({ def, m: lm }, li) => {
      const inkWidth = lm.actualBoundingBoxLeft + lm.actualBoundingBoxRight;
      const start =
        s.align === 'left' ? edgePad : s.align === 'right' ? width - edgePad - inkWidth : (width - inkWidth) / 2;
      const lx = start + lm.actualBoundingBoxLeft;
      const baseline = firstBaseline + li * rowStep;
      const xHeight = baseline - scaledXHeight;
      const capHeight = baseline - scaledCap;
      const ascender = baseline - scaledAscender;
      const descender = baseline + scaledDescender;
      const lTop = baseline - lm.actualBoundingBoxAscent;
      const lBottom = baseline + lm.actualBoundingBoxDescent;
      const inkTop = Math.min(lTop, capHeight) - 2;
      const inkBottom = Math.max(lBottom, baseline) + 2;

      const lView = {
        size,
        baseline,
        left: lx - lm.actualBoundingBoxLeft,
        right: lx + lm.actualBoundingBoxRight,
        top: lTop,
        bottom: lBottom,
        lines: [
          { y: baseline, label: 'baseline' },
          { y: xHeight, label: 'x-height' },
          { y: capHeight, label: 'cap height' },
          ...(capHeight - ascender > Math.max(11, size * 0.06) ? [{ y: ascender, label: 'ascender' }] : []),
          { y: descender, label: 'descender' }
        ],
        bands: [
          { y0: xHeight, y1: baseline, up: true, order: 0 },
          { y0: capHeight, y1: xHeight, up: true, order: 1 },
          { y0: inkTop, y1: capHeight, up: true, order: 2 },
          { y0: baseline, y1: inkBottom, up: false, order: 1 }
        ].filter((band) => band.y1 - band.y0 > 0.5)
      };

      lineViews.push(lView);
      const bucket = [];
      lineGlyphBuckets.push(bucket);

      globalLeft = Math.min(globalLeft, lView.left);
      globalRight = Math.max(globalRight, lView.right);
      globalTop = Math.min(globalTop, lView.top);
      globalBottom = Math.max(globalBottom, lView.bottom);

      const chars = Array.from(def.text);
      let prefix = '';
      let linePos = 0;

      chars.forEach((char, i) => {
        prefix += char;
        const own = probe.measureText(char);
        const gx = lx + probe.measureText(prefix).width - own.width;
        if (!char.trim()) return;

        const base = {
          char,
          x: gx,
          box: {
            x1: gx - own.actualBoundingBoxLeft,
            y1: baseline - own.actualBoundingBoxAscent,
            x2: gx + own.actualBoundingBoxRight,
            y2: baseline + own.actualBoundingBoxDescent
          }
        };

        const outIdx = glyphs.length;
        const kept = previous[outIdx];
        const sameGlyph = kept?.char === char && kept.line === li && kept.charIndex === i;

        const glyphObj = {
          ...base,
          line: li,
          linePos,
          charIndex: i,
          index: outIdx,
          ink: def.color,
          accent: def.accentColor,
          lineView: lView,
          offset: sameGlyph ? kept.offset : { x: 0, y: 0 },
          velocity: sameGlyph ? kept.velocity : { x: 0, y: 0 },
          outline: sameGlyph ? kept.outline : 0,
          shown: sameGlyph ? kept.shown : 1,
          cells: null,
          assembled: 0,
          fill: sprite(s, lView, base, false, def.color),
          dashes: sprite(s, lView, base, true, def.color)
        };

        glyphs.push(glyphObj);
        bucket.push(glyphObj);
        linePos++;
      });
    });

    const sweepPath = [];
    lineGlyphBuckets.forEach((bucket, li) => {
      const ordered = li % 2 === 1 ? [...bucket].reverse() : bucket;
      ordered.forEach((g) => {
        sweepPath.push({
          x: (g.box.x1 + g.box.x2) / 2,
          y: (g.box.y1 + g.box.y2) / 2
        });
      });
    });

    if (!Number.isFinite(globalLeft)) {
      globalLeft = 0;
      globalRight = width;
      globalTop = 0;
      globalBottom = height;
    }

    word = {
      size,
      baseline: lineViews[0]?.baseline ?? height * 0.5,
      left: globalLeft,
      right: globalRight,
      top: globalTop,
      bottom: globalBottom,
      lines: lineViews[0]?.lines ?? [],
      bands: lineViews[0]?.bands ?? [],
      lineCount: lineViews.length,
      lineViews,
      sweepPath
    };

    if (dragging >= 0 && glyphs[dragging]?.index !== previous[dragging]?.index) dragging = -1;
    if (frame.index >= 0 && glyphs[frame.index]?.char !== previous[frame.index]?.char) frame.index = -1;
    return word;
  };

  const glyphAt = (x, y) => {
    if (!word || glyphs.length === 0) return -1;
    if (word.lineCount === 1) {
      if (y < word.top - 24 || y > word.bottom + 24) return -1;
      let best = -1;
      let bestDistance = Infinity;
      glyphs.forEach((glyph, i) => {
        const x1 = glyph.box.x1 + glyph.offset.x;
        const x2 = glyph.box.x2 + glyph.offset.x;
        const d = x < x1 ? x1 - x : x > x2 ? x - x2 : 0;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      return bestDistance < 28 ? best : -1;
    }

    let best = -1;
    let bestDistance = Infinity;
    glyphs.forEach((glyph, i) => {
      const x1 = glyph.box.x1 + glyph.offset.x;
      const x2 = glyph.box.x2 + glyph.offset.x;
      const y1 = glyph.box.y1 + glyph.offset.y;
      const y2 = glyph.box.y2 + glyph.offset.y;
      const dx = x < x1 ? x1 - x : x > x2 ? x - x2 : 0;
      const dy = y < y1 ? y1 - y : y > y2 ? y - y2 : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return bestDistance < 26 ? best : -1;
  };

  const falloff = (target, cx, cy, radius, strength, softness) => {
    const inner = Math.min(1, Math.max(0, 1 - softness));
    const gradient = target.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    if (inner > 0.995) {
      gradient.addColorStop(0.995, `rgba(0, 0, 0, ${strength})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return gradient;
    }
    for (let i = 0; i <= FALLOFF_STEPS; i++) {
      const t = i / FALLOFF_STEPS;
      const eased = t * t * (3 - 2 * t);
      gradient.addColorStop(inner + (1 - inner) * t, `rgba(0, 0, 0, ${strength * (1 - eased)})`);
    }
    return gradient;
  };

  const blit = (target, art, dx, dy, originX, originY) => {
    target.drawImage(
      art.image,
      Math.round((art.left + dx) * dpr - originX),
      Math.round((art.top + dy) * dpr - originY)
    );
  };

  const drawReveal = (s) => {
    const radius = s.reach * dpr;
    const cx = lens.x * dpr;
    const cy = lens.y * dpr;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = falloff(ctx, cx, cy, radius, presence, s.softness);
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.globalCompositeOperation = 'source-over';

    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(canvas.width, Math.ceil(cx + radius));
    const y1 = Math.min(canvas.height, Math.ceil(cy + radius));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0;
    const h = y1 - y0;
    if (scratch.width < w || scratch.height < h) {
      scratch.width = Math.max(scratch.width, w);
      scratch.height = Math.max(scratch.height, h);
    }
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, w, h);
    for (const glyph of glyphs) blit(scratchCtx, glyph.dashes, glyph.offset.x, glyph.offset.y, x0, y0);
    scratchCtx.globalCompositeOperation = 'destination-in';
    scratchCtx.fillStyle = falloff(scratchCtx, cx - x0, cy - y0, radius, 1, s.softness);
    scratchCtx.fillRect(0, 0, w, h);
    scratchCtx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = presence;
    ctx.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
    ctx.globalAlpha = 1;
  };

  const crisp = (value) => (Math.round(value * dpr) + 0.5) / dpr;

  const perimeterPoint = (distance, w, h) => {
    let d = ((distance % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
    if (d < w) return [frame.x1 + d, frame.y1, 0, -1];
    d -= w;
    if (d < h) return [frame.x2, frame.y1 + d, 1, 0];
    d -= h;
    if (d < w) return [frame.x2 - d, frame.y2, 0, 1];
    d -= w;
    return [frame.x1, frame.y2 - d, -1, 0];
  };

  const drawSpecks = (s, a, accent) => {
    const w = frame.x2 - frame.x1;
    const h = frame.y2 - frame.y1;
    if (w < 2 || h < 2) return;
    const perimeter = 2 * (w + h);
    const seed = frame.index + 1;
    const grid = 3;
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;

    for (let k = 0; k < s.specks; k++) {
      const period = 0.5 + noise(seed, k, 11) * 1.2;
      const t = pulse / period + noise(seed, k, 17);
      const cycle = Math.floor(t);
      const life = t - cycle;
      if (life > 0.7) continue;
      const [px, py, nx, ny] = perimeterPoint(noise(seed, k, cycle) * perimeter, w, h);
      const pick = noise(seed, k, cycle, 2);
      const size = pick < 0.46 ? 2 : pick < 0.7 ? 3 : pick < 0.84 ? 5 : pick < 0.94 ? 8 : 11;
      const large = size >= 8;
      const out = (large ? 9 : 4) + Math.floor(noise(seed, k, cycle, 1) * 5) * grid;
      const x = frame.x1 + Math.round((px + nx * out - frame.x1) / grid) * grid;
      const y = frame.y1 + Math.round((py + ny * out - frame.y1) / grid) * grid;
      const tone = noise(seed, k, cycle, 3);
      const blink = life < 0.06 || (life > 0.32 && life < 0.36) ? 0.35 : 1;
      const alpha = a * (large ? 0.3 + 0.4 * tone : 0.3 + 0.6 * tone) * blink;
      const left = Math.round(x - size / 2);
      const top = Math.round(y - size / 2);
      ctx.globalAlpha = alpha;
      if (tone < 0.26 || (large && tone < 0.78)) {
        ctx.strokeRect(left + 0.5, top + 0.5, size, size);
        if (large && tone > 0.5) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      } else {
        ctx.fillRect(left, top, size, size);
      }
    }

    for (let j = 0; j < 2; j++) {
      const head = (pulse * 0.42 * s.speed + j * 0.5) * perimeter;
      for (let i = 0; i < 4; i++) {
        const [x, y] = perimeterPoint(head - i * 6, w, h);
        const size = i === 0 ? 3 : 2;
        ctx.globalAlpha = a * [0.95, 0.55, 0.32, 0.16][i];
        ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawFrame = (s, fallbackAccent) => {
    const glyph = glyphs[frame.index];
    if (!glyph || frame.alpha < 0.01) return;
    const accent = glyph.accent || fallbackAccent;
    const a = frame.alpha;
    const x1 = crisp(frame.x1);
    const y1 = crisp(frame.y1);
    const x2 = crisp(frame.x2);
    const y2 = crisp(frame.y2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;

    const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
    if (moved > 1) {
      const hx = (glyph.box.x1 + glyph.box.x2) / 2;
      const hy = (glyph.box.y1 + glyph.box.y2) / 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + glyph.offset.x, hy + glyph.offset.y);
      ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.45 * a;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.rect(Math.round(hx) - 2, Math.round(hy) - 2, 4, 4);
      ctx.globalAlpha = 0.7 * a;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.globalAlpha = 0.5 * a;
    ctx.stroke();

    ctx.beginPath();
    for (const [cx, cy] of [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2]
    ]) {
      ctx.rect(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5);
    }
    ctx.globalAlpha = 0.95 * a;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (s.specks > 0) drawSpecks(s, a, accent);

    if (!s.labels) return;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.68 * a;
    const label =
      moved > 1
        ? `${signed(Math.round(glyph.offset.x))}, ${signed(Math.round(-glyph.offset.y))}`
        : `${glyph.char}  ${Math.round(glyph.box.x2 - glyph.box.x1)} × ${Math.round(glyph.box.y2 - glyph.box.y1)}`;
    ctx.fillText(label, Math.round(frame.x1), Math.round(frame.y1) - 7);
    ctx.globalAlpha = 1;
  };

  const drawLines = (s, view, accent, alpha, growth) => {
    const lineList = view.lineViews || [view];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 1;
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';

    lineList.forEach((lv) => {
      const pad = Math.max(12, lv.size * 0.12);
      const x1 = Math.round(lv.left - pad);
      const x2 = Math.round(lv.right + pad);
      const room = width - x2 > x1;
      ctx.textAlign = room ? 'left' : 'right';
      lv.lines.forEach((line, k) => {
        const grow = growth(k);
        if (grow <= 0.001) return;
        const y = crisp(line.y);
        const end = x1 + (x2 - x1) * grow;
        ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(end, y);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillRect(x1 - 1, Math.round(line.y) - 1, 3, 3);
        ctx.fillRect(Math.round(end) - 1, Math.round(line.y) - 1, 3, 3);
        if (s.labels) {
          ctx.globalAlpha = alpha * 0.62 * smoothstep(0.7, 1, grow);
          ctx.fillText(line.label, room ? x2 + 8 : x1 - 8, Math.round(line.y));
        }
      });
    });

    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  };

  const ensureCells = (glyph, view) => {
    if (glyph.cells) return glyph.cells;
    const art = glyph.fill;
    const size = Math.max(3, Math.round(view.size / 26));
    const w = art.image.width;
    const h = art.image.height;
    const source = art.image.getContext('2d');
    const cells = [];
    glyph.cells = cells;
    glyph.assembled = 0;
    if (!source || w < 2 || h < 2) return cells;
    const data = source.getImageData(0, 0, w, h).data;
    const gx = Math.floor(art.left / size) * size;
    const gy = Math.floor(art.top / size) * size;
    const cols = Math.ceil((art.left + w / dpr - gx) / size) + 1;
    const rows = Math.ceil((art.top + h / dpr - gy) / size) + 1;
    const hit = new Uint8Array(cols * rows);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (data[(py * w + px) * 4 + 3] < 24) continue;
        const cx = Math.floor((art.left + px / dpr - gx) / size);
        const cy = Math.floor((art.top + py / dpr - gy) / size);
        hit[cy * cols + cx] = 1;
      }
    }
    const center = (glyph.box.x1 + glyph.box.x2) / 2;
    const along = clamp01((center - view.left) / Math.max(1, view.right - view.left));
    for (let k = 0; k < hit.length; k++) {
      if (!hit[k]) continue;
      const angle = noise(glyph.index, k, 1) * Math.PI * 2;
      const distance = view.size * (0.25 + 0.6 * noise(glyph.index, k, 2));
      const start = 0.03 + 0.36 * along + 0.12 * noise(glyph.index, k, 3);
      const land = start + 0.3 + 0.14 * noise(glyph.index, k, 4);
      cells.push({
        x: gx + (k % cols) * size,
        y: gy + Math.floor(k / cols) * size,
        size,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance * 0.7,
        start,
        land
      });
      glyph.assembled = Math.max(glyph.assembled, land);
    }
    return cells;
  };

  const cellRect = (x, y, size) => {
    const left = Math.round(x * dpr);
    const top = Math.round(y * dpr);
    return [left, top, Math.round((x + size) * dpr) - left, Math.round((y + size) * dpr) - top];
  };

  const drawAssembling = (glyph, progress, fallbackAccent) => {
    const cells = glyph.cells || [];
    ctx.save();
    ctx.beginPath();
    let landed = 0;
    for (const cell of cells) {
      if (progress < cell.land) continue;
      const [x, y, w, h] = cellRect(cell.x, cell.y, cell.size);
      ctx.rect(x, y, w, h);
      landed++;
    }
    if (landed) {
      ctx.clip();
      blit(ctx, glyph.fill, 0, 0, 0, 0);
    }
    ctx.restore();
    ctx.fillStyle = glyph.accent || fallbackAccent;
    for (const cell of cells) {
      if (progress < cell.start || progress >= cell.land) continue;
      const u = (progress - cell.start) / (cell.land - cell.start);
      const eased = 1 - Math.pow(1 - u, 4);
      const size = cell.size * (0.4 + 0.6 * eased);
      const x = cell.x + (cell.size - size) / 2 + cell.dx * (1 - eased);
      const y = cell.y + (cell.size - size) / 2 + cell.dy * (1 - eased);
      const [left, top, w, h] = cellRect(x, y, size);
      ctx.globalAlpha = Math.min(1, u * 4) * (0.55 + 0.45 * eased);
      ctx.fillRect(left, top, Math.max(1, w), Math.max(1, h));
    }
    ctx.globalAlpha = 1;
  };

  const drawFilling = (glyph, lead, progress, lineView) => {
    const art = glyph.fill;
    const left = Math.floor(art.left * dpr);
    const top = Math.floor(art.top * dpr);
    const w = art.image.width + 2;
    const h = art.image.height + 2;
    const fill = clamp01((progress - 0.24 - 0.28 * lead) / 0.48);
    const rects = [];
    for (const band of lineView.bands) {
      const amount = smoothstep(0.3 * band.order, 0.3 * band.order + 0.4, fill);
      if (amount <= 0) continue;
      const span = (band.y1 - band.y0) * amount;
      const y0 = Math.round((band.up ? band.y1 - span : band.y0) * dpr);
      const y1 = Math.round((band.up ? band.y1 : band.y0 + span) * dpr);
      if (y1 > y0) rects.push([y0, y1 - y0]);
    }
    const outline = smoothstep(0.08 + 0.2 * lead, 0.22 + 0.2 * lead, progress);
    if (outline > 0.001) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - 2, top - 2, w + 2, h + 2);
      for (const [y, span] of rects) ctx.rect(left - 2, y, w + 2, span);
      ctx.clip('evenodd');
      ctx.globalAlpha = outline;
      blit(ctx, glyph.dashes, 0, 0, 0, 0);
      ctx.restore();
    }
    if (rects.length) {
      ctx.save();
      ctx.beginPath();
      for (const [y, span] of rects) ctx.rect(left - 2, y, w + 2, span);
      ctx.clip();
      blit(ctx, glyph.fill, 0, 0, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  const kick = (index) => {
    const target = glyphs[index];
    if (!target) return;
    const strength = (word ? word.size : 120) * 11;
    kicks.push({ index, at: pulse, velocity: strength });
    for (let j = 0; j < glyphs.length; j++) {
      if (j === index) continue;
      const peer = glyphs[j];
      if (peer.line !== target.line) continue;
      const d = Math.abs(peer.linePos - target.linePos);
      const velocity = strength * Math.pow(KICK_DECAY, d);
      if (velocity < 30) continue;
      kicks.push({ index: j, at: pulse + d * 0.055, velocity });
    }
    wake();
  };

  const sampleSweep = (view, tNorm) => {
    const path = view.sweepPath;
    if (!path || path.length === 0) return { x: width * 0.5, y: height * 0.5 };
    if (path.length === 1) return path[0];
    const scaled = clamp01(tNorm) * (path.length - 1);
    const idx = Math.min(path.length - 2, Math.floor(scaled));
    const frac = scaled - idx;
    const p0 = path[idx];
    const p1 = path[idx + 1];
    return {
      x: p0.x + (p1.x - p0.x) * frac,
      y: p0.y + (p1.y - p0.y) * frac
    };
  };

  const tick = (now) => {
    raf = 0;
    if (!alive || !visible || document.hidden) return;
    const s = settings;
    if (!s) return;

    if (sizeDirty) {
      sizeDirty = false;
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const { ink, accent } = palette(s);
    const view = ensureLayout(s, ink, accent);
    const damping = 2 * Math.sqrt(SPRING) * (1 - clamp01(s.bounce) * 0.96);

    if (s.intro !== introKind) {
      introKind = s.intro;
      introClock = 0;
    }
    const introOn = introKind !== 'none' && !reducedMotion && glyphs.length > 0;
    if (introOn && fontsReady) introClock += dt;
    const progress = introOn ? clamp01((introClock - INTRO_DELAY) / Math.max(0.3, s.introDuration)) : 1;
    introducing = introOn && progress < 1;

    const sweeping = !introducing && s.sweep && !reducedMotion && !pointer.inside && dragging < 0;
    if (sweeping) clock += dt * s.speed;
    pulse += dt;

    let targetX = pointer.x;
    let targetY = pointer.y;
    if (sweeping) {
      if (view.lineCount > 1 && view.sweepPath.length > 0) {
        const pt = sampleSweep(view, 0.5 - 0.5 * Math.cos(clock * 0.34));
        targetX = pt.x;
        targetY = pt.y;
      } else {
        targetX = view.left + (view.right - view.left) * (0.5 - 0.5 * Math.cos(clock * 0.45));
        targetY = view.top + (view.bottom - view.top) * (0.45 + 0.1 * Math.sin(clock * 0.8));
      }
    }

    const active = !introducing && (pointer.inside || sweeping || dragging >= 0);
    if (active && !placed) {
      lens.x = targetX;
      lens.y = targetY;
    }
    if (active) {
      const lag = pointer.inside ? 0.05 : 0.22;
      lens.x = approach(lens.x, targetX, dt, lag);
      lens.y = approach(lens.y, targetY, dt, lag);
    }
    placed = active;
    presence = approach(presence, s.reveal === 'area' && active && dragging < 0 ? 1 : 0, dt, 0.16);

    for (let k = kicks.length - 1; k >= 0; k--) {
      if (kicks[k].at > pulse) continue;
      const glyph = glyphs[kicks[k].index];
      if (glyph) glyph.velocity.y -= kicks[k].velocity;
      kicks.splice(k, 1);
    }

    let moving = false;
    glyphs.forEach((glyph, i) => {
      if (i === dragging) {
        glyph.offset.x = approach(glyph.offset.x, pointer.x - grab.x, dt, 0.03);
        glyph.offset.y = approach(glyph.offset.y, pointer.y - grab.y, dt, 0.03);
        glyph.velocity.x = 0;
        glyph.velocity.y = 0;
        moving = true;
        return;
      }
      const { offset, velocity } = glyph;
      if (Math.abs(offset.x) < 0.05 && Math.abs(offset.y) < 0.05 && Math.hypot(velocity.x, velocity.y) < 0.5) {
        offset.x = 0;
        offset.y = 0;
        velocity.x = 0;
        velocity.y = 0;
        return;
      }
      velocity.x += (-SPRING * offset.x - damping * velocity.x) * dt;
      velocity.y += (-SPRING * offset.y - damping * velocity.y) * dt;
      offset.x += velocity.x * dt;
      offset.y += velocity.y * dt;
      moving = true;
    });

    let typing = -1;
    if (introducing && introKind === 'type') {
      const step = 0.86 / glyphs.length;
      const cursorAt = Math.min(glyphs.length - 1, Math.floor(progress / step));
      typing = progress < 0.93 ? cursorAt : -1;
      glyphs.forEach((glyph, i) => {
        glyph.shown = i < cursorAt ? 1 : i === cursorAt ? smoothstep(0, step * 0.3, progress - i * step) : 0;
      });
    } else {
      glyphs.forEach((glyph) => {
        glyph.shown = 1;
      });
    }

    const focus = introducing ? typing : dragging >= 0 ? dragging : active ? glyphAt(lens.x, lens.y) : -1;
    if (focus >= 0 && s.selection) {
      const glyph = glyphs[focus];
      const bx1 = glyph.box.x1 + glyph.offset.x - 6;
      const by1 = glyph.box.y1 + glyph.offset.y - 6;
      const bx2 = glyph.box.x2 + glyph.offset.x + 6;
      const by2 = glyph.box.y2 + glyph.offset.y + 6;
      if (frame.index < 0 || frame.alpha < 0.02) {
        frame.x1 = bx1;
        frame.y1 = by1;
        frame.x2 = bx2;
        frame.y2 = by2;
      }
      const glide = focus === dragging ? 0.02 : 0.08;
      frame.x1 = approach(frame.x1, bx1, dt, glide);
      frame.y1 = approach(frame.y1, by1, dt, glide);
      frame.x2 = approach(frame.x2, bx2, dt, glide);
      frame.y2 = approach(frame.y2, by2, dt, glide);
      frame.index = focus;
    }
    frame.alpha = approach(frame.alpha, focus >= 0 && s.selection ? 1 : 0, dt, 0.1);

    glyphs.forEach((glyph, i) => {
      const target = introducing
        ? introKind === 'type' && (i === typing || (typing >= 0 && i > typing))
          ? 1
          : 0
        : s.reveal === 'letter' && i === focus && i !== dragging
          ? 1
          : 0;
      if (introducing && glyph.shown === 0) glyph.outline = target;
      glyph.outline = approach(glyph.outline, target, dt, 0.09);
      if (Math.abs(glyph.outline - target) > 0.002) moving = true;
      else glyph.outline = target;
    });

    guideAlpha = approach(guideAlpha, s.guides && !introducing && (focus >= 0 || presence > 0.4) ? 1 : 0, dt, 0.14);

    const hovering = !introducing && focus >= 0 && pointer.inside;
    const nextCursor =
      dragging >= 0 ? 'grabbing' : hovering && s.draggable ? 'grab' : hovering && s.clickKick ? 'pointer' : '';
    if (nextCursor !== cursor) {
      cursor = nextCursor;
      container.style.cursor = nextCursor;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const glyph of glyphs) {
      const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
      if (moved > 1) {
        ctx.globalAlpha = Math.min(1, moved / 24) * 0.55;
        blit(ctx, glyph.dashes, 0, 0, 0, 0);
        ctx.globalAlpha = 1;
      }
    }

    if (introducing && introKind === 'metrics') {
      drawLines(s, view, accent, 1 - smoothstep(0.84, 1, progress), (k) =>
        smoothstep(0.02 + 0.04 * k, 0.2 + 0.04 * k, progress)
      );
    } else if (guideAlpha > 0.005) {
      drawLines(s, view, accent, guideAlpha * 0.6, () => 1);
    }

    glyphs.forEach((glyph, i) => {
      if (introducing && introKind === 'assemble') {
        ensureCells(glyph, view);
        if (progress < glyph.assembled) {
          drawAssembling(glyph, progress, accent);
          return;
        }
      }
      if (introducing && introKind === 'metrics') {
        const lead = glyphs.length > 1 ? i / (glyphs.length - 1) : 0;
        if (progress < 0.72 + 0.28 * lead) {
          drawFilling(glyph, lead, progress, glyph.lineView);
          return;
        }
      }
      if (glyph.shown < 0.001) return;
      if (glyph.outline < 0.999) {
        ctx.globalAlpha = (1 - glyph.outline) * glyph.shown;
        blit(ctx, glyph.fill, glyph.offset.x, glyph.offset.y, 0, 0);
      }
      if (glyph.outline > 0.001) {
        ctx.globalAlpha = glyph.outline * glyph.shown;
        blit(ctx, glyph.dashes, glyph.offset.x, glyph.offset.y, 0, 0);
      }
      ctx.globalAlpha = 1;
    });

    if (presence > 0.001) drawReveal(s);
    drawFrame(s, accent);

    const settling =
      moving ||
      introducing ||
      kicks.length > 0 ||
      (guideAlpha > 0.005 && guideAlpha < 0.995) ||
      Math.abs(presence - (s.reveal === 'area' && active && dragging < 0 ? 1 : 0)) > 0.002 ||
      (frame.alpha > 0.01 && frame.alpha < 0.99);
    if ((active || settling) && visible && alive && !document.hidden) {
      raf = requestAnimationFrame(tick);
    }
  };

  function wake() {
    if (raf || !visible || !alive || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  const resize = () => {
    sizeDirty = true;
    wake();
  };

  const locate = (e) => {
    const rect = container.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
  };

  const onMove = (e) => {
    locate(e);
    pointer.inside = true;
    wake();
  };

  const onLeave = () => {
    if (dragging >= 0) return;
    pointer.inside = false;
    wake();
  };

  const onDown = (e) => {
    locate(e);
    pointer.inside = true;
    const primary = e.pointerType !== 'mouse' || e.button === 0;
    const index = introducing || !primary ? -1 : glyphAt(pointer.x, pointer.y);
    press.x = pointer.x;
    press.y = pointer.y;
    press.time = performance.now();
    press.index = index;
    if (settings.draggable && index >= 0) {
      dragging = index;
      grab.x = pointer.x - glyphs[index].offset.x;
      grab.y = pointer.y - glyphs[index].offset.y;
      container.setPointerCapture?.(e.pointerId);
    }
    wake();
  };

  const onUp = (e) => {
    if (dragging >= 0) {
      dragging = -1;
      try {
        container.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture already released
      }
      const rect = container.getBoundingClientRect();
      pointer.inside =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    }
    if (
      e.type === 'pointerup' &&
      press.index >= 0 &&
      settings.clickKick &&
      !reducedMotion &&
      performance.now() - press.time < 450
    ) {
      const rect = container.getBoundingClientRect();
      if (Math.hypot(e.clientX - rect.left - press.x, e.clientY - rect.top - press.y) < 6) {
        kick(press.index);
      }
    }
    press.index = -1;
    wake();
  };

  const onVisibility = () => {
    if (!document.hidden && visible && alive) {
      last = performance.now();
      wake();
    }
  };

  container.addEventListener('pointermove', onMove, { passive: true });
  container.addEventListener('pointerenter', onMove, { passive: true });
  container.addEventListener('pointerdown', onDown, { passive: true });
  container.addEventListener('pointerup', onUp, { passive: true });
  container.addEventListener('pointercancel', onUp, { passive: true });
  container.addEventListener('pointerleave', onLeave, { passive: true });
  canvas.addEventListener('contextrestored', invalidateLayout);
  document.addEventListener('visibilitychange', onVisibility, { passive: true });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener('resize', resize, { passive: true });

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  });
  intersectionObserver.observe(container);

  const themeObserver = new MutationObserver(wake);
  for (const node of [document.documentElement, document.body]) {
    if (node) themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  }

  const schemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  schemeQuery?.addEventListener?.('change', wake);
  if (document.fonts) document.fonts.ready.then(fontsLoaded, fontsLoaded);

  resize();

  const update = (nextOptions = {}) => {
    settings = { ...settings, ...nextOptions };
    wake();
  };

  const destroy = () => {
    alive = false;
    cancelAnimationFrame(raf);
    raf = 0;
    resizeObserver.disconnect();
    window.removeEventListener('resize', resize);
    intersectionObserver.disconnect();
    themeObserver.disconnect();
    schemeQuery?.removeEventListener?.('change', wake);
    document.removeEventListener('visibilitychange', onVisibility);
    container.style.cursor = '';
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerenter', onMove);
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    container.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('contextrestored', invalidateLayout);
  };

  return { update, destroy, wake };
}

export function mountAllTechTexts(root = document) {
  const instances = [];
  root.querySelectorAll('[data-tech-text]').forEach((el) => {
    if (el.dataset.techTextMounted === '1') return;
    el.dataset.techTextMounted = '1';
    let options = {};
    try {
      options = JSON.parse(el.dataset.techText || '{}');
    } catch {
      options = {};
    }
    instances.push(createTechText(el, options));
  });
  return instances;
}
