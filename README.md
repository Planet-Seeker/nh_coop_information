# nh_coop_information
대한민국 농업협동조합(지역농협·품목조합·축협)의 일반현황·재무현황·경영지표를 조합명으로 검색해 연도별 추이와 함께 보여주는 웹 서비스입니다.

- 사이트: https://planet-seeker.github.io/nh_coop_information/
- 데이터: [금융위원회_금융통계농업협동조합정보](https://www.data.go.kr/data/15061344/openapi.do) (공공데이터포털, 이용허락범위 제한 없음)
- 글꼴: Pretendard GOV (SIL Open Font License 1.1)
- 결정 사항·구조·남은 일: [PROJECT.md](PROJECT.md)

## 구조

```
.github/workflows/update-data.yml  매주 월요일 03:17(KST) 새 반기 확인·수집 → 변경분 자동 커밋
scripts/collect.py                 수집기(일반현황·재무현황·주요경영지표, 이어받기)
docs/                              GitHub Pages 사이트(정적, 서버 없음)
docs/data/                         수집된 정적 JSON
```

검색과 화면 처리는 방문자 브라우저에서 이루어집니다. API 인증키는 GitHub Secrets에만 있으며 사이트나 저장소에 노출되지 않습니다.

## 설정

1. **Settings → Secrets and variables → Actions**: `SERVICE_KEY`에 공공데이터포털 일반 인증키
2. **Actions → 농협 데이터 갱신 → Run workflow**: 수집 실행(이미 받은 반기는 건너뜀)
3. **Settings → Pages**: Branch `main`, 폴더 `/docs`

## 로컬 실행

```bash
SERVICE_KEY=발급키 python3 scripts/collect.py
cd docs && python3 -m http.server 8000   # http://localhost:8000
```
