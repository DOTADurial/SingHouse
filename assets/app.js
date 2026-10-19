(function () {
  "use strict";

  const D = window.HDB_DATA;
  const TYPE_LABELS = { "ALL": "全部户型", "3 ROOM": "三房式", "4 ROOM": "四房式", "5 ROOM": "五房式", "EXECUTIVE": "公寓式 (EA)" };
  const SEQ = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];
  const DIV = ["--div-neg-3", "--div-neg-2", "--div-neg-1", "--div-mid", "--div-pos-1", "--div-pos-2", "--div-pos-3"];
  const YOY_EDGES = [-0.08, -0.03, -0.01, 0.01, 0.05, 0.10]; // 7 classes
  const SLOTS = ["--s1", "--s2", "--s3"];
  const MAX_SELECTED = SLOTS.length;
  const ROW_H = 26;

  const $ = (id) => document.getElementById(id);
  const townById = Object.fromEntries(D.towns.map((t) => [t.id, t]));

  const state = {
    type: "ALL",
    metric: "price",
    yi: D.years.length - 1,
    // town id -> colour slot; slot stays with the town until it is deselected
    selected: new Map([["QUEENSTOWN", 0], ["PUNGGOL", 1], ["WOODLANDS", 2]]),
    timer: null,
  };

  // ------------------------------------------------------------------ data
  const cell = (town, type, yi) => (D.stats[town][type] || [])[yi] || null;
  const med = (town, type, yi) => { const c = cell(town, type, yi); return c ? c[1] : null; };
  const natCell = (type, yi) => D.national[type][yi];
  function yoy(get, yi) {
    if (yi < 1) return null;
    const a = get(yi), b = get(yi - 1);
    return a && b ? a / b - 1 : null;
  }
  const townYoy = (town, type, yi) => yoy((i) => med(town, type, i), yi);
  const natYoy = (type, yi) => yoy((i) => (natCell(type, i) || [])[1], yi);

  // price colour breaks are fixed per flat type across all years so the animation shows growth
  function priceBreaks(type) {
    const vals = [];
    for (const t of D.towns) for (let i = 0; i < D.years.length; i++) { const v = med(t.id, type, i); if (v) vals.push(v); }
    vals.sort((a, b) => a - b);
    const lo = vals[0], hi = vals[vals.length - 1];
    const edges = [];
    for (let k = 1; k < SEQ.length; k++) edges.push(lo + ((hi - lo) * k) / SEQ.length);
    return { lo, hi, edges };
  }
  const classify = (v, edges) => { let k = 0; while (k < edges.length && v >= edges[k]) k++; return k; };

  // ------------------------------------------------------------------ format
  const wan = (v) => (v / 10000).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "万";
  const money = (v) => (v == null ? "—" : "S$" + wan(v));
  const pct = (v, digits = 1) => (v == null ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(digits) + "%");
  const num = (v) => (v == null ? "—" : v.toLocaleString("zh-CN"));

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function inkFor(bg) {
    const m = bg.match(/^#([0-9a-f]{6})$/i);
    if (!m) return "";
    const n = parseInt(m[1], 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.33 ? "#0b0b0b" : "#ffffff";
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ tooltip
  const tip = $("tooltip");
  function showTip(evt, title, rows) {
    tip.replaceChildren(el("div", "t-title", title));
    for (const r of rows) {
      const row = el("div", "t-row");
      const label = el("span");
      if (r.color) { const k = el("i"); k.style.background = r.color; label.append(k); }
      label.append(document.createTextNode(r.label));
      row.append(label, el("b", null, r.value));
      tip.append(row);
    }
    tip.hidden = false;
    moveTip(evt);
  }
  function moveTip(evt) {
    let x, y;
    if (evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
    else { const r = evt.currentTarget.getBoundingClientRect(); x = r.right; y = r.top; }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(x + 14, window.innerWidth - w - 8) + "px";
    tip.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - h - 8)) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  function townTipRows(id) {
    const c = cell(id, state.type, state.yi);
    return [
      { label: "中位价", value: money(c && c[1]) },
      { label: "25%–75% 分位", value: c ? money(c[0]) + " – " + money(c[2]) : "—" },
      { label: "同比", value: pct(townYoy(id, state.type, state.yi)) },
      { label: "成交套数", value: num(c && c[3]) },
    ];
  }
  const townTitle = (t) => `${t.zh} ${t.name} · ${D.years[state.yi]}`;

  // ------------------------------------------------------------------ tile map
  const tiles = new Map();
  function buildTiles() {
    const map = $("tilemap");
    const rows = Math.max(...D.towns.map((t) => t.row)) + 1;
    const grid = Array.from({ length: rows * 8 }, () => null);
    for (const t of D.towns) grid[t.row * 8 + t.col] = t;
    for (const t of grid) {
      if (!t) { const e = el("div", "tile empty"); e.setAttribute("aria-hidden", "true"); map.append(e); continue; }
      const b = el("button", "tile");
      b.type = "button";
      b.setAttribute("role", "listitem");
      b.append(el("span", "zh", t.zh), el("span", "en", t.name), el("span", "val"));
      b.addEventListener("click", () => toggleSelect(t.id));
      const enter = (e) => showTip(e, townTitle(t), townTipRows(t.id));
      b.addEventListener("pointerenter", enter);
      b.addEventListener("pointermove", moveTip);
      b.addEventListener("pointerleave", hideTip);
      b.addEventListener("focus", enter);
      b.addEventListener("blur", hideTip);
      tiles.set(t.id, b);
      map.append(b);
    }
  }

  function renderMap() {
    const yr = D.years[state.yi];
    const label = TYPE_LABELS[state.type];
    $("map-title").textContent = state.metric === "price" ? `${yr} 各市镇中位价 · ${label}` : `${yr} 各市镇同比涨幅 · ${label}`;
    const pb = priceBreaks(state.type);
    for (const [id, b] of tiles) {
      const t = townById[id];
      let v, cls, txt;
      if (state.metric === "price") {
        v = med(id, state.type, state.yi);
        cls = v == null ? null : SEQ[classify(v, pb.edges)];
        txt = v == null ? "—" : wan(v);
      } else {
        v = townYoy(id, state.type, state.yi);
        cls = v == null ? null : DIV[classify(v, YOY_EDGES)];
        txt = pct(v);
      }
      const bg = cls ? cssVar(cls) : cssVar("--grid");
      b.style.backgroundColor = bg;
      b.style.color = cls ? inkFor(bg) : cssVar("--muted");
      b.querySelector(".val").textContent = txt;
      const slot = state.selected.get(id);
      b.classList.toggle("selected", slot != null);
      b.style.setProperty("--sel", slot != null ? cssVar(SLOTS[slot]) : "");
      b.setAttribute("aria-label", `${t.zh} ${t.name}，${state.metric === "price" ? "中位价 " + money(v) : "同比 " + txt}${slot != null ? "，已选中" : ""}`);
      b.setAttribute("aria-pressed", slot != null ? "true" : "false");
    }
    renderLegend(pb);
  }

  function renderLegend(pb) {
    const lg = $("legend");
    lg.replaceChildren();
    const ramp = el("div", "ramp");
    const steps = state.metric === "price" ? SEQ : DIV;
    for (const v of steps) { const s = el("span"); s.style.background = cssVar(v); ramp.append(s); }
    if (state.metric === "price") {
      lg.append(el("span", null, money(pb.lo)), ramp, el("span", null, money(pb.hi)), el("span", null, "（色阶在各年份间固定）"));
    } else {
      lg.append(el("span", null, "≤ -8%"), ramp, el("span", null, "≥ +10%"), el("span", null, "灰色 = ±1% 以内"));
    }
  }

  const REGION_ZH = { "Central": "中部", "North": "北部", "North-East": "东北部", "East": "东部", "West": "西部" };
  function renderRegions() {
    const box = $("regions");
    box.replaceChildren();
    if (!D.regions) return;
    for (const r of Object.keys(D.regions)) {
      const s = D.regions[r][state.type] || [];
      const c = s[state.yi];
      const y = yoy((i) => (s[i] || [])[1], state.yi);
      const card = el("div", "region");
      const sub = el("div", "r-sub");
      const d = el("span", y == null ? null : y >= 0 ? "delta-up" : "delta-down", pct(y));
      sub.append(d, document.createTextNode(" 同比"));
      card.title = `${r} · ${num(c && c[3])} 套成交`;
      card.append(el("div", "r-name", REGION_ZH[r] || r), el("div", "r-val", money(c && c[1])), sub);
      box.append(card);
    }
  }

  // ------------------------------------------------------------------ ranking
  const rankRows = new Map();
  function buildRank() {
    const box = $("rank");
    box.style.height = D.towns.length * ROW_H + "px";
    for (const t of D.towns) {
      const r = el("div", "rank-row");
      const track = el("div", "track");
      track.append(el("div", "band"), el("div", "dot"));
      r.append(el("div", "name", t.zh), track, el("div", "num"));
      r.tabIndex = 0;
      const enter = (e) => showTip(e, townTitle(t), townTipRows(t.id));
      r.addEventListener("pointerenter", enter);
      r.addEventListener("pointermove", moveTip);
      r.addEventListener("pointerleave", hideTip);
      r.addEventListener("focus", enter);
      r.addEventListener("blur", hideTip);
      r.addEventListener("click", () => toggleSelect(t.id));
      rankRows.set(t.id, r);
      box.append(r);
    }
  }

  function renderRank() {
    const type = state.type, yi = state.yi;
    const items = D.towns.map((t) => ({
      id: t.id,
      c: cell(t.id, type, yi),
      y: townYoy(t.id, type, yi),
    }));
    const key = state.metric === "price" ? (d) => (d.c ? d.c[1] : -Infinity) : (d) => (d.y == null ? -Infinity : d.y);
    items.sort((a, b) => key(b) - key(a));

    // fixed x-scale across years for the selected flat type
    let lo = Infinity, hi = -Infinity;
    for (const t of D.towns) for (let i = 0; i < D.years.length; i++) {
      const c = cell(t.id, type, i); if (c) { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[2]); }
    }
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    let yLo = -0.1, yHi = 0.2;
    for (const t of D.towns) for (let i = 1; i < D.years.length; i++) {
      const v = townYoy(t.id, type, i); if (v != null) { yLo = Math.min(yLo, v); yHi = Math.max(yHi, v); }
    }
    const xy = (v) => ((v - yLo) / (yHi - yLo)) * 100;

    items.forEach((d, i) => {
      const r = rankRows.get(d.id);
      r.style.transform = `translateY(${i * ROW_H}px)`;
      r.classList.toggle("selected", state.selected.has(d.id));
      const band = r.querySelector(".band"), dot = r.querySelector(".dot");
      if (state.metric === "price") {
        if (d.c) {
          band.style.left = x(d.c[0]) + "%"; band.style.width = (x(d.c[2]) - x(d.c[0])) + "%";
          dot.style.left = x(d.c[1]) + "%"; dot.hidden = false; band.hidden = false;
        } else { band.hidden = true; dot.hidden = true; }
        band.style.background = ""; band.style.borderRadius = "";
        r.querySelector(".num").textContent = d.c ? wan(d.c[1]) : "—";
      } else {
        dot.hidden = true;
        if (d.y == null) { band.hidden = true; }
        else {
          band.hidden = false;
          const a = xy(Math.min(0, d.y)), b = xy(Math.max(0, d.y));
          band.style.left = a + "%"; band.style.width = Math.max(0.5, b - a) + "%";
          band.style.background = cssVar(d.y >= 0 ? "--div-pos-2" : "--div-neg-2");
          band.style.borderRadius = d.y >= 0 ? "0 4px 4px 0" : "4px 0 0 4px";
        }
        r.querySelector(".num").textContent = pct(d.y);
      }
    });
  }

  // ------------------------------------------------------------------ trend
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  }
  function niceTicks(lo, hi, count) {
    const span = hi - lo, raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return { ticks: out, lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
  }

  function trendSeries() {
    const type = state.type;
    const series = [{ id: "__SG__", label: "全国", color: cssVar("--s0"), values: D.years.map((_, i) => (natCell(type, i) || [])[1] || null), dashed: true }];
    for (const [id, slot] of [...state.selected].sort((a, b) => a[1] - b[1])) {
      const t = townById[id];
      series.push({ id, label: t.zh, color: cssVar(SLOTS[slot]), values: D.years.map((_, i) => med(id, type, i)) });
    }
    return series;
  }

  function renderTrend() {
    const box = $("trend");
    box.replaceChildren();
    const series = trendSeries();
    const W = box.clientWidth, H = box.clientHeight;
    const m = { top: 12, right: 72, bottom: 26, left: 52 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const yt = niceTicks(Math.min(...all), Math.max(...all), 5);
    const X = (i) => m.left + (D.years.length === 1 ? iw / 2 : (i / (D.years.length - 1)) * iw);
    const Y = (v) => m.top + ih - ((v - yt.lo) / (yt.hi - yt.lo)) * ih;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${TYPE_LABELS[state.type]}中位价历年走势` }, box);
    const axis = svg("g", { class: "axis" }, root);
    for (const v of yt.ticks) {
      svg("line", { class: "gridline", x1: m.left, x2: m.left + iw, y1: Y(v), y2: Y(v) }, axis);
      svg("text", { x: m.left - 8, y: Y(v) + 4, "text-anchor": "end" }, axis).textContent = wan(v);
    }
    const every = iw < 420 ? 2 : 1;
    D.years.forEach((yr, i) => {
      if (i % every && i !== D.years.length - 1) return;
      svg("text", { x: X(i), y: H - 6, "text-anchor": "middle" }, axis).textContent = yr;
    });
    svg("line", { class: "now", x1: X(state.yi), x2: X(state.yi), y1: m.top, y2: m.top + ih }, root);

    const labels = [];
    for (const s of series) {
      let d = "", pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
        pen = true;
      });
      svg("path", { class: "line", d, stroke: s.color, "stroke-dasharray": s.dashed ? "5 4" : "" }, root);
      const v = s.values[state.yi];
      if (v != null) svg("circle", { cx: X(state.yi), cy: Y(v), r: 4.5, fill: s.color, stroke: cssVar("--surface"), "stroke-width": 2 }, root);
      const lastI = s.values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
      if (lastI != null) labels.push({ y: Y(s.values[lastI]), text: s.label, x: X(lastI) + 8 });
    }
    // direct end labels, nudged apart so they never overlap
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) svg("text", { class: "end-label", x: l.x, y: l.y + 4 }, root).textContent = l.text;

    // crosshair layer
    const cross = svg("line", { class: "cross", y1: m.top, y2: m.top + ih, visibility: "hidden" }, root);
    const hit = svg("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent", tabindex: 0 }, root);
    const at = (i, evt) => {
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      const rows = series.map((s) => ({ label: s.label, value: money(s.values[i]), color: s.color, v: s.values[i] ?? -1 }))
        .sort((a, b) => b.v - a.v);
      showTip(evt, `${D.years[i]} · ${TYPE_LABELS[state.type]}`, rows);
    };
    const nearest = (evt) => {
      const r = root.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(D.years.length - 1, Math.round(((px - m.left) / iw) * (D.years.length - 1))));
    };
    hit.addEventListener("pointermove", (e) => at(nearest(e), e));
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    hit.addEventListener("click", (e) => { setYear(nearest(e)); });
    hit.addEventListener("focus", (e) => at(state.yi, e));
    hit.addEventListener("blur", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });

    // legend (always present when ≥ 2 series)
    const lg = $("trend-legend");
    lg.replaceChildren();
    for (const s of series) {
      const it = el("span");
      const key = el("i"); key.style.background = s.color;
      it.append(key, document.createTextNode(s.label));
      if (s.id !== "__SG__") {
        const x = el("button", null, "×");
        x.type = "button"; x.setAttribute("aria-label", "移除 " + s.label);
        x.addEventListener("click", () => toggleSelect(s.id));
        it.append(x);
      }
      lg.append(it);
    }
  }

  // ------------------------------------------------------------------ KPIs
  function renderKpis() {
    const type = state.type, yi = state.yi;
    const nc = natCell(type, yi);
    const y = natYoy(type, yi);
    const ranked = D.towns.map((t) => ({ t, v: med(t.id, type, yi) })).filter((d) => d.v != null).sort((a, b) => b.v - a.v);
    const top = ranked[0], bottom = ranked[ranked.length - 1];
    const kpi = (label, value, sub, cls) => {
      const k = el("div", "kpi");
      k.append(el("div", "label", label));
      const v = el("div", "value", value); if (cls) v.classList.add(cls); k.append(v);
      k.append(el("div", "sub", sub));
      return k;
    };
    $("kpis").replaceChildren(
      kpi(`全国中位价 · ${D.years[yi]}`, money(nc && nc[1]), TYPE_LABELS[type]),
      kpi("同比变化", pct(y), yi > 0 ? `对比 ${D.years[yi - 1]}` : "首年无对比", y == null ? null : y >= 0 ? "delta-up" : "delta-down"),
      kpi("最贵市镇", top ? top.t.zh : "—", top ? money(top.v) : ""),
      kpi("最亲民市镇", bottom ? bottom.t.zh : "—", bottom ? money(bottom.v) : ""),
      kpi("成交套数", num(nc && nc[3]), "全年转售"),
    );
  }

  // ------------------------------------------------------------------ table
  function renderTable() {
    const tb = $("data-table");
    tb.replaceChildren();
    const head = el("tr");
    head.append(el("th", null, `市镇（${TYPE_LABELS[state.type]}中位价）`));
    for (const y of D.years) head.append(el("th", null, y));
    const thead = el("thead"); thead.append(head);
    const tbody = el("tbody");
    for (const t of [...D.towns].sort((a, b) => a.name.localeCompare(b.name))) {
      const tr = el("tr");
      tr.append(el("td", null, `${t.zh} ${t.name}`));
      D.years.forEach((_, i) => tr.append(el("td", null, money(med(t.id, state.type, i)))));
      tbody.append(tr);
    }
    const tr = el("tr");
    tr.append(el("td", null, "全国"));
    D.years.forEach((_, i) => tr.append(el("td", null, money((natCell(state.type, i) || [])[1]))));
    tbody.append(tr);
    tb.append(thead, tbody);
  }

  // ------------------------------------------------------------------ actions
  function render() {
    $("year-label").textContent = D.years[state.yi];
    $("year-slider").value = state.yi;
    renderMap();
    renderRegions();
    renderRank();
    renderTrend();
    renderKpis();
  }
  function setYear(i) { state.yi = i; render(); }
  function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else {
      if (state.selected.size >= MAX_SELECTED) state.selected.delete([...state.selected.keys()][0]);
      const used = new Set(state.selected.values());
      state.selected.set(id, [0, 1, 2].find((s) => !used.has(s)));
    }
    render();
  }
  function stop() {
    clearInterval(state.timer); state.timer = null;
    $("play").textContent = "▶"; $("play").setAttribute("aria-label", "播放");
  }
  function play() {
    if (state.yi >= D.years.length - 1) setYear(0);
    $("play").textContent = "❚❚"; $("play").setAttribute("aria-label", "暂停");
    state.timer = setInterval(() => {
      if (state.yi >= D.years.length - 1) return stop();
      setYear(state.yi + 1);
    }, 1300);
  }

  function initControls() {
    const sel = $("type-select");
    for (const t of D.types) { const o = el("option", null, TYPE_LABELS[t] || t); o.value = t; sel.append(o); }
    sel.addEventListener("change", () => { state.type = sel.value; render(); renderTable(); });

    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      state.metric = b.dataset.metric;
      document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
      render();
    }));

    const slider = $("year-slider");
    slider.min = 0; slider.max = D.years.length - 1;
    slider.addEventListener("input", () => { stop(); setYear(+slider.value); });
    $("play").addEventListener("click", () => (state.timer ? stop() : play()));

    const root = document.documentElement;
    try { const saved = localStorage.getItem("singhouse-theme"); if (saved) root.dataset.theme = saved; } catch (e) { /* storage unavailable */ }
    $("theme-toggle").addEventListener("click", () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("singhouse-theme", root.dataset.theme); } catch (e) { /* ignore */ }
      render();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderTrend, 120); });
  }

  // ------------------------------------------------------------------ boot
  $("year-span").textContent = `${D.years[0]}–${D.years[D.years.length - 1]}`;
  $("source").textContent = D.meta.source;
  $("generated").textContent = D.meta.generated;
  $("sample-note").hidden = !D.meta.sample;
  initControls();
  buildTiles();
  buildRank();
  render();
  renderTable();
})();
