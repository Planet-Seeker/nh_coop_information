#!/usr/bin/env python3
"""
원칙: 공공데이터 API로 받은 값만 원본, 나머지는 모두 추정. meta.csv의 '추정' 열에 추정인 열 이름을 남긴다
(사용자가 직접 확인한 열만 '추정'에서 지운다). 화면은 추정만 "(추정)"으로 표시.
meta.csv의 빈 칸을 추정값으로 채우고, 채운 열 이름을 '추정' 열에 남긴다(수동 실행, 이미 적힌 값은 보존).
  유형        조합명 규칙(화면 app.js coopType과 같음): 지역농협·지역축협·품목농협·품목축협
  소속구역    지역농협 → 지역본부(광역) + 시군지부(기초, 시·군만 지부가 있고 광역시 구는 직할), 그 밖
  행정구역    추정한 시군과 그 시도(위치 기준, 기초 순위에 사용)(지역축협·품목농협·품목축협) → 지역본부 직할
시군 추정 순서
  1) 조합명에 시군 이름이 있으면 그 시군(예: 남김천농협 → 김천시). 단, 금융회사코드 권역과 맞지 않으면 버림
     (예: 포항 동해면의 동해농협이 강원 동해시로 잡히는 것 방지)
  2) 없으면 GROUP에 정한 코드군 시군, 그다음 같은 코드군(금융회사코드 8~10번째 자리, 옛 시군 단위)의 다른 조합에서 가장 많이 나온 시군
  3) 축산계(코드 17)는 코드군이 지역이 아니므로 1)만 사용, 못 찾으면 광역도 비움
광역(지역본부)은 정한 시군이 속한 시도. 시군을 못 정하면 코드 권역이 한 곳일 때만 그 시도.
"""
import csv, io, json, re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
META = DATA / "meta" / "coop_meta.csv"

SIGUNGU = {
    "서울": "종로구 중구 용산구 성동구 광진구 동대문구 중랑구 성북구 강북구 도봉구 노원구 은평구 서대문구 마포구 양천구 강서구 구로구 금천구 영등포구 동작구 관악구 서초구 강남구 송파구 강동구",
    "부산": "중구 서구 동구 영도구 부산진구 동래구 남구 북구 해운대구 사하구 금정구 강서구 연제구 수영구 사상구 기장군",
    "대구": "중구 동구 서구 남구 북구 수성구 달서구 달성군 군위군",
    "인천": "중구 동구 미추홀구 연수구 남동구 부평구 계양구 서구 강화군 옹진군",
    "광주": "동구 서구 남구 북구 광산구",
    "대전": "동구 중구 서구 유성구 대덕구",
    "울산": "중구 남구 동구 북구 울주군",
    "세종": "세종시",
    "경기": "수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군",
    "강원": "춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 고성군 양양군",
    "충북": "청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군",
    "충남": "천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군",
    "전북": "전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군",
    "전남": "목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군",
    "경북": "포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 울릉군 봉화군 울진군",
    "경남": "창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 고성군 남해군 하동군 산청군 함양군 거창군 합천군",
    "제주": "제주시 서귀포시",
}
# 옛 시군 이름 → 지금 시군
OLD = {"청원": ("충북", "청주시"), "마산": ("경남", "창원시"), "진해": ("경남", "창원시"), "의창": ("경남", "창원시"),
       "여천": ("전남", "여수시"), "승주": ("전남", "순천시"), "금릉": ("경북", "김천시"), "선산": ("경북", "구미시"),
       "영일": ("경북", "포항시"), "월성": ("경북", "경주시"), "삼천포": ("경남", "사천시"), "충무": ("경남", "통영시"),
       "북제주": ("제주", "제주시"), "남제주": ("제주", "서귀포시"), "중원": ("충북", "충주시"), "제원": ("충북", "제천시"),
       "대천": ("충남", "보령시"), "온양": ("충남", "아산시"), "천원": ("충남", "천안시"), "진양": ("경남", "진주시"),
       "명주": ("강원", "강릉시"), "춘성": ("강원", "춘천시"), "원성": ("강원", "원주시")}
# 금융회사코드 권역 → 가능한 시도(옛 행정구역 반영: 강화·옹진은 경기 코드, 달성은 경북 코드 등)
CODE_SIDO = {"10": {"서울"}, "12": {"부산"}, "13": {"인천"}, "15": {"대구"},
             "2": {"경기", "인천"}, "3": {"강원"}, "40": {"충북", "세종"}, "41": {"충북", "세종"}, "42": {"충북", "세종"},
             "45": {"대전", "충남", "세종"}, "46": {"대전", "충남", "세종"}, "47": {"대전", "충남", "세종"}, "48": {"대전", "충남", "세종"},
             "5": {"전북"}, "6": {"전남", "광주"}, "7": {"경북", "대구"}, "8": {"경남", "울산", "부산"}, "9": {"제주"}}

