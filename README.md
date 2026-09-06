# 오늘 문 연 약국·의원 검색

카카오 지도 + 응급의료포털(E-Gen) 공공데이터로 **지금 이 시간 영업 중인 약국/병·의원**을
검색 위치 **반경 10km** 안에서 찾아 거리순으로 보여주는 React(Vite) + Tailwind 웹앱.

## 빠른 시작

```bash
npm install
cp .env.example .env   # 키 입력 후
npm run dev            # http://localhost:5173
```

### 필요한 키 2개

| 환경변수 | 발급처 | 비고 |
| --- | --- | --- |
| `VITE_KAKAO_JS_KEY` | [카카오 개발자센터](https://developers.kakao.com) → 내 애플리케이션 → 앱 키 → **JavaScript 키** | *플랫폼 → Web → 사이트 도메인*에 `http://localhost:5173` 을 반드시 등록 |
| `VITE_EGEN_SERVICE_KEY` | [공공데이터포털](https://www.data.go.kr) → 「전국 병·의원 찾기 서비스」 / 「전국 약국 정보 조회 서비스」 활용신청 | 마이페이지의 **일반 인증키(Decoding)** 값 (Encoding 키 아님) |

> 카카오 지도 SDK는 `libraries=services` 로 로드되어 주소·키워드 검색(Geocoder/Places)까지
> 함께 사용하므로 REST API 키는 필요 없습니다.

## 아키텍처

```
src/
├─ App.jsx                    상태 오케스트레이션 (탭/중심좌표/결과)
├─ components/
│  ├─ TabBar.jsx              💊 약국 / 🏥 의원 탭
│  ├─ SearchBar.jsx           지역 검색 + 현재 위치 버튼
│  ├─ KakaoMap.jsx            지도·마커·인포윈도우·10km 반경 원
│  ├─ PlaceList.jsx           결과 리스트 (로딩/에러/빈 상태)
│  └─ PlaceCard.jsx           카드 + 카카오맵/길찾기 버튼
├─ hooks/
│  ├─ useKakaoSdk.js          SDK 1회 로드
│  └─ useGeolocation.js       브라우저 위치 취득
└─ lib/
   ├─ kakao.js                주소/키워드 검색, 좌표→행정구역, place_url 조회
   ├─ egen.js                 E-Gen Open API 클라이언트 (XML 파싱)
   ├─ finder.js               지역 해석 → 조회 → 시간 필터 → 반경 필터 → 정렬
   ├─ geo.js                  Haversine 거리 계산
   ├─ time.js                 요일 코드 / 영업시간 판정
   └─ constants.js            반경·기본좌표·시도 매핑·공휴일
```

### 검색 파이프라인

1. **좌표 확정** — 검색어는 `Geocoder.addressSearch` → 실패 시 `Places.keywordSearch`로 대표 좌표 추출.
   초기 진입 시에는 Geolocation, 권한 거부 시 `DEFAULT_CENTER`(성남시청).
2. **행정구역 해석** — E-Gen은 시/도(`Q0`) + 시군구(`Q1`) 단위로만 조회된다.
   반경 10km가 구·시 경계를 넘는 경우를 놓치지 않도록 **중심 + 8방위 10km 지점**의
   행정구역을 `coord2RegionCode`로 모두 구해 중복 제거 후 병렬 조회한다.
   (`서울` → `서울특별시`, `성남시 분당구` → `성남시분당구` 로 정규화)
3. **API 호출** — 오늘 요일 코드(`QT`: 1=월 … 7=일, 8=공휴일)로 서버에서 1차 필터.
   - 약국 `ErmctInsttInfoInqireService/getParmacyListInfoInqire`
   - 병·의원 `HsptlAsembySearchService/getHsptlMdcncListInfoInqire`
4. **시각 필터** — Open API는 요일까지만 좁혀주므로, 응답의
   `dutyTime1s~8s`(시작, QT31~QT38) / `dutyTime1c~8c`(종료, QT41~QT48)와
   현재 `HHMM`을 비교해 **실제 영업 중**인 곳만 남긴다.
   종료 < 시작이면 심야영업(익일)으로 처리하고, 전날 심야영업이 새벽까지 이어지는 경우도 포함한다.
5. **반경 필터 & 정렬** — Haversine으로 중심 좌표와의 거리를 구해 10km 이내만 남기고 가까운 순 정렬.

### CORS 프록시

`apis.data.go.kr` 은 브라우저 직접 호출을 허용하지 않는다.

- **개발**: `vite.config.js` 의 `server.proxy` 가 `/egen/*` → `https://apis.data.go.kr/*`
- **배포**: `api/egen.js`(서버리스 함수) + `vercel.json` rewrite 로 동일 경로 유지

Vercel 외의 호스팅을 쓴다면 같은 역할의 프록시를 만들고 `VITE_EGEN_PROXY_BASE` 로 경로만 바꾸면 된다.

## 동작 메모

- **`💊 약국` 탭**은 약국만, **`🏥 의원` 탭**은 E-Gen의 병·의원 데이터를 모두 보여주고
  종별(`의원`/`병원`/`종합병원` 등)을 카드에 배지로 표시한다. 상급 병원을 숨기면
  야간·휴일에 실제로 갈 수 있는 곳이 사라지기 때문에 종별로 잘라내지 않았다.
- 영업시간을 등록하지 않은 기관은 기본적으로 제외되며, 리스트 상단 체크박스로 포함시킬 수 있다.
- 공휴일 목록은 `src/lib/constants.js` 의 `HOLIDAYS` 에 하드코딩되어 있다.
  정확도가 중요하면 공공데이터포털 「특일 정보(getRestDeInfo)」 API로 대체할 것.
  목록에 없는 날은 평일 시간표로 동작하므로 누락돼도 앱은 정상 작동한다.
- 각 카드의 **[카카오맵으로 보기]** 는 클릭 시 Kakao Local로 해당 좌표 반경 500m 안에서
  장소를 찾아 `place_url` 로 이동하고, 못 찾으면 `map.kakao.com/link/search/{상호명}` 로 폴백한다.
  **[길찾기]** 는 `map.kakao.com/link/to/{상호명},{위도},{경도}`.
