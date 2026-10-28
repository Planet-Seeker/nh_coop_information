#!/usr/bin/env python3
"""
금융위원회_금융회사기본정보(getFnCoOutl)에서 이름에 '협동조합'이 들어간 금융회사를 모두 받아
법인등록번호별 최신 기록만 남겨 저장한다. 조합 주소(행정구역) 채우기의 원자료.
  출처: 기관 fsc(금융위원회) / 자료 fnco_basic(금융회사기본정보)
  저장: docs/data/meta/fnco_coops.json
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = "https://apis.data.go.kr/1160100/service/GetFnCoBasiInfoService/getFnCoOutl"
KEY = os.environ.get("SERVICE_KEY", "").strip()
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "meta" / "fnco_coops.json"
ROWS = 1000
KEEP = ["crno", "fncoNm", "fncoAdr", "fncoZpcd", "bzno", "fncoEstbDt", "fncoTlno", "basDt"]


def call(page):
    q = {"serviceKey": KEY, "resultType": "json", "pageNo": page, "numOfRows": ROWS, "fncoNm": "협동조합"}
    for attempt in range(4):
        try:
            with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(q), timeout=90) as r:
                js = json.loads(r.read().decode("utf-8", "replace"))
            body = js["response"]["body"]
            items = (body.get("items") or {}).get("item", []) if isinstance(body.get("items"), dict) else []
            return int(body.get("totalCount") or 0), ([items] if isinstance(items, dict) else items)
        except Exception as e:  # noqa
            last = e
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"API 호출 실패: {type(last).__name__}")


def main():
    if not KEY:
        raise SystemExit("SERVICE_KEY 없음")
    total, items = call(1)
    pages = -(-total // ROWS)
    print(f"totalCount={total}, {pages}페이지", flush=True)
    for p in range(2, pages + 1):
        time.sleep(0.3)
        items += call(p)[1]
    latest = {}
    for it in items:
        crno = str(it.get("crno") or "").strip()
        key = crno or str(it.get("fncoNm"))
        rec = {k: str(it.get(k) or "").strip() for k in KEEP}
        if key not in latest or rec["basDt"] > latest[key]["basDt"]:
            latest[key] = rec
    recs = sorted(latest.values(), key=lambda r: (r["fncoNm"], r["crno"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": {"org": "fsc", "dataset": "fnco_basic", "api": "금융위원회_금융회사기본정보"},
                               "query": "fncoNm=협동조합", "total_raw": total, "records": recs},
                              ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"::notice title=주소 원자료::원자료 {total}건 → 법인별 최신 {len(recs)}건 저장", flush=True)


if __name__ == "__main__":
    main()
