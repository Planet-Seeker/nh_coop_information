#!/usr/bin/env python3
"""
사용자 캡처(농협 홈페이지 '지역 농·축협' 목록)를 옮겨 적은 파일을 meta.csv에 반영. 캡처로 확인한 값은 확정(추정 해제).
  입력: docs/data/meta/capture/*.csv  (지역본부,단위,조합명,우편번호,주소,전화번호)
        - 조합명 == 단위 인 줄은 단위(지역본부·회원지원국·지부) 자체 → docs/data/meta/units.csv
  반영: 소속구역_광역(지역본부), 소속구역_기초(단위가 ○○본부면 '직할', 아니면 단위 이름), 주소·우편번호·전화번호,
        행정구역(주소의 시도·시군구), 홈페이지 표기 이름이 다르면 '별칭'(검색용)
  조합 찾기: 같은 지역본부의 운영 조합 중 이름이 같거나, 홈페이지 이름이 '지역명+원자료 이름'인 경우(서울강서농협 → 강서농협).
            없으면 전체에서 같은 이름 하나(지역본부가 금융당국 자료와 다른 조합, 공시가 끊긴 조합)
  소속 구분은 홈페이지 조직도를 따름. 금융당국 자료(금감원 목록·시도 합계)의 지역본부와 다르면 비고에 "금융당국 자료상 ○○본부 소속."
사용: python3 scripts/apply_capture.py   (결과: 반영 수, 못 찾은 이름, 캡처에 없던 같은 본부 조합)
"""
import csv, glob, io, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "docs" / "data" / "meta" / "coop_meta.csv"
UNITS = ROOT / "docs" / "data" / "meta" / "units.csv"
SIDO = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
        "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북",
        "충청남도": "충남", "충남": "충남", "충북": "충북", "전남": "전남", "전북": "전북", "경남": "경남", "경북": "경북", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
        "제주특별자치도": "제주"}
NEW_COLS = ["우편번호", "전화번호", "별칭"]
# 홈페이지 이름 ↔ 금융당국 자료 이름이 규칙으로 안 맞는 경우(개명 등). 공시가 이어지는 같은 조합으로 판단한 것만
ALIAS = {"예당사과원예농협": "예산능금농협", "창녕남부농협": "부곡농협", "북상주농협": "함창농협"}   # 창녕남부: 창녕군 부곡면 소재, 경남에서 짝 없는 유일 조합
norm = lambda n: n.replace("축산농협", "축협").replace("원예농협", "농협")   # 예산축산농협=예산축협, 천안배원예농협=천안배농협
code = lambda v: (v or "").strip().lstrip("=").strip('"')


def admin_of(addr):
    t = addr.split()
    if not t or t[0] not in SIDO:
        return "", ""
    if t[0] == "세종특별자치시":
        return "세종", "세종시"
    return SIDO[t[0]], (t[1] if len(t) > 1 and re.search(r"(시|군|구)$", t[1]) else "")


