import { SIDO_MAP } from './constants.js';
import { haversineKm } from './geo.js';

const APP_KEY = import.meta.env.VITE_KAKAO_JS_KEY || '';
const SDK_URL = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${APP_KEY}&libraries=services&autoload=false`;

let loaderPromise = null;

/** 카카오 지도 SDK(services 라이브러리 포함)를 1회만 로드한다. */
export function loadKakaoSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.kakao?.maps?.services) return Promise.resolve(window.kakao);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (!APP_KEY) {
      reject(
        new Error('카카오 JavaScript 키가 없습니다. .env 의 VITE_KAKAO_JS_KEY 를 설정하세요.'),
      );
      return;
    }

    const existing = document.querySelector('script[data-kakao-sdk]');
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      script.dataset.kakaoSdk = 'true';
      document.head.appendChild(script);
    }

    script.addEventListener('load', () => {
      window.kakao.maps.load(() => resolve(window.kakao));
    });
    script.addEventListener('error', () =>
      reject(new Error('카카오 지도 SDK 를 불러오지 못했습니다. 앱 키와 등록 도메인을 확인하세요.')),
    );
  });

  return loaderPromise;
}

const services = () => window.kakao.maps.services;

/**
 * 카카오 SDK 는 콜백 기반이라, 콜백이 오지 않으면 Promise 가 영원히 매달린다.
 * 그러면 화면이 '검색 중' 에서 빠져나오지 못한다. 모든 호출에 상한을 둔다.
 */
const KAKAO_TIMEOUT_MS = 8000;
function withTimeout(promise, fallback = null, ms = KAKAO_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * 키워드/주소 검색으로 지역 대표 좌표를 얻는다.
 *   1) 주소 검색(Geocoder.addressSearch) — "서울시 강남구 역삼동" 같은 행정구역명에 강함
 *   2) 실패 시 키워드 검색(Places.keywordSearch)
 * @returns {Promise<{lat:number,lng:number,label:string,addressName:string,placeUrl?:string}>}
 */
export async function searchLocation(query) {
  await loadKakaoSdk();
  const keyword = query.trim();
  if (!keyword) throw new Error('검색어를 입력하세요.');

  const byAddress = await addressSearch(keyword);
  if (byAddress) return byAddress;

  const byKeyword = await keywordSearch(keyword);
  if (byKeyword) return byKeyword;

  throw new Error(`"${keyword}" 위치를 찾지 못했습니다. 시/도와 동 이름을 함께 입력해 보세요.`);
}

function addressSearch(keyword) {
  return withTimeout(new Promise((resolve) => {
    new (services().Geocoder)().addressSearch(keyword, (result, status) => {
      if (status !== services().Status.OK || !result.length) return resolve(null);
      const top = result[0];
      resolve({
        lat: Number(top.y),
        lng: Number(top.x),
        label: top.address_name,
        addressName: top.address_name,
      });
    });
  }));
}

function keywordSearch(keyword) {
  return withTimeout(new Promise((resolve) => {
    new (services().Places)().keywordSearch(keyword, (data, status) => {
      if (status !== services().Status.OK || !data.length) return resolve(null);
      const top = data[0];
      resolve({
        lat: Number(top.y),
        lng: Number(top.x),
        label: top.place_name,
        addressName: top.road_address_name || top.address_name,
        placeUrl: top.place_url,
      });
    });
  }));
}

/**
 * 카카오의 시군구 이름을 E-Gen 의 Q1 값으로 바꾼다.
 *
 * 일반구(시 아래의 구)는 이름을 붙이지 않고 **시까지만** 쓴다.
 *   카카오: "화성시 효행구" → E-Gen Q1: "화성시"
 *
 * 구 단위로 물으면 더 적게 받아 좋을 것 같지만, E-Gen 의 구 태깅이 완전하지 않다.
 * 2025 년에 구가 새로 생긴 화성시가 대표적이다 (실측, 2026-09-07):
 *   Q1=화성시        → 약국 350 · 병원 1040
 *   Q1=화성시효행구+동탄구+병점구 → 약국  38 · 병원  770
 * 아직 구 없는 옛 주소로 등록된 기관이 그대로 남아 있어서, 구로 물으면
 * 봉담읍 약국 대부분이 통째로 사라진다.
 *
 * 반대 방향의 누락은 없다. 시로 물은 결과가 그 시의 모든 구 결과를 포함하는 것을
 * 화성·고양·창원·전주 4개 시 × 약국/병원 양쪽에서 확인했다. 구 질의를 시 질의로
 * 바꿔도 잃는 것이 없고, 반경이 한 시의 여러 구에 걸칠 때는 호출 수까지 줄어든다.
 *
 * 서울·부산 등의 자치구("강남구")는 앞에 시 이름이 없으므로 그대로 둔다.
 */
export function toEgenSigungu(name) {
  const gu = name.match(/^(\S+시)\s+\S+구$/);
  return (gu ? gu[1] : name).replace(/\s+/g, '');
}

/**
 * 좌표 → 행정구역. 응급의료포털 요청용 Q0(시도)/Q1(시군구) 로 변환해 돌려준다.
 * @returns {Promise<{q0:string, q1:string, label:string}|null>}
 */
export function coordToRegion({ lat, lng }) {
  return withTimeout(new Promise((resolve) => {
    new (services().Geocoder)().coord2RegionCode(lng, lat, (result, status) => {
      if (status !== services().Status.OK || !result.length) return resolve(null);
      const region = result.find((r) => r.region_type === 'H') || result[0];

      const sido = SIDO_MAP[region.region_1depth_name] || region.region_1depth_name;
      const sigungu = toEgenSigungu(region.region_2depth_name || '');

      resolve({
        q0: sido,
        q1: sigungu,
        label: [region.region_1depth_name, region.region_2depth_name, region.region_3depth_name]
          .filter(Boolean)
          .join(' '),
      });
    });
  }));
}

/** 이 거리(km)를 넘게 떨어진 동명 장소는 다른 곳으로 본다. */
const PLACE_MATCH_KM = 1;
/**
 * keywordSearch 의 radius 는 좁게 주면 실재하는 장소도 ZERO_RESULT 로 떨어진다.
 * (실측: 500m → ZERO_RESULT, 5km → 정상. 같은 좌표·같은 이름)
 * 그래서 넉넉히 받아서 우리가 직접 가까운 것을 고른다.
 */
const PLACE_SEARCH_RADIUS_M = 5000;

/**
 * 장소명 + 좌표로 카카오맵 place_url 을 찾는다. 실패하면 null.
 * (E-Gen 응답에는 place_url 이 없으므로 상세 링크가 필요할 때만 조회)
 *
 * 넓게 검색하는 만큼 이름만 같고 동네가 다른 지점이 1위로 올 수 있으므로,
 * 좌표가 {@link PLACE_MATCH_KM} 안에 있는 후보 중 가장 가까운 것만 채택한다.
 */
export function findPlaceUrl(name, { lat, lng }) {
  return new Promise((resolve) => {
    if (!window.kakao?.maps?.services) return resolve(null);
    const options = {
      location: new window.kakao.maps.LatLng(lat, lng),
      radius: PLACE_SEARCH_RADIUS_M,
      size: 15,
    };
    new (services().Places)().keywordSearch(
      name,
      (data, status) => {
        if (status !== services().Status.OK || !data.length) return resolve(null);

        const nearest = data
          .map((p) => ({ p, km: haversineKm({ lat, lng }, { lat: Number(p.y), lng: Number(p.x) }) }))
          .filter(({ km }) => Number.isFinite(km) && km <= PLACE_MATCH_KM)
          .sort((a, b) => a.km - b.km)[0];

        resolve(nearest ? toHttps(nearest.p.place_url) : null);
      },
      options,
    );
  });
}

/** place_url 은 http 로 내려온다. 리다이렉트 한 번을 아끼려고 미리 올린다. */
function toHttps(url) {
  return url ? url.replace(/^http:\/\//, 'https://') : null;
}

/** 카카오맵 외부 링크 */
export const kakaoLinks = {
  search: (name) => `https://map.kakao.com/link/search/${encodeURIComponent(name)}`,
  map: (name, lat, lng) => `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`,
  to: (name, lat, lng) => `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`,
};

