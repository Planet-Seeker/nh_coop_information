#!/usr/bin/env python3
"""
금융위원회_금융통계농업협동조합정보 > 농업협동조합일반현황조회(getAgriCoopGeneInfo)
기준년월 전체를 수집해 docs/data/ 아래 정적 JSON으로 저장한다.

환경변수
  SERVICE_KEY : 공공데이터포털 일반 인증키(Decoding)  ※ GitHub Secrets로 주입
  BAS_YM      : (선택) 수집할 기준년월 YYYYMM. 비우면 데이터가 있는 최신 월을 자동 탐색
  API_BASE    : (선택) 테스트용 엔드포인트 교체
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

API = os.environ.get(
    "API_BASE",
    "https://apis.data.go.kr/1160100/service/GetAgriCoopInfoService/getAgriCoopGeneInfo",
)
ROWS = 1000
MAX_PAGES = 100
LOOKBACK_MONTHS = 36
OUT = Path(__file__).resolve().parent.parent / "docs" / "data"
KST = timezone(timedelta(hours=9))


class ApiError(Exception):
    pass


def call(key: str, op: str = "", **params) -> dict:
    q = {"serviceKey": key, "resultType": "json", **params}
    base = API.rsplit("/", 1)[0] + "/" + op if op else API
    url = base + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                raw = r.read().decode("utf-8", "replace")
            break
        except Exception as e:  # 네트워크 일시 오류 재시도
            last = e
            time.sleep(2 * (attempt + 1))
    else:
        detail = str(last).replace(key, "***")[:150]
        raise ApiError(f"API 서버 연결 실패: {type(last).__name__} - {detail}")

    try:
        js = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"<(?:returnAuthMsg|resultMsg|errMsg)>([^<]+)<", raw)
        raise ApiError("API 오류: " + (m.group(1) if m else raw[:200].replace(key, "***")))

    head = js.get("response", {}).get("header", {})
    if head.get("resultCode") != "00":
        raise ApiError(f"API 오류 {head.get('resultCode')}: {head.get('resultMsg')}")
    body = js["response"].get("body", {}) or {}

    def unpack(block):
        its = block.get("items") or {}
        its = its.get("item", []) if isinstance(its, dict) else []
        return [its] if isinstance(its, dict) else list(its)

    # 실제 응답은 body.tableList[] 에 표(title)별로 나뉘어 온다. 명세식 단일 구조도 함께 지원.
    blocks = body.get("tableList")
    if isinstance(blocks, dict):
        blocks = [blocks]
    if not blocks:
        blocks = [body]
    tables = []
    for b in blocks:
        t = str(b.get("title") or "")
        its = unpack(b)
        for i in its:
            i.setdefault("title", t)
        tables.append({"title": t, "total": int(b.get("totalCount") or 0), "items": its})
    return {
        "tables": tables,
        "total": max((t["total"] for t in tables), default=0),   # 페이지 수 계산용(표마다 같은 pageNo가 적용됨)
        "items": [i for t in tables for i in t["items"]],
    }


def months_back(n: int):
    y, m = date.today().year, date.today().month
    for _ in range(n):
        yield f"{y:04d}{m:02d}"
        m -= 1
        if m == 0:
            y, m = y - 1, 12


COOP_TABLE = "임직원"       # 조합별 자료가 담긴 표(title에 포함된 글자)
SUMMARY_TABLE = "회원조합수"  # 전국 합계 요약표


def coop_total(r: dict) -> int:
    return sum(t["total"] for t in r["tables"] if COOP_TABLE in t["title"])


def find_latest(key: str) -> str:
    for ym in months_back(LOOKBACK_MONTHS):
        if coop_total(call(key, basYm=ym, pageNo=1, numOfRows=1)) > 0:
            return ym
        time.sleep(0.2)
    raise ApiError(f"최근 {LOOKBACK_MONTHS}개월 안에 데이터가 있는 기준년월을 찾지 못했습니다.")


def notice(msg: str) -> None:
    print(msg)
    if os.environ.get("GITHUB_ACTIONS"):
        print("::notice title=진단::" + msg.replace("\n", " | "))


def probe(key: str) -> None:
    """각 오퍼레이션의 표(title) 구성, 필드, 기준년월별 건수를 확인한다."""
    for op in ("getAgriCoopFinaInfo", "getAgriCoopKeyManaIndi"):
        try:
            r = call(key, op, pageNo=1, numOfRows=3)
        except ApiError as e:
            notice(f"{op}: {e}")
            continue
        notice(f"{op}: 표 {len(r['tables'])}개")
        for t in r["tables"]:
            keys = sorted({k for i in t["items"] for k in i} - {"title", "crno"})
            sample = json.dumps({k: v for k, v in t["items"][0].items() if k not in ("title", "crno")}, ensure_ascii=False)[:260] if t["items"] else ""
            notice(f"{op} [표] {t['title']} total={t['total']} 필드={keys} 예={sample}")
        for ym in ("202606", "202603", "202512"):
            r = call(key, op, pageNo=1, numOfRows=1, basYm=ym)
            notice(f"{op} basYm={ym}: " + ", ".join(f"{t['title']}={t['total']}" for t in r["tables"]))
            time.sleep(0.3)


def fetch_month(key: str, ym: str) -> list:
    first = call(key, basYm=ym, pageNo=1, numOfRows=ROWS)
    items = list(first["items"])
    pages = min(-(-max(coop_total(first), 1) // ROWS), MAX_PAGES)
    for p in range(2, pages + 1):
        time.sleep(0.3)
        items += call(key, basYm=ym, pageNo=p, numOfRows=ROWS)["items"]
    print(f"[{ym}] 조합별 totalCount={coop_total(first)} 수집={len(items)}건 ({pages}회 호출)")
    return items


def to_num(v):
    try:
        f = float(str(v).replace(",", ""))
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def pick(it: dict, suffix: str):
    """필드명 접미사로 값 찾기 (표마다 xcsmCnt / nhUnnCnt 처럼 이름이 달라서)"""
    for k, v in it.items():
        if k.endswith(suffix) and not (suffix == "Dcd" and k.endswith("DcdNm")):
            return v
    return None


def build(ym: str, items: list) -> dict:
    """조합(금융회사코드)별로 묶어 용량을 줄인다. 전국 요약표는 summary로 분리."""
    coops, summary, seen = {}, [], set()
    for it in items:
        sig = json.dumps(it, sort_keys=True, ensure_ascii=False)
        if sig in seen:
            continue
        seen.add(sig)
        title = str(it.get("title") or "")
        row = {
            "t": title,
            "k": str(pick(it, "Dcd") or ""),
            "d": str(pick(it, "DcdNm") or "").strip(),
            "n": to_num(pick(it, "Cnt")),
        }
        if SUMMARY_TABLE in title:
            summary.append(row)
            continue
        cd = str(it.get("fncoCd") or "").strip()
        nm = str(it.get("fncoNm") or "").strip()
        if not cd and not nm:
            continue
        c = coops.setdefault(cd or nm, {"cd": cd, "nm": nm, "crno": str(it.get("crno") or ""), "rows": []})
        c["rows"].append(row)
    lst = sorted(coops.values(), key=lambda c: c["nm"])
    for c in lst:
        c["rows"].sort(key=lambda r: (r["t"], r["k"]))
    summary.sort(key=lambda r: r["k"])
    return {"basYm": ym, "count": len(lst), "summary": summary, "coops": lst}


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    key = os.environ.get("SERVICE_KEY", "").strip()
    if not key:
        print("SERVICE_KEY 환경변수가 없습니다. 저장소 Settings > Secrets에 등록하세요.", file=sys.stderr)
        return 2

    ym = os.environ.get("BAS_YM", "").strip()
    if ym and not re.fullmatch(r"(19|20)\d{2}(0[1-9]|1[0-2])", ym):
        print(f"BAS_YM 형식 오류: {ym}", file=sys.stderr)
        return 2

    try:
        if os.environ.get("PROBE") == "true":
            probe(key)
            return 0
        ym = ym or find_latest(key)
        data = build(ym, fetch_month(key, ym))
    except ApiError as e:
        print(str(e), file=sys.stderr)
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=API 수집 실패::{e}")  # Actions 요약(Annotations)에 표시
        return 1

    if data["count"] == 0:
        print(f"[{ym}] 수집된 조합이 없어 저장하지 않습니다.", file=sys.stderr)
        return 1

    write_json(OUT / f"gene_{ym}.json", data)

    # 보유 중인 기준년월 목록(최신순) 갱신
    months = sorted(
        {p.stem.split("_")[1] for p in OUT.glob("gene_*.json")}, reverse=True
    )
    idx_path = OUT / "index.json"
    old = {}
    if idx_path.exists():
        try:
            old = json.loads(idx_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    idx = {"months": months, "latest": months[0]}
    # 데이터가 실제로 바뀌지 않았으면 갱신시각도 유지 → 불필요한 커밋 방지
    idx["updated"] = old.get("updated") if {k: old.get(k) for k in idx} == idx else datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    write_json(idx_path, idx)
    print(f"저장 완료: gene_{ym}.json ({data['count']}개 조합), 보유 기준년월 {months}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
