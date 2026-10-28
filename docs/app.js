(() => {
  "use strict";

  // ── 표 이름(수집기의 table_key) ─────────────────────────────
  const T = {
    G: "일반현황_임직원현황",
    S: "일반현황_회원조합수 현황",
    AS: "재무현황_요약재무상태표(자산)",
    LE: "재무현황_요약재무상태표(부채및자본)",
    PL: "재무현황_요약손익계산서",
    FU: "재무현황_주요자금조달및운용",
    Q: "주요경영지표_여신건전성",
    P: "주요경영지표_수익성",
    L: "주요경영지표_유동성",
  };
  const TABS = [
    { id: "gen", label: "일반현황", tables: [[T.G, "임직원·조합원"]] },
    { id: "bs", label: "재무상태표", tables: [[T.AS, "자산"], [T.LE, "부채 및 자본"]] },
    { id: "pl", label: "손익계산서", tables: [[T.PL, "요약 손익계산서"]] },
    { id: "fund", label: "자금조달·운용", tables: [[T.FU, "주요 자금조달 및 운용"]] },
    { id: "kmi", label: "경영지표", tables: [[T.Q, "여신건전성"], [T.P, "수익성"], [T.L, "유동성"]] },
  ];
  const KPIS = [
    { label: "자산총계", t: T.AS, c: "A" },
    { label: "예수부채", t: T.LE, c: "A1" },
    { label: "대출채권", t: T.AS, c: "A3" },
    { label: "당기순이익", t: T.PL, c: "A", note: "6월은 상반기 누적" },
    { label: "고정이하여신비율", t: T.Q, c: "C", note: "낮을수록 건전" },
    { label: "예대율", t: T.L, c: "C" },
    { label: "유동성비율", t: T.L, c: "B" },
    { label: "조합원", t: T.G, c: "B" },
  ];
  const MAX_LIST = 50;

  // ── 상태 ───────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const qEl = $("q"), statusEl = $("status"), resEl = $("results"), detEl = $("detail");
  let INDEX = null, CODES = {}, LIST = [];
  const coopCache = new Map();
  const view = { coop: null, ym: null, months: [], tab: "gen", metric: KPIS[0], hideZero: true };

  // ── 유틸 ───────────────────────────────────────────────────
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
  const ymShort = (ym) => `${ym.slice(2, 4)}.${ym.slice(4)}`;
  const nf = (d) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d });
  const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);  // 텍스트는 노드로만 → XSS 방지
    return e;
  }
  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };

  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("err", isErr);
  }

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path} (${r.status})`);
    return r.json();
  }

  // ── 항목 이름·단위 ─────────────────────────────────────────
  const codeName = (t, c) => (CODES[t] && CODES[t][c]) || c;
  const clean = (s) => s.replace(/^임 원/, "임원").replace(/^직 원/, "직원");
  function kindOf(t, c) {
    if (t === T.G) return "cnt";
    if (t === T.S) return "num";
    const n = codeName(t, c);
    if (n.includes("_")) return "won";
    return /(율|비율\(|ROA|ROE)/.test(n) ? "pct" : "won";
  }
  function fmt(v, kind, short = false) {
    if (v == null) return "-";
    if (kind === "pct") return `${NF2.format(v)}%`;
    if (kind === "cnt") return `${NF0.format(v)}${short ? "명" : ""}`;
    if (kind === "num") return NF0.format(v);
    const eok = v / 1e8;                                   // 원 → 억원
    if (short) return `${Math.abs(eok) >= 100 ? NF0.format(eok) : NF1.format(eok)}억`;
    return Math.abs(eok) >= 10 || eok === 0 ? NF0.format(eok) : NF1.format(eok);
  }
  const unitLabel = (kind) => ({ pct: "%", cnt: "명", num: "", won: "억원" })[kind];

  function rowsOf(coop, ym, t) {
    const rows = (coop.d[ym] && coop.d[ym][t]) || [];
    return rows.map(([c, v, r]) => {
      const name = clean(codeName(t, c));
      const parts = name.split("_");
      return { c, v, r, name, label: parts[parts.length - 1], depth: parts.length - 1 };
    });
  }
  const valueOf = (coop, ym, t, c) => {
    const row = coop.d[ym] && coop.d[ym][t] && coop.d[ym][t].find((r) => r[0] === c);
    return row ? row[1] : null;
  };

  // ── 검색 ───────────────────────────────────────────────────
  function highlight(name, q) {
    const nq = norm(q);
    if (!nq) return name;
    const chars = [...name], map = [];
    let flat = "";
    chars.forEach((ch, i) => { if (!/\s/.test(ch)) { flat += ch.toLowerCase(); map.push(i); } });
    const at = flat.indexOf(nq);
    if (at < 0) return name;
    const s = map[at], e = map[at + nq.length - 1] + 1;
    return [chars.slice(0, s).join(""), el("mark", {}, chars.slice(s, e).join("")), chars.slice(e).join("")];
  }

  function search({ push = true } = {}) {
    const q = qEl.value.trim().slice(0, 30);
    detEl.hidden = true;
    view.coop = null;
    if (push) setURL({ q });
    if (!q) {
      resEl.replaceChildren();
      setStatus(`전국 ${NF0.format(LIST.length)}개 조합 · ${ymLabel(INDEX.months[INDEX.months.length - 1])}~${ymLabel(INDEX.latest)} 자료. 조합명을 입력하세요.`);
      return;
    }
    const nq = norm(q);
    const rank = (c) => (c.k === nq ? 0 : c.k.startsWith(nq) ? 1 : 2);
    const hits = LIST.filter((c) => c.k.includes(nq))
      .sort((a, b) => rank(a) - rank(b) || a.nm.localeCompare(b.nm, "ko"));

    if (!hits.length) {
      resEl.replaceChildren();
      setStatus(`‘${q}’에 해당하는 조합이 없습니다.`);
      return;
    }
    setStatus(hits.length > MAX_LIST
      ? `${NF0.format(hits.length)}곳 중 ${MAX_LIST}곳만 표시합니다. 조합명을 더 구체적으로 입력해 보세요.`
      : `${hits.length}곳 검색됨 · 조합을 선택하세요`);
    const dupes = new Map();
    for (const h of hits) dupes.set(h.nm, (dupes.get(h.nm) || 0) + 1);
    resEl.replaceChildren(el("ul", { class: "hits" }, ...hits.slice(0, MAX_LIST).map((h) =>
      el("li", {}, el("button", { type: "button", class: "hit", onclick: () => openCoop(h.cd) },
        el("span", { class: "hit-nm" }, highlight(h.nm, q)),
        el("span", { class: "hit-meta" },
          dupes.get(h.nm) > 1 ? `금융회사코드 ${h.cd}` : `최신 ${ymShort(h.ym)}`),
        el("span", { class: "hit-go", "aria-hidden": "true" }, "›"))))));
  }

  // ── 상세 ───────────────────────────────────────────────────
  async function openCoop(cd, { push = true, ym = null, tab = null } = {}) {
    setStatus("조합 자료를 불러오는 중…");
    let coop = coopCache.get(cd);
    try {
      if (!coop) {
        coop = await getJSON(`data/coop/${encodeURIComponent(cd.replace(/[^0-9A-Za-z]/g, ""))}.json`);
        coopCache.set(cd, coop);
      }
    } catch {
      setStatus("조합 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
      return;
    }
    const months = Object.keys(coop.d).sort().reverse();
    view.coop = coop;
    view.months = months;
    view.ym = ym && months.includes(ym) ? ym : months[0];
    view.tab = tab && TABS.some((t) => t.id === tab) ? tab : "gen";
    view.metric = KPIS[0];
    if (push) setURL({ c: cd });
    setStatus("");
    resEl.replaceChildren();
    detEl.hidden = false;                                  // 먼저 보이게 해야 폭을 잴 수 있음
    renderDetail();
    if (push) detEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function detailURL() {
    return { c: view.coop.cd, ym: view.ym === view.months[0] ? null : view.ym, tab: view.tab === "gen" ? null : view.tab };
  }

  function renderDetail() {
    const { coop, ym, months } = view;
    const back = qEl.value.trim()
      ? el("button", { type: "button", class: "back", onclick: () => { setURL({ q: qEl.value.trim() }); search({ push: false }); } }, "‹ 검색 결과")
      : null;
    const sel = el("select", { "aria-label": "기준년월", onchange: (e) => { view.ym = e.target.value; setURL(detailURL(), true); renderDetail(); } },
      months.map((m) => el("option", { value: m, selected: m === ym }, `${ymLabel(m)} 기준`)));

    const head = el("div", { class: "d-head" },
      back,
      el("div", { class: "d-title" },
        el("h2", {}, coop.nm),
        el("p", { class: "meta" }, `금융회사코드 ${coop.cd}`, coop.crno ? ` · 법인등록번호 ${coop.crno}` : "")),
      sel);

    // 핵심 수치 (누르면 추이 그래프 전환)
    const kpis = el("div", { class: "kpis" }, KPIS.map((k) => {
      const kind = kindOf(k.t, k.c);
      const v = valueOf(coop, ym, k.t, k.c);
      const active = view.metric.t === k.t && view.metric.c === k.c;
      return el("button", { type: "button", class: "kpi" + (active ? " on" : ""), "aria-pressed": active ? "true" : "false",
        title: `${k.label} 추이 보기`, onclick: () => { view.metric = k; renderDetail(); } },
        el("span", { class: "kpi-l" }, k.label),
        el("span", { class: "kpi-v" + (v < 0 ? " neg" : "") }, fmt(v, kind, true)),
        k.note ? el("span", { class: "kpi-n" }, k.note) : null);
    }));

    detEl.replaceChildren(head, kpis, renderTrend(), renderTabs());
  }

  // ── 추이 그래프 ─────────────────────────────────────────────
  function renderTrend() {
    const { coop, months } = view;
    const m = view.metric;
    const kind = kindOf(m.t, m.c);
    const label = m.label || codeName(m.t, m.c).replace(/_/g, " › ");
    const pts = months.slice().reverse()
      .map((ym) => ({ ym, v: valueOf(coop, ym, m.t, m.c) }))
      .filter((p) => p.v != null);

    const box = el("section", { class: "trend" },
      el("div", { class: "trend-h" },
        el("h3", {}, `${label} 추이`),
        el("span", { class: "unit" }, unitLabel(kind) ? `단위: ${unitLabel(kind)}` : "")));
    if (pts.length < 2) {
      box.append(el("p", { class: "muted" }, "추이를 그릴 자료가 부족합니다."));
      return box;
    }

    const disp = (v) => (kind === "won" ? v / 1e8 : v);
    const vals = pts.map((p) => disp(p.v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // 값이 모두 양수이고 변동폭이 작으면 0 대신 아래쪽 여유만 두어 변화가 보이게 함
    if (lo > 0 && (hi - lo) / hi < 0.5) lo = Math.max(0, lo - (hi - lo) * 0.6);
    else lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (hi === lo) hi = lo + 1;
    const ticks = niceTicks(lo, hi, 4);
    lo = ticks[0]; hi = ticks[ticks.length - 1];

    // 실제 화면 폭에 맞춰 그림 → 휴대폰에서도 글자가 작아지지 않음
    const W = Math.round(Math.min(720, Math.max(300, (detEl.clientWidth || 640) - 34)));
    const narrow = W < 520;
    const H = narrow ? 200 : 220, ml = narrow ? 46 : 56, mr = narrow ? 58 : 70, mt = 14, mb = 28;
    const x = (i) => ml + (i * (W - ml - mr)) / (pts.length - 1);
    const y = (v) => mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo));
    const base = y(Math.min(Math.max(0, lo), hi));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${label} 반기별 추이` });

    for (const t of ticks) {
      svg.append(svgEl("line", { x1: ml, x2: W - mr, y1: y(t), y2: y(t), class: t === 0 ? "axis0" : "grid" }));
      const tx = svgEl("text", { x: ml - 8, y: y(t) + 4, class: "tick", "text-anchor": "end" });
      tx.textContent = tickFmt(t, kind);
      svg.append(tx);
    }
    pts.forEach((p, i) => {
      if (narrow && pts.length > 6 && (pts.length - 1 - i) % 2) return;   // 좁은 화면은 하나 걸러 표시(최신은 항상)
      const tx = svgEl("text", { x: x(i), y: H - 8, class: "tick", "text-anchor": "middle" });
      tx.textContent = ymShort(p.ym);
      svg.append(tx);
    });
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(disp(p.v)).toFixed(1)}`).join("");
    svg.append(svgEl("path", { d: `${d}L${x(pts.length - 1).toFixed(1)},${base.toFixed(1)}L${x(0).toFixed(1)},${base.toFixed(1)}Z`, class: "area" }));
    svg.append(svgEl("path", { d, class: "line" }));

    const cross = svgEl("line", { y1: mt, y2: H - mb, class: "cross", visibility: "hidden" });
    svg.append(cross);
    const dots = pts.map((p, i) => {
      const c = svgEl("circle", { cx: x(i), cy: y(disp(p.v)), r: i === pts.length - 1 ? 5 : 4, class: "dot" });
      svg.append(c);
      return c;
    });
    const last = pts[pts.length - 1];                      // 끝값만 직접 표시
    const endTx = svgEl("text", { x: x(pts.length - 1) + 10, y: y(disp(last.v)) + 4, class: "endlabel" });
    endTx.textContent = fmt(last.v, kind, true);
    svg.append(endTx);

    // 호버·터치 툴팁 (점보다 넓은 감지 영역)
    const tip = el("div", { class: "tip", hidden: true });
    const wrap = el("div", { class: "chart-wrap" }, svg, tip);
    const step = (W - ml - mr) / (pts.length - 1);
    const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.forEach((dd) => dd.classList.remove("hot")); };
    pts.forEach((p, i) => {
      const hit = svgEl("rect", { x: x(i) - step / 2, y: 0, width: step, height: H, class: "hit" });
      const show = () => {
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
        dots.forEach((dd, j) => dd.classList.toggle("hot", j === i));
        tip.replaceChildren(el("b", {}, ymLabel(p.ym)), el("span", {}, fmt(p.v, kind, true)));
        tip.hidden = false;
        const r = svg.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max((x(i) / W) * r.width, 60), r.width - 60)}px`;
        const top = (y(disp(p.v)) / H) * r.height;
        tip.classList.toggle("below", top < 56);           // 위쪽 끝이면 점 아래에 표시
        tip.style.top = `${top}px`;
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });   // 터치는 탭한 값 유지
      svg.append(hit);
    });
    box.append(wrap);

    box.append(el("details", { class: "tbl-view" },
      el("summary", {}, "표로 보기"),
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "기준년월"), el("th", { class: "num" }, unitLabel(kind) ? `${unitLabel(kind)}` : "값"))),
        el("tbody", {}, pts.slice().reverse().map((p) => el("tr", {}, el("td", {}, ymLabel(p.ym)), el("td", { class: "num" }, fmt(p.v, kind))))))));
    return box;
  }

  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(+(Math.round(v / step) * step).toPrecision(12));
    return out;
  }
  function tickFmt(v, kind) {
    if (kind === "pct") return `${+v.toFixed(2)}%`;
    if (kind === "won") return Math.abs(v) >= 10000 ? `${+(v / 10000).toFixed(2)}조` : `${NF0.format(v)}억`;
    return NF0.format(v);
  }

  // ── 탭 & 표 ────────────────────────────────────────────────
  function renderTabs() {
    const { coop, ym } = view;
    const tabs = el("div", { class: "tabs", role: "tablist" }, TABS.map((t) =>
      el("button", { type: "button", role: "tab", class: "tab" + (t.id === view.tab ? " on" : ""), "aria-selected": t.id === view.tab ? "true" : "false",
        onclick: () => { view.tab = t.id; setURL(detailURL(), true); renderDetail(); } }, t.label)));
    const tab = TABS.find((t) => t.id === view.tab);
    const zero = el("label", { class: "zero" },
      el("input", { type: "checkbox", checked: view.hideZero, onchange: (e) => { view.hideZero = e.target.checked; renderDetail(); } }),
      " 0인 항목 숨기기");
    const panel = el("div", { class: "panel", role: "tabpanel" },
      el("div", { class: "panel-bar" }, el("span", { class: "hint" }, "항목을 누르면 위 그래프에 추이가 나옵니다."), zero),
      tab.tables.map(([t, title]) => renderTable(coop, ym, t, title)));
    return el("section", { class: "tabbox" }, tabs, panel);
  }

  function renderTable(coop, ym, t, title) {
    let rows = rowsOf(coop, ym, t);
    if (!rows.length) return el("section", { class: "sec" }, el("h3", {}, title), el("p", { class: "muted" }, `${ymLabel(ym)} 자료가 없습니다.`));
    const hasR = rows.some((r) => r.r != null);
    if (view.hideZero) rows = rows.filter((r) => r.v !== 0);
    const kinds = new Set(rows.map((r) => kindOf(t, r.c)));
    const unit = kinds.size === 1 ? unitLabel([...kinds][0]) : "";
    const body = el("tbody", {}, rows.map((r) => {
      const kind = kindOf(t, r.c);
      const active = view.metric.t === t && view.metric.c === r.c;
      const total = r.depth === 0 && (r.c === "A" || /(총계|총여신|총자산)/.test(r.name));
      return el("tr", { class: [`d${Math.min(r.depth, 3)}`, total ? "total" : "", active ? "on" : ""].join(" ").trim() },
        el("td", {}, el("button", { type: "button", class: "item", title: "추이 보기",
          onclick: () => {
            view.metric = { t, c: r.c, label: r.name.replace(/_/g, " › ") };
            renderDetail();
            detEl.querySelector(".trend").scrollIntoView({ block: "nearest", behavior: "smooth" });
          } },
          r.label, unit ? null : el("small", { class: "u" }, ` (${unitLabel(kind)})`))),
        el("td", { class: "num" + (r.v < 0 ? " neg" : "") }, fmt(r.v, kind)),
        hasR ? el("td", { class: "num rto" }, r.r == null ? "" : NF2.format(r.r)) : null);
    }));
    const thead = el("thead", {}, el("tr", {},
      el("th", {}, "항목"),
      el("th", { class: "num" }, unit ? (unit === "%" ? "비율(%)" : unit === "명" ? "인원(명)" : `금액(${unit})`) : "값"),
      hasR ? el("th", { class: "num" }, "구성비(%)") : null));
    return el("section", { class: "sec" }, el("h3", {}, title), el("div", { class: "tbl-scroll" }, el("table", {}, thead, body)));
  }

  // ── 전국 요약 ──────────────────────────────────────────────
  function renderSummary() {
    const box = $("summary");
    const s = (INDEX.summary && INDEX.summary[INDEX.latest]) || [];
    if (!s.length) return;
    box.replaceChildren(
      el("span", { class: "sum-label" }, `전국 회원조합 (${ymLabel(INDEX.latest)})`),
      ...s.map(([c, n]) => el("span", { class: "chip" }, `${codeName(T.S, c).replace(/^농협_/, "")} `, el("b", {}, NF0.format(n)))));
    box.hidden = false;
  }

  // ── URL (검색어·조합·기준년월·탭을 주소에 담아 공유 가능) ─────────
  function setURL(params, replace = false) {
    const p = new URLSearchParams();
    const q = qEl.value.trim();
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(params)) if (v && k !== "q") p.set(k, v);
    const s = p.toString();
    const url = s ? `?${s}` : location.pathname;
    if ((s ? `?${s}` : "") === location.search) return;
    (replace ? history.replaceState : history.pushState).call(history, null, "", url);
  }
  function route() {
    const p = new URLSearchParams(location.search);
    qEl.value = (p.get("q") || "").slice(0, 30);
    const c = p.get("c");
    if (c && LIST.some((x) => x.cd === c)) openCoop(c, { push: false, ym: p.get("ym"), tab: p.get("tab") });
    else search({ push: false });
  }

  let timer;
  qEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { setURL({}, true); search({ push: false }); }, 180);
  });
  $("f").addEventListener("submit", (e) => {
    e.preventDefault(); clearTimeout(timer);
    const q = norm(qEl.value);
    const exact = LIST.filter((c) => c.k === q);
    if (exact.length === 1) openCoop(exact[0].cd); else search();
  });
  window.addEventListener("popstate", route);
  let lastW = window.innerWidth, rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (view.coop && !detEl.hidden && Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; renderDetail(); } }, 200);
  });

  // ── 초기화 ─────────────────────────────────────────────────
  (async () => {
    try {
      const [idx, codes, list] = await Promise.all([getJSON("data/index.json"), getJSON("data/codes.json"), getJSON("data/coops.json")]);
      INDEX = idx; CODES = codes;
      LIST = list.list.map(([cd, nm, ym]) => ({ cd, nm, ym, k: norm(nm) }));
      if (!INDEX.months || !INDEX.months.length) throw new Error("empty");
    } catch {
      setStatus("데이터를 준비 중입니다. 잠시 후 다시 방문해 주세요.", true);
      return;
    }
    if (INDEX.updated) $("updated").textContent = ` · 갱신일자 ${INDEX.updated}`;
    renderSummary();
    route();
  })();
})();
