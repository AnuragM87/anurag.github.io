/*
 * dust.js — Telegram-style "disintegrate into dust" effect.
 *
 * Dust.vanish(element) captures every visible word, button and <hr> inside
 * `element` onto a canvas, hides the real element, then blows each captured
 * pixel away as a particle, sweeping left to right. Returns a Promise that
 * resolves when the last particle is gone.
 *
 * Add `data-dust-box` to any element whose background/border should also
 * turn into dust (cards, badges, ...).
 */
const Dust = (() => {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const inView = (r) =>
    r.width > 0 && r.height > 0 &&
    r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;

  function applyTransform(text, mode) {
    if (mode === "uppercase") return text.toUpperCase();
    if (mode === "lowercase") return text.toLowerCase();
    if (mode === "capitalize") return text.replace(/^\p{L}/u, (c) => c.toUpperCase());
    return text;
  }

  function drawBox(ctx, el) {
    const r = el.getBoundingClientRect();
    if (!inView(r)) return;
    const s = getComputedStyle(el);
    const radius = parseFloat(s.borderTopLeftRadius) || 0;
    const bw = s.borderTopStyle === "none" ? 0 : parseFloat(s.borderTopWidth) || 0;

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw, radius);
    else ctx.rect(r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw);

    ctx.fillStyle = s.backgroundColor;
    ctx.fill();
    if (bw > 0) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = s.borderTopColor;
      ctx.stroke();
    }
  }

  function drawText(ctx, root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = document.createRange();

    for (let node; (node = walker.nextNode()); ) {
      const s = getComputedStyle(node.parentElement);
      if (s.visibility === "hidden" || s.display === "none") continue;

      ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      ctx.fillStyle = s.color;
      if ("letterSpacing" in ctx) ctx.letterSpacing = s.letterSpacing === "normal" ? "0px" : s.letterSpacing;
      const fontSize = parseFloat(s.fontSize);
      const ascent = ctx.measureText("Mg").fontBoundingBoxAscent ?? fontSize * 0.8;
      const underline = s.textDecorationLine.includes("underline");

      const paint = (str, r) => {
        if (!inView(r)) return;
        const baseline = r.top + ascent;
        ctx.fillText(applyTransform(str, s.textTransform), r.left, baseline);
        if (underline) {
          const t = Math.max(1, fontSize / 16);
          ctx.fillRect(r.left, baseline + t * 1.5, r.width, t);
        }
      };

      // Measure word by word with a Range — no DOM changes needed.
      for (const m of node.nodeValue.matchAll(/\S+/g)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects();
        if (rects.length <= 1) {
          paint(m[0], range.getBoundingClientRect());
        } else {
          // Word broken across lines: fall back to per-character.
          for (let i = 0; i < m[0].length; i++) {
            range.setStart(node, m.index + i);
            range.setEnd(node, m.index + i + 1);
            paint(m[0][i], range.getBoundingClientRect());
          }
        }
      }
    }
  }

  // Render what's visible of `root` into pixels and turn them into particles.
  function capture(root) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Sample every Nth device pixel; each particle starts as an N×N square.
    const step = dpr >= 1.5 ? 2 : 1;
    const W = Math.ceil(innerWidth * dpr);
    const H = Math.ceil(innerHeight * dpr);

    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    ctx.scale(dpr, dpr);

    root.querySelectorAll("button, hr, [data-dust-box]").forEach((el) => drawBox(ctx, el));
    drawText(ctx, root);

    const data = ctx.getImageData(0, 0, W, H).data;
    const xs = [], ys = [], colors = [], alphas = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        const a = data[i + 3];
        if (a < 30) continue;
        xs.push(x);
        ys.push(y);
        // Packed little-endian RGBA without alpha: 0x00BBGGRR
        colors.push((data[i + 2] << 16) | (data[i + 1] << 8) | data[i]);
        alphas.push(a);
      }
    }
    return { W, H, dpr, step, xs, ys, colors, alphas };
  }

  function vanish(root, { duration = 1600 } = {}) {
    if (reducedMotion.matches) return Promise.resolve();

    const { W, H, dpr, step, xs, ys, colors, alphas } = capture(root);
    root.style.visibility = "hidden";

    const n = xs.length;
    if (!n) return Promise.resolve();

    // Per-particle motion parameters.
    let minX = Infinity, maxX = -Infinity;
    for (const x of xs) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const spanX = Math.max(1, maxX - minX);
    const sweep = (duration / 1000) * 0.55; // seconds for the wave to cross
    const maxLife = (duration / 1000) * 0.45;

    const delay = new Float32Array(n);
    const life = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const phase = new Float32Array(n);
    let end = 0;
    for (let i = 0; i < n; i++) {
      delay[i] = ((xs[i] - minX) / spanX) * sweep + Math.random() * 0.12;
      life[i] = maxLife * (0.45 + Math.random() * 0.55);
      vx[i] = (15 + Math.random() * 70) * dpr;
      vy[i] = -(10 + Math.random() * 60) * dpr;
      phase[i] = Math.random() * Math.PI * 2;
      end = Math.max(end, delay[i] + life[i]);
    }

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    Object.assign(canvas.style, {
      position: "fixed", left: "0", top: "0",
      width: innerWidth + "px", height: innerHeight + "px",
      pointerEvents: "none", zIndex: "9999",
    });
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const buf = new Uint32Array(img.data.buffer);

    const plot = (x, y, size, rgba) => {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x + size > W || y + size > H) return;
      for (let dy = 0; dy < size; dy++) {
        const row = (y + dy) * W + x;
        for (let dx = 0; dx < size; dx++) buf[row + dx] = rgba;
      }
    };

    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const t = (now - start) / 1000;
        buf.fill(0);

        for (let i = 0; i < n; i++) {
          const local = t - delay[i];
          if (local < 0) {
            // Not reached by the wave yet: still looks like the original text.
            plot(xs[i], ys[i], step, ((alphas[i] << 24) | colors[i]) >>> 0);
            continue;
          }
          const p = local / life[i];
          if (p >= 1) continue;

          const ease = local * local;
          const x = xs[i] + vx[i] * local + Math.sin(phase[i] + local * 9) * 4 * dpr * p;
          const y = ys[i] + vy[i] * local - 40 * dpr * ease;
          const a = (alphas[i] * (1 - p * p)) | 0;
          plot(x, y, p < 0.5 ? 2 : 1, ((a << 24) | colors[i]) >>> 0);
        }

        ctx.putImageData(img, 0, 0);

        if (t < end) {
          requestAnimationFrame(frame);
        } else {
          canvas.remove();
          root.style.visibility = "";
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  return { vanish };
})();
