/* Pixel Sketch Studio — UI logic */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // A4 page at ~120 dpi (210 x 297 mm)
  const A4 = { long: 1414, short: 1000 };
  const LABELS = {
    sketch: "Sketch Drawing", pencil: "Pencil Drawing", blood: "Blood Drawing",
    cartoon: "Cartoon Pencil",
  };

  const el = {
    file: $("fileInput"), drop: $("dropzone"), effects: $("effects"),
    intensity: $("intensity"), detail: $("detail"), grain: $("grain"),
    before: $("beforeCanvas"), after: $("afterCanvas"), compare: $("compare"),
    clip: $("beforeClip"), handle: $("handle"), empty: $("emptyState"), busy: $("busy"),
    reset: $("resetBtn"), download: $("downloadBtn"), pdf: $("pdfBtn"), hist: $("histCanvas"), history: $("history"),
  };

  const state = {
    img: null,          // loaded HTMLImageElement
    imgUrl: null,
    orient: "portrait",
    fit: "fit",
    src: null,          // ImageData of the A4 page (before)
    name: "photo",
    effect: "sketch",
    beforeStats: null,
    edits: 0,
    pos: 50,
    view: "slider",
    pending: false,
  };

  // ---------- upload ----------
  el.file.addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("drag"); }));
  el.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  function loadFile(file) {
    if (!file.type.startsWith("image/")) { alert("Please choose an image file."); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (state.imgUrl) URL.revokeObjectURL(state.imgUrl);
      state.img = img; state.imgUrl = url;
      state.name = file.name.replace(/\.[^.]+$/, "");
      // choose the orientation that suits the photo
      state.orient = img.naturalWidth > img.naturalHeight * 1.1 ? "landscape" : "portrait";
      syncSegs();
      state.edits = 0;
      el.history.innerHTML = "";
      $("s-edits").textContent = "0";
      el.empty.classList.add("hidden");
      el.compare.classList.remove("hidden");
      el.reset.disabled = false; el.download.disabled = false; el.pdf.disabled = false;
      setPos(50);
      buildFrame(true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("Could not read that image."); };
    img.src = url;
  }

  // ---------- A4 frame ----------
  function buildFrame(commit) {
    const img = state.img;
    if (!img) return;
    const land = state.orient === "landscape";
    const W = land ? A4.long : A4.short, H = land ? A4.short : A4.long;
    [el.before, el.after].forEach((c) => { c.width = W; c.height = H; });
    el.compare.style.setProperty("--ar", (W / H).toFixed(5));
    const ctx = el.before.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const k = state.fit === "fill" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    const dw = iw * k, dh = ih * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    state.src = ctx.getImageData(0, 0, W, H);
    state.beforeStats = Effects.analyze(state.src);
    $("s-size").textContent = "A4 " + W + "×" + H;
    render(commit);
  }

  function syncSegs() {
    document.querySelectorAll("#orientSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.orient === state.orient));
    document.querySelectorAll("#fitSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.fit === state.fit));
  }
  $("orientSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    state.orient = b.dataset.orient; syncSegs(); buildFrame(false);
  });
  $("fitSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    state.fit = b.dataset.fit; syncSegs(); buildFrame(false);
  });

  // ---------- controls ----------
  el.effects.addEventListener("click", (e) => {
    const b = e.target.closest(".effect");
    if (!b) return;
    el.effects.querySelectorAll(".effect").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.effect = b.dataset.effect;
    if (state.src) render(true);
  });

  ["intensity", "detail", "grain"].forEach((id) => {
    const input = el[id], out = $("o-" + id);
    input.addEventListener("input", () => { out.textContent = input.value; if (state.src) schedule(false); });
    input.addEventListener("change", () => { if (state.src) render(true); });
  });

  el.reset.addEventListener("click", () => {
    el.intensity.value = 60; el.detail.value = 50; el.grain.value = 30;
    $("o-intensity").textContent = "60"; $("o-detail").textContent = "50"; $("o-grain").textContent = "30";
    state.edits = 0; el.history.innerHTML = "";
    $("s-edits").textContent = "0";
    if (state.src) render(false);
  });

  el.download.addEventListener("click", () => {
    el.after.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = state.name + "-" + state.effect + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });

  el.pdf.addEventListener("click", () => {
    const land = state.orient === "landscape";
    el.after.toBlob((blob) => {
      blob.arrayBuffer().then((buf) => {
        const pdf = A4Pdf.make(new Uint8Array(buf), el.after.width, el.after.height, land);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
        a.download = state.name + "-" + state.effect + "-A4.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    }, "image/jpeg", 0.95);
  });

  // ---------- view tabs & compare slider ----------
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.view = t.dataset.view;
      applyView();
    }));

  function applyView() {
    const single = state.view !== "slider";
    el.compare.classList.toggle("single", single);
    const p = state.view === "before" ? 100 : state.view === "after" ? 0 : state.pos;
    paintPos(p);
  }
  function paintPos(p) {
    el.clip.style.clipPath = "inset(0 " + (100 - p) + "% 0 0)";
    el.handle.style.left = p + "%";
  }
  function setPos(p) { state.pos = clampN(p, 0, 100); if (state.view === "slider") paintPos(state.pos); }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  let dragging = false;
  const moveTo = (clientX) => {
    if (state.view !== "slider") return;
    const r = el.compare.getBoundingClientRect();
    setPos(((clientX - r.left) / r.width) * 100);
  };
  el.compare.addEventListener("pointerdown", (e) => { dragging = true; el.compare.setPointerCapture(e.pointerId); moveTo(e.clientX); });
  el.compare.addEventListener("pointermove", (e) => { if (dragging) moveTo(e.clientX); });
  el.compare.addEventListener("pointerup", () => (dragging = false));
  el.compare.addEventListener("pointercancel", () => (dragging = false));

  // ---------- rendering ----------
  function schedule(commit) {
    if (state.pending) return;
    state.pending = true;
    requestAnimationFrame(() => { state.pending = false; render(commit); });
  }

  function render(commit) {
    if (!state.src) return;
    el.busy.classList.remove("hidden");
    setTimeout(() => {
      const params = {
        intensity: +el.intensity.value, detail: +el.detail.value, grain: +el.grain.value,
      };
      const t0 = performance.now();
      let out;
      try {
        out = Effects.apply(state.effect, state.src, params);
      } catch (err) {
        console.error(err);
        el.busy.classList.add("hidden");
        alert("Something went wrong while applying the effect.");
        return;
      }
      const ms = performance.now() - t0;
      el.after.getContext("2d").putImageData(out, 0, 0);
      const after = Effects.analyze(out);
      updateStats(after, ms);
      if (commit) addHistory(params, ms);
      el.busy.classList.add("hidden");
      applyView();
    }, 20);
  }

  // ---------- analytics ----------
  function fmt(v, d) { return v.toFixed(d == null ? 1 : d); }
  function setCell(id, before, after, unit, decimals, isInt) {
    const delta = after - before;
    $("b-" + id).textContent = isInt ? before.toLocaleString() : fmt(before, decimals) + unit;
    $("a-" + id).textContent = isInt ? after.toLocaleString() : fmt(after, decimals) + unit;
    const d = $("d-" + id);
    const sign = delta > 0 ? "+" : "";
    d.textContent = isInt ? sign + Math.round(delta).toLocaleString() : sign + fmt(delta, decimals) + unit;
    d.className = delta > 0 ? "up" : delta < 0 ? "down" : "";
  }

  function updateStats(after, ms) {
    const b = state.beforeStats;
    $("s-effect").textContent = LABELS[state.effect];
    $("s-time").textContent = Math.round(ms) + " ms";
    setCell("bright", b.brightness, after.brightness, "%", 1);
    setCell("contrast", b.contrast, after.contrast, "%", 1);
    setCell("sat", b.saturation, after.saturation, "%", 1);
    setCell("edge", b.edge, after.edge, "%", 1);
    setCell("col", b.colors, after.colors, "", 0, true);
    drawHist(b.hist, after.hist);
  }

  function drawHist(hb, ha) {
    const c = el.hist, ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(0.0001, ...hb, ...ha);
    const bw = W / hb.length;
    ctx.globalCompositeOperation = "lighter";
    const bars = (arr, color) => {
      ctx.fillStyle = color;
      arr.forEach((v, i) => {
        const bh = (v / max) * (H - 10);
        ctx.fillRect(i * bw + 1, H - bh, bw - 2, bh);
      });
    };
    bars(hb, "rgba(79,140,255,0.75)");
    bars(ha, "rgba(255,95,168,0.75)");
    ctx.globalCompositeOperation = "source-over";
  }

  function addHistory(p, ms) {
    state.edits++;
    $("s-edits").textContent = String(state.edits);
    const li = document.createElement("li");
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    li.innerHTML = "<strong>" + LABELS[state.effect] + "</strong><small>Intensity " + p.intensity +
      " · Detail " + p.detail + " · Grain " + p.grain + " · " + Math.round(ms) + " ms · " + time + "</small>";
    el.history.prepend(li);
    while (el.history.children.length > 30) el.history.lastChild.remove();
  }

  // initial empty histogram
  drawHist(new Array(32).fill(0), new Array(32).fill(0));
})();
