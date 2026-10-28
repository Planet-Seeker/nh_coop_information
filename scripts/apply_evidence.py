#!/usr/bin/env python3
"""scripts/merger_evidence.json(웹 교차검증 기록)을 meta.csv에 반영.
확인·정황이면 상태=합병, 승계조합코드(있으면), 이전명칭(비어 있을 때만), 비고="확인|정황: 내용 (출처)".
비고에 '자동 추정'만 있거나 비어 있는 행만 고친다(수기로 적은 비고는 보존)."""
import csv, io, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "docs" / "data" / "meta" / "coop_meta.csv"
ev = {k: v for k, v in json.loads((ROOT / "scripts" / "merger_evidence.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
text = META.read_text(encoding="utf-8-sig")
rows = list(csv.DictReader(io.StringIO(text)))
cols = list(rows[0].keys())
code = lambda v: (v or "").strip().lstrip("=").strip('"')
n = 0
for r in rows:
    e = ev.get(code(r["금융회사코드"]))
    if not e:
        continue
    if r["비고"] and "자동 추정" not in r["비고"] and not re.match(r"^(확인|정황):", r["비고"]):
        continue
    if e["grade"] == "미확인":                     # 상태·승계는 자동 추정 그대로, 비고만 표시
        r["비고"] = "자동 추정(웹 검색 근거 없음)"
        n += 1
        continue
    r["상태"] = e.get("st", "합병")
    if "succ" in e:
        r["승계조합코드"] = e["succ"]
    if e.get("prev") and not r["이전명칭"]:
        r["이전명칭"] = e["prev"]
    r["비고"] = f'{e["grade"]}: {e["note"]} ({e["src"]})'
    if "추정" in r:                              # 웹 근거도 원자료가 아니므로 추정
        est = [x for x in r["추정"].split(";") if x] + [c for c in ("상태", "승계조합코드", "이전명칭") if code(r[c])]
        r["추정"] = ";".join(dict.fromkeys(est))
    n += 1
out = io.StringIO()
w = csv.writer(out, lineterminator="\r\n")
w.writerow(cols)
for r in rows:
    w.writerow([("@@" + code(r[c]) if c in ("금융회사코드", "승계조합코드") and code(r[c]) else r[c]) for c in cols])
META.write_text("﻿" + re.sub(r"@@(\d{13})", r'="\1"', out.getvalue()), encoding="utf-8")
print(f"반영 {n}건")