def main():
    rows = list(csv.DictReader(io.StringIO(META.read_text(encoding="utf-8-sig"))))
    cols = list(rows[0].keys())
    if "별칭" not in cols:
        cols.insert(cols.index("이전명칭") + 1, "별칭")
    for c in ("전화번호", "우편번호"):           # 주소 다음에 우편번호, 전화번호
        if c not in cols:
            cols.insert(cols.index("주소") + 1, c)
    caps = []
    for f in sorted(glob.glob(str(ROOT / "docs/data/meta/capture/*.csv"))):
        for x in csv.DictReader(open(f, encoding="utf-8-sig")):
            x["_src"] = Path(f).stem
            caps.append(x)
    units = {u["단위"]: u for u in csv.DictReader(open(UNITS, encoding="utf-8-sig"))} if UNITS.exists() else {}
    done, miss, seen_hq = 0, [], {}
    # 홈페이지에 그 이름 그대로 있는 조합은 끝맞춤·규칙 매칭에서 제외(북상주농협이 상주농협에 붙는 것 방지)
    exact = {(x["지역본부"].strip(), x["조합명"].strip()) for x in caps}
    taken = set()   # 이번 실행에서 이미 짝지은 조합(한 조합에 두 줄이 붙지 않게)
    for x in caps:
        hq, unit, nm = x["지역본부"].strip(), x["단위"].strip(), x["조합명"].strip()
        if nm == unit:
            units[unit] = {"지역본부": hq, "단위": unit, "우편번호": x["우편번호"], "주소": x["주소"], "전화번호": x["전화번호"], "출처": x["_src"]}
            continue
        seen_hq.setdefault(hq, set())
        pool = [r for r in rows if r["상태"] == "운영" and r["소속구역_광역"] == hq and code(r["금융회사코드"]) not in taken]
        loose = [r for r in pool if (hq, r["조합명(참고)"]) not in exact]
        hit = [r for r in pool if r["조합명(참고)"] == nm] or \
              [r for r in pool if nm in [x.strip() for x in (r.get("별칭") or "").split(";")]] or \
              [r for r in loose if nm.endswith(r["조합명(참고)"]) and len(nm) > len(r["조합명(참고)"])] or \
              [r for r in pool if r["조합명(참고)"] == ALIAS.get(nm)] or \
              [r for r in loose if norm(r["조합명(참고)"]) == norm(nm)]
        if not hit:   # 금융당국 자료의 지역본부와 홈페이지 조직도가 다른 조합(과천=서울본부 등) 또는 공시가 끊긴 조합: 전체에서 같은 이름 하나
            alls = [r for r in rows if r["조합명(참고)"] == nm and code(r["금융회사코드"]) not in taken]
            live = [r for r in alls if r["상태"] == "운영"]
            hit = live if len(live) == 1 else alls if len(alls) == 1 else []
        if len(hit) > 1:   # 같은 본부에 같은 이름(당진·아산 송악농협 등): 주소의 시군과 위치(행정구역 기초)가 같은 쪽
            a2 = admin_of(x["주소"])[1]
            hit = [r for r in hit if r["행정구역_기초"] == a2] or [r for r in hit if not r["행정구역_기초"]] or hit
        if len(hit) != 1:
            miss.append(f"{x['_src']}: {nm} (후보 {len(hit)}곳)")
            continue
        r = hit[0]
        taken.add(code(r["금융회사코드"]))
        seen_hq[hq].add(code(r["금융회사코드"]))
        est = [e for e in r.get("추정", "").split(";") if e]
        fsc_hq = r["소속구역_광역"]
        if fsc_hq and fsc_hq != hq and "소속구역_광역" not in est:   # 원본(금감원·시도 합계)과 다르면 비고에 남김
            r["비고"] = re.sub(r"\s*금융당국 자료상 [^ ]+본부 소속\.?", "", r.get("비고") or "").strip()
            r["비고"] = (r["비고"] + " " if r["비고"] else "") + f"금융당국 자료상 {fsc_hq}본부 소속."
        r["소속구역_광역"] = hq   # 소속 구분은 농협중앙회 홈페이지 조직도를 따름(사용자 결정)
        r["소속구역_기초"] = "직할" if unit.endswith("본부") else unit
        r["주소"], r["우편번호"], r["전화번호"] = x["주소"], x["우편번호"], x["전화번호"]
        a1, a2 = admin_of(x["주소"])
        if a1:
            r["행정구역_광역"], r["행정구역_기초"] = a1, a2
        est = [e for e in est if e not in ("소속구역_광역", "소속구역_기초", "행정구역_광역", "행정구역_기초")]
        if nm != r["조합명(참고)"]:
            al = [a for a in (r.get("별칭") or "").split(";") if a]
            r["별칭"] = ";".join(dict.fromkeys(al + [nm]))
        note = f"소속·주소 확인: 농협 홈페이지 캡처({x['_src']})"
        r["비고"] = re.sub(r"\s*소속·주소 확인: [^)]*\)", "", r.get("비고") or "").strip()
        r["비고"] = (r["비고"] + " " if r["비고"] else "") + note
        r["추정"] = ";".join(est)
        done += 1
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([("@@" + code(r.get(c))) if c in ("금융회사코드", "승계조합코드") and code(r.get(c)) else (r.get(c) or "") for c in cols])
    META.write_text("﻿" + re.sub(r"@@(\d{13})", r'="\1"', out.getvalue()), encoding="utf-8")
    uo = io.StringIO()
    uw = csv.writer(uo, lineterminator="\r\n")
    uw.writerow(["지역본부", "단위", "우편번호", "주소", "전화번호", "출처"])
    for u in sorted(units.values(), key=lambda u: (u["지역본부"], u["단위"])):
        uw.writerow([u["지역본부"], u["단위"], u["우편번호"], u["주소"], u["전화번호"], u.get("출처", "")])
    UNITS.write_text("﻿" + uo.getvalue(), encoding="utf-8")
    print(f"반영 {done}곳, 단위 {len(units)}개")
    for m in miss:
        print("못 찾음:", m)
    for hq, got in seen_hq.items():   # 캡처에 없던 같은 본부 운영 조합(다른 시군 캡처에 있을 수 있음)
        rest = [r["조합명(참고)"] for r in rows if r["상태"] == "운영" and r["소속구역_광역"] == hq and code(r["금융회사코드"]) not in got
                and "소속구역_기초" in (r.get("추정") or "")]
        if rest:
            print(f"{hq}본부 미확인 {len(rest)}곳:", ", ".join(rest[:30]))


if __name__ == "__main__":
    main()
