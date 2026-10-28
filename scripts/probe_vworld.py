#!/usr/bin/env python3
"""VWorld 검색 API 진단(저장 안 함): 키 동작, 조합명 장소 검색 정확도."""
import json, os, re, time, urllib.parse, urllib.request
KEY = os.environ.get("VWORLD_KEY", "").strip()
DOMAIN = "https://planet-seeker.github.io"
def note(m): print("::notice title=VWorld::" + m.replace("\n", " ")[:900], flush=True)
def search(q, typ="place", domain=True):
    p = {"service": "search", "request": "search", "version": "2.0", "crs": "EPSG:4326", "size": 5, "page": 1,
         "query": q, "type": typ, "format": "json", "errorformat": "json", "key": KEY}
    if domain: p["domain"] = DOMAIN
    if typ == "address": p["category"] = "road"
    url = "https://api.vworld.kr/req/search?" + urllib.parse.urlencode(p)
    try:
        with urllib.request.urlopen(url, timeout=30) as r: raw = r.read().decode("utf-8", "replace")
    except Exception as e:
        return f"연결 실패 {type(e).__name__} {str(e)[:120]}"
    try: js = json.loads(raw)["response"]
    except Exception: return "해석 실패 " + re.sub(r"\s+", " ", raw)[:200].replace(KEY, "***")
    if js.get("status") != "OK": return f"status={js.get('status')} {json.dumps(js.get('error', ''), ensure_ascii=False)[:200]}"
    items = js.get("result", {}).get("items", [])
    return [(i.get("title"), (i.get("address") or {}).get("road") or (i.get("address") or {}).get("parcel"), (i.get("point") or {}).get("x"), (i.get("point") or {}).get("y"), i.get("category")) for i in items[:3]]
if not KEY:
    note("VWORLD_KEY 없음"); raise SystemExit(0)
note(f"키 길이 {len(KEY)}")
note("domain 없이: " + str(search("오창농협", domain=False)))
for q in ["오창농협", "오창농협 본점", "천안축산농협", "서울우유협동조합", "송악농협", "가산농협"]:
    note(f"{q} → {search(q)}"); time.sleep(0.3)
