#!/usr/bin/env python3
"""금감원 FISIS 조회 결과(statisticsInfoSearch 행 목록)를 사이트 형식으로 저장.
  docs/data/fss/coop/<코드>.json  {"cd","src":"fss","d":{기준년월:{표:[[항목코드,값],...]}}}
  docs/data/fss/codes.json        {표:{항목코드:항목명}}
금융위원회 자료와 별도 출처로 보관(금감원 자료는 공식 통계 아님 → 화면에서 금융위원회 값 우선, 다르면 병기).
사용: python3 scripts/fss_convert.py docs/data/probe/fisis_span_<코드>.json"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "fss"
TABLES = {  # FISIS 통계코드 → 사이트 표 key
    "SQ014": "fss_대출채권", "SQ015": "fss_유가증권", "SQ016": "fss_예수부채·차입부채", "SQ017": "fss_유형자산",
    "SQ018": "fss_수수료 손익", "SQ019": "fss_유가증권 평가·처분 손익", "SQ020": "fss_이자 손익·판매비와 관리비",
    "SQ021": "fss_유형별 대출(조합원·비조합원)",
}


def num(v):
    try:
        f = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else round(f, 4)


def convert(rows_by_list, codes):
    d = {}
    for no, rows in rows_by_list.items():
        t = TABLES.get(no)
        if not t:
            continue
        for x in rows:
            v = x.get("a") if x.get("a") not in (None, "") else x.get("b")
            codes.setdefault(t, {})[x["account_cd"]] = x["account_nm"].strip()
            d.setdefault(x["base_month"], {}).setdefault(t, []).append([x["account_cd"], num(v)])
    for tb in d.values():
        for rows in tb.values():
            rows.sort(key=lambda r: r[0])
    return d


def main():
    src = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cd = Path(sys.argv[1]).stem.split("_")[-1]
    codes_p = OUT / "codes.json"
    codes = json.loads(codes_p.read_text(encoding="utf-8")) if codes_p.exists() else {}
    d = convert({no: t["values"] for no, t in src.items()}, codes)
    (OUT / "coop").mkdir(parents=True, exist_ok=True)
    (OUT / "coop" / f"{cd}.json").write_text(json.dumps({"cd": cd, "src": "fss", "d": d}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    codes_p.write_text(json.dumps(codes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(cd, len(d), "개 기준년월")


if __name__ == "__main__":
    main()
