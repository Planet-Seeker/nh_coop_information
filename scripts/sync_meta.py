#!/usr/bin/env python3
"""
docs/data/meta/coop_meta.csv 동기화(수동 실행).
- 수집된 모든 개별 조합(시도·전국 합계 제외)이 한 행씩 있도록 새 조합 행을 추가한다.
- 이미 적힌 값은 절대 덮어쓰지 않는다(엑셀로 고친 내용 보존). 빈 칸만 채운다.
- 상태·승계조합코드가 비어 있으면 자동 추정값을 넣고 비고에 '자동 추정'을 남긴다.

상태 값
  운영      최신 기준년월까지 공시
  합병      다른 조합에 합쳐짐(승계조합코드 = 합쳐진 조합)
  코드변경  같은 조합이 새 금융회사코드로 공시(승계조합코드 = 새 코드) → 화면에서 추이를 이어 그림
  공시중단  공시가 끊겼으나 사유·승계 조합 미확인
이전명칭: 옛 조합 이름(여러 개면 ;로 구분). 원자료는 과거 자료에도 현재 이름을 붙이므로 자동으로 알 수 없음 → 수기.

자동 추정 규칙
  1) 이름이 "○○농협 △△지점"이고 공시가 끊김 → 합병, 승계 = 같은 이름(○○농협)의 운영 중 조합
  2) 같은 이름·같은 권역 코드의 운영 중 조합이 하나 있음
       공시 기간이 겹치지 않고 자산 규모가 이어짐(0.7~1.5배) → 코드변경
       기간이 겹치고, 끊긴 직후 상대 자산이 끊긴 조합 자산의 절반 이상 늘어남 → 합병
  3) 그 밖에 공시가 끊김 → 공시중단
"""
import csv
import io
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"
META = DATA / "meta" / "coop_meta.csv"
COLS = ["금융회사코드", "조합명(참고)", "유형", "상태", "승계조합코드", "이전명칭", "별칭", "현재명칭", "연혁", "변동일",
        "행정구역_광역", "행정구역_기초", "공시지역", "소속구역_광역", "소속구역_기초", "주소", "우편번호", "전화번호", "위도", "경도", "비고", "추정"]   # 추정: 추정으로 채운 열 이름(;로 구분). 확인하면 지움
CODE_COLS = {"금융회사코드", "승계조합코드"}
AUTO = "자동 추정(확인 필요)"


def code_of(v: str) -> str:
    v = (v or "").strip().lstrip("=").strip('"').strip()
    return v.zfill(13) if re.fullmatch(r"\d{8,12}", v) else v


def main() -> int:
    latest = json.loads((DATA / "index.json").read_text(encoding="utf-8"))["latest"]
    coops = {}
    for p in sorted((DATA / "coop").glob("0010027*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if re.fullmatch(r"0010027\d{6}", d["cd"]) and d["d"]:
            assets = {}
            for ym, t in d["d"].items():
                r = [x for x in t.get("재무현황_요약재무상태표(자산)", []) if x[0] == "A" and x[1] is not None]
                if r:
                    assets[ym] = r[0][1]
            coops[d["cd"]] = {"nm": d["nm"], "yms": set(d["d"]), "assets": assets}

    rows = {}
    if META.exists():
        for r in csv.DictReader(io.StringIO(META.read_text(encoding="utf-8-sig"))):
            cd = code_of(r.get("금융회사코드", ""))
            if cd:
                rows[cd] = {c: (code_of(r.get(c, "")) if c in CODE_COLS else (r.get(c) or "").strip()) for c in COLS}

    live = {cd for cd, c in coops.items() if max(c["yms"]) >= latest}
    rc = lambda cd: cd[7:9]

    def guess(cd):
        c = coops[cd]
        if cd in live:
            return "운영", ""
        m = re.fullmatch(r"(.+?) \S+지점", c["nm"])
        if m:
            cand = [k for k in live if coops[k]["nm"] == m.group(1)]
            cand.sort(key=lambda k: rc(k) != rc(cd))             # 같은 권역 우선
            if cand:
                return "합병", cand[0]
        cand = [k for k in live if k != cd and coops[k]["nm"] == c["nm"] and rc(k) == rc(cd)]
        if len(cand) == 1:
            k = cand[0]
            a, b = c["assets"], coops[k]["assets"]
            end = max(a) if a else None
            after = min((y for y in b if end and y > end), default=None)
            before = max((y for y in b if end and y <= end), default=None)
            if end and after:
                if not (c["yms"] & coops[k]["yms"]):          # 기간이 안 겹침: 규모가 이어지면 코드변경
                    if 0.7 <= b[after] / a[end] <= 1.5:
                        return "코드변경", k
                elif before and b[after] - b[before] >= 0.5 * a[end]:   # 겹침: 끊긴 직후 상대 자산이 그만큼 늘면 합병
                    return "합병", k
        return "공시중단", ""

    added = guessed = 0
    for cd, c in coops.items():
        r = rows.setdefault(cd, {k: "" for k in COLS})
        if not r["금융회사코드"]:
            r["금융회사코드"] = cd
            added += 1
        r["조합명(참고)"] = c["nm"]                              # 참고용 이름은 원자료 최신 이름으로
        if not r["상태"]:
            st, succ = guess(cd)
            r["상태"] = st
            if succ and not r["승계조합코드"]:
                r["승계조합코드"] = succ
            if st != "운영":
                r["추정"] = ";".join(dict.fromkeys([x for x in r.get("추정", "").split(";") if x] + ["상태"] + (["승계조합코드"] if r["승계조합코드"] else [])))
                r["비고"] = f"{r['비고']} {AUTO}".strip() if AUTO not in r["비고"] else r["비고"]
                guessed += 1

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(COLS)
    for cd in sorted(rows, key=lambda k: (rows[k]["조합명(참고)"], k)):
        r = rows[cd]
        w.writerow([("@@" + r[c] if c in CODE_COLS and r[c] else r[c]) for c in COLS])
    # 엑셀에서 앞자리 0이 지워지지 않도록 코드는 ="…" 형식(csv.writer가 따옴표를 덧붙이지 않게 마지막에 치환)
    text = re.sub(r"@@(\d{13})", r'="\1"', out.getvalue())
    META.write_text("﻿" + text, encoding="utf-8")
    st = {}
    for r in rows.values():
        st[r["상태"]] = st.get(r["상태"], 0) + 1
    print(f"meta: {len(rows)}행 (새 행 {added}, 자동 추정 {guessed}) 상태별 {st}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
