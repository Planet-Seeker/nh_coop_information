#!/usr/bin/env python3
"""
주요 지표 순위용 파일 생성: 연도별 대표 기준년월마다 전 조합(시도·전국 합계 제외)의 카드 지표 값만 모은다.
  docs/data/metrics/<기준년월>.json  {"ym", "keys": [...], "rows": {금융회사코드: [값, ...]}}
순위 계산(전국·소속구역 광역·기초)은 화면에서 meta.csv의 구역으로 묶어 한다 → meta.csv를 고치면 바로 반영.
collect.py 실행 뒤 호출. 단독 실행도 가능(수집 없이 기존 조합 파일로 재생성).
"""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"

# 화면 app.js의 KPIS와 같은 순서·정의 (표 key, 항목 코드)
KPIS = [
    ("조합원", "일반현황_임직원현황", "B"),
    ("자산총계", "재무현황_요약재무상태표(자산)", "A"),
    ("유동성비율", "주요경영지표_유동성", "B"),
    ("예수부채", "재무현황_요약재무상태표(부채및자본)", "A1"),
    ("대출채권", "재무현황_요약재무상태표(자산)", "A3"),
    ("예대율", "주요경영지표_유동성", "C"),
    ("당기순이익", "재무현황_요약손익계산서", "A"),
    ("고정이하여신비율", "주요경영지표_여신건전성", "C"),
]


def is_coop(cd: str) -> bool:
    return bool(re.fullmatch(r"0010027\d{6}", cd))


def main() -> int:
    by_ym = {}
    for path in sorted((DATA / "coop").glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        cd = doc.get("cd", "")
        if not is_coop(cd):
            continue
        for ym, tables in doc["d"].items():
            vals = []
            for _, t, c in KPIS:
                row = next((r for r in tables.get(t, []) if r[0] == c), None)
                vals.append(row[1] if row else None)
            if any(v is not None for v in vals):
                by_ym.setdefault(ym, {})[cd] = vals

    # 화면은 연 단위: 연도별로 12월, 없으면 그해 최신 반기만 사용
    reps = {}
    for ym in by_ym:
        y = ym[:4]
        if y not in reps or ym > reps[y]:
            reps[y] = ym
    out = DATA / "metrics"
    out.mkdir(parents=True, exist_ok=True)
    keep = set()
    for ym in sorted(reps.values()):
        name = f"{ym}.json"
        keep.add(name)
        data = json.dumps({"ym": ym, "keys": [k[0] for k in KPIS], "rows": by_ym[ym]},
                          ensure_ascii=False, separators=(",", ":"))
        p = out / name
        if not p.exists() or p.read_text(encoding="utf-8") != data:
            p.write_text(data, encoding="utf-8")
    for p in out.glob("*.json"):            # 대표가 바뀐 연도의 옛 파일 정리(예: 6월 → 12월 공개)
        if p.name not in keep:
            p.unlink()
    print(f"metrics: {len(keep)}개 연도 {sorted(keep)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
