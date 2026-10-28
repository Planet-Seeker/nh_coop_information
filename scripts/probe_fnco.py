#!/usr/bin/env python3
"""금융위원회_금융회사기본정보 API에 단위농협이 있는지 확인하는 진단 스크립트(저장 안 함)."""
import json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
API = "https://apis.data.go.kr/1160100/service/GetFnCoBasiInfoService/getFnCoOutl"
KEY = os.environ["SERVICE_KEY"].strip()

def call(**p):
    q = {"serviceKey": KEY, "resultType": "json", "pageNo": 1, "numOfRows": 10, **p}
    with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(q), timeout=60) as r:
        raw = r.read().decode("utf-8", "replace")
    try:
        js = json.loads(raw)
    except json.JSONDecodeError:
        return {"err": re.sub(r"\s+", " ", raw)[:300].replace(KEY, "***")}
    body = js.get("response", {}).get("body", {}) or {}
    head = js.get("response", {}).get("header", {})
    items = (body.get("items") or {}).get("item", []) if isinstance(body.get("items"), dict) else []
    if isinstance(items, dict): items = [items]
    return {"code": head.get("resultCode"), "total": body.get("totalCount"), "items": items}

def note(msg): print("::notice title=주소API::" + msg.replace("\n", " ")[:900], flush=True)

r = call()
note(f"조건없음 total={r.get('total')} code={r.get('code')} {r.get('err','')} 예={[(i.get('fncoNm'), i.get('basDt')) for i in r.get('items', [])[:5]]}")
data = Path("docs/data")
coops = [c for c in json.loads((data / "coops.json").read_text())["list"] if re.fullmatch(r"0010027\d{6}", c[0])]
with_crno = []
for cd, nm, ym in coops:
    d = json.loads((data / "coop" / f"{cd}.json").read_text())
    if d.get("crno") and not d["crno"].startswith("000000"):
        with_crno.append((nm, d["crno"]))
for nm, crno in with_crno[:3]:
    r = call(crno=crno); time.sleep(0.3)
    note(f"crno {nm} {crno} → total={r.get('total')} {r.get('err','')} {[(i.get('fncoNm'), i.get('fncoAdr'), i.get('basDt')) for i in r.get('items', [])[:3]]}")
for q in ["오창농업협동조합", "오창농협", "천안축산업협동조합", "가산농업협동조합", "농업협동조합"]:
    r = call(fncoNm=q); time.sleep(0.3)
    note(f"이름 '{q}' → total={r.get('total')} {r.get('err','')} {[(i.get('fncoNm'), i.get('fncoAdr'), i.get('crno')) for i in r.get('items', [])[:3]]}")
