# nh_coop_information
대한민국 농업협동조합(농협)의 일반현황을 조합명으로 검색할 수 있는 웹 서비스입니다.

- 데이터: [금융위원회_금융통계농업협동조합정보](https://www.data.go.kr/data/15061344/openapi.do) (공공데이터포털, 이용허락범위 제한 없음)
- 제공 항목: 조합별 일반현황(임직원 현황 등), 기준년월별

## 구조

```
.github/workflows/update-data.yml  매주 월요일 03:17(KST) API 수집 → 변경분 자동 커밋
scripts/fetch_gene.py              일반현황 API 수집 스크립트 (Python 표준 라이브러리만 사용)
docs/                              GitHub Pages 사이트 (HTML·CSS·JS)
docs/data/                         수집된 정적 JSON (gene_YYYYMM.json, index.json)
```

검색은 방문자의 브라우저에서 정적 JSON을 읽어 처리합니다. API 인증키는 GitHub Secrets에만 저장되며 사이트나 저장소에 노출되지 않습니다.

## 설정

1. **Settings → Secrets and variables → Actions → New repository secret**
   이름 `SERVICE_KEY`, 값은 공공데이터포털의 일반 인증키(**Decoding**)
2. **Actions → 농협 일반현황 데이터 갱신 → Run workflow** 로 첫 수집 실행
   (특정 기준년월을 받으려면 `bas_ym`에 YYYYMM 입력)
3. **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main`, 폴더: `/docs`

## 로컬 실행

```bash
SERVICE_KEY=발급키 python3 scripts/fetch_gene.py
cd docs && python3 -m http.server 8000   # http://localhost:8000
```
