---
name: kakao-map-integration
description: 카카오맵(Kakao Maps JavaScript SDK)을 React 앱에 붙일 때 반복해서 물리는 함정들 — SDK 로딩, 컨테이너 크기 0 문제, relayout·setBounds, 마커 성능, 바텀시트에 가려진 지도의 중심 보정, 모바일에서 카카오맵으로 나갔다 돌아오기, 좌표↔행정구역 변환. 지도 컴포넌트를 만들거나 고칠 때, 지도가 엉뚱한 곳을 비추거나 축척이 이상할 때, 마커가 많아 화면이 멈출 때, panTo·setBounds·relayout·CustomOverlay·Geocoder·keywordSearch·coord2RegionCode·place_url 을 다룰 때 반드시 먼저 읽을 것. window.kakao, dapi.kakao.com, VITE_KAKAO_JS_KEY 가 보이면 이 스킬을 참고한다.
---

# 카카오맵 SDK 실전 노트

카카오맵 SDK는 문서만 보고 짜면 거의 반드시 물리는 함정이 있다. 아래는 medi365에서
실제로 사용자 눈에 보이는 버그로 터진 뒤에 고친 것들이다. 대부분 **지도 자체보다
"컨테이너 크기"와 "콜백"** 에서 온다.

## 1. SDK 로딩 — 한 번만, autoload=false, 그리고 `kakao.maps.load`

```js
const SDK_URL = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${APP_KEY}&libraries=services&autoload=false`;
```

- `autoload=false` 로 받고 반드시 `window.kakao.maps.load(cb)` 안에서 지도를 만든다.
  이걸 빼면 스크립트 `load` 이벤트가 떴는데도 `kakao.maps.Map`이 아직 없다.
- 로더는 **모듈 수준 Promise 하나로 캐시**한다. React StrictMode·재마운트에서
  스크립트가 두 번 붙는 것을 막아야 한다. 이미 붙은 `script[data-kakao-sdk]`가 있으면
  재사용한다.
- `services` 라이브러리를 안 넣으면 `Geocoder`·`Places`가 통째로 없다.
  준비 판정도 `window.kakao?.maps?.services` 로 한다 (`window.kakao`만 보면 이르다).
- 실패 메시지에 **앱 키와 등록 도메인 확인**을 적는다. 이 둘이 원인의 대부분이다.

## 2. 콜백 API는 매달린다 — 전부 시간 상한으로 감싼다

`Geocoder.addressSearch`, `Places.keywordSearch`, `coord2RegionCode`는 전부 콜백
기반이라 **콜백이 오지 않으면 Promise가 영원히 해소되지 않는다.** 화면은 "검색 중"에
갇힌다. 예외가 아니라 무응답이므로 try/catch로는 못 잡는다.

```js
const KAKAO_TIMEOUT_MS = 8000;
const withTimeout = (promise, fallback = null, ms = KAKAO_TIMEOUT_MS) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
```

fallback을 `null`/`[]`로 두면 상위에서 "못 찾음"으로 자연스럽게 흐른다.

## 3. 좌표 확정은 2단계 — 주소 검색 → 키워드 검색

`Geocoder.addressSearch`는 "서울시 강남구 역삼동" 같은 행정구역명에 강하고,
`Places.keywordSearch`는 상호·랜드마크에 강하다. 하나만 쓰면 절반이 실패한다.
주소 검색 먼저, 실패하면 키워드 검색으로 넘긴다.

## 4. 컨테이너 크기가 0이면 지도가 망가진다 — 가장 자주 터지는 문제

숨겨진 탭, 레이아웃 확정 전, 조건부 렌더 직후에는 컨테이너가 0×0이다. 이때:

- **`setBounds`를 부르면 축척이 최대로 축소된다.** 지도가 한반도 전체를 비춘다.
- 0 크기에서 만들어진 지도는 크기가 잡히면서 **중심이 틀어진다.**

대응은 세 개가 한 세트다.

```js
// (1) 크기가 없으면 적용하지 않고 보류한다
const { width, height } = box.getBoundingClientRect();
if (width < 2 || height < 2) return;      // 다음 기회에
map.relayout();
map.setBounds(pendingBounds, 40, 40, bottomPad, 40);