# 조합명에 시군 이름이 거의 없는 코드군: 대부분 조합이 있는 시군으로 추정
GROUP = {"702": ("대구", "달성군"), "815": ("울산", "울주군"), "735": ("경북", "칠곡군"), "217": ("경기", "고양시"),
         "601": ("광주", "광산구"), "327": ("강원", "고성군"), "207": ("경기", "화성시")}

STEMS = []   # (이름 조각, 시도, 시군)
for sido, names in SIGUNGU.items():
    for full in names.split():
        stem = full[:-1]
        if len(stem) >= 2:
            STEMS.append((stem, sido, full))
for k, (sido, full) in OLD.items():
    STEMS.append((k, sido, full))
for stem in ("무진장", "순정", "동진강"):     # 무주·진안·장수, 순창·정읍, 동진강(정읍·부안) 축협
    STEMS.append((stem, "전북", ""))
for sido in SIGUNGU:                       # "서울우유", "대구경북양돈"처럼 시도 이름만 있는 경우
    STEMS.append((sido, sido, ""))

LIVE_ITEM = re.compile(r"낙농|우유|양돈|양계|양봉|양토|양록|한우|육우|치즈|오리|사슴|흑염소")
CROP_ITEM = re.compile(r"원예|인삼|과수|채소|화훼|특작|버섯|감귤|약초|엽연초|단감|사과|(?<!월)배농협|포도|고추|딸기|참외|녹차|키위|복숭아|매실|유자|더덕")


def coop_type(cd, nm):
    if cd[7:9] == "17":
        return "품목축협" if LIVE_ITEM.search(nm) and not re.search(r"축산농협$|축협$", nm) else "지역축협"
    return "품목농협" if CROP_ITEM.search(nm) else "지역농협"


def code_sido(cd):
    rc = cd[7:9]
    return CODE_SIDO.get(rc) or CODE_SIDO.get(rc[0]) or set()


# 소속 지역본부(금감원 원본, 금융위원회 시도 합계로 검증) → 위치 시도로 가능한 곳
HQ_OK = {"서울": {"서울", "경기"}, "부산": {"부산", "경남"}, "대구": {"대구", "경북"}, "인천": {"인천", "경기"},
         "광주": {"광주", "전남"}, "대전": {"대전", "충남", "세종"}, "울산": {"울산", "경남"}, "경기": {"경기"},
         "강원": {"강원"}, "충북": {"충북", "세종"}, "충남": {"충남", "세종", "대전"}, "전북": {"전북"},
         "전남": {"전남", "광주"}, "경북": {"경북", "대구"}, "경남": {"경남", "부산", "울산"}, "제주": {"제주"}}


def by_name(cd, nm, hq=""):
    """조합명에서 (시도, 시군). 시군까지 잡히는 조각 → 앞에 나오는 조각 → 긴 조각 순.
    소속 지역본부(원본)와 금융회사코드 권역(축산계 제외) 양쪽과 맞는 시도만."""
    cs = code_sido(cd) if cd[7:9] != "17" else None
    hs = HQ_OK.get(hq)
    ok = (hs & cs) if hs and cs else (hs or cs)       # 지역본부와 코드 권역을 모두 만족(예: 대구 코드의 칠곡농협은 경북 칠곡군이 아님)
    best = None
    for stem, sido, full in STEMS:
        i = nm.find(stem)
        if i < 0 or (ok is not None and sido not in ok):
            continue
        key = (not full, i, -len(stem))          # 시군까지 잡히는 조각 우선(예: 인천강화옹진축협 → 강화군)
        if best is None or key < best[0]:
            best = (key, sido, full)
    return (best[1], best[2]) if best else None


