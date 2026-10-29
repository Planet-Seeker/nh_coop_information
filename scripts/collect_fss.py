#!/usr/bin/env python3
"""
금융감독원 FISIS 조합별 수집기(표준 라이브러리만). 금감원 자료는 금감원 공식 자료이나 국가승인통계 아님.
  - 대상: FISIS 금융회사 목록(partDiv=Q)의 조합. 순서: 운영 조합 → 그 밖의 조합 → FISIS에만 있는 옛 코드
  - 표: SQ014~SQ021 8개(fss_convert.TABLES). 1회 조회 기간 최대 40분기라 두 구간으로 나눔
      1단계 최근 구간(201612~202606)을 전 조합 → 2단계 이전 구간(201106~201606)을 전 조합
  - 하루 호출 한도: CALL_BUDGET(기본 8000, 비영리 하루 1만 건). 닿으면 저장하고 멈춤 → 다음 실행이 이어받음
  - 저장: docs/data/fss/coop/<코드>.json {"cd","src":"fss","ranges":[...],"d":{ym:{표:[[항목,값]]}}}
          docs/data/fss/codes.json, companies.json, status.json(진행 상황), mismatch.json(금융위원회 값과 다른 항목)
환경변수: FISIS_KEY(필수), CALL_BUDGET, MAX_MINUTES(기본 320)
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fss_convert import TABLES, num  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "fss"
BASE = "https://fisis.fss.or.kr/openapi"
KEY = os.environ.get("FISIS_KEY", "").strip()
BUDGET = int(os.environ.get("CALL_BUDGET", "8000") or 8000)
MAX_MIN = float(os.environ.get("MAX_MINUTES", "320") or 320)
RANGES = [("201612", "202606"), ("201106", "201606")]     # 최근 구간 먼저
GH = bool(os.environ.get("GITHUB_ACTIONS"))
KST = timezone(timedelta(hours=9))
calls = 0
T0 = time.time()

# 교차검증 대응표(app.js XMAP과 같음): 금융위원회 (표, 항목) ↔ 금감원 (표, 항목)
XMAP = {}
for t, f, pairs in [
    ("재무현황_요약재무상태표(자산)", "fss_대출채권", "A3:A A32:A1 A320:A11 A33:A2 A330:A21 A34:A3 A340:A31"),
    ("재무현황_요약재무상태표(자산)", "fss_유가증권", "A2:A A23:A1 A24:A2 A25:A3"),
    ("재무현황_요약재무상태표(자산)", "fss_유형자산", "A4:A A42:A1 A420:A11 A43:A2 A430:A21 A431:A22 A44:A3 A440:A31 A441:A32"),
    ("재무현황_요약재무상태표(부채및자본)", "fss_예수부채·차입부채", "A1:A A11:A1 A12:A2 A13:A3 A2:B A21:B1 A22:B2 A23:B3"),
    ("재무현황_요약손익계산서", "fss_이자 손익·판매비와 관리비", "A11:B A111:B1 A1111:B11 A1112:B12 A1113:B13 A112:B2 A113:B3 A114:B4 A21:C A211:C1 A212:C2 A213:C3 A26:D A261:D1 A263:D2 A264:D3 A265:D4 A266:D5 A267:D6 A268:D7 A269:D8 A262:D9"),
    ("재무현황_요약손익계산서", "fss_수수료 손익", "A14:B A141:B1 A142:B2 A144:B3 A143:B4 A24:C A241:C1 A242:C2 A243:C3"),
    ("재무현황_요약손익계산서", "fss_유가증권 평가·처분 손익", "A12:B A22:C"),
    ("재무현황_주요자금조달및운용", "fss_유형별 대출(조합원·비조합원)", "A21:A"),
]:
    for p in pairs.split():
        a, b = p.split(":")
        XMAP[(t, a)] = (f, b)


class Stop(Exception):
    pass


def note(msg, level="notice"):
    print(msg, flush=True)
    if GH and level:
        print(f"::{level} title=금감원 수집::" + msg.replace("\n", " | ")[:900], flush=True)


def call(api, **params):
    global calls
    if calls >= BUDGET:
        raise Stop(f"오늘 호출 한도 {BUDGET}회 도달")
    if (time.time() - T0) / 60 > MAX_MIN:
        raise Stop(f"실행 시간 {MAX_MIN:.0f}분 도달")
    q = {"auth": KEY, "lang": "kr", **params}
    url = f"{BASE}/{api}.json?" + urllib.parse.urlencode(q)
    err = ""
    for attempt in range(3):
        calls += 1
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                js = json.loads(r.read().decode("utf-8", "replace"))
            res = js.get("result", js)
            return res.get("err_cd"), res.get("err_msg"), res.get("list") or []
        except Exception as e:  # 네트워크 일시 오류
            err = str(e).replace(KEY, "***")[:150]
            time.sleep(3 * (attempt + 1))
    raise Stop(f"{api} 연결 실패: {err}")


def rj(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def wj(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(p)


def crosscheck(cd, fss_d):
    """금융위원회 자료와 같은 항목을 비교해 다른 것만 돌려줌 [[ym, 금융위 표, 항목, 금융위 값, 금감원 값]]"""
    fsc = rj(DATA / "coop" / f"{cd}.json", {}).get("d", {})
    out = []
    for ym, tb in fss_d.items():
        f_ym = fsc.get(ym)
        if not f_ym:
            continue
        for (t, a), (f, b) in XMAP.items():
            fv = next((r[1] for r in tb.get(f, []) if r[0] == b), None)
            cv = next((r[1] for r in f_ym.get(t, []) if r[0] == a), None)
            if fv is not None and cv is not None and fv != cv:
                out.append([ym, t, a, cv, fv])
    return sorted(out)


def main():
    if not KEY:
        note("FISIS_KEY가 Secrets에 없습니다.", "error")
        return 2
    codes = rj(OUT / "codes.json", {})
    status = rj(OUT / "status.json", {})
    mism = rj(OUT / "mismatch.json", {})

    cd_, msg, comp = call("companySearch", partDiv="Q")
    if cd_ != "000" or not comp:
        note(f"금융회사 목록 조회 실패: {cd_} {msg}", "error")
        return 1
    wj(OUT / "companies.json", {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "list": comp})
    ours = {c[0]: c for c in rj(DATA / "coops.json", {}).get("list", [])}
    latest = rj(DATA / "index.json", {}).get("latest", "")
    targets = [c["finance_cd"] for c in comp if str(c["finance_cd"]).startswith("0010027")]
    rank = lambda cd: (0 if cd in ours and ours[cd][2] >= latest else 1 if cd in ours else 2, cd)
    targets.sort(key=rank)

    done_now = 0
    try:
        for a, b in RANGES:
            tag = f"{a}-{b}"
            for cd in targets:
                p = OUT / "coop" / f"{cd}.json"
                doc = rj(p, {"cd": cd, "src": "fss", "ranges": [], "d": {}})
                if tag in doc.get("ranges", []):
                    continue
                got = {}
                for no, t in TABLES.items():
                    e, m, rows = call("statisticsInfoSearch", financeCd=cd, listNo=no, term="H", startBaseMm=a, endBaseMm=b)
                    if e not in ("000", None) and rows == []:
                        if "인증" in str(m) or "한도" in str(m) or "초과" in str(m):
                            raise Stop(f"FISIS 응답: {e} {m}")
                    for x in rows:
                        v = x.get("a") if x.get("a") not in (None, "") else x.get("b")
                        codes.setdefault(t, {})[x["account_cd"]] = str(x.get("account_nm", "")).strip()
                        got.setdefault(x["base_month"], {}).setdefault(t, []).append([x["account_cd"], num(v)])
                    time.sleep(0.12)
                for ym, tb in got.items():
                    for t, rows in tb.items():
                        doc["d"].setdefault(ym, {})[t] = sorted(rows, key=lambda r: r[0])
                doc["ranges"] = sorted(set(doc.get("ranges", [])) | {tag})
                wj(p, doc)
                mm = crosscheck(cd, doc["d"])
                if mm:
                    mism[cd] = mm
                else:
                    mism.pop(cd, None)
                done_now += 1
                if done_now % 50 == 0:
                    wj(OUT / "codes.json", codes)
                    wj(OUT / "mismatch.json", mism)
                    note(f"{tag}: {done_now}곳 처리, 호출 {calls}회", "")
        stopped = ""
    except Stop as s:
        stopped = str(s)

    wj(OUT / "codes.json", codes)
    wj(OUT / "mismatch.json", mism)
    prog = {}
    for a, b in RANGES:
        tag = f"{a}-{b}"
        prog[tag] = sum(1 for cd in targets if tag in rj(OUT / "coop" / f"{cd}.json", {}).get("ranges", []))
    status = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "targets": len(targets), "progress": prog,
              "last_run": {"processed": done_now, "calls": calls, "stopped": stopped},
              "mismatch_coops": len(mism), "mismatch_items": sum(len(v) for v in mism.values())}
    wj(OUT / "status.json", status)
    note(f"이번 실행 {done_now}곳, 호출 {calls}회{(' · 멈춤: ' + stopped) if stopped else ''} · 진행 {prog} / 대상 {len(targets)}곳"
         f" · 금융위원회와 다른 항목 {status['mismatch_items']}개({len(mism)}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
