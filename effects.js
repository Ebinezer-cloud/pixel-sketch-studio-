/* Pixel Sketch Studio — image effects & analytics (pure JS, no dependencies) */
(function (root) {
  "use strict";

  // ---------- helpers ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function grayOf(data, n) {
    const g = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return g;
  }

  function boxPass(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let y = 0; y < h; y++) {
      let ti = y * w, li = ti, ri = ti + r;
      const fv = src[ti], lv = src[ti + w - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + j];
      for (let j = 0; j <= r; j++) { val += src[ri++] - fv; dst[ti++] = val * iarr; }
      for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
      for (let j = w - r; j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
    }
  }
  function transpose(src, dst, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[x * h + y] = src[y * w + x];
  }
  // Separable box blur (applied `passes` times ≈ gaussian)
  function blur(src, w, h, r, passes) {
    r = Math.max(1, Math.min(Math.round(r), ((Math.min(w, h) - 1) >> 1) - 1));
    passes = passes || 2;
    let a = Float32Array.from(src), b = new Float32Array(src.length), t = new Float32Array(src.length);
    for (let p = 0; p < passes; p++) {
      boxPass(a, b, w, h, r);
      transpose(b, t, w, h);
      boxPass(t, b, h, w, r);
      transpose(b, a, h, w);
    }
    return a;
  }

  function sobel(g, w, h) {
    const m = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
        const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
        m[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return m;
  }

  // ---------- v2 helpers: true gaussian, bilateral, DoG line art ----------
  const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function gauss(src, w, h, sigma) {
    if (sigma > 4) return blur(src, w, h, Math.max(1, Math.round(sigma / 1.15)), 3);
    const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) {
          let xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
          a += src[row + xx] * k[i + r];
        }
        tmp[row + x] = a;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) {
          let yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
          a += tmp[yy * w + x] * k[i + r];
        }
        out[y * w + x] = a;
      }
    }
    return out;
  }

  // Edge-preserving colour smoothing (flattens regions, keeps edges)
  function bilateral(ch, w, h, r, sigS, sigR) {
    const R = ch[0], G = ch[1], B = ch[2], n = w * h, side = 2 * r + 1;
    const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n);
    const spat = new Float32Array(side * side);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      spat[(dy + r) * side + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * sigS * sigS));
    const lut = new Float32Array(766);
    for (let i = 0; i < 766; i++) { const d = i / 3; lut[i] = Math.exp(-(d * d) / (2 * sigR * sigR)); }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, cr = R[i], cg = G[i], cb = B[i];
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            const d = Math.abs(R[j] - cr) + Math.abs(G[j] - cg) + Math.abs(B[j] - cb);
            const wt = spat[(dy + r) * side + dx + r] * lut[d | 0];
            sr += R[j] * wt; sg += G[j] * wt; sb += B[j] * wt; sw += wt;
          }
        }
        oR[i] = sr / sw; oG[i] = sg / sw; oB[i] = sb / sw;
      }
    }
    return [oR, oG, oB];
  }

  function channelsOf(data, n) {
    const c = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0, p = 0; i < n; i++, p += 4) { c[0][i] = data[p]; c[1][i] = data[p + 1]; c[2][i] = data[p + 2]; }
    return c;
  }

  // Difference-of-gaussians line darkness: 0 = no line, 1 = solid ink (dark lines only)
  function lineArt(gray, w, h, sigma, gain, t0, t1) {
    const a = gauss(gray, w, h, sigma), b = gauss(gray, w, h, sigma * 1.6);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = smooth01(t0, t1, ((b[i] - a[i]) / 255) * gain);
    return out;
  }

  const scaleOf = (w, h) => clamp(Math.min(w, h) / 700, 0.7, 2.2);

  // Colour-dodge pencil sketch map: 255 = paper, 0 = line
  function sketchMap(gray, w, h, opts) {
    const n = w * h;
    const inv = new Float32Array(n);
    for (let i = 0; i < n; i++) inv[i] = 255 - gray[i];
    // detail 0..100 -> bigger blur = bolder, fewer lines
    const r = Math.max(2, Math.round((Math.min(w, h) / 140) * (2.4 - opts.detail / 55)));
    const bl = blur(inv, w, h, r, 2);
    const out = new Float32Array(n);
    const k = 0.55 + opts.intensity * 1.15; // line strength
    for (let i = 0; i < n; i++) {
      const d = Math.min(255, (gray[i] * 255) / (255 - bl[i] + 1));
      out[i] = clamp(255 - (255 - d) * k, 0, 255);
    }
    return out;
  }

  function paperGrain(rand, amount) { // returns multiplier ~1
    return 1 - amount * 0.22 * rand();
  }

  function newImage(w, h, data) {
    if (typeof ImageData !== "undefined") return new ImageData(data, w, h);
    return { width: w, height: h, data: data };
  }

  // ---------- effects ----------
  const fx = {};

  fx.sketch = function (src, o) {
    const { width: w, height: h } = src, n = w * h, sf = scaleOf(w, h);
    const g0 = grayOf(src.data, n);
    const g = gauss(g0, w, h, 0.6 * sf);
    const sigma = sf * (0.5 + (1 - o.detail / 100) * 0.9);
    const dark = lineArt(g, w, h, sigma, 1.2 + o.intensity * 2.4, 0.012, 0.07);
    const soft = gauss(g0, w, h, 1.6 * sf);
    const shade = 0.12 + 0.3 * o.intensity;
    const out = new Uint8ClampedArray(n * 4), rand = rng(7);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const tone = 1 - shade * Math.pow(1 - soft[i] / 255, 1.8);
      let v = (1 - dark[i]) * tone;
      v = clamp((v - 0.03) / 0.94, 0, 1) * 255;
      v *= paperGrain(rand, o.grain * 0.5);
      out[p] = v; out[p + 1] = v; out[p + 2] = Math.min(255, v * 1.015); out[p + 3] = 255;
    }
    return newImage(w, h, out);
  };

  fx.pencil = function (src, o) {
    const { width: w, height: h } = src, n = w * h;
    const g = grayOf(src.data, n);
    const s = sketchMap(g, w, h, { detail: o.detail, intensity: o.intensity * 0.85 });
    const sg = blur(g, w, h, 2, 1);
    const out = new Uint8ClampedArray(n * 4), rand = rng(11);
    const gap = Math.max(4, Math.round(Math.min(w, h) / 170));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4;
        let v = s[i];
        // graphite cross-hatching in shadows
        const tone = sg[i];
        let hatch = 0;
        if (tone < 200 && ((x + y) % gap) === 0) hatch += (200 - tone) * 0.35;
        if (tone < 140 && ((x - y + h * 4) % gap) === 0) hatch += (140 - tone) * 0.4;
        if (tone < 80 && (y % (gap + 1)) === 0) hatch += (80 - tone) * 0.5;
        v -= hatch * o.intensity * (0.6 + rand() * 0.5);
        v *= paperGrain(rand, o.grain * 1.2);
        v = clamp(v, 0, 255);
        // warm paper + cool graphite
        out[p] = clamp(v * 0.97 + 8, 0, 255);
        out[p + 1] = clamp(v * 0.97 + 5, 0, 255);
        out[p + 2] = clamp(v * 0.95, 0, 255);
        out[p + 3] = 255;
      }
    }
    return newImage(w, h, out);
  };

  fx.blood = function (src, o) {
    const { width: w, height: h } = src, n = w * h, sf = scaleOf(w, h);
    const g0 = grayOf(src.data, n);
    const g = gauss(g0, w, h, 0.6 * sf);
    const sigma = sf * (0.5 + (1 - o.detail / 100) * 0.9);
    const ink = lineArt(g, w, h, sigma, 1.2 + o.intensity * 2.4, 0.012, 0.07);
    const soft = gauss(g0, w, h, 1.8 * sf);
    const inkB = gauss(ink, w, h, 1.1 * sf);
    const out = new Uint8ClampedArray(n * 4), rand = rng(1313);
    const wash = 0.02 + 0.12 * o.intensity;

    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4, xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        const gr = paperGrain(rand, o.grain * 0.6);
        // aged paper
        let r = 248 * gr, gc = 240 * gr, b = 234 * gr;
        // thin blood wash in the shaded areas
        const t = wash * Math.pow(1 - soft[i] / 255, 1.7);
        r = r * (1 - t) + 190 * t; gc = gc * (1 - t) + 38 * t; b = b * (1 - t) + 44 * t;
        // wet ink: thick strokes go dark crimson, thin strokes stay bright red
        const a = Math.max(ink[i], clamp(inkB[i] * 1.6 - 0.1, 0, 1) * 0.9), thick = clamp(inkB[i] * 1.4, 0, 1);
        const ir = 182 - 100 * thick, ig = 10 - 8 * thick, ib = 20 - 12 * thick;
        r = r * (1 - a) + ir * a; gc = gc * (1 - a) + ig * a; b = b * (1 - a) + ib * a;
        // glossy highlight on edges facing the light (top-left)
        const gx = inkB[y * w + xr] - inkB[y * w + xl], gy = inkB[yd * w + x] - inkB[yu * w + x];
        const spec = clamp(-(gx + gy) * 2.6, 0, 1) * a;
        r += spec * 95; gc += spec * 60; b += spec * 60;
        out[p] = clamp(r, 0, 255); out[p + 1] = clamp(gc, 0, 255); out[p + 2] = clamp(b, 0, 255); out[p + 3] = 255;
      }
    }

    return newImage(w, h, out);
  };

  fx.cartoon = function (src, o) {
    const { width: w, height: h } = src, n = w * h, sf = scaleOf(w, h);
    let ch = channelsOf(src.data, n);
    const rad = Math.round(clamp(2 * sf, 2, 4));
    for (let it = 0; it < 2; it++) ch = bilateral(ch, w, h, rad, 2.2 * sf, 26);
    const Y = new Float32Array(n);
    for (let i = 0; i < n; i++) Y[i] = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
    const bands = Math.round(4 + (o.detail / 100) * 5); // 4..9 tone bands
    // clean ink outlines from the smoothed image
    const dark = lineArt(Y, w, h, sf * (1.1 + (1 - o.detail / 100) * 1.2), 1 + o.intensity * 1.8, 0.02, 0.085);
    const out = new Uint8ClampedArray(n * 4), rand = rng(5);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const y = Y[i], t = (y / 255) * bands, fl = Math.floor(t), fr = t - fl;
      const q = ((fl + smooth01(0.38, 0.62, fr)) / bands) * 255;
      const target = 0.35 * y + 0.65 * q; // keep a little natural gradation
      const ratio = clamp((target + 6) / (y + 6), 0.6, 1.7);
      let r = ch[0][i] * ratio, gc = ch[1][i] * ratio, b = ch[2][i] * ratio;
      const m = (r + gc + b) / 3, sat = 1.22;
      r = m + (r - m) * sat; gc = m + (gc - m) * sat; b = m + (b - m) * sat;
      const a = dark[i];
      r = r * (1 - a) + 24 * a; gc = gc * (1 - a) + 22 * a; b = b * (1 - a) + 42 * a;
      const gr = paperGrain(rand, o.grain * 0.35);
      out[p] = clamp(r * gr, 0, 255); out[p + 1] = clamp(gc * gr, 0, 255); out[p + 2] = clamp(b * gr, 0, 255); out[p + 3] = 255;
    }
    return newImage(w, h, out);
  };

  function apply(name, src, params) {
    const o = {
      intensity: clamp((params && params.intensity != null ? params.intensity : 60) / 100, 0, 1),
      detail: clamp(params && params.detail != null ? params.detail : 50, 0, 100),
      grain: clamp((params && params.grain != null ? params.grain : 30) / 100, 0, 1),
    };
    if (!fx[name]) throw new Error("Unknown effect: " + name);
    return fx[name](src, o);
  }

  // ---------- analytics ----------
  function analyze(img) {
    const { width: w, height: h, data } = img, n = w * h;
    const hist = new Array(32).fill(0);
    let sum = 0, sum2 = 0, satSum = 0;
    const colors = new Set();
    const g = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], gg = data[p + 1], b = data[p + 2];
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      g[i] = l; sum += l; sum2 += l * l; hist[Math.min(31, l >> 3)]++;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      colors.add(((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3));
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const em = sobel(g, w, h);
    let ec = 0;
    for (let i = 0; i < n; i++) if (em[i] > 80) ec++;
    return {
      brightness: (mean / 255) * 100,
      contrast: (std / 255) * 100,
      saturation: (satSum / n) * 100,
      edge: (ec / n) * 100,
      colors: colors.size,
      hist: hist.map((v) => v / n),
    };
  }

  root.Effects = { apply: apply, analyze: analyze, names: Object.keys(fx) };
  if (typeof module !== "undefined") module.exports = root.Effects;
})(typeof window !== "undefined" ? window : globalThis);
