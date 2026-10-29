#!/usr/bin/env python3
"""
금감원 금융통계정보시스템(FISIS) Open API 진단(수동 실행, 표준 라이브러리만).
  1) 금융회사 목록(companySearch, partDiv=Q 농업협동조합): 응답 항목·나열 순서·조합 수
  2) 통계목록(statisticsListSearch, lrgDiv=Q, smlDiv A·B·C·P): 통계표 전체
  3) 표본 조합 1곳의 통계표별 계정항목(accountListSearch)과 최근 값(statisticsInfoSearch)
결과: docs/data/probe/fisis_*.json   환경변수 FISIS_KEY (GitHub Secrets)
"""
import json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path

BASE = "https://fisis.fss.or.kr/openapi"
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "probe"
KEY = os.environ.get("FISIS_KEY", "").strip()
GH = bool(os.environ.get("GITHUB_ACTIONS"))
AGG = ""


def note(msg, level="notice"):
    print(msg, flush=True)
    if GH:
        print(f"::{level} title=FISIS::" + msg.replace("\n", " | ")[:900], flush=True)


def call(api, **params):
    q = {"auth": KEY, "lang": "kr", **params}
    url = f"{BASE}/{api}.json?" + urllib.parse.urlencode(q)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            err = str(e).replace(KEY, "***")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{api} 호출 실패: {err[:200]}")


def body(js):
    r = js.get("result", js)
    return r.get("err_cd"), r.get("err_msg"), r.get("list") or []


def save(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    if not KEY:
        note("FISIS_KEY가 Secrets에 없습니다. Settings > Secrets and variables > Actions에 등록하세요.", "error")
        return 2
    cd, msg, comp = body(call("companySearch", partDiv="Q"))
    note(f"금융회사(Q): 응답코드 {cd} {msg}, {len(comp)}곳, 항목 {sorted(comp[0]) if comp else []}")
    save("fisis_company_Q.json", {"err": [cd, msg], "count": len(comp), "list": comp})
    if not comp:
        return 1
    lists = {}
    for sml in "ABCP":
        cd, msg, lst = body(call("statisticsListSearch", lrgDiv="Q", smlDiv=sml))
        lists[sml] = lst
        note(f"통계목록 Q-{sml}: {len(lst)}개 " + ", ".join(f"{x.get('list_no')} {x.get('list_nm')}" for x in lst)[:800])
        time.sleep(0.3)
    save("fisis_lists_Q.json", lists)
    # 표본: 목록에서 이름에 '천안농협'이 있으면 그 조합, 없으면 첫 조합
    sample = next((c for c in comp if "천안농협" == str(c.get("finance_nm", "")).strip()), comp[0])
    fcd = sample.get("finance_cd")
    global AGG
    AGG = next((c["finance_cd"] for c in comp if not str(c["finance_cd"]).startswith("0010027")), fcd)
    detail = {"sample": sample, "tables": {}}
    for sml, lst in lists.items():
        for x in lst:
            no = x.get("list_no")
            _, _, acc = body(call("accountListSearch", listNo=no))
            fc = fcd if sml != "P" else AGG
            val, cd2, msg2, used = [], None, None, None
            for term in ("H", "Y", "Q"):                  # 기간 구분값 확인(반기·연·분기)
                cd2, msg2, val = body(call("statisticsInfoSearch", financeCd=fc, listNo=no, term=term,
                                           startBaseMm="202312", endBaseMm="202606"))
                if cd2 == "000":
                    used = term
                    break
                time.sleep(0.2)
            detail["tables"][no] = {"name": x.get("list_nm"), "accounts": acc, "values": val[:60], "err": [cd2, msg2], "term": used}
            time.sleep(0.3)
    save("fisis_sample.json", detail)
    ok = {k: (v["term"], len(v["values"])) for k, v in detail["tables"].items()}
    note(f"표본 {sample.get('finance_nm')}({fcd}), 집계 {AGG}: 통계표별 (기간구분, 값 수) {ok}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
