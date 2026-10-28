#!/usr/bin/env python3
"""
금융위원회_금융통계농업협동조합정보 수집기
  - 일반현황(getAgriCoopGeneInfo), 재무현황(getAgriCoopFinaInfo), 주요경영지표(getAgriCoopKeyManaIndi)
  - 최근 KEEP_PERIODS개 반기(6월·12월)를 유지. 이미 받은 기준년월은 다시 받지 않는다(이어받기).
  - 결과는 docs/data/ 에 정적 JSON으로 저장
      index.json        기준년월 목록, 전국 요약, 갱신시각
      coops.json        검색용 조합 목록 [[코드, 이름, 최신 기준년월], ...]
      codes.json        표별 항목코드 → 항목명 사전
      coop/<코드>.json  조합별 전체 자료 {ym: {표: [[코드, 값, 구성비], ...]}}

환경변수
  SERVICE_KEY  공공데이터포털 인증키 (GitHub Secrets)
  MAX_NEW      한 번 실행에 새로 받을 기준년월 수 (기본 4)
  BAS_YM       특정 기준년월만 (다시) 받기
  PROBE=true   진단 모드(저장 안 함), PROBE_OPS로 오퍼레이션 지정
  API_BASE     테스트용 서비스 URL 교체
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = os.environ.get("API_BASE", "https://apis.data.go.kr/1160100/service/GetAgriCoopInfoService")
OPS = {
    "gene": "getAgriCoopGeneInfo",
    "fina": "getAgriCoopFinaInfo",
    "kmi": "getAgriCoopKeyManaIndi",
}
KEEP_PERIODS = 10          # 최근 5년 = 반기 10개
ROWS = 1000
MAX_PAGES = 300
SUMMARY_TABLE = "회원조합수"
OUT = Path(__file__).resolve().parent.parent / "docs" / "data"
KST = timezone(timedelta(hours=9))
IN_ACTIONS = bool(os.environ.get("GITHUB_ACTIONS"))


class ApiError(Exception):
    pass


def log(msg: str, level: str = "") -> None:
    print(msg, flush=True)
    if IN_ACTIONS and level:
        print(f"::{level} title=수집::" + msg.replace("\n", " | "), flush=True)


# ── API ────────────────────────────────────────────────────────────────
def call(key: str, op: str, **params) -> dict:
    q = {"serviceKey": key, "resultType": "json", **params}
    url = f"{BASE}/{op}?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
            js = json.loads(raw)
            break
        except json.JSONDecodeError:
            m = re.search(r"<(?:returnAuthMsg|resultMsg|errMsg)>([^<]+)<", raw)
            last = ApiError("API 오류: " + (m.group(1) if m else raw[:200].replace(key, "***")))
        except Exception as e:  # 네트워크 일시 오류
            last = e
        time.sleep(3 * (attempt + 1))
    else:
        if isinstance(last, ApiError):
            raise last
        raise ApiError(f"API 서버 연결 실패: {type(last).__name__} - {str(last).replace(key, '***')[:150]}")

    head = js.get("response", {}).get("header", {})
    if head.get("resultCode") != "00":
        raise ApiError(f"API 오류 {head.get('resultCode')}: {head.get('resultMsg')}")
    body = js["response"].get("body", {}) or {}

    # 실제 응답은 body.tableList[] 에 표(title)별로 나뉘어 온다
    blocks = body.get("tableList")
    if isinstance(blocks, dict):
        blocks = [blocks]
    if not blocks:
        blocks = [body]
    tables = []
    for b in blocks:
        its = b.get("items") or {}
        its = its.get("item", []) if isinstance(its, dict) else []
        its = [its] if isinstance(its, dict) else list(its)
        tables.append({"title": str(b.get("title") or ""), "total": int(b.get("totalCount") or 0), "items": its})
    return {"tables": tables, "max": max((t["total"] for t in tables), default=0)}


def coop_total(r: dict) -> int:
    return sum(t["total"] for t in r["tables"] if SUMMARY_TABLE not in t["title"])


def fetch(key: str, op: str, ym: str) -> list:
    """한 오퍼레이션의 한 기준년월 전체. pageNo는 표마다 동시에 적용된다."""
    first = call(key, op, basYm=ym, pageNo=1, numOfRows=ROWS)
    pages = min(-(-first["max"] // ROWS), MAX_PAGES)
    tables = {t["title"]: list(t["items"]) for t in first["tables"]}
    for p in range(2, pages + 1):
        time.sleep(0.2)
        for t in call(key, op, basYm=ym, pageNo=p, numOfRows=ROWS)["tables"]:
            tables.setdefault(t["title"], []).extend(t["items"])
    got = sum(len(v) for v in tables.values())
    expect = sum(t["total"] for t in first["tables"])
    log(f"[{ym}] {op}: 표 {len(tables)}개, {got:,}/{expect:,}건, {pages}회 호출")
    if got < expect * 0.98:
        raise ApiError(f"[{ym}] {op} 수집 건수 부족 ({got}/{expect})")
    return [(title, it) for title, its in tables.items() for it in its]


# ── 항목 정규화 ─────────────────────────────────────────────────────────
VALUE_SUFFIX = ("Amt", "At", "Val", "Cnt")


def fields(it: dict):
    code = name = val = rto = None
    for k, v in it.items():
        if k.endswith("DcdNm"):
            name = v
        elif k.endswith("Dcd"):
            code = v
        elif k.endswith("Rto"):
            rto = v
        elif k.endswith(VALUE_SUFFIX) and k not in ("basYm",):
            val = v
    return code, name, val, rto


def num(v):
    if v in (None, ""):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return int(f) if f.is_integer() and abs(f) < 2 ** 53 else round(f, 4)


def table_key(title: str) -> str:
    return re.sub(r"^농협_", "", title).strip()


# ── 파일 입출력 ─────────────────────────────────────────────────────────
def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if path.exists() and path.read_text(encoding="utf-8") == data:
        return
    tmp = path.with_suffix(".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)


# ── 기준년월 ───────────────────────────────────────────────────────────
def half_years_back(n: int, start: str):
    y, m = int(start[:4]), int(start[4:])
    out = []
    while len(out) < n:
        if m in (6, 12):
            out.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def find_latest(key: str) -> str:
    today = date.today()
    for ym in half_years_back(8, f"{today.year:04d}{today.month:02d}"):
        if coop_total(call(key, OPS["gene"], basYm=ym, pageNo=1, numOfRows=1)) > 0:
            return ym
        time.sleep(0.2)
    raise ApiError("최근 4년 안에 데이터가 있는 기준년월을 찾지 못했습니다.")


# ── 수집 본체 ───────────────────────────────────────────────────────────
def collect_month(key: str, ym: str, codes: dict):
    """한 기준년월의 3개 기능 전체 → (조합별 자료, 조합 이름, 전국요약)"""
    per_coop, names, summary = {}, {}, []
    for op in OPS.values():
        for title, it in fetch(key, op, ym):
            tk = table_key(title)
            code, name, val, rto = fields(it)
            if code is None:
                continue
            code = str(code)
            tbl = codes.setdefault(tk, {})
            if name:
                tbl[code] = str(name).strip()
            row = [code, num(val)]
            if rto not in (None, ""):
                row.append(num(rto))
            if SUMMARY_TABLE in tk:
                summary.append(row)
                continue
            cd = str(it.get("fncoCd") or "").strip()
            if not cd:
                continue
            names[cd] = (str(it.get("fncoNm") or "").strip(), str(it.get("crno") or "").strip())
            per_coop.setdefault(cd, {}).setdefault(tk, []).append(row)
        time.sleep(0.5)
    for tbls in per_coop.values():
        for rows in tbls.values():
            rows.sort(key=lambda r: r[0])
    return per_coop, names, summary


def probe(key: str) -> None:
    for op in os.environ.get("PROBE_OPS", ",".join(OPS.values())).split(","):
        r = call(key, op.strip(), pageNo=1, numOfRows=3)
        for t in r["tables"]:
            keys = sorted({k for i in t["items"] for k in i})
            log(f"{op} [표] {t['title']} total={t['total']} 필드={keys}", "notice")


def main() -> int:
    key = os.environ.get("SERVICE_KEY", "").strip()
    if not key:
        log("SERVICE_KEY가 없습니다. 저장소 Settings > Secrets에 등록하세요.", "error")
        return 2
    only = os.environ.get("BAS_YM", "").strip()
    if only and not re.fullmatch(r"20\d{2}(06|12)", only):
        log(f"BAS_YM은 반기말(YYYY06/YYYY12)이어야 합니다: {only}", "error")
        return 2
    max_new = int(os.environ.get("MAX_NEW", "4") or 4)

    try:
        if os.environ.get("PROBE") == "true":
            probe(key)
            return 0

        index = read_json(OUT / "index.json", {})
        codes = read_json(OUT / "codes.json", {})
        coop_list = {c[0]: c for c in read_json(OUT / "coops.json", {}).get("list", [])}
        done = set(index.get("months", []))
        summaries = index.get("summary", {})
        empty = set(index.get("empty", []))          # 데이터가 없던 기준년월(재시도 안 함)

        latest = find_latest(key)
        target = half_years_back(KEEP_PERIODS, latest)          # 최신순
        todo = [only] if only else [m for m in target if m not in done and m not in empty][:max_new]
        log(f"최신 기준년월 {latest}, 유지 대상 {target[-1]}~{target[0]}, 이번 수집 {todo or '없음'}")

        coop_dir = OUT / "coop"

        def save_meta(changed: bool) -> list:
            months = sorted(done, reverse=True)
            write_json(OUT / "codes.json", codes)
            write_json(OUT / "coops.json", {"list": sorted(coop_list.values(), key=lambda c: (c[1], c[0]))})
            new_index = {"months": months, "latest": months[0] if months else None,
                         "summary": {m: summaries[m] for m in months if m in summaries},
                         "empty": sorted(empty & set(target))}
            same = {k: index.get(k) for k in new_index} == new_index
            new_index["updated"] = index.get("updated") if same and not changed \
                else datetime.now(KST).strftime("%Y-%m-%d %H:%M")
            write_json(OUT / "index.json", new_index)
            return months

        for ym in todo:
            per_coop, names, summary = collect_month(key, ym, codes)
            if not per_coop:
                log(f"[{ym}] 데이터가 없어 건너뜁니다.", "warning")
                empty.add(ym)
                continue
            for cd, tbls in per_coop.items():
                path = coop_dir / f"{re.sub(r'[^0-9A-Za-z]', '', cd)}.json"
                doc = read_json(path, {"cd": cd, "d": {}})
                doc["d"][ym] = tbls
                last_ym = max(doc["d"])
                if ym >= last_ym or "nm" not in doc:          # 이름은 가장 최신 기준년월 것을 사용
                    doc["nm"], doc["crno"] = names[cd]
                write_json(path, doc)
                old = coop_list.get(cd)
                if not old or ym >= old[2]:
                    coop_list[cd] = [cd, names[cd][0], ym]
            summaries[ym] = summary
            done.add(ym)
            save_meta(True)          # 기준년월마다 저장 → 중간에 실패해도 받은 데까지는 유지
            log(f"[{ym}] 저장: 조합 {len(per_coop):,}곳")

        # 유지 기간 밖 기준년월 정리
        keep = set(target) | ({only} if only else set())
        drop = done - keep
        if drop:
            for path in coop_dir.glob("*.json"):
                doc = read_json(path, None)
                if not doc:
                    continue
                for ym in drop:
                    doc["d"].pop(ym, None)
                if doc["d"]:
                    write_json(path, doc)
                else:
                    path.unlink()
                    coop_list.pop(doc.get("cd"), None)
            for ym in drop:
                summaries.pop(ym, None)
            done -= drop
            log(f"유지 기간이 지난 기준년월 삭제: {sorted(drop)}")

        months = save_meta(bool(todo) or bool(drop))

        remain = [m for m in target if m not in done and m not in empty]
        log(f"완료: 보유 {len(months)}개 반기, 조합 {len(coop_list):,}곳" + (f", 남은 기준년월 {remain}" if remain else ""),
            "notice")
    except ApiError as e:
        log(str(e), "error")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