// (2) 되돌릴 중심을 '방금 맞춘 결과'로 갱신한다
viewCenterRef.current = map.getCenter();
```

```js
// (3) window resize 만으로는 부족하다 — 컨테이너를 직접 관찰한다
const observer = new ResizeObserver(onResize);
observer.observe(boxRef.current);
```

`ResizeObserver`가 필요한 이유: 숨겨진 탭에서 열렸다가 나중에 보이는 경우, 사이드
패널이 접히는 경우처럼 **윈도우 크기는 그대로인데 컨테이너만 바뀌는 상황**은
`window.resize`로 잡히지 않는다. 레이아웃 토글(지도 전체화면 등)을 넣을 계획이라면
이게 있어야 저절로 동작한다.

### `viewCenterRef` 갱신을 빼먹으면 생기는 일

`setBounds`로 화면을 맞춘 뒤 `viewCenterRef`를 갱신하지 않으면, 이후의 relayout
(주소창 접힘·화면 회전 등)이 **거기 남아 있던 옛 검색 좌표로 되돌린다.** medi365에서는
이 때문에 맞춰놓은 마커들이 전부 바텀시트 뒤로 내려가 있었다. relayout 복구는
"마지막으로 사용자에게 보인 중심"으로 해야지, "마지막 검색 좌표"로 하면 안 된다.

## 5. 지도 아래가 시트에 가려질 때 — inset 보정

지도 div가 화면 전체를 차지하고 그 위에 바텀시트가 얹히는 구조라면, 지도의 기하학적
중앙은 **시트 뒤**다. 보정하지 않으면 `panTo`·`setBounds` 결과가 시트에 가려진다.

```jsx
<KakaoMap bottomInsetRatio={isDesktop ? 0 : SNAP[snap]} />
```

- `setBounds`: 아래쪽 패딩에 `height * insetRatio` 를 더한다.
- `panTo`: **투영으로 목표 좌표를 한 번에 구해 panTo를 한 번만 부른다.**

```js
const inset = box.clientHeight * bottomInsetRatio;
const projection = map.getProjection();
const point = projection.containerPointFromCoords(marker.position);
point.y += inset / 2;                       // 중심을 내리면 마커가 올라온다
map.panTo(projection.coordsFromContainerPoint(point));
```

`panTo` 뒤에 `panBy`를 이어 붙이면 애니메이션이 두 번 겹쳐 **화면이 튄다.**
반드시 한 번의 panTo로 끝낸다.

## 6. 마커 — CustomOverlay + 0×0 앵커, 그리고 개수 상한

상태 전환(선택/비선택)을 CSS 애니메이션으로 처리하려면 앵커와 시각 요소를 분리한다.

- 바깥 `.mk-anchor`를 **0×0**으로 두면 `xAnchor:0.5, yAnchor:0.5`가 정확히 좌표를
  가리킨다. 실제 마커는 그 안에서 `transform`으로 움직이므로 원형↔핀형 전환이
  CSS로 애니메이션된다. 오버레이 자체의 앵커를 바꾸려 하면 애니메이션이 안 된다.
- 마커 클릭 핸들러에서 **`e.stopPropagation()`** 을 부른다. 안 그러면 지도의 click
  핸들러(선택 해제)까지 올라가 선택하자마자 해제된다.
- 핸들러가 최신 선택 상태를 보려면 **ref로 읽는다**(`selectedRef`). 클로저에 잡힌
  옛 값을 보면 "같은 마커 재클릭 = 해제"가 동작하지 않는다.
- 사용자 입력값(`item.name`)을 `innerHTML`/오버레이 content에 넣을 때는
  **반드시 이스케이프**한다.
- 언마운트 시 `overlay.setMap(null)`·원·중심 오버레이를 전부 치운다. 안 치우면
  재마운트 때 그대로 겹쳐 쌓인다.

**개수 상한이 없으면 도심에서 화면이 멈춘다.** 결과가 수천 곳인 지역에서 마커를 전부
그리면 브라우저가 정지한다. medi365는 `renderLimit`(초기 100, '더 보기'로 증가)로
자르고, 목록과 지도에 **같은 잘린 배열**을 넘긴다. 다만 **개수 표시는 자르기 전 값**을
쓴다 — 사용자가 알아야 할 것은 "몇 곳이 있는가"지 "몇 개를 그렸는가"가 아니다.

## 7. `keywordSearch`의 radius는 좁게 주면 안 된다

실측: 같은 좌표·같은 이름으로 **radius 500m → `ZERO_RESULT`, 5km → 정상.**
좁은 반경은 실재하는 장소도 떨어뜨린다. 넉넉히(5km) 받아서 **우리가 직접 거리로
가까운 것을 고른다.** 그렇게 하면 이름만 같고 동네가 다른 지점이 1위로 오는 문제도
같이 해결된다(예: 1km 이내 후보 중 최근접만 채택).

카테고리 검색(`categorySearch`)은 한 번에 15개 × 최대 3페이지 = **45곳 제한**이 있다.
거리순 정렬로 받으면 가까운 곳부터 채워지므로 실용상 문제는 적다.

## 8. 좌표 → 행정구역: 일반구는 '시'까지만 쓴다

`coord2RegionCode` 결과를 외부 API의 시군구 파라미터로 넘길 때, 시 아래의 **일반구**는
붙이지 않고 시까지만 쓴다.

```
카카오: "화성시 효행구"  →  외부 API 시군구: "화성시"
```

이유(실측, 2026-09-07): 구가 새로 생긴 시는 상류의 구 태깅이 완전하지 않다.

| 질의 | 약국 | 병원 |
| --- | --- | --- |
| `화성시` | 350 | 1040 |
| `화성시효행구 + 동탄구 + 병점구` | 38 | 770 |

옛 주소로 등록된 기관이 그대로 남아 있어 구로 물으면 통째로 사라진다. 반대 방향의
누락은 없다 — 시 질의 결과가 그 시의 모든 구 결과를 포함하는 것을 화성·고양·창원·전주
4개 시 × 약국/병원 양쪽에서 확인했다. 호출 수까지 줄어든다.

서울·부산의 **자치구**("강남구")는 앞에 시 이름이 없으므로 그대로 둔다.
정규식으로 `^(\S+시)\s+\S+구$` 만 시로 접는다.

## 9. 모바일에서 카카오맵으로 나가면 돌아오지 못한다

`map.kakao.com` 링크는 모바일에서 **카카오맵 앱으로 넘어간다.** 이때 새 탭으로 열었다면
사용자가 브라우저로 돌아왔을 때 그 새 탭 위에 서 있게 되는데, **새 탭에는 방문 기록이
없어 뒤로가기가 아무 일도 하지 않는다.** 탭 목록을 뒤질 줄 모르는 사용자는 앱으로
못 돌아온다.

- 모바일은 **같은 탭**으로 내보낸다 → 뒤로가기 한 번이면 돌아온다.
- 대신 **검색 상태를 주소창(URL)에 남겨야** 돌아왔을 때 보던 목록이 살아있다.
  이 둘은 한 세트다. 하나만 하면 의미가 없다.
- 데스크톱 판정은 화면 폭이 아니라 **`matchMedia('(pointer: fine)')`** 로 한다.

```js
const opensInNewTab = () => window.matchMedia?.('(pointer: fine)')?.matches ?? true;
export const kakaoLinkProps = () =>
  opensInNewTab() ? { target: '_blank', rel: 'noopener noreferrer' } : {};
