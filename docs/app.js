(() => {
  "use strict";

  const MAX_SHOW = 30;
  const $ = (id) => document.getElementById(id);
  const qEl = $("q"), ymEl = $("ym"), statusEl = $("status"), resEl = $("results");
  const cache = new Map();

  // ── 유틸 ───────────────────────────────────────────────
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const fmtYm = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월`;
  const fmtNum = (n) => (n === null || n === undefined || n === "") ? "-" : Number(n).toLocaleString("ko-KR");
  const prettyTitle = (t) => (t || "일반현황").replace(/^농협_/, "").replace(/_/g, " · ");

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v; else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);  // 텍스트는 append로만 → XSS 방지
    return e;
  }

  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("err", isErr);
  }

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path} (${r.status})`);
    return r.json();
  }

  async function loadMonth(ym) {
    if (!cache.has(ym)) {
      const data = await getJSON(`data/gene_${ym}.json`);
      for (const c of data.coops) c._k = norm(c.nm);
      cache.set(ym, data);
    }
    const data = cache.get(ym);
    renderSummary(data);
    return data;
  }

  // 전국 회원조합 수 요약
  function renderSummary(data) {
    const box = $("summary");
    const s = (data.summary || []).filter((r) => r.n != null);
    if (!s.length) { box.hidden = true; return; }
    box.replaceChildren(
      el("span", { class: "sum-label" }, `전국 회원조합 (${fmtYm(data.basYm)})`),
      ...s.map((r) => el("span", { class: "chip" }, `${r.d || r.k} `, el("b", {}, fmtNum(r.n))))
    );
    box.hidden = false;
  }

  // 검색어 일치 부분 강조 (DOM 노드로 구성)
  function highlight(name, q) {
    const nq = norm(q);
    if (!nq) return document.createTextNode(name);
    // 공백 무시 매칭: 원문 인덱스 매핑
    const chars = [...name], map = [];
    let flat = "";
    chars.forEach((ch, i) => { if (!/\s/.test(ch)) { flat += ch.toLowerCase(); map.push(i); } });
    const at = flat.indexOf(nq);
    if (at < 0) return document.createTextNode(name);
    const s = map[at], e = map[at + nq.length - 1] + 1;
    const f = document.createDocumentFragment();
    f.append(chars.slice(0, s).join(""), el("mark", {}, chars.slice(s, e).join("")), chars.slice(e).join(""));
    return f;
  }

  function renderCoop(c, q, ym) {
    const groups = new Map();
    for (const r of c.rows) {
      if (!groups.has(r.t)) groups.set(r.t, []);
      groups.get(r.t).push(r);
    }
    const card = el("article", { class: "coop" },
      el("div", { class: "coop-h" },
        el("h2", {}, highlight(c.nm, q)),
        el("span", { class: "meta" }, `기준 ${fmtYm(ym)} · 금융회사코드 ${c.cd || "-"}`)
      )
    );
    for (const [t, rows] of groups) {
      const tb = el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "구분"), el("th", { class: "num" }, "인원")))
      );
      const body = el("tbody");
      for (const r of rows) {
        body.append(el("tr", {}, el("td", {}, r.d || r.k || "-"), el("td", { class: "num" }, fmtNum(r.n))));
      }
      tb.append(body);
      card.append(el("section", { class: "sec" }, el("h3", {}, prettyTitle(t)), tb));
    }
    return card;
  }

  // ── 검색 ───────────────────────────────────────────────
  let seq = 0;
  async function search() {
    const my = ++seq;
    const q = qEl.value.trim().slice(0, 30);
    const ym = ymEl.value;
    syncURL(q, ym);
    if (!ym) return;

    if (!q) {
      resEl.replaceChildren();
      const d = cache.get(ym);
      setStatus(d ? `${fmtYm(ym)} 기준 ${d.count.toLocaleString("ko-KR")}개 조합 자료가 있습니다. 조합명을 입력하세요.` : "조합명을 입력하세요.");
      return;
    }

    let data;
    try { data = await loadMonth(ym); }
    catch (e) { if (my === seq) setStatus("데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", true); return; }
    if (my !== seq) return;

    const nq = norm(q);
    const hits = data.coops.filter((c) => c._k.includes(nq));
    // 정확히 일치 → 앞부분 일치 → 나머지 순
    hits.sort((a, b) => rank(a, nq) - rank(b, nq) || a.nm.localeCompare(b.nm, "ko"));

    resEl.replaceChildren(...hits.slice(0, MAX_SHOW).map((c) => renderCoop(c, q, ym)));
    if (!hits.length) setStatus(`${fmtYm(ym)} 자료에서 ‘${q}’에 해당하는 조합이 없습니다.`);
    else if (hits.length > MAX_SHOW) setStatus(`${hits.length.toLocaleString("ko-KR")}곳이 검색되어 상위 ${MAX_SHOW}곳만 표시합니다. 조합명을 더 구체적으로 입력해 보세요.`);
    else setStatus(`${hits.length}곳 검색됨`);
  }
  const rank = (c, nq) => (c._k === nq ? 0 : c._k.startsWith(nq) ? 1 : 2);

  function syncURL(q, ym) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (ym && ym !== ymEl.dataset.latest) p.set("ym", ym);
    const s = p.toString();
    history.replaceState(null, "", s ? `?${s}` : location.pathname);
  }

  let timer;
  qEl.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 200); });
  ymEl.addEventListener("change", search);
  $("f").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); search(); });

  // ── 초기화 ─────────────────────────────────────────────
  (async () => {
    let idx;
    try { idx = await getJSON("data/index.json"); }
    catch { setStatus("아직 수집된 데이터가 없습니다. 첫 데이터 갱신 후 이용할 수 있습니다.", true); return; }

    ymEl.replaceChildren(...idx.months.map((m) => el("option", { value: m }, fmtYm(m))));
    ymEl.dataset.latest = idx.latest;
    if (idx.updated) $("updated").textContent = `데이터 갱신: ${idx.updated} (KST)`;

    const p = new URLSearchParams(location.search);
    const ym = p.get("ym");
    ymEl.value = ym && idx.months.includes(ym) ? ym : idx.latest;
    qEl.value = (p.get("q") || "").slice(0, 30);

    try { await loadMonth(ymEl.value); } catch { /* search()에서 처리 */ }
    search();
  })();
})();
