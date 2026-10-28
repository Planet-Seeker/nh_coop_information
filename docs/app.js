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
  // 핵심 수치: 화면 왼쪽 절반에 3열로 배치. 오른쪽 절반은 추후 별도 기능 자리로 비워 둠
  const KPIS = [
    { label: "조합원", t: T.G, c: "B" },
    { label: "자산총계", t: T.AS, c: "A" },
    { label: "당기순이익", t: T.PL, c: "A" },
    { label: "예수부채", t: T.LE, c: "A1" },
    { label: "대출채권", t: T.AS, c: "A3" },
    { label: "고정이하여신비율", t: T.Q, c: "C" },
  ];
  const MAX_LIST = 50;
  // VWorld 지도 인증키: 저장소에 두지 않고, 배포 때 GitHub Secrets(VWORLD_KEY)로 config.js를 만들어 넣는다.
  // (브라우저에는 전달되지만 VWorld에 등록한 사이트 주소에서만 동작)
  const VWORLD_KEY = (window.NH_CONFIG && window.NH_CONFIG.vworldKey) || "";
  const SOURCE = { id: "fsc_agcoop", label: "금융위원회 농협 금융통계" };   // 자료 출처 구분(추후 다른 API 추가 대비)

  // ── 금융회사코드 기반 분류 ─────────────────────────────────
  // 개별 조합: 0010027 + 권역 2자리 + 일련번호(13자리). 'nnnnnnnS' 형태는 시도·전국 합계(집계값).
  const REGION = { 10: "서울", 12: "부산", 13: "인천", 15: "대구", 2: "경기", 3: "강원", 40: "충북", 41: "충북", 42: "충북",
    45: "대전·충남", 46: "대전·충남", 47: "대전·충남", 48: "대전·충남", 5: "전북", 6: "광주·전남", 7: "경북", 8: "경남·울산", 9: "제주" };
  // 유형 4구분: 지역농협 · 지역축협 · 품목농협 · 품목축협
  // 코드 17 = 축산계. 그중 낙농·우유·양돈·양계·양봉 등 축종 이름이면 품목축협, 나머지(○○축산농협·○○축협) 지역축협.
  // 그 밖에는 원예·인삼·과수 등 품목 이름이면 품목농협, 나머지 지역농협.
  const LIVE_ITEM = /낙농|우유|양돈|양계|양봉|양토|양록|한우|육우|치즈|오리|사슴|흑염소/;
  const CROP_ITEM = /원예|인삼|과수|채소|화훼|특작|버섯|감귤|약초|엽연초|단감|사과|(?<!월)배농협|포도|고추|딸기|참외|녹차|키위|복숭아|매실|유자|더덕/;
  function coopType(rc, nm) {
    if (rc === "17") return LIVE_ITEM.test(nm) && !/축산농협$|축협$/.test(nm) ? "품목축협" : "지역축협";
    return CROP_ITEM.test(nm) ? "품목농협" : "지역농협";
  }
  function classify(cd, nm) {
    if (/^0010027\d{6}$/.test(cd)) {
      const rc = cd.slice(7, 9);
      return { kind: "coop", rc, region: rc === "17" ? "권역 미지정" : (REGION[rc] || REGION[rc[0]] || "기타"), type: coopType(rc, nm) };
    }
    const m = /^농협\((.+)\)$/.exec(nm);
    if (/S$/.test(cd) && m) return { kind: "sido", sido: m[1] };
    if (/S$/.test(cd)) return { kind: "nation" };
    return { kind: "other" };
  }

  // ── 상태 ───────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const qEl = $("q"), statusEl = $("status"), resEl = $("results"), detEl = $("detail");
  let INDEX = null, CODES = {}, LIST = [];
  const AGG = { nation: null, sido: new Map() };            // 집계값(시도 합계·전국 합계) — 검색 목록에서 분리, 비교 기능용
  const META = new Map();
  const BYCD = new Map();                                   // 금융회사코드 → 검색 목록 항목
  const METRICS = new Map();                                // 기준년월 → {keys, rows} (순위 계산용, data/metrics)
  const NO_RANK = new Set(["예대율"]);                       // 순위를 표시하지 않는 지표
  const LOW_FIRST = new Set(["고정이하여신비율"]);           // 낮을수록 1위

  async function loadMetrics(ym) {
    if (METRICS.has(ym)) return METRICS.get(ym);
    let d = null;
    try { d = await getJSON(`data/metrics/${ym}.json`); } catch { d = { keys: [], rows: {} }; }
    METRICS.set(ym, d);
    return d;
  }

  // 순위: 전국 / 소속구역(광역) 내 / 행정구역(기초) 내. 값이 없는 조합은 제외. 동점은 같은 순위.
  // 기초는 소속구역이 아닌 행정구역 기준(소속구역 '직할'은 지역 단위가 아니라 직할끼리만 묶이는 문제)
  function ranksOf(cd, ym, label) {
    const d = METRICS.get(ym);
    if (!d || NO_RANK.has(label)) return null;
    const i = d.keys.indexOf(label);
    const mine = d.rows[cd] && d.rows[cd][i];
    if (i < 0 || mine == null) return null;
    const low = LOW_FIRST.has(label);
    const me = affOf(cd);
    const adm = (k) => { const m = META.get(k) || {}; return m["행정구역_광역"] && m["행정구역_기초"] ? `${m["행정구역_광역"]} ${m["행정구역_기초"]}` : ""; };
    const myAdm = adm(cd);
    const out = [["전국", 0, 0], [me.aff1 ? (me.est ? `${me.aff1}(추정)` : me.aff1) : "", 0, 0], [myAdm ? myAdm.split(" ")[1] : "", 0, 0]];
    for (const [k, vals] of Object.entries(d.rows)) {
      const v = vals[i];
      if (v == null) continue;
      const better = low ? v < mine : v > mine;
      const a = affOf(k);
      const groups = [true, me.aff1 && a.aff1 === me.aff1, myAdm && adm(k) === myAdm];
      groups.forEach((g, j) => { if (g) { out[j][2]++; if (better) out[j][1]++; } });
    }
    return out.map(([name, b, n]) => (name ? { name, rank: b + 1, n } : { name: "", rank: 0, n: 0 }));
  }                                   // 수기 지정 조합 정보(data/meta/coop_meta.csv), 금융회사코드 → 행

  // 간단한 CSV 파서(따옴표·쉼표·줄바꿈 처리). 첫 줄은 열 이름.
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = ""; if (row.some((v) => v !== "")) rows.push(row); row = [];
      } else cur += ch;
    }
    row.push(cur); if (row.some((v) => v !== "")) rows.push(row);
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }

  // 지역 4구분을 두 줄 문장으로: "충남 천안시 위치" / "충남지역본부 천안시지부 소속"(직할이면 "충남지역본부 직할")
  // meta.csv 값 우선, 없으면 소속구역(광역)만 금융회사코드로 추정(한 지역으로 정해지는 경우만)
  function affOf(cd) {
    const m = META.get(cd) || {};
    const c = BYCD.get(cd);
    let aff1 = m["소속구역_광역"] || "", est = false;
    if (!aff1 && c && c.rc !== "17" && !c.region.includes("·") && c.region !== "기타") { aff1 = c.region; est = true; }
    return { aff1, aff2: m["소속구역_기초"] || "", est };
  }
  function regionLines(cd) {
    const m = META.get(cd) || {};
    const adm1 = m["행정구역_광역"] || "", adm2 = m["행정구역_기초"] || "";
    const { aff1, aff2, est } = affOf(cd);
    const loc = [adm1, adm2].filter(Boolean).join(" ");
    let aff = "";
    if (aff1 && aff2 === "직할") aff = `${aff1}지역본부 직할`;
    else if (aff1 || aff2) aff = `${[aff1 && `${aff1}지역본부`, aff2 && `${aff2}지부`].filter(Boolean).join(" ")} 소속`;
    return [
      { text: loc ? `${loc} 위치` : "위치 미지정", miss: !loc },
      { text: aff || "소속 미지정", miss: !aff, est },
    ];
  }
  const coopCache = new Map();
  const view = { coop: null, ym: null, months: [], tab: "gen", metric: KPIS[1], range: "5y" };
  const RANGES = [["3y", "최근 3년", 3], ["5y", "최근 5년", 5], ["10y", "최근 10년", 10], ["all", "전체", Infinity]];  // 연도 개수
  const MISSING = "자료누락";

  // ── 유틸 ───────────────────────────────────────────────────
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
  const ymShort = (ym) => `${ym.slice(2, 4)}.${ym.slice(4)}`;
  // 화면은 연 단위: 연도마다 12월(연말) 자료, 그해 12월 자료가 아직 없으면 그해 최신 반기 자료로 대표
  const isYearEnd = (ym) => ym.endsWith("12");
  const yearLabel = (ym) => `${ym.slice(0, 4)}년`;      // 화면 표기는 연도로 통일
  const yearPick = yearLabel;
  const axisLabel = (ym) => ym.slice(0, 4);
  function yearReps(monthsDesc) {
    const best = new Map();
    for (const ym of monthsDesc) {
      const y = ym.slice(0, 4), cur = best.get(y);
      if (!cur || ym > cur) best.set(y, ym);
    }
    return [...best.values()].sort().reverse();
  }
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
    if (v == null) return MISSING;
    if (kind === "pct") return `${NF2.format(v)}%`;
    if (kind === "cnt") return `${NF0.format(v)}${short ? "명" : ""}`;
    if (kind === "num") return NF0.format(v);
    return won(v);
  }
  // 원 → "2조 9,720억" / "538억" / "9.2억" / "0.05억"
  function won(v) {
    if (v === 0) return "0";
    const sign = v < 0 ? "-" : "";
    const a = Math.abs(v) / 1e8;                           // 억 단위
    if (a >= 10000) {
      let jo = Math.floor(a / 10000), rest = Math.round(a - jo * 10000);
      if (rest === 10000) { jo += 1; rest = 0; }
      return `${sign}${NF0.format(jo)}조${rest ? ` ${NF0.format(rest)}억` : ""}`;
    }
    if (a >= 10) return `${sign}${NF0.format(Math.round(a))}억`;
    if (a >= 1) return `${sign}${NF1.format(a)}억`;
    return `${sign}${NF2.format(a)}억`;
  }
  const unitLabel = (kind) => ({ pct: "%", cnt: "명", num: "", won: "" })[kind];
  const colHead = (kind) => ({ pct: "비율(%)", cnt: "인원(명)", won: "금액", num: "값" })[kind] || "값";

  // 표의 전체 항목(전 기간 코드 사전 기준)을 모두 나열하고, 이 조합·기준년월에 값이 없으면 null(자료누락)
  function rowsOf(coop, ym, t) {
    const have = new Map(((coop.d[ym] && coop.d[ym][t]) || []).map(([c, v, r]) => [c, [v, r]]));
    const codes = [...new Set([...Object.keys(CODES[t] || {}), ...have.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return codes.map((c) => {
      const [v, r] = have.get(c) || [null, null];
      const name = clean(codeName(t, c));
      const parts = name.split("_");
      return { c, v: v ?? null, r: r ?? null, name, label: parts[parts.length - 1], depth: parts.length - 1 };
    });
  }
  // 12월 기준에만 공시되는 항목(예: ROA·ROE) 판별: 이 조합 자료에서 12월에는 있고 6월에는 한 번도 없음
  function decOnly(coop, t, c) {
    let dec = false;
    for (const [ym, tb] of Object.entries(coop.d)) {
      const has = (tb[t] || []).some((r) => r[0] === c && r[1] != null);
      if (has && ym.endsWith("06")) return false;
      if (has && ym.endsWith("12")) dec = true;
    }
    return dec;
  }
  const missText = (coop, ym, t, c) => (ym.endsWith("06") && decOnly(coop, t, c) ? "연말 공시" : MISSING);
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
      setStatus(`전국 ${NF0.format(LIST.length)}개 조합(시도·전국 합계 제외) · ${ymLabel(INDEX.months[INDEX.months.length - 1])}~${ymLabel(INDEX.latest)} 자료. 조합명을 입력하세요.`);
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
    // 같은 이름·같은 권역 조합 구분(금융회사코드는 보이지 않음): 자료가 끊긴 곳은 마지막 연도, 나머지는 번호
    const same = new Map();
    for (const h of LIST) { const k = `${h.nm}|${h.region}`; same.set(k, [...(same.get(k) || []), h]); }
    const tag = (h) => {
      const g = same.get(`${h.nm}|${h.region}`);
      if (g.length < 2) return "";
      if (h.ym < INDEX.latest) return ` · ~${h.ym.slice(0, 4)}년`;
      const live = g.filter((x) => x.ym >= INDEX.latest).sort((a, b) => (a.cd < b.cd ? -1 : 1));
      return live.length > 1 ? ` · 동명 조합 ${"①②③④"[live.indexOf(h)]}` : "";
    };
    resEl.replaceChildren(el("ul", { class: "hits" }, ...hits.slice(0, MAX_LIST).map((h) =>
      el("li", {}, el("button", { type: "button", class: "hit", onclick: () => openCoop(h.cd) },
        el("span", { class: "hit-nm" }, highlight(h.nm, q)),
        el("span", { class: "hit-meta" },
          `${h.region} · ${h.type}${tag(h)}`),
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
    const months = yearReps(Object.keys(coop.d).sort().reverse());   // 연도별 대표 기준년월(최신순)
    if (ym && !months.includes(ym)) ym = months.find((m) => m.slice(0, 4) === ym.slice(0, 4)) || null;
    view.coop = coop;
    view.months = months;
    view.ym = ym && months.includes(ym) ? ym : months[0];
    view.tab = tab && TABS.some((t) => t.id === tab) ? tab : "gen";
    view.metric = KPIS[1];                                 // 기본 그래프: 자산총계
    if (push) setURL({ c: cd });
    setStatus("");
    resEl.replaceChildren();
    detEl.hidden = false;                                  // 먼저 보이게 해야 폭을 잴 수 있음
    renderDetail();
    if (push) detEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function rankRows(cd, ym, label) {
    if (NO_RANK.has(label)) return null;
    if (!METRICS.has(ym)) { loadMetrics(ym).then(() => { if (view.coop && view.ym === ym) renderDetail(); }); return el("span", { class: "rk" }, el("span", { class: "rk-row" }, "순위 계산 중…")); }
    const r = ranksOf(cd, ym, label);
    if (!r) return el("span", { class: "rk" }, el("span", { class: "rk-row miss" }, "순위 없음"));
    return el("span", { class: "rk" }, r.map((x, j) => el("span", { class: "rk-row" + (x.name ? "" : " miss") },
      x.name ? [el("span", { class: "rk-g" }, x.name), el("span", { class: "rk-n" }, `${NF0.format(x.rank)}위`, el("small", {}, ` / ${NF0.format(x.n)}`))]
        : (j === 1 ? "소속 광역 미지정" : "행정 기초 미지정"))));
  }

  // ── 본점 위치 지도(VWorld 배경지도 + Leaflet) ─────────────────
  // 좌표는 meta.csv의 위도·경도. 조합별로 지도 요소를 한 번만 만들어 다시 그릴 때 재사용(타일 깜빡임 방지).
  const maps = new Map();
  function coordsOf(cd) {
    const m = META.get(cd) || {};
    const lat = parseFloat(m["위도"]), lng = parseFloat(m["경도"]);
    return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? [lat, lng] : null;   // 국내 범위만 인정
  }
  function mapBox(coop) {
    const ll = coordsOf(coop.cd);
    const box = el("section", { class: "map-box", "aria-label": "본점 위치" });
    if (!ll || !VWORLD_KEY || !window.L) {
      box.append(el("p", { class: "map-empty" }, !ll ? "본점 위치 미지정" : "지도를 불러올 수 없습니다."));
      return box;
    }
    let entry = maps.get(coop.cd);
    if (!entry) {
      const node = el("div", { class: "map" });
      entry = { node, map: null };
      maps.set(coop.cd, entry);
    }
    box.append(entry.node);
    requestAnimationFrame(() => {                           // 화면에 붙은 뒤 크기를 알 수 있음
      if (!entry.map) {
        const dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
        // 배경지도 스타일: 밝은 화면 gray, 다크 모드 midnight. 비교용으로 주소에 ?mapstyle=Base|gray|midnight|Satellite|Hybrid 지정 가능
        const want = new URLSearchParams(location.search).get("mapstyle");
        const layer = ["Base", "gray", "midnight", "Satellite", "Hybrid"].includes(want) ? want : dark ? "midnight" : "gray";
        const ext = layer === "Satellite" ? "jpeg" : "png";
        entry.map = L.map(entry.node, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(ll, 15);
        entry.map.attributionControl.setPrefix("Leaflet");
        if (layer === "Hybrid") L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg`, { minZoom: 6, maxZoom: 19 }).addTo(entry.map);
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/{z}/{y}/{x}.${ext}`, {
          minZoom: 6, maxZoom: 19, attribution: "지도: VWorld(국토교통부)", className: `tiles-${layer}`,
        }).addTo(entry.map);
        // 사이트 녹색 핀(이미지 없이 SVG, 테마 색은 CSS 변수로)
        const pin = L.divIcon({ className: "pin", iconSize: [28, 36], iconAnchor: [14, 34], tooltipAnchor: [0, -30],
          html: '<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true"><path class="pin-body" d="M14 1C7 1 1.5 6.4 1.5 13.2 1.5 22 14 35 14 35s12.5-13 12.5-21.8C26.5 6.4 21 1 14 1z"/><circle class="pin-dot" cx="14" cy="13" r="4.6"/></svg>' });
        L.marker(ll, { icon: pin, keyboard: false, title: coop.nm }).addTo(entry.map)
          .bindTooltip(coop.nm, { permanent: true, direction: "top", className: "pin-label" });
      } else entry.map.invalidateSize();
    });
    return box;
  }

  function detailURL() {
    return { c: view.coop.cd, ym: view.ym === view.months[0] ? null : view.ym, tab: view.tab === "gen" ? null : view.tab };
  }

  function renderDetail() {
    const { coop, ym, months } = view;
    const back = qEl.value.trim()
      ? el("button", { type: "button", class: "back", onclick: () => { setURL({ q: qEl.value.trim() }); search({ push: false }); } }, "‹ 검색 결과")
      : null;
    const sel = el("select", { "aria-label": "기준연도", onchange: (e) => { view.ym = e.target.value; setURL(detailURL(), true); renderDetail(); } },
      months.map((m) => el("option", { value: m, selected: m === ym }, yearPick(m))));

    const head = el("div", { class: "d-head" },
      back,
      el("div", { class: "d-title" },
        el("h2", {}, coop.nm),
        el("p", { class: "meta" }, (() => {                // 금융회사코드·법인등록번호는 화면에 표시하지 않음(데이터에는 보관)
          const c = LIST.find((x) => x.cd === coop.cd);
          return c ? `${c.region} · ${c.type}` : "";
        })()),
        isYearEnd(ym) ? null : el("p", { class: "partial-note" }, `${yearLabel(ym)} 자료는 ${Number(ym.slice(4))}월 기준입니다(연말 자료 공개 전).`)));

    // 핵심 수치 (누르면 추이 그래프 전환)
    const kpis = el("div", { class: "kpis" }, KPIS.map((k) => {
      const kind = kindOf(k.t, k.c);
      const v = valueOf(coop, ym, k.t, k.c);
      const active = view.metric.t === k.t && view.metric.c === k.c;
      return el("button", { type: "button", class: "kpi" + (active ? " on" : ""), "aria-pressed": active ? "true" : "false",
        title: `${k.label} 추이 보기`, onclick: () => { view.metric = k; renderDetail(); } },
        el("span", { class: "kpi-l" }, k.label),
        el("span", { class: "kpi-v" + (v == null ? " miss" : v < 0 ? " neg" : "") }, fmt(v, kind, true)),
        rankRows(coop.cd, ym, k.label));
    }));

    const kpiRow = el("div", { class: "kpi-row" },
      el("section", { class: "kpi-box", "aria-labelledby": "kpi-h" },
        el("div", { class: "kpi-hd" }, sel, el("h3", { id: "kpi-h", class: "kpi-h" }, "주요 지표")),
        el("div", { class: "rgns" }, regionLines(coop.cd).map((r) =>    // 1행: 행정구역(위치), 2행: 소속구역
          el("p", { class: "rgn" + (r.miss ? " miss" : "") }, r.text, r.est ? el("span", { class: "rgn-n" }, " (코드 추정)") : null))),
        kpis),
      mapBox(coop));
    detEl.replaceChildren(head, kpiRow, renderTrend(), renderTabs());
  }

  // ── 추이 그래프 ─────────────────────────────────────────────
  function renderTrend() {
    const { coop, months } = view;
    const m = view.metric;
    const kind = kindOf(m.t, m.c);
    const label = m.label || codeName(m.t, m.c).replace(/_/g, " › ");
    // 연 단위: 선택한 연도를 오른쪽 끝으로 최근 N년(연도별 대표 자료). '전체'면 보유 연도 전체.
    const asc = months.slice().reverse();
    const win = (RANGES.find((r) => r[0] === view.range) || RANGES[1])[2];
    const annual = decOnly(coop, m.t, m.c);               // 연말에만 공시되는 항목은 12월 자료만 이어서 그림
    const pool = annual ? asc.filter((ym) => ym.endsWith("12") || ym === view.ym) : asc;
    const pend = pool.indexOf(view.ym);
    const shown = pool.slice(Math.max(0, pend - win + 1), pend + 1);
    const pts = shown.map((ym) => ({ ym, v: valueOf(coop, ym, m.t, m.c) }));  // 오래된 → 최신
    const valid = pts.filter((p) => p.v != null);
    const selIdx = pts.findIndex((p) => p.ym === view.ym);

    const rangeBtn = (id, text) => el("button", { type: "button", class: "seg" + (view.range === id ? " on" : ""), "aria-pressed": view.range === id ? "true" : "false",
      onclick: () => { view.range = id; renderDetail(); } }, text);
    const box = el("section", { class: "trend" },
      el("div", { class: "trend-h" },
        el("div", { class: "trend-t" },
          el("h3", {}, `${label} 추이`),
          el("span", { class: "unit" }, `${unitLabel(kind) ? `단위: ${unitLabel(kind)} · ` : ""}${pts.length ? `${yearLabel(pts[0].ym)}~${yearLabel(pts[pts.length - 1].ym)}` : ""}${annual ? " · 연말(12월) 공시 항목" : ""}`)),
        el("div", { class: "segs", role: "group", "aria-label": "기간" }, RANGES.map(([id, text]) => rangeBtn(id, text)))));

    if (valid.length < 2) {
      box.append(el("p", { class: "muted" }, valid.length ? "추이를 그릴 자료가 부족합니다." : `${MISSING}: 이 항목은 이 조합의 자료가 없습니다.`));
      return box;
    }

    const disp = (v) => (kind === "won" ? v / 1e8 : v);
    const vals = valid.map((p) => disp(p.v));
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
    const x = (i) => ml + (i * (W - ml - mr)) / Math.max(1, pts.length - 1);
    const y = (v) => mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo));
    const base = y(Math.min(Math.max(0, lo), hi));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": `${label} 반기별 추이` });

    // 선택한 기준년월 강조 띠
    const step = (W - ml - mr) / Math.max(1, pts.length - 1);
    if (selIdx >= 0) {
      const bw = Math.min(step, 40), bx0 = Math.max(ml, x(selIdx) - bw / 2), bx1 = Math.min(W - mr, x(selIdx) + bw / 2);
      svg.append(svgEl("rect", { x: bx0, y: mt, width: Math.max(0, bx1 - bx0), height: H - mt - mb, class: "sel-band" }));
    }

    for (const t of ticks) {
      svg.append(svgEl("line", { x1: ml, x2: W - mr, y1: y(t), y2: y(t), class: t === 0 ? "axis0" : "grid" }));
      const tx = svgEl("text", { x: ml - 8, y: y(t) + 4, class: "tick", "text-anchor": "end" });
      tx.textContent = tickFmt(t, kind);
      svg.append(tx);
    }
    const every = Math.max(1, Math.ceil(pts.length / (narrow ? 5 : 10)));   // X축 날짜는 화면 폭에 맞게 솎아 냄(선택 월은 항상)
    pts.forEach((p, i) => {
      const keep = i === selIdx || ((pts.length - 1 - i) % every === 0 && Math.abs(i - selIdx) >= every / 2);
      if (!keep) return;
      const tx = svgEl("text", { x: x(i), y: H - 8, class: "tick" + (i === selIdx ? " sel" : ""), "text-anchor": "middle" });
      tx.textContent = axisLabel(p.ym);
      svg.append(tx);
    });

    // 자료누락 구간에서는 선을 끊음
    const segs = [];
    let cur = [];
    pts.forEach((p, i) => { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      const d = sg.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(disp(pts[i].v)).toFixed(1)}`).join("");
      if (sg.length > 1) {
        svg.append(svgEl("path", { d: `${d}L${x(sg[sg.length - 1]).toFixed(1)},${base.toFixed(1)}L${x(sg[0]).toFixed(1)},${base.toFixed(1)}Z`, class: "area" }));
        svg.append(svgEl("path", { d, class: "line" }));
      }
    }
    pts.forEach((p, i) => {                                // 누락 지점은 축 위에 빈 표시
      if (p.v != null) return;
      svg.append(svgEl("circle", { cx: x(i), cy: base, r: 3.5, class: "miss-dot" }));
    });

    const cross = svgEl("line", { y1: mt, y2: H - mb, class: "cross", visibility: "hidden" });
    svg.append(cross);
    const dots = pts.map((p, i) => {
      if (p.v == null) return null;
      const c = svgEl("circle", { cx: x(i), cy: y(disp(p.v)), r: i === selIdx ? 6 : pts.length > 20 ? 3 : 4, class: "dot" + (i === selIdx ? " sel" : "") + (isYearEnd(p.ym) ? "" : " partial") });
      svg.append(c);
      return c;
    });
    // 선택한 기준년월 값만 직접 표시
    const sel = pts[selIdx];
    if (sel && sel.v != null) {
      const atEnd = selIdx === pts.length - 1;
      const lt = svgEl("text", { x: atEnd ? x(selIdx) + 10 : x(selIdx), y: atEnd ? y(disp(sel.v)) + 4 : y(disp(sel.v)) - 12, class: "endlabel", "text-anchor": atEnd ? "start" : "middle" });
      lt.textContent = fmt(sel.v, kind, true);
      svg.append(lt);
    }

    // 호버·터치 툴팁 (점보다 넓은 감지 영역)
    const tip = el("div", { class: "tip", hidden: true });
    const wrap = el("div", { class: "chart-wrap" }, svg, tip);
    const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.forEach((dd) => dd && dd.classList.remove("hot")); };
    pts.forEach((p, i) => {
      const hit = svgEl("rect", { x: x(i) - step / 2, y: 0, width: step, height: H, class: "hit" });
      const show = () => {
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
        dots.forEach((dd, j) => dd && dd.classList.toggle("hot", j === i));
        tip.replaceChildren(el("b", {}, ymLabel(p.ym)), el("span", {}, p.v == null ? missText(coop, p.ym, m.t, m.c) : fmt(p.v, kind, true)));
        tip.hidden = false;
        const r = svg.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max((x(i) / W) * r.width, 60), r.width - 60)}px`;
        const top = ((p.v == null ? base : y(disp(p.v))) / H) * r.height;
        tip.classList.toggle("below", top < 56);           // 위쪽 끝이면 점 아래에 표시
        tip.style.top = `${top}px`;
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });   // 터치는 탭한 값 유지
      svg.append(hit);
    });
    box.append(wrap);

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
    if (v === 0) return "0";
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
    const panel = el("div", { class: "panel", role: "tabpanel" },
      el("div", { class: "panel-bar" }, el("span", { class: "hint" }, "항목을 누르면 위 그래프에 추이가 나옵니다.")),
      tab.tables.map(([t, title]) => renderTable(coop, ym, t, title)));
    return el("section", { class: "tabbox" }, tabs, panel);
  }

  function renderTable(coop, ym, t, title) {
    let rows = rowsOf(coop, ym, t);
    if (!rows.length) return el("section", { class: "sec" }, el("h3", {}, title), el("p", { class: "muted" }, MISSING));
    const hasR = rows.some((r) => r.r != null);
    const kinds = new Set(rows.map((r) => kindOf(t, r.c)));
    const body = el("tbody", {}, rows.map((r) => {
      const kind = kindOf(t, r.c);
      const active = view.metric.t === t && view.metric.c === r.c;
      const total = r.depth === 0 && (r.c === "A" || /총계$/.test(r.name));
      return el("tr", { class: [`d${Math.min(r.depth, 3)}`, total ? "total" : "", active ? "on" : ""].join(" ").trim() },
        el("td", {}, el("button", { type: "button", class: "item", title: "추이 보기",
          onclick: () => {
            view.metric = { t, c: r.c, label: r.name.replace(/_/g, " › ") };
            renderDetail();
            detEl.querySelector(".trend").scrollIntoView({ block: "nearest", behavior: "smooth" });
          } },
          r.label, kinds.size > 1 && unitLabel(kind) ? el("small", { class: "u" }, ` (${unitLabel(kind)})`) : null)),
        el("td", { class: "num" + (r.v == null ? " miss" : r.v < 0 ? " neg" : "") }, r.v == null ? missText(coop, ym, t, r.c) : fmt(r.v, kind)),
        hasR ? el("td", { class: "num rto" }, r.r == null ? "" : NF2.format(r.r)) : null);
    }));
    const thead = el("thead", {}, el("tr", {},
      el("th", {}, "항목"),
      el("th", { class: "num" }, kinds.size === 1 ? colHead([...kinds][0]) : "값"),
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
      try {                                                 // 수기 지정 파일은 없어도 됨
        const r = await fetch("data/meta/coop_meta.csv", { cache: "no-cache" });
        if (r.ok) for (const row of parseCSV(await r.text())) {
          // 엑셀용 ="0010027…" 형식, 앞자리 0이 지워진 숫자 모두 13자리 코드로 맞춤
          let cd = (row["금융회사코드"] || "").replace(/^=/, "").replace(/"/g, "").trim();
          if (/^\d{8,12}$/.test(cd)) cd = cd.padStart(13, "0");
          if (cd) META.set(cd, row);
        }
      } catch { /* 무시 */ }
      for (const [cd, nm, ym] of list.list) {
        const c = { cd, nm, ym, k: norm(nm), ...classify(cd, nm) };
        const mt = (META.get(cd) || {})["유형"];               // meta.csv 유형이 있으면 그 값을 우선
        if (c.kind === "coop" && ["지역농협", "지역축협", "품목농협", "품목축협"].includes(mt)) c.type = mt;
        if (c.kind === "coop") { LIST.push(c); BYCD.set(cd, c); }
        else if (c.kind === "sido") AGG.sido.set(c.sido, c);
        else if (c.kind === "nation") AGG.nation = c;
      }
      if (!INDEX.months || !INDEX.months.length) throw new Error("empty");
    } catch {
      setStatus("데이터를 준비 중입니다. 잠시 후 다시 방문해 주세요.", true);
      return;
    }
    if (INDEX.updated) $("updated").textContent = INDEX.updated;
    // 전국 회원조합수 요약 줄은 표시하지 않음(2026-10-28 결정). 데이터(index.json summary)는 비교 기능용으로 보관.
    route();
  })();
})();
