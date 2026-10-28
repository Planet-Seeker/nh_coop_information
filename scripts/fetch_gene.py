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


def call(key: str, **params) -> dict:
    q = {"serviceKey": key, "resultType": "json", **params}
    url = API + "?" + urllib.parse.urlencode(q)
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
    items = (body.get("items") or {})
    items = items.get("item", []) if isinstance(items, dict) else []
    if isinstance(items, dict):
        items = [items]
    return {"total": int(body.get("totalCount") or 0), "items": items}


def months_back(n: int):
    y, m = date.today().year, date.today().month
    for _ in range(n):
        yield f"{y:04d}{m:02d}"
        m -= 1
        if m == 0:
            y, m = y - 1, 12


def find_latest(key: str) -> str:
    for ym in months_back(LOOKBACK_MONTHS):
        if call(key, basYm=ym, pageNo=1, numOfRows=1)["total"] > 0:
            return ym
        time.sleep(0.2)
    raise ApiError(f"최근 {LOOKBACK_MONTHS}개월 안에 데이터가 있는 기준년월을 찾지 못했습니다.")


def notice(msg: str) -> None:
    print(msg)
    if os.environ.get("GITHUB_ACTIONS"):
        print("::notice title=진단::" + msg.replace("\n", " | "))


def probe(key: str) -> None:
    """기준년월 없이 조회해 실제 보유 데이터의 범위와 구성을 확인한다."""
    from collections import Counter
    T = "농협_일반현황_임직원현황"
    for rt in ("json", "xml"):
        url = API + "?" + urllib.parse.urlencode({"serviceKey": key, "resultType": rt, "pageNo": 1, "numOfRows": 2})
        with urllib.request.urlopen(url, timeout=30) as r:
            raw = r.read().decode("utf-8", "replace")
        notice(f"원문({rt}): " + re.sub(r"\s+", " ", raw).replace(key, "***")[:700])
    combos = [
        {}, {"title": T}, {"basYm": "201112"}, {"title": T, "basYm": "201112"},
        {"basYm": "202312"}, {"title": T, "basYm": "202312"}, {"basYm": "202412"},
    ]
    for c in combos:
        try:
            r = call(key, pageNo=1, numOfRows=1, **c)
            it = r["items"][0] if r["items"] else {}
            notice(f"{c or '조건없음'} → totalCount={r['total']} {json.dumps(it, ensure_ascii=False)[:200]}")
        except ApiError as e:
            notice(f"{c or '조건없음'} → {e}")
        time.sleep(0.3)
    first = call(key, pageNo=1, numOfRows=ROWS, title=T)
    total = first["total"]
    if not total:
        return
    pages = -(-total // ROWS)
    samples = list(first["items"])
    if pages > 1:
        samples += call(key, pageNo=pages, numOfRows=ROWS, title=T)["items"]
    yms = Counter(str(i.get("basYm")) for i in samples)
    titles = Counter(str(i.get("title")) for i in samples)
    notice(f"첫/마지막 페이지 기준년월 범위 {min(yms)} ~ {max(yms)} / 표본 월 {sorted(yms)[-12:]}")
    notice("표본 title: " + ", ".join(f"{t}({n})" for t, n in titles.most_common(10)))
    notice("첫 항목: " + json.dumps(first["items"][0], ensure_ascii=False)[:400])


def fetch_month(key: str, ym: str) -> list:
    first = call(key, basYm=ym, pageNo=1, numOfRows=ROWS)
    items = list(first["items"])
    pages = min(-(-first["total"] // ROWS), MAX_PAGES)
    for p in range(2, pages + 1):
        time.sleep(0.3)
        items += call(key, basYm=ym, pageNo=p, numOfRows=ROWS)["items"]
    print(f"[{ym}] totalCount={first['total']} 수집={len(items)}건 ({pages}회 호출)")
    return items


def to_num(v):
    try:
        f = float(str(v).replace(",", ""))
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def build(ym: str, items: list) -> dict:
    """조합(금융회사코드)별로 묶어 용량을 줄인다."""
    coops = {}
    for it in items:
        cd = str(it.get("fncoCd") or "").strip()
        nm = str(it.get("fncoNm") or "").strip()
        if not cd and not nm:
            continue
        c = coops.setdefault(cd or nm, {"cd": cd, "nm": nm, "crno": str(it.get("crno") or ""), "rows": []})
        c["rows"].append({
            "t": str(it.get("title") or ""),
            "k": str(it.get("xcsmDcd") or ""),
            "d": str(it.get("xcsmDcdNm") or "").strip(),
            "n": to_num(it.get("xcsmCnt")),
        })
    lst = sorted(coops.values(), key=lambda c: c["nm"])
    for c in lst:
        c["rows"].sort(key=lambda r: (r["t"], r["k"]))
    return {"basYm": ym, "count": len(lst), "coops": lst}


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
