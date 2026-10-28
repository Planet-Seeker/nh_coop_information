# nh_coop_information
대한민국 농업협동조합(지역농협·품목조합·축협)의 일반현황·재무현황·경영지표를 조합명으로 검색해 연도별 추이와 함께 보여주는 웹 서비스입니다.

- 사이트: https://planet-seeker.github.io/nh_coop_information/
- 데이터: [금융위원회_금융통계농업협동조합정보](https://www.data.go.kr/data/15061344/openapi.do) (공공데이터포털, 이용허락범위 제한 없음)
- 지도: VWorld 배경지도(국토교통부), Leaflet (BSD-2-Clause)
- 글꼴: Pretendard GOV (SIL Open Font License 1.1)
- 결정 사항·구조·남은 일: [PROJECT.md](PROJECT.md)

## 구조

```
.github/workflows/update-data.yml  매주 월요일 03:17(KST) 새 반기 확인·수집 → 순위 파일 생성 → 커밋
.github/workflows/deploy-pages.yml 사이트 배포(코드 변경·데이터 갱신 시), 지도 키는 Secrets에서 주입
scripts/collect.py                 수집기(일반현황·재무현황·주요경영지표, 이어받기)
scripts/build_metrics.py           순위용 연도별 지표 파일 생성
docs/                              사이트(정적, 서버 없음)
docs/data/                         수집된 정적 JSON, 순위용 지표, 조합 정보(meta/coop_meta.csv)
```

검색·순위 계산은 방문자 브라우저에서 이루어집니다. 인증키는 GitHub Secrets에만 있고 저장소에는 없습니다.

## 설정

1. **Settings → Secrets and variables → Actions**: `SERVICE_KEY`(공공데이터포털), `VWORLD_KEY`(VWorld)
2. **Settings → Pages**: Source = **GitHub Actions**
3. **Actions → 농협 데이터 갱신 → Run workflow**: 수집 실행(이미 받은 반기는 건너뜀)

## 로컬 실행

```bash
SERVICE_KEY=발급키 python3 scripts/collect.py && python3 scripts/build_metrics.py
cd docs && python3 -m http.server 8000   # http://localhost:8000
```
