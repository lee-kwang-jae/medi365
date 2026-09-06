import { SIDO_MAP } from './constants.js';

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
  return new Promise((resolve) => {
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
  });
}

function keywordSearch(keyword) {
  return new Promise((resolve) => {
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
  });
}

/**
 * 좌표 → 행정구역. 응급의료포털 요청용 Q0(시도)/Q1(시군구) 로 변환해 돌려준다.
 * @returns {Promise<{q0:string, q1:string, label:string}|null>}
 */
export function coordToRegion({ lat, lng }) {
  return new Promise((resolve) => {
    new (services().Geocoder)().coord2RegionCode(lng, lat, (result, status) => {
      if (status !== services().Status.OK || !result.length) return resolve(null);
      const region = result.find((r) => r.region_type === 'H') || result[0];

      const sido = SIDO_MAP[region.region_1depth_name] || region.region_1depth_name;
      // 카카오: "성남시 분당구" → E-Gen: "성남시분당구"
      const sigungu = (region.region_2depth_name || '').replace(/\s+/g, '');

      resolve({
        q0: sido,
        q1: sigungu,
        label: [region.region_1depth_name, region.region_2depth_name, region.region_3depth_name]
          .filter(Boolean)
          .join(' '),
      });
    });
  });
}

/**
 * 장소명 + 좌표로 카카오맵 place_url 을 찾는다. 실패하면 null.
 * (E-Gen 응답에는 place_url 이 없으므로 상세 링크가 필요할 때만 조회)
 */
export function findPlaceUrl(name, { lat, lng }) {
  return new Promise((resolve) => {
    if (!window.kakao?.maps?.services) return resolve(null);
    const options = {
      location: new window.kakao.maps.LatLng(lat, lng),
      radius: 500,
      size: 5,
    };
    new (services().Places)().keywordSearch(
      name,
      (data, status) => {
        if (status !== services().Status.OK || !data.length) return resolve(null);
        resolve(data[0].place_url || null);
      },
      options,
    );
  });
}

/** 카카오맵 외부 링크 */
export const kakaoLinks = {
  search: (name) => `https://map.kakao.com/link/search/${encodeURIComponent(name)}`,
  map: (name, lat, lng) => `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`,
  to: (name, lat, lng) => `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`,
};
