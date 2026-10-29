#!/usr/bin/env python3
"""금감원 FISIS 금융회사 목록(농업협동조합 Q)의 원본 정보를 meta.csv에 반영.
  finance_path '농협단위조합\\농협(서울)\\…' → 소속구역_광역(지역본부, 원본: 추정 표시 제거)
     ※ 행정구역이 아니라 소속 지역본부 기준(과천·광명=서울, 경산=대구, 군위=경북)
  finance_nm '성전농협[폐]' 처럼 원자료 이름과 다르면 → 이전명칭(원본)
입력: docs/data/probe/fisis_company_Q.json (fisis_probe.py 결과)"""
import csv, io, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "docs" / "data" / "meta" / "coop_meta.csv"
comp = json.loads((ROOT / "docs" / "data" / "probe" / "fisis_company_Q.json").read_text(encoding="utf-8"))["list"]
fs = {c["finance_cd"]: c for c in comp}
rows = list(csv.DictReader(io.StringIO(META.read_text(encoding="utf-8-sig"))))
cols = list(rows[0].keys())
code = lambda v: (v or "").strip().lstrip("=").strip('"')
n_sido = n_prev = 0
for r in rows:
    c = fs.get(code(r["금융회사코드"]))
    if not c:
        continue
    est = [x for x in r["추정"].split(";") if x]
    m = re.search(r"농협\((.+?)\)", c.get("finance_path", ""))
    if m:
        if r["소속구역_광역"] != m.group(1) or "소속구역_광역" in est:
            n_sido += 1
        r["소속구역_광역"] = m.group(1)
        est = [x for x in est if x != "소속구역_광역"]
    old = re.sub(r"\[폐\]$", "", c.get("finance_nm", "")).strip()
    if old and old != r["조합명(참고)"]:
        prev = [x.strip() for x in re.split(r"[;；]", r["이전명칭"]) if x.strip()]
        if old not in prev:
            prev.insert(0, old)
        r["이전명칭"] = ";".join(prev)
        if prev == [old]:
            est = [x for x in est if x != "이전명칭"]
        n_prev += 1
    r["추정"] = ";".join(est)
out = io.StringIO()
w = csv.writer(out, lineterminator="\r\n")
w.writerow(cols)
for r in rows:
    w.writerow([("@@" + code(r[c])) if c in ("금융회사코드", "승계조합코드") and code(r[c]) else r[c] for c in cols])
META.write_text("﻿" + re.sub(r"@@(\d{13})", r'="\1"', out.getvalue()), encoding="utf-8")
print(f"소속구역_광역 원본 반영 {n_sido}곳, 이전명칭 원본 {n_prev}곳")