/**
 * 카카오맵에서 이 장소를 연다.
 *
 * E-Gen 응답에는 place_url 이 없어 클릭 시점에 Kakao Local 로 조회해야 하는데,
 * 그 사이 사용자 제스처가 끝나 팝업 차단에 걸린다. 그래서 창은 제스처 안에서
 * 먼저 비워둔 채 열고, 주소만 조회가 끝난 뒤에 채운다.
 *
 * `window.open` 에 `noopener` 를 넘기면 **명세상 null 이 반환되어** 이 핸들을
 * 잃는다. 그러면 조회 후의 재시도는 제스처 밖이라 차단되고, 버튼은 아무 반응도
 * 하지 않는다. 그래서 옵션 대신 opener 를 직접 끊는다.
 *
 * @returns {boolean} 창을 열었으면 true. false 는 팝업이 막힌 것이므로
 *   호출부는 preventDefault 하지 말고 앵커의 기본 동작에 맡겨야 한다.
 */
export function openInKakaoMap(item) {
  const win = window.open('about:blank', '_blank');
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    /* 아직 about:blank 라 실패할 일은 없지만, 실패해도 이동은 계속한다 */
  }

  const fallback = kakaoLinks.search(item.name);
  findPlaceUrl(item.name, { lat: item.lat, lng: item.lng })
    .then((url) => {
      win.location.href = url || fallback;
    })
    .catch(() => {
      win.location.href = fallback;
    });
  return true;
}

