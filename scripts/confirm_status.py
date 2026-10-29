#!/usr/bin/env python3
"""지자체(시군) 소속 확인 현황표 CONFIRM.md 생성. 사용자 캡처(농협 홈페이지 지역 농·축협 목록)로 확인한 단위는 '확정'.
운영 중인 조합 기준. 사용: python3 scripts/confirm_status.py"""
import csv, collections
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
rows = [r for r in csv.DictReader(open(ROOT / "docs/data/meta/coop_meta.csv", encoding="utf-8-sig")) if r["상태"] == "운영"]
ORDER = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
conf, est, blank = (collections.defaultdict(collections.Counter) for _ in range(3))
rule = collections.Counter()   # 지역축협·품목농협·품목축협: 규칙상 지역본부 직할
total = collections.Counter()
for r in rows:
    h, b = r["소속구역_광역"], r["소속구역_기초"]
    total[h] += 1
    if r["유형"] != "지역농협" and b == "직할":
        rule[h] += 1
    elif not b:
        blank[h][r["유형"]] += 1
    elif "소속구역_기초" in r["추정"].split(";"):
        est[h][b] += 1
    else:
        conf[h][b] += 1
out = ["# 지자체 소속 확인 현황", "",
       "농협 홈페이지 '지역 농·축협' 목록 캡처로 확인한 시군(회원지원국·지부) 단위는 **확정**, 그 밖은 추정 또는 미정입니다.",
       "운영 중인 조합 기준이며 `python3 scripts/confirm_status.py`로 다시 만듭니다.", "",
       "지역축협·품목농협·품목축협은 규칙상 지역본부 직할이라 따로 셉니다. 확인 대상은 지역농협의 시군 단위입니다.", "",
       "| 지역본부 | 조합 수 | 축협·품목 직할 | 확정 | 추정(조합 수) | 미정 |", "|---|---|---|---|---|---|"]
for h in ORDER:
    c = ", ".join(f"{k}({v})" for k, v in sorted(conf[h].items())) or "-"
    e = ", ".join(f"{k}({v})" for k, v in sorted(est[h].items())) or "-"
    b = ", ".join(f"{k} {v}" for k, v in blank[h].items()) or "-"
    out.append(f"| {h} | {total[h]} | {rule[h]} | {c} | {e} | {b} |")
done = sum(sum(v.values()) for v in conf.values())
out += ["", f"지역농협 확정 {done}곳 / 운영 지역농협 {sum(1 for r in rows if r['유형'] == '지역농협')}곳"]
(ROOT / "CONFIRM.md").write_text("\n".join(out) + "\n", encoding="utf-8")
print(out[-1])
