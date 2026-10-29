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
  // 금융감독원 FISIS 자료(금감원 공식 자료이나 국가승인통계 아님, data/fss). 금감원에만 있는 항목은 (금감원) 꼬리표
  const F = {
    LOAN: "fss_대출채권", SEC: "fss_유가증권", DEP: "fss_예수부채·차입부채", FIX: "fss_유형자산",
    FEE: "fss_수수료 손익", SECPL: "fss_유가증권 평가·처분 손익", INT: "fss_이자 손익·판매비와 관리비", MEM: "fss_유형별 대출(조합원·비조합원)",
  };
  const FSS_TAG = " · 금융감독원";
  // 교차검증 대응표: 금융위원회 항목 → 같은 값의 금감원 항목. 둘 다 있으면 일치 여부를 꼬리표로 표시
  const XMAP = (() => {
    const m = {}, add = (t, f, pairs) => pairs.split(" ").forEach((x) => { const [a, b] = x.split(":"); m[`${t}|${a}`] = [f, b]; });
    add("재무현황_요약재무상태표(자산)", F.LOAN, "A3:A A32:A1 A320:A11 A33:A2 A330:A21 A34:A3 A340:A31");
    add("재무현황_요약재무상태표(자산)", F.SEC, "A2:A A23:A1 A24:A2 A25:A3");
    add("재무현황_요약재무상태표(자산)", F.FIX, "A4:A A42:A1 A420:A11 A43:A2 A430:A21 A431:A22 A44:A3 A440:A31 A441:A32");
    add("재무현황_요약재무상태표(부채및자본)", F.DEP, "A1:A A11:A1 A12:A2 A13:A3 A2:B A21:B1 A22:B2 A23:B3");
    add("재무현황_요약손익계산서", F.INT, "A11:B A111:B1 A1111:B11 A1112:B12 A1113:B13 A112:B2 A113:B3 A114:B4 A21:C A211:C1 A212:C2 A213:C3 A26:D A261:D1 A263:D2 A264:D3 A265:D4 A266:D5 A267:D6 A268:D7 A269:D8 A262:D9");
    add("재무현황_요약손익계산서", F.FEE, "A14:B A141:B1 A142:B2 A144:B3 A143:B4 A24:C A241:C1 A242:C2 A243:C3");
    add("재무현황_요약손익계산서", F.SECPL, "A12:B A22:C");
    add("재무현황_주요자금조달및운용", F.MEM, "A21:A");
    return m;
  })();
  // 금감원에만 있는 하위 항목을 금융위원회 표 안에 끼워 넣는 위치: [금융위원회 표, 부모 항목, 금감원 표, 금감원 항목들]
  const NEST = [["재무현황_주요자금조달및운용", "A21", F.MEM, ["A1", "A2", "A3"]]];
  const TABS = [
    { id: "gen", label: "일반현황", tables: [[T.G, "임직원·조합원"]] },
    { id: "bs", label: "재무상태표", tables: [[T.AS, "자산"], [T.LE, "부채 및 자본"]] },
    { id: "pl", label: "손익계산서", tables: [[T.PL, "요약 손익계산서"]] },   // 금감원 손익 3표는 같은 항목이라 교차검증만
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
    const out = [["전국", 0, 0], [me.aff1 ? (me.est1 ? `${me.aff1}(추정)` : me.aff1) : "", 0, 0], [myAdm ? myAdm.split(" ")[1] + (estOf(cd, "행정구역_기초") ? "(추정)" : "") : "", 0, 0]];
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
  // meta.csv '추정' 열: 추정으로 채운 열 이름(;로 구분). 화면에는 "(추정)"으로 표시
  const estOf = (cd, col) => ((META.get(cd) || {})["추정"] || "").split(";").map((x) => x.trim()).includes(col);
  const typeText = (c) => `${c.type}${estOf(c.cd, "유형") ? "(추정)" : ""}`;
  function affOf(cd) {
    const m = META.get(cd) || {};
    const c = BYCD.get(cd);
    let aff1 = m["소속구역_광역"] || "", est1 = estOf(cd, "소속구역_광역");
    if (!aff1 && c && c.rc !== "17" && !c.region.includes("·") && c.region !== "기타") { aff1 = c.region; est1 = true; }
    const aff2 = m["소속구역_기초"] || "";
    return { aff1, aff2, est1, est: est1 || (!!aff2 && estOf(cd, "소속구역_기초")) };   // est1: 광역만(순위용), est: 문장 전체
  }
  function regionLines(cd) {
    const m = META.get(cd) || {};
    const adm1 = m["행정구역_광역"] || "", adm2 = m["행정구역_기초"] || "";
    const { aff1, aff2, est } = affOf(cd);
    const loc = [adm1, adm2].filter(Boolean).join(" ");
    // 소속: 농협중앙회 ○○지역본부 ○○지부(세종시회원지원국처럼 단위 이름이 있으면 그대로, 직할이면 직할)
    let aff = "";
    if (aff1 || aff2) aff = ["농협중앙회", aff1 ? `${aff1}지역본부` : "", aff2 === "직할" ? "직할" : aff2 ? (/(지부|국)$/.test(aff2) ? aff2 : `${aff2}지부`) : ""].filter(Boolean).join(" ");
    return [
      { label: "위치", text: loc || "미지정", miss: !loc, est: !!loc && (estOf(cd, "행정구역_광역") || estOf(cd, "행정구역_기초")) },
      { label: "소속", text: aff || "미지정", miss: !aff, est: !!aff && est },
    ];
  }
  // 조합 상태(meta.csv 상태·승계조합코드·이전명칭). 상태가 비어 있으면 공시 여부로 판단
  const STATES = ["운영", "합병", "코드변경", "공시중단"];
  const normCd = (v) => { let cd = String(v || "").replace(/^=/, "").replace(/"/g, "").trim(); if (/^\d{8,12}$/.test(cd)) cd = cd.padStart(13, "0"); return cd; };
  const PRED = new Map();                                   // 승계 조합 → 앞선 조합 코드들(합병·코드변경)
  function stOf(cd) {
    const m = META.get(cd) || {}, c = BYCD.get(cd);
    let st = m["상태"] || "";
    if (!STATES.includes(st)) st = c && c.ym < INDEX.latest ? "공시중단" : "운영";
    const succ = normCd(m["승계조합코드"]);
    return { st, succ: BYCD.has(succ) && succ !== cd ? succ : "", est: estOf(cd, "상태") || estOf(cd, "승계조합코드") || /자동 추정|^정황:/.test(m["비고"] || ""),   // 원자료가 아니면 추정
      prevEst: estOf(cd, "이전명칭"),
      prev: (m["이전명칭"] || "").split(/[;；]/).map((x) => x.trim()).filter(Boolean) };
  }
  const hiddenOld = (cd) => { const s = stOf(cd); return s.st === "코드변경" && !!s.succ; };   // 새 코드 조합에 이어 붙여 보여 줌
  const hwanOf = (cd) => (/^0010027\d{6}$/.test(cd) ? cd.slice(7) : "");   // 환코드: 권역 2자리 + 일련번호 4자리(조합 고유)
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
  // 공시 기간: 이 조합 자료에서 값이 있는 첫·마지막 기준년월(예: 직원 책임자·일반직원·기타는 2018년 6월까지,
  // 정규·비정규직원과 임원 전무·상무는 2018년 12월부터 → 원자료 분류 변경)
  function spanOf(coop, t, c) {
    let a = null, b = null;
    for (const [ym, tb] of Object.entries(coop.d)) {
      if (!(tb[t] || []).some((r) => r[0] === c && r[1] != null)) continue;
      if (!a || ym < a) a = ym;
      if (!b || ym > b) b = ym;
    }
    return [a, b];
  }
  function missText(coop, ym, t, c) {
    if (ym.endsWith("06") && decOnly(coop, t, c)) return "연말 공시";
    const tableHas = ((coop.d[ym] || {})[t] || []).some((r) => r[1] != null);
    if (tableHas) {                                          // 같은 표의 다른 항목은 있는데 이 항목만 없음
      const [a, b] = spanOf(coop, t, c);
      if (b && ym > b) return `${ymLabel(b)}까지 공시`;
      if (a && ym < a) return `${ymLabel(a)}부터 공시`;
    }
    return MISSING;
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

  // 지역 검색: 광역 정식 명칭은 줄임말로("인천광역시"→"인천", "충청남도"→"충남")
  const SIDO_FULL = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전",
    울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남",
    전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주", 제주도: "제주" };
  const regionQuery = (nq) => SIDO_FULL[nq] || nq.replace(/(지역본부|본부|지부)$/, "");
  // 이 조합이 속한 지역 이름들: 행정구역 광역·기초, 소속구역 광역·기초(meta.csv), 없으면 코드로 정해지는 소속 광역
  function regionKeys(cd) {
    const m = META.get(cd) || {};
    const { aff1 } = affOf(cd);
    const c = BYCD.get(cd);
    const code = c && c.rc !== "17" ? c.region.split("·") : [];   // 금융회사코드 권역("대전·충남"이면 대전·충남 둘 다)
    return [m["행정구역_광역"], m["행정구역_기초"], aff1, m["소속구역_기초"] === "직할" ? "" : m["소속구역_기초"], ...code]
      .filter(Boolean).map(norm);
  }
  function regionHit(cd, rq) {
    if (rq.length < 2) return false;                         // 한 글자는 조합명만 검색
    return regionKeys(cd).some((k) => k === rq || k.startsWith(rq));
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
    const rq = regionQuery(nq);
    const isCode = /^\d{2,6}$/.test(nq);                    // 숫자만 입력하면 환코드로 검색(앞부분 일치)
    const byName = (c) => isCode ? hwanOf(c.cd).startsWith(nq) : c.k.includes(nq) || c.alias.some((a) => a.includes(nq));
    const rank = (c) => (c.k === nq ? 0 : c.k.startsWith(nq) ? 1 : byName(c) ? 2 : 3);   // 조합명 일치 먼저, 지역 일치는 뒤에
    const gone = (c) => stOf(c.cd).st !== "운영";
    const hits = LIST.filter((c) => !hiddenOld(c.cd) && (byName(c) || regionHit(c.cd, rq)))
      .sort((a, b) => gone(a) - gone(b) || rank(a) - rank(b) || a.nm.localeCompare(b.nm, "ko"));
    const nName = hits.filter(byName).length, nRegion = hits.length - nName;

    if (!hits.length) {
      resEl.replaceChildren();
      setStatus(`‘${q}’에 해당하는 조합이 없습니다.`);
      return;
    }
    setStatus(hits.length > MAX_LIST
      ? `${NF0.format(hits.length)}곳${nRegion ? ` (조합명 ${nName}곳 · 지역 ${nRegion}곳)` : ""} 중 ${MAX_LIST}곳만 표시합니다. 더 구체적으로 입력해 보세요.`
      : `${hits.length}곳 검색됨${nRegion ? ` (조합명 ${nName}곳 · 지역 ${nRegion}곳)` : ""} · 조합을 선택하세요`);
    // 같은 이름·같은 권역 조합 구분(금융회사코드는 보이지 않음): 자료가 끊긴 곳은 마지막 연도, 나머지는 번호
    const same = new Map();
    for (const h of LIST) { const k = `${h.nm}|${h.region}`; same.set(k, [...(same.get(k) || []), h]); }
    const tag = (h) => {
      const g = same.get(`${h.nm}|${h.region}`);
      if (g.length < 2 || gone(h)) return "";
      const live = g.filter((x) => x.ym >= INDEX.latest).sort((a, b) => (a.cd < b.cd ? -1 : 1));
      return live.length > 1 ? ` · 동명 조합 ${"①②③④"[live.indexOf(h)]}` : "";
    };
    const goneText = (h) => {
      const s = stOf(h.cd);
      const sn = s.succ ? BYCD.get(s.succ).nm : "";
      return ` · ${h.ym.slice(0, 4)}년까지 공시${s.st === "합병" && sn ? ` · ${sn}에 합병${s.est ? "(추정)" : ""}` : ""}`;
    };
    const aliasText = (h) => {
      if (h.k.includes(nq)) return "";
      const a = stOf(h.cd).prev.find((x) => norm(x).includes(nq));
      return a ? ` · 옛 이름 ${a}${stOf(h.cd).prevEst ? "(추정)" : ""}` : "";
    };
    const item = (h) => el("li", {}, el("button", { type: "button", class: "hit" + (gone(h) ? " gone" : ""), onclick: () => openCoop(h.cd) },
      el("span", { class: "hit-nm" }, highlight(h.nm, q)),
      el("span", { class: "hit-meta" },
        `${(() => { const a = affOf(h.cd); return a.aff1 ? `${a.aff1}${a.est1 ? "(추정)" : ""}` : h.rc === "17" ? h.region : `${h.region}(추정)`; })()} · ${typeText(h)}${isCode ? ` · ${hwanOf(h.cd)}` : tag(h)}${aliasText(h)}${gone(h) ? goneText(h) : ""}`),
      el("span", { class: "hit-go", "aria-hidden": "true" }, "›")));
    const shown = hits.slice(0, MAX_LIST);
    const liveHits = shown.filter((h) => !gone(h)), goneHits = shown.filter(gone);
    resEl.replaceChildren(
      ...(liveHits.length ? [el("ul", { class: "hits" }, ...liveHits.map(item))] : []),
      ...(goneHits.length ? [el("h3", { class: "hits-h" }, "합병·소멸 조합 (공시 종료)"), el("ul", { class: "hits" }, ...goneHits.map(item))] : []));
  }

  // ── 상세 ───────────────────────────────────────────────────
  async function loadCoop(cd) {
    let c = coopCache.get(cd);
    if (!c) {
      c = await getJSON(`data/coop/${encodeURIComponent(cd.replace(/[^0-9A-Za-z]/g, ""))}.json`);
      try {                                                 // 금감원 상세 표(있을 때만). 금융위원회 자료가 있는 기준년월에만 붙임
        const f = await getJSON(`data/fss/coop/${encodeURIComponent(cd.replace(/[^0-9A-Za-z]/g, ""))}.json`);
        for (const [ym, tb] of Object.entries(f.d || {})) if (c.d[ym]) Object.assign(c.d[ym], tb);
        c.fss = true;
      } catch { c.fss = false; }
      coopCache.set(cd, c);
    }
    return c;
  }
  // 합병·코드변경·옛 이름 안내 줄
  function historyLines(coop) {
    const cd = coop.cd, s = stOf(cd), c = BYCD.get(cd);
    const link = (k) => el("button", { type: "button", class: "linkish", onclick: () => openCoop(k) }, BYCD.get(k).nm);
    const lines = [];
    if (s.st !== "운영" && c) {
      const end = `${ymLabel(c.ym)} 이후 공시 없음`;
      if (s.st === "합병" && s.succ) lines.push([end, " · ", link(s.succ), `에 합병${s.est ? "(추정)" : ""}`]);
      else if (s.st === "코드변경" && s.succ) lines.push(["같은 조합의 이후 자료: ", link(s.succ), s.est ? "(추정)" : ""]);
      else {                                                // 공시중단: 비고에 확인된 사유가 있으면 그 내용
        const why = /^(확인|정황): (.+?) \(https?:/.exec((META.get(cd) || {})["비고"] || "");
        lines.push([`${end} · ${why ? why[2] + (s.est ? "(추정)" : "") : "사유 미확인"}`]);
      }
    }
    const preds = PRED.get(cd) || [];
    const merged = preds.filter((p) => stOf(p).st === "합병");
    const moved = preds.filter((p) => stOf(p).st === "코드변경");
    if (merged.length) lines.push(["합병 이력: ", ...merged.flatMap((p, i) => [i ? ", " : "", link(p), ` ${BYCD.get(p).ym.slice(0, 4)}년까지 공시${stOf(p).est ? "(추정)" : ""}`])]);
    if (moved.length) {
      const last = moved.map((p) => BYCD.get(p).ym).sort().pop();
      lines.push([`${ymLabel(last)}까지는 금융회사코드 변경 전 자료를 이어 붙였습니다${moved.some((p) => stOf(p).est) ? "(추정)" : ""}`]);
    }
    if (s.prev.length) lines.push([`옛 이름: ${s.prev.join(", ")}${s.prevEst ? "(추정)" : ""}`]);
    return lines;
  }

  // 카드와 그래프 사이 주석(최대 5행 높이, 넘치면 스크롤): 단위·갱신일, 공시 상태·합병 이력, 기준월, 공시 공백, 자료 산출 방식, 추정 안내
  function notesBox(coop, ym) {
    const lines = [[`금액은 조·억 단위로 반올림해 표시합니다. 데이터 최종갱신일은 ${INDEX.updated || "-"}입니다.`], ...historyLines(coop)];
    if (!isYearEnd(ym)) lines.push([`${yearLabel(ym)} 자료는 ${Number(ym.slice(4))}월 기준이며 손익은 상반기 누적입니다.`]);
    const years = [...new Set(Object.keys(coop.d).map((m) => +m.slice(0, 4)))].sort((a, b) => a - b);
    const gaps = [];
    for (let y = years[0]; y < years[years.length - 1]; y++) if (!years.includes(y)) gaps.push(`${y}년`);
    if (gaps.length) lines.push([`공시 자료 끊김: ${gaps.join(", ")}`]);
    lines.push(["기본적으로 데이터는 금융위원회 자료를 기반으로 금융감독원 자료를 보충하는 식으로 산출됩니다. 두 자료가 다르면 금융위원회 자료를 우선하며, 금융위원회 값 옆에 금감원 값을 별도 표기합니다."]);
    lines.push(["(추정)이 붙은 값은 공시 원자료가 아닌 추정값입니다."]);
    return el("section", { class: "notes", "aria-label": "참고 사항" }, el("ul", {}, lines.map((l) => el("li", {}, ...l))));
  }

  async function openCoop(cd, { push = true, ym = null, tab = null } = {}) {
    setStatus("조합 자료를 불러오는 중…");
    let coop;
    try {
      coop = await loadCoop(cd);
      // 같은 조합이 금융회사코드만 바뀐 경우(상태 코드변경): 옛 코드 자료를 빈 기준년월에 이어 붙임
      const olds = (PRED.get(cd) || []).filter((p) => stOf(p).st === "코드변경");
      if (olds.length) {
        const merged = { ...coop, d: { ...coop.d }, src: {} };
        for (const p of olds) {
          const o = await loadCoop(p);
          for (const [ym, t] of Object.entries(o.d)) if (!merged.d[ym]) { merged.d[ym] = t; merged.src[ym] = p; }
        }
        coop = merged;
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
          minZoom: 6, maxZoom: 19, attribution: '지도: <a href="https://www.vworld.kr" target="_blank" rel="noopener">VWorld</a>(국토교통부)', className: `tiles-${layer}`,
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

    // 조합명 · 위치·구분(1행) · 소속(2행) → 주요 지표 → 카드. 이 왼쪽 묶음 높이를 오른쪽 정사각형 지도와 맞춤.
    const title = [
      el("h2", { class: "d-name" }, coop.nm, hwanOf(coop.cd) ? el("span", { class: "hwan" }, ` (${hwanOf(coop.cd)})`) : null),   // 환코드(금융회사코드 끝 6자리)
      (() => {                                              // 본점소재지(주소), 위치 · 구분(유형), 소속. 금융회사코드·법인등록번호는 표시하지 않음
        const c = LIST.find((x) => x.cd === coop.cd);
        const [loc, aff] = regionLines(coop.cd);
        const item = (label, text, miss, est) => el("span", { class: "rgn-item" }, el("span", { class: "rgn-l" }, label),
          el("span", { class: "rgn-v" + (miss ? " miss" : "") }, text), est ? el("span", { class: "rgn-n" }, "(추정)") : null);
        const addr = ((META.get(coop.cd) || {})["주소"] || "").trim();
        return el("div", { class: "rgn-text" },
          addr ? el("p", { class: "addr" }, addr) : null,      // 본점소재지: 이름 아래 회색 한 줄(없으면 생략)
          el("p", {}, item("위치", loc.text, loc.miss, loc.est), el("span", { class: "rgn-sep" }, "·"),
            item("구분", c ? c.type : "미지정", !c, c ? estOf(c.cd, "유형") : false)),
          el("p", {}, item("소속", aff.text, aff.miss, aff.est)));
      })(),
    ];
    // 핵심 수치 (누르면 추이 그래프 전환)
    const kpis = el("div", { class: "kpis" }, KPIS.map((k) => {
      const kind = kindOf(k.t, k.c);
      const v = valueOf(coop, ym, k.t, k.c);
      const active = view.metric.t === k.t && view.metric.c === k.c;
      return el("button", { type: "button", class: "kpi" + (active ? " on" : ""), "aria-pressed": active ? "true" : "false",
        title: `${k.label} 추이 보기`, onclick: () => { view.metric = k; renderDetail(); } },
        el("span", { class: "kpi-l" }, k.label),
        el("span", { class: "kpi-v" + (v == null ? " miss" : v < 0 ? " neg" : "") }, fmt(v, kind, true)),
        rankRows((coop.src && coop.src[ym]) || coop.cd, ym, k.label));   // 이어 붙인 연도는 옛 코드로 순위 조회
    }));

    const kpiRow = el("div", { class: "kpi-row" },
      el("section", { class: "kpi-box", "aria-labelledby": "kpi-h" },
        ...title,
        el("div", { class: "kpi-hd" }, sel, el("h3", { id: "kpi-h", class: "kpi-h" }, "주요 지표"),
          ),
        kpis),
      mapBox(coop));
    detEl.replaceChildren(...(back ? [el("div", { class: "d-head" }, back)] : []), kpiRow, notesBox(coop, ym), renderTrend(), renderTabs());
  }

  // ── 추이 그래프 ─────────────────────────────────────────────
  // 글자 폭 측정(캔버스). 실패하면 글자 수로 어림
  const measureCtx = (() => { try { return document.createElement("canvas").getContext("2d"); } catch { return null; } })();
  function textW(s, size, weight = 400) {
    if (measureCtx) {
      const fam = getComputedStyle(document.body).fontFamily || "sans-serif";
      measureCtx.font = `${weight} ${size}px ${fam}`;
      return measureCtx.measureText(s).width;
    }
    return [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 1 : /[\s.,]/.test(ch) ? 0.3 : 0.6) * size, 0);
  }

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
          el("h3", {}, `${label} 추이`, m.t.startsWith("fss_") ? srcTag("금감원", "fss") : null),
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
    // 좌우 여백은 고정값 대신 실제 글자 폭으로: 왼쪽 = 가장 긴 눈금 글자, 오른쪽 = 끝 값 표시(없으면 연도 글자 절반)
    const selV = selIdx >= 0 ? pts[selIdx].v : null;
    const endLbl = selIdx === pts.length - 1 && selV != null ? fmt(selV, kind, true) : "";
    const ml = Math.ceil(Math.max(...ticks.map((t) => textW(tickFmt(t, kind), 11)))) + 10;
    const mr = endLbl ? Math.ceil(textW(endLbl, 12, 600)) + 14 : 18;
    const H = narrow ? 200 : 220, mt = 14, mb = 28;
    const x = (i) => ml + (i * (W - ml - mr)) / Math.max(1, pts.length - 1);
    const y = (v) => mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo));
    const base = y(Math.min(Math.max(0, lo), hi));
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart" + (m.t.startsWith("fss_") ? " fss" : ""), role: "img", "aria-label": `${label} 반기별 추이` });

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

  // 출처 꼬리표: 기준은 금융위원회 → 금융위원회 값은 표시 없음. 금감원에만 있는 값은 (금감원), 서로 다르면 금감원 값 병기
  const srcTag = (txt, cls = "") => el("span", { class: "src" + (cls ? " " + cls : "") }, txt);
  function renderTable(coop, ym, t, title) {
    const fssTable = t.startsWith("fss_");
    if (fssTable && !coop.fss) return el("section", { class: "sec" }, el("h3", {}, title, srcTag("금감원", "fss")), el("p", { class: "muted" }, "금융감독원 자료 수집 전입니다."));
    let rows = rowsOf(coop, ym, t).map((r) => ({ ...r, t }));
    for (const [nt, parent, ft, codes] of NEST) {           // 금감원 하위 항목 끼워 넣기(예: 대출금 아래 조합원·준조합원·비조합원)
      if (nt !== t || !coop.fss) continue;
      const at = rows.findIndex((r) => r.c === parent);
      if (at < 0) continue;
      const kids = codes.map((c) => ({ c, t: ft, v: valueOf(coop, ym, ft, c), r: null, name: codeName(ft, c), label: codeName(ft, c), depth: rows[at].depth + 1, nested: true }));
      rows.splice(at + 1, 0, ...kids);
    }
    if (!rows.length) return el("section", { class: "sec" }, el("h3", {}, title), el("p", { class: "muted" }, MISSING));
    const hasR = rows.some((r) => r.r != null);
    const kinds = new Set(rows.map((r) => kindOf(r.t, r.c)));
    const body = el("tbody", {}, rows.map((r) => {
      const kind = kindOf(r.t, r.c);
      const onlyFss = fssTable || r.nested;
      const active = view.metric.t === r.t && view.metric.c === r.c;
      const total = r.depth === 0 && (r.c === "A" || /총계$| 계$/.test(r.name));
      // 출처 판정
      const x = !onlyFss && XMAP[`${t}|${r.c}`];
      const fv = x && coop.fss ? valueOf(coop, ym, x[0], x[1]) : null;
      let shown = r.v, tag;
      if (onlyFss) tag = srcTag("금감원", "fss");
      else if (r.v == null && fv != null) { shown = fv; tag = srcTag("금감원", "fss"); }
      else if (fv != null && fv !== r.v) tag = el("small", { class: "alt" }, ` 금감원 ${fmt(fv, kind)}`);   // 불일치만 병기
      return el("tr", { class: [`d${Math.min(r.depth, 3)}`, total ? "total" : "", active ? "on" : "", onlyFss || (r.v == null && fv != null) ? "fss" : ""].join(" ").trim() },
        el("td", {}, el("button", { type: "button", class: "item", title: "추이 보기",
          onclick: () => {
            view.metric = { t: r.t, c: r.c, label: r.name.replace(/_/g, " › ") };
            renderDetail();
            detEl.querySelector(".trend").scrollIntoView({ block: "nearest", behavior: "smooth" });
          } },
          r.label, kinds.size > 1 && unitLabel(kind) ? el("small", { class: "u" }, ` (${unitLabel(kind)})`) : null), tag),
        el("td", { class: "num" + (shown == null ? " miss" : shown < 0 ? " neg" : "") }, shown == null ? missText(coop, ym, r.t, r.c) : fmt(shown, kind)),
        hasR ? el("td", { class: "num rto" }, r.r == null ? "" : NF2.format(r.r)) : null);
    }));
    const thead = el("thead", {}, el("tr", {},
      el("th", {}, "항목"),
      el("th", { class: "num" }, kinds.size === 1 ? colHead([...kinds][0]) : "값"),
      hasR ? el("th", { class: "num" }, "구성비(%)") : null));
    return el("section", { class: "sec" }, el("h3", {}, title, fssTable ? srcTag("금감원", "fss") : null), el("div", { class: "tbl-scroll" }, el("table", {}, thead, body)));
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

  // 검색창 안내문: 좁은 화면에서는 짧게(긴 문장이 잘리지 않도록)
  const LONG_PH = qEl.getAttribute("placeholder"), SHORT_PH = "조합명·지역 검색 (예: 순천농협, 인천)";
  const narrowMQ = window.matchMedia("(max-width: 640px)");
  const setPH = () => qEl.setAttribute("placeholder", narrowMQ.matches ? SHORT_PH : LONG_PH);
  setPH(); narrowMQ.addEventListener("change", setPH);

  let timer;
  qEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { setURL({}, true); search({ push: false }); }, 180);
  });
  $("f").addEventListener("submit", (e) => {
    e.preventDefault(); clearTimeout(timer);
    const q = norm(qEl.value);
    const exact = LIST.filter((c) => (c.k === q || hwanOf(c.cd) === q) && !hiddenOld(c.cd));
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
      try { Object.assign(CODES, await getJSON("data/fss/codes.json")); } catch { /* 금감원 표 없음 */ }
      try {                                                 // 수기 지정 파일은 없어도 됨
        const r = await fetch("data/meta/coop_meta.csv", { cache: "no-cache" });
        if (r.ok) for (const row of parseCSV(await r.text())) {
          // 엑셀용 ="0010027…" 형식, 앞자리 0이 지워진 숫자 모두 13자리 코드로 맞춤
          const cd = normCd(row["금융회사코드"]);
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
      for (const c of LIST) {                               // 옛 이름(검색용)·승계 관계
        const s = stOf(c.cd);
        c.alias = [...s.prev, ...((META.get(c.cd) || {})["별칭"] || "").split(";")].map((x) => x.trim()).filter(Boolean).map(norm);   // 옛 이름·홈페이지 표기 이름도 검색
        if (s.succ && s.st !== "운영") PRED.set(s.succ, [...(PRED.get(s.succ) || []), c.cd]);
      }
    } catch {
      setStatus("데이터를 준비 중입니다. 잠시 후 다시 방문해 주세요.", true);
      return;
    }
    // 데이터 최종갱신일은 상세 화면 주석에 표시
    // 전국 회원조합수 요약 줄은 표시하지 않음(2026-10-28 결정). 데이터(index.json summary)는 비교 기능용으로 보관.
    route();
  })();
})();
