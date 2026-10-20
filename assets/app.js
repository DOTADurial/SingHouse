(function () {
  "use strict";

  const MARKETS = { hdb: window.HDB_DATA, private: window.PRIVATE_DATA };
  const SEQ = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];
  const DIV = ["--div-neg-3", "--div-neg-2", "--div-neg-1", "--div-mid", "--div-pos-1", "--div-pos-2", "--div-pos-3"];
  const YOY_EDGES = [-0.08, -0.03, -0.01, 0.01, 0.05, 0.10]; // 7 classes
  const SLOTS = ["--s1", "--s2", "--s3"];
  const MAX_SELECTED = SLOTS.length;
  const ROW_H = 26;

  const $ = (id) => document.getElementById(id);

  let D, areaById;
  const state = {
    market: "hdb",
    type: "ALL",
    metric: "price",
    yi: 0,
    // area id -> colour slot; slot stays with the area until it is deselected
    selected: new Map(),
    timer: null,
  };

  // ------------------------------------------------------------------ data
  const cell = (id, type, yi) => (D.stats[id][type] || [])[yi] || null;
  const med = (id, type, yi) => { const c = cell(id, type, yi); return c ? c[1] : null; };
  const natCell = (type, yi) => D.national[type][yi];
  function yoy(get, yi) {
    if (yi < 1) return null;
    const a = get(yi), b = get(yi - 1);
    return a && b ? a / b - 1 : null;
  }
  const areaYoy = (id, type, yi) => yoy((i) => med(id, type, i), yi);
  const natYoy = (type, yi) => yoy((i) => (natCell(type, i) || [])[1], yi);
  const typeLabel = (t) => D.typeLabels[t] || t;
  const shortName = (a) => a.zh.split("/")[0]; // "D09 乌节/里峇峇利" -> "D09 乌节"

  // price colour breaks are fixed per type across all years so the animation shows growth
  function priceBreaks(type) {
    const vals = [];
    for (const a of D.areas) for (let i = 0; i < D.years.length; i++) { const v = med(a.id, type, i); if (v) vals.push(v); }
    vals.sort((a, b) => a - b);
    const lo = vals[0], hi = vals[vals.length - 1];
    const edges = [];
    for (let k = 1; k < SEQ.length; k++) edges.push(lo + ((hi - lo) * k) / SEQ.length);
    return { lo, hi, edges };
  }
  const classify = (v, edges) => { let k = 0; while (k < edges.length && v >= edges[k]) k++; return k; };

  // ------------------------------------------------------------------ format
  // HDB values are total prices (shown in 万); private values are SGD per square foot.
  const wan = (v) => (v / 10000).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "万";
  const short = (v) => (D.meta.unit === "psf" ? Math.round(v).toLocaleString("en-US") : wan(v));
  const money = (v) => (v == null ? "—" : "S$" + short(v) + (D.meta.unit === "psf" ? "/呎" : ""));
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

  function areaTipRows(id) {
    const c = cell(id, state.type, state.yi);
    return [
      { label: D.meta.metricLabel, value: money(c && c[1]) },
      { label: "25%–75% 分位", value: c ? money(c[0]) + " – " + money(c[2]) : "—" },
      { label: "同比", value: pct(areaYoy(id, state.type, state.yi)) },
      { label: "成交套数", value: num(c && c[3]) },
    ];
  }
  const areaTitle = (a) => `${a.zh} · ${a.name} · ${D.years[state.yi]}`;
  function hoverable(node, a) {
    const enter = (e) => showTip(e, areaTitle(a), areaTipRows(a.id));
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointermove", moveTip);
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", enter);
    node.addEventListener("blur", hideTip);
    node.addEventListener("click", () => toggleSelect(a.id));
  }

  // ------------------------------------------------------------------ tile map
  const tiles = new Map();
  function buildTiles() {
    const map = $("tilemap");
    map.replaceChildren();
    tiles.clear();
    const rows = Math.max(...D.areas.map((a) => a.row)) + 1;
    const grid = Array.from({ length: rows * 8 }, () => null);
    for (const a of D.areas) grid[a.row * 8 + a.col] = a;
    for (const a of grid) {
      if (!a) { const e = el("div", "tile empty"); e.setAttribute("aria-hidden", "true"); map.append(e); continue; }
      const b = el("button", "tile");
      b.type = "button";
      b.setAttribute("role", "listitem");
      b.append(el("span", "zh", shortName(a)), el("span", "en", a.name), el("span", "val"));
      hoverable(b, a);
      tiles.set(a.id, b);
      map.append(b);
    }
  }

  function renderMap() {
    const yr = D.years[state.yi];
    const what = state.metric === "price" ? D.meta.metricLabel : "同比涨幅";
    $("map-title").textContent = `${yr} 各${D.meta.areaLabel}${what} · ${typeLabel(state.type)}`;
    const pb = priceBreaks(state.type);
    for (const [id, b] of tiles) {
      const a = areaById[id];
      let v, cls, txt;
      if (state.metric === "price") {
        v = med(id, state.type, state.yi);
        cls = v == null ? null : SEQ[classify(v, pb.edges)];
        txt = v == null ? "—" : short(v);
      } else {
        v = areaYoy(id, state.type, state.yi);
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
      b.setAttribute("aria-label", `${a.zh} ${a.name}，${state.metric === "price" ? D.meta.metricLabel + " " + money(v) : "同比 " + txt}${slot != null ? "，已选中" : ""}`);
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

  function renderRegions() {
    $("region-heading").textContent = D.meta.regionHeading;
    const box = $("regions");
    box.replaceChildren();
    for (const r of Object.keys(D.regions)) {
      const s = D.regions[r][state.type] || [];
      const c = s[state.yi];
      const y = yoy((i) => (s[i] || [])[1], state.yi);
      const card = el("div", "region");
      const sub = el("div", "r-sub");
      sub.append(el("span", y == null ? null : y >= 0 ? "delta-up" : "delta-down", pct(y)), document.createTextNode(" 同比"));
      card.title = `${r} · ${num(c && c[3])} 套成交`;
      card.append(el("div", "r-name", D.regionLabels[r] || r), el("div", "r-val", money(c && c[1])), sub);
      box.append(card);
    }
  }

  // ------------------------------------------------------------------ ranking
  const rankRows = new Map();
  function buildRank() {
    const box = $("rank");
    box.replaceChildren();
    rankRows.clear();
    box.style.height = D.areas.length * ROW_H + "px";
    for (const a of D.areas) {
      const r = el("div", "rank-row");
      const track = el("div", "track");
      track.append(el("div", "band"), el("div", "dot"));
      r.append(el("div", "name", shortName(a)), track, el("div", "num"));
      r.tabIndex = 0;
      hoverable(r, a);
      rankRows.set(a.id, r);
      box.append(r);
    }
  }

  function renderRank() {
    const type = state.type, yi = state.yi;
    $("rank-hint").textContent = state.metric === "price"
      ? "条带 = 25%–75% 分位，圆点 = 中位数" : "相对上一年的中位数涨跌";
    const items = D.areas.map((a) => ({ id: a.id, c: cell(a.id, type, yi), y: areaYoy(a.id, type, yi) }));
    const key = state.metric === "price" ? (d) => (d.c ? d.c[1] : -Infinity) : (d) => (d.y == null ? -Infinity : d.y);
    items.sort((a, b) => key(b) - key(a));

    // fixed x-scales across years for the selected type
    let lo = Infinity, hi = -Infinity, yLo = -0.1, yHi = 0.2;
    for (const a of D.areas) for (let i = 0; i < D.years.length; i++) {
      const c = cell(a.id, type, i); if (c) { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[2]); }
      const v = areaYoy(a.id, type, i); if (v != null) { yLo = Math.min(yLo, v); yHi = Math.max(yHi, v); }
    }
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    const xy = (v) => ((v - yLo) / (yHi - yLo)) * 100;

    items.forEach((d, i) => {
      const r = rankRows.get(d.id);
      r.style.transform = `translateY(${i * ROW_H}px)`;
      r.classList.toggle("selected", state.selected.has(d.id));
      const band = r.querySelector(".band"), dot = r.querySelector(".dot");
      if (state.metric === "price") {
        band.hidden = dot.hidden = !d.c;
        if (d.c) {
          band.style.left = x(d.c[0]) + "%"; band.style.width = (x(d.c[2]) - x(d.c[0])) + "%";
          dot.style.left = x(d.c[1]) + "%";
        }
        band.style.background = ""; band.style.borderRadius = "";
        r.querySelector(".num").textContent = d.c ? short(d.c[1]) : "—";
      } else {
        dot.hidden = true;
        band.hidden = d.y == null;
        if (d.y != null) {
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
    const span = hi - lo || 1, raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return { ticks: out, lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
  }

  function trendSeries() {
    const type = state.type;
    const series = [{ id: "__ALL__", label: "全国", color: cssVar("--s0"), values: D.years.map((_, i) => (natCell(type, i) || [])[1] || null), dashed: true }];
    for (const [id, slot] of [...state.selected].sort((a, b) => a[1] - b[1])) {
      const a = areaById[id];
      series.push({ id, label: shortName(a), color: cssVar(SLOTS[slot]), values: D.years.map((_, i) => med(id, type, i)) });
    }
    return series;
  }

  function renderTrend() {
    $("trend-title").textContent = `历年走势 · ${D.meta.metricLabel}`;
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

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${typeLabel(state.type)}${D.meta.metricLabel}历年走势` }, box);
    const axis = svg("g", { class: "axis" }, root);
    for (const v of yt.ticks) {
      svg("line", { class: "gridline", x1: m.left, x2: m.left + iw, y1: Y(v), y2: Y(v) }, axis);
      svg("text", { x: m.left - 8, y: Y(v) + 4, "text-anchor": "end" }, axis).textContent = short(v);
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
      showTip(evt, `${D.years[i]} · ${typeLabel(state.type)}`, rows);
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
      if (s.id !== "__ALL__") {
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
    const ranked = D.areas.map((a) => ({ a, v: med(a.id, type, yi) })).filter((d) => d.v != null).sort((a, b) => b.v - a.v);
    const top = ranked[0], bottom = ranked[ranked.length - 1];
    const kpi = (label, value, sub, cls) => {
      const k = el("div", "kpi");
      k.append(el("div", "label", label));
      const v = el("div", "value", value); if (cls) v.classList.add(cls); k.append(v);
      k.append(el("div", "sub", sub));
      return k;
    };
    $("kpis").replaceChildren(
      kpi(`全国${D.meta.metricLabel} · ${D.years[yi]}`, money(nc && nc[1]), typeLabel(type)),
      kpi("同比变化", pct(y), yi > 0 ? `对比 ${D.years[yi - 1]}` : "首年无对比", y == null ? null : y >= 0 ? "delta-up" : "delta-down"),
      kpi(`最贵${D.meta.areaLabel}`, top ? shortName(top.a) : "—", top ? money(top.v) : ""),
      kpi(`最亲民${D.meta.areaLabel}`, bottom ? shortName(bottom.a) : "—", bottom ? money(bottom.v) : ""),
      kpi("成交套数", num(nc && nc[3]), "全年"),
    );
  }

  // ------------------------------------------------------------------ table
  function renderTable() {
    const tb = $("data-table");
    tb.replaceChildren();
    const head = el("tr");
    head.append(el("th", null, `${D.meta.areaLabel}（${typeLabel(state.type)}${D.meta.metricLabel}）`));
    for (const y of D.years) head.append(el("th", null, y));
    const thead = el("thead"); thead.append(head);
    const tbody = el("tbody");
    const sorted = [...D.areas].sort((a, b) => (D.meta.unit === "psf" ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)));
    for (const a of sorted) {
      const tr = el("tr");
      tr.append(el("td", null, `${a.zh} ${a.name}`));
      D.years.forEach((_, i) => tr.append(el("td", null, money(med(a.id, state.type, i)))));
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

  function setMarket(market) {
    stop();
    state.market = market;
    D = MARKETS[market];
    areaById = Object.fromEntries(D.areas.map((a) => [a.id, a]));
    state.type = "ALL";
    state.yi = D.years.length - 1;
    state.selected = new Map(D.meta.defaults.filter((id) => areaById[id]).map((id, i) => [id, i]));

    document.querySelectorAll("[data-market]").forEach((b) => b.setAttribute("aria-checked", b.dataset.market === market ? "true" : "false"));
    $("subtitle").textContent = `${D.meta.title} · 按${D.meta.areaLabel} · ${D.years[0]}–${D.years[D.years.length - 1]}`;
    $("type-label").textContent = D.meta.typeLabel;
    const sel = $("type-select");
    sel.replaceChildren();
    for (const t of D.types) { const o = el("option", null, typeLabel(t)); o.value = t; sel.append(o); }
    sel.value = state.type;
    const slider = $("year-slider");
    slider.min = 0; slider.max = D.years.length - 1;
    $("map-hint").textContent = `点击${D.meta.areaLabel}加入下方走势对比（最多 3 个）`;
    $("source").textContent = D.meta.source;
    $("generated").textContent = D.meta.generated;
    $("sample-note").hidden = !D.meta.sample;
    $("sample-cmd").textContent = market === "hdb"
      ? "python3 scripts/build_data.py hdb --csv resale.csv"
      : "python3 scripts/build_data.py private --ura-json ura.json";
    $("sample-source").textContent = market === "hdb" ? "data.gov.sg 官方成交数据" : "URA 官方成交数据";
    $("unit-note").hidden = D.meta.unit !== "psf";

    buildTiles();
    buildRank();
    render();
    renderTable();
    try { history.replaceState(null, "", market === "hdb" ? location.pathname + location.search : "#private"); } catch (e) { /* file:// etc. */ }
  }

  function initControls() {
    document.querySelectorAll("[data-market]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.market !== state.market) setMarket(b.dataset.market);
    }));

    $("type-select").addEventListener("change", (e) => { state.type = e.target.value; render(); renderTable(); });

    document.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
      state.metric = b.dataset.metric;
      document.querySelectorAll("[data-metric]").forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
      render();
    }));

    $("year-slider").addEventListener("input", (e) => { stop(); setYear(+e.target.value); });
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
  initControls();
  setMarket(location.hash === "#private" && MARKETS.private ? "private" : "hdb");
})();
