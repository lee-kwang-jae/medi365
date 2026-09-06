# 오늘 문 연 약국·의원 검색

카카오 지도 + 응급의료포털(E-Gen) 공공데이터로 **지금 이 시간 영업 중인 약국/병·의원**을
검색 위치 **반경 3km** 안에서 찾아 거리순으로 보여주는 React(Vite) + Tailwind 웹앱.

**배포**: GitHub 저장소 → Vercel 자동 배포

## 로컬 실행

```bash
npm install
cp .env.example .env   # 키 입력 후
npm run dev            # http://localhost:5173
```

### 환경변수

| 변수 | 노출 | 발급처 |
| --- | --- | --- |
| `VITE_KAKAO_JS_KEY` | 브라우저 | 카카오 개발자센터 → 앱 키 → **JavaScript 키** |
| `EGEN_SERVICE_KEY` | **서버만** | 공공데이터포털 → 마이페이지 → 일반 인증키 **(Decoding)** |

`EGEN_SERVICE_KEY` 에는 `VITE_` 접두사가 없다. Vite 는 `VITE_` 로 시작하는 변수만 번들에
주입하므로 이 키는 **클라이언트에 절대 포함되지 않는다.** 프록시(개발: Vite dev 서버,
배포: `api/egen.js`)가 요청을 흘려보낼 때 서버 쪽에서 붙인다.

카카오 JS 키는 도메인 화이트리스트로 보호되는 방식이라 번들에 포함되는 게 정상이다.
카카오 개발자센터 → 플랫폼 → Web 사이트 도메인에 아래를 등록할 것:

```
http://localhost:5173
https://<Vercel 배포 도메인>
```

## 배포 (Vercel)

`apis.data.go.kr` 이 CORS 를 막기 때문에 서버 프록시가 필요하다.
Vercel 서버리스 함수가 그 역할을 하며, 인증키도 여기서 주입한다.

```
브라우저 ──▶ <프로젝트>.vercel.app          (정적 자산)
        └─▶ <프로젝트>.vercel.app/egen/…    (rewrite → api/egen.js)
                        └─▶ apis.data.go.kr (+ serviceKey 주입)
```