/* ──────────────────────────────────────────────────────────────
 * 최후 수단: 카카오 장소 검색으로 주변 약국·병원 찾기
 *
 * 응급의료포털이 죽고 정적 데이터도 없을 때 쓴다. 카카오에는 **영업시간이 없어서**
 * '지금 문 연 곳' 을 가릴 수 없다. 대신 위치·전화번호는 나오므로 전화로 확인할 수 있다.
 * 아무것도 못 보여주는 것보다 낫다는 판단이다.
 *
 * 한 번에 최대 45곳(15개 × 3페이지)까지만 받을 수 있는 API 제약이 있다.
 * 거리순으로 받으므로 가까운 곳부터 채워진다.
 * ────────────────────────────────────────────────────────────── */

const CATEGORY = { pharmacy: 'PM9', hospital: 'HP8', pediatric: 'HP8' };
const MAX_PAGES = 3;

function categoryPage(places, code, options, page) {
  return withTimeout(new Promise((resolve) => {
    places.categorySearch(
      code,
      (data, status) => resolve(status === services().Status.OK ? data : []),
      { ...options, page },
    );
  }), []);
}

/**
 * @param {'pharmacy'|'hospital'|'pediatric'} kind
 * @returns {Promise<Array>} 앱 내부 모델 (영업시간 없음)
 */
export async function searchNearby(kind, center, radiusKm) {
  await loadKakaoSdk();
  const places = new (services().Places)();
  const options = {
    location: new window.kakao.maps.LatLng(center.lat, center.lng),
    radius: Math.min(20000, Math.round(radiusKm * 1000)), // 카카오 제한 20km
    sort: services().SortBy.DISTANCE,
    size: 15,
  };

  const code = CATEGORY[kind] ?? CATEGORY.hospital;
  const pages = await Promise.all(
    Array.from({ length: MAX_PAGES }, (_, i) => categoryPage(places, code, options, i + 1)),
  );

  const seen = new Set();
  const items = [];
  pages.flat().forEach((p) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    items.push({
      id: `kakao:${p.id}`,
      kind,
      name: p.place_name,
      address: p.road_address_name || p.address_name,
      tel: p.phone || '',
      // '음식점 > ...' 처럼 계층으로 오므로 마지막 조각만 쓴다
      division: (p.category_name || '').split('>').pop().trim(),
      emergency: '',
      etc: '',
      lat: Number(p.y),
      lng: Number(p.x),
      placeUrl: p.place_url,
      fromKakao: true, // 영업시간 없음을 표시하기 위한 표식
    });
  });
  return items;
}