```

## 10. 클릭 후 비동기로 URL을 구해야 할 때 (팝업 차단)

외부 응답에 `place_url`이 없어 클릭 시점에 조회해야 하면, 조회가 끝날 즈음엔
**사용자 제스처가 끝나 팝업 차단에 걸린다.** 제스처 안에서 빈 창을 먼저 열고,
주소만 나중에 채운다.

```js
const win = window.open('about:blank', '_blank');
if (!win) return false;              // 차단됨 → 앵커 기본 동작에 맡긴다
try { win.opener = null; } catch {}  // noopener 대체
// ...조회 후...
win.location.href = url || fallbackSearchUrl;
```

**`window.open(url, name, 'noopener')`를 쓰면 명세상 `null`이 반환되어 핸들을 잃는다.**
그러면 조회 후 재시도는 제스처 밖이라 차단되고 버튼이 먹통이 된다. 옵션 대신
`win.opener = null`로 끊는다.

같은 탭으로 내보내는 환경(모바일)에서는 **이 최적화를 아예 하지 않는다.** 시간 상한
없는 조회에 `preventDefault`까지 걸어두면 콜백이 안 올 때 버튼이 그냥 죽는다.
정확한 장소 페이지는 부가 기능이므로 검색 링크로 나가는 편이 낫다.

## 이 저장소에서 실제 코드 위치

| 내용 | 파일 |
| --- | --- |
| 지도 컴포넌트 전체 | `src/components/KakaoMap.jsx` |
| SDK 로더·검색·행정구역·외부 링크 | `src/lib/kakao.js` |
| SDK 준비 상태 훅 | `src/hooks/useKakaoSdk.js` |
| 마커 기하 정의(CSS) | `src/index.css` '지도 마커' 절 |
| 검색 상태 URL 보존 | `src/lib/urlState.js` |