1. [vercel.com/new](https://vercel.com/new) 에서 이 GitHub 저장소를 Import.
   Vite 프리셋이 자동 인식되므로 빌드 설정은 건드릴 필요 없다.
2. **Settings → Environment Variables** 에 두 개 등록 (Production/Preview/Development 전체):

   | 이름 | 값 |
   | --- | --- |
   | `VITE_KAKAO_JS_KEY` | 카카오 JavaScript 키 |
   | `EGEN_SERVICE_KEY` | 공공데이터포털 Decoding 키 |

3. Deploy. 이후 `main` 에 push 할 때마다 자동 재배포되고, PR 에는 미리보기 배포가 붙는다.
4. 배포 도메인이 나오면 카카오 개발자센터의 Web 사이트 도메인에 추가할 것.
   (등록 전에는 지도 SDK 가 로드되지 않는다)

## 구조

```
src/
├─ App.jsx                    상태 오케스트레이션 (탭/중심좌표/결과)
├─ components/
│  ├─ TabBar.jsx              💊 약국 / 🏥 의원 탭
│  ├─ SearchBar.jsx           지역 검색 + 현재 위치 버튼
│  ├─ KakaoMap.jsx            지도·마커·인포윈도우·반경 원
│  ├─ PlaceList.jsx           결과 리스트 (로딩/에러/빈 상태)
│  └─ PlaceCard.jsx           카드 + 카카오맵/길찾기 버튼
├─ hooks/
│  ├─ useKakaoSdk.js          SDK 1회 로드
│  └─ useGeolocation.js       브라우저 위치 취득
└─ lib/
   ├─ kakao.js                주소/키워드 검색, 좌표→행정구역, place_url 조회
   ├─ egen.js                 E-Gen Open API 클라이언트 (약국·병의원·명절 비상진료, XML 파싱)
   ├─ finder.js               지역 해석 → 조회 → 시간 필터 → 반경 필터 → 정렬
   ├─ geo.js                  Haversine 거리 계산
   ├─ time.js                 요일 코드 / 영업시간 판정
   └─ constants.js            반경·기본좌표·시도 매핑·공휴일·명절 연휴
api/
└─ egen.js                    Vercel 서버리스 프록시 (CORS 우회 + 인증키 주입)
```

### 검색 파이프라인

1. **좌표 확정** — 검색어는 `Geocoder.addressSearch` → 실패 시 `Places.keywordSearch`로 대표 좌표 추출.
   초기 진입 시에는 Geolocation, 권한 거부 시 `DEFAULT_CENTER`(성남시청).
2. **행정구역 해석** — E-Gen은 시/도(`Q0`) + 시군구(`Q1`) 단위로만 조회된다.
   검색 반경이 구·시 경계를 넘는 경우를 놓치지 않도록 **중심 + 8방위 반경 지점**의
   행정구역을 `coord2RegionCode`로 모두 구해 중복 제거 후 병렬 조회한다.
   (`서울` → `서울특별시`, `성남시 분당구` → `성남시분당구` 로 정규화)
3. **API 호출** — 오늘 요일 코드(`QT`: 1=월 … 7=일, 8=공휴일)로 서버에서 1차 필터.
   - 약국 `ErmctInsttInfoInqireService/getParmacyListInfoInqire`
   - 병·의원 `HsptlAsembySearchService/getHsptlMdcncListInfoInqire`
   - 공휴일에는 공휴일 시간표를 등록하지 않은 기관이 서버에서 걸러지므로,
     `QT=8` 과 실제 요일 코드로 각각 조회해 합친다.
3-1. **명절 연휴 (설·추석)** — 위 목록 API 를 **요일 필터 없이** 호출해 전체 좌표를 확보하고,
   국립중앙의료원 「전국 명절 비상 진료기관 정보 조회 서비스」를 함께 조회해 `hpid` 로 조인한다.
   - `HolidyEmgncClnicInsttInfoInqireService/getHolidyClnicPosblEgytInfoInqire`
   - 이 API 응답에는 **좌표가 없어서** 목록 API 의 `wgs84Lat/Lon` 을 빌려 쓴다.
   - 요일 필터를 빼는 이유: "평소 그 요일엔 안 열지만 명절엔 여는 곳" 이 서버 단계에서
     사라지면 명절 데이터를 조인할 대상 자체가 없어지기 때문이다.
   - 명절 비상진료기관은 그날 공지된 `dutyDaytime{n}` 이 요일 시간표보다 우선한다.
4. **시각 필터** — Open API는 요일까지만 좁혀주므로, 응답의
   `dutyTime1s~8s`(시작, QT31~QT38) / `dutyTime1c~8c`(종료, QT41~QT48)와
   현재 `HHMM`을 비교해 **실제 영업 중**인 곳만 남긴다.
   종료 < 시작이면 심야영업(익일)으로 처리하고, 전날 심야영업이 새벽까지 이어지는 경우도 포함한다.
5. **반경 필터 & 정렬** — Haversine으로 중심 좌표와의 거리를 구해 `SEARCH_RADIUS_KM` 이내만 남기고 가까운 순 정렬.

## 동작 메모

- **`💊 약국` 탭**은 약국만, **`🏥 의원` 탭**은 E-Gen의 병·의원 데이터를 모두 보여주고
  종별(`의원`/`병원`/`종합병원` 등)을 카드에 배지로 표시한다. 상급 병원을 숨기면
  야간·휴일에 실제로 갈 수 있는 곳이 사라지기 때문에 종별로 잘라내지 않았다.
- 지도의 초기 축척은 **검색 위치 + 가장 가까운 5곳**이 모두 보이도록 맞춘다
  (`FIT_NEAREST_COUNT` in `KakaoMap.jsx`). 결과 전체를 담으면 반경 끝의 한 곳 때문에
  축척이 과하게 넓어져 정작 가까운 곳들이 뭉쳐 보인다. 나머지 마커도 모두 찍히므로
  축소하면 보인다.
- 영업시간을 등록하지 않은 기관은 기본적으로 제외되며, 리스트 상단 체크박스로 포함시킬 수 있다.
- 명절 API 는 개발계정 트래픽이 **1,000회/일**로 다른 서비스보다 훨씬 빠듯하다.
  그래서 `src/lib/constants.js` 의 `HOLIDAY_SEASONS` 에 등록된 설·추석 연휴 당일에만 호출한다.
  평상시에는 한 번도 부르지 않으므로 한도를 소모하지 않는다. **매년 갱신 필요.**
- 공휴일 목록은 `src/lib/constants.js` 의 `HOLIDAYS` 에 하드코딩되어 있다.
  정확도가 중요하면 공공데이터포털 「특일 정보(getRestDeInfo)」 API로 대체할 것.
  목록에 없는 날은 평일 시간표로 동작하므로 누락돼도 앱은 정상 작동한다.
- 각 카드의 **[카카오맵으로 보기]** 는 클릭 시 Kakao Local로 해당 좌표 반경 500m 안에서
  장소를 찾아 `place_url` 로 이동하고, 못 찾으면 `map.kakao.com/link/search/{상호명}` 로 폴백한다.
  **[길찾기]** 는 `map.kakao.com/link/to/{상호명},{위도},{경도}`.