def main():
    text = META.read_text(encoding="utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    cols = list(rows[0].keys())
    first = "추정" not in cols
    if first:
        cols.append("추정")
    code = lambda v: (v or "").strip().lstrip("=").strip('"')
    names = {code(r["금융회사코드"]): r["조합명(참고)"] for r in rows}

    hq_of = {code(r["금융회사코드"]): (r["소속구역_광역"] if "소속구역_광역" not in (r.get("추정") or "") else "") for r in rows}
    guess = {cd: by_name(cd, nm, hq_of.get(cd, "")) for cd, nm in names.items()}
    # 코드군 다수결: 같은 코드군·같은 지역본부에서 이름으로 시군이 잡힌 조합이 2곳 이상이고 70% 이상 한 시군일 때만
    # (광역시 구는 한 코드군에 여러 구가 섞여 다수결로 정하지 않음)
    grp = {}
    for cd, g in guess.items():
        if g and g[1] and cd[7:9] != "17":
            grp.setdefault((cd[7:10], hq_of.get(cd, "")), Counter())[g] += 1

    def group_pick(cd):
        c = grp.get((cd[7:10], hq_of.get(cd, "")))
        if not c:
            return None
        (top, n), total = c.most_common(1)[0], sum(c.values())
        return top if n >= 2 and n / total >= 0.7 and not top[1].endswith("구") else None

    stat = Counter()
    for r in rows:
        cd = code(r["금융회사코드"])
        est = [x for x in (r.get("추정") or "").split(";") if x]
        if first and r["유형"]:
            est.append("유형")                      # 지금까지의 유형은 모두 이름 규칙으로 정한 값
        if not r["유형"]:
            r["유형"] = coop_type(cd, r["조합명(참고)"]); est.append("유형")
        # 추정 표시가 붙은 칸은 매번 다시 계산(원본·직접 확인한 칸은 그대로)
        for col in ("소속구역_기초", "행정구역_광역", "행정구역_기초"):
            if col in est:
                r[col] = ""
                est.remove(col)
        g = guess[cd]
        if (not g or not g[1]) and cd[7:9] != "17":
            hq = hq_of.get(cd, "")
            if cd[7:10] in GROUP and (not hq or GROUP[cd[7:10]][0] in HQ_OK.get(hq, {GROUP[cd[7:10]][0]})):
                g = GROUP[cd[7:10]]
            else:
                g = group_pick(cd) or g
        sido = g[0] if g else ""
        sigun = g[1] if g else ""
        if not sido:
            cs = code_sido(cd) if cd[7:9] != "17" else set()
            sido = next(iter(cs)) if len(cs) == 1 else ""
        if not r["소속구역_광역"] and sido:
            r["소속구역_광역"] = sido; est.append("소속구역_광역")
        METRO = {"서울", "부산", "대구", "인천", "광주", "대전", "울산"}
        if not r["소속구역_기초"]:
            # 지부는 시·군에만 있음(광역시 구는 지부가 없어 지역본부 직할).
            # 시군을 못 정해도 소속 지역본부가 광역시이고 군 지역이 아니면 직할로 봄(예: 대구 시내 지역농협)
            if r["유형"] != "지역농협" or sigun.endswith("구") or (not sigun and r["소속구역_광역"] in METRO):
                v = "직할"
            else:
                v = sigun
            if v and (sido or v == "직할"):
                r["소속구역_기초"] = v
                if r["유형"] == "지역농협":                  # 지역농협의 시군지부·직할은 시군 추정에 기댐 → 추정
                    est.append("소속구역_기초")
        # 지역축협·품목농협·품목축협은 규칙상 지역본부 직할(사용자 확인) → 추정 아님. 유형 자체의 추정 여부는 '유형'에 표시
        if r["유형"] != "지역농협" and r["소속구역_기초"] in ("", "직할"):
            r["소속구역_기초"] = "직할"
            est = [x for x in est if x != "소속구역_기초"]
        # 행정구역(위치) 추정: 조합명·코드군으로 정한 시군과 그 시군이 속한 시도(지역본부와 다를 수 있음, 예: 과천=경기 과천시·서울본부)
        if not r["행정구역_광역"] and not r["행정구역_기초"] and g and g[1]:
            r["행정구역_광역"], r["행정구역_기초"] = g[0], g[1]
            est += ["행정구역_광역", "행정구역_기초"]
        if re.search(r"자동 추정|^확인:|^정황:", r["비고"] or ""):   # 합병·승계·옛 이름도 원자료가 아닌 추정
            est += [c for c in ("상태", "승계조합코드", "이전명칭") if code(r.get(c)) and not (c == "상태" and r[c] == "운영")]
        r["추정"] = ";".join(dict.fromkeys(est))
        stat[(r["유형"], bool(r["소속구역_광역"]), bool(r["소속구역_기초"]))] += 1

    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([("@@" + code(r.get(c))) if c in ("금융회사코드", "승계조합코드") and code(r.get(c)) else (r.get(c) or "") for c in cols])
    META.write_text("﻿" + re.sub(r"@@(\d{13})", r'="\1"', out.getvalue()), encoding="utf-8")
    for k, v in sorted(stat.items()):
        print(k, v)


if __name__ == "__main__":
    main()
