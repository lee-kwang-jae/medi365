import { coordToRegion } from './kakao.js';
import { fetchFacilities } from './egen.js';
import { haversineKm, offsetLatLng } from './geo.js';
import { getDayCode, getWeekdayCode, getOpenState } from './time.js';
import { SEARCH_RADIUS_KM } from './constants.js';

/**
 * 검색 중심에서 반경 R 안에 걸치는 모든 시군구를 찾는다.
 * E-Gen 은 시/도 + 시군구 단위로만 조회되므로, 경계를 넘는 시설을 놓치지 않으려면
 * 중심 + 8방위 가장자리 좌표의 행정구역을 모두 모아 조회해야 한다.
 */
export async function resolveRegions(center, radiusKm = SEARCH_RADIUS_KM) {
  const probes = [
    center,
    ...[
      [0, 1],
      [0.71, 0.71],
      [1, 0],
      [0.71, -0.71],
      [0, -1],
      [-0.71, -0.71],
      [-1, 0],
      [-0.71, 0.71],
    ].map(([ex, ny]) => offsetLatLng(center, ex * radiusKm, ny * radiusKm)),
  ];

  const found = await Promise.all(probes.map((p) => coordToRegion(p).catch(() => null)));

  const unique = new Map();
  found.forEach((region) => {
    if (!region?.q0) return;
    const key = `${region.q0}|${region.q1}`;
    if (!unique.has(key)) unique.set(key, region);
  });

  // 중심 지역은 항상 첫 번째로
  return Array.from(unique.values());
}

/**
 * 오늘·지금 문 연 약국/병의원을 반경 내에서 찾아 거리순으로 돌려준다.
 *
 * @param {object} params
 * @param {'pharmacy'|'hospital'} params.kind
 * @param {{lat:number,lng:number}} params.center
 * @param {Date} [params.now]
 * @param {number} [params.radiusKm]
 * @returns {Promise<{items:Array, regions:Array, stats:object}>}
 */
export async function findOpenFacilities({
  kind,
  center,
  now = new Date(),
  radiusKm = SEARCH_RADIUS_KM,
}) {
  const regions = await resolveRegions(center, radiusKm);
  if (!regions.length) {
    throw new Error('검색 위치의 행정구역을 확인하지 못했습니다. 다른 지역명으로 시도해 보세요.');
  }

  // 공휴일에는 공휴일(8) 시간표를 등록하지 않은 곳이 서버 단계에서 걸러지므로
  // 실제 요일 코드로도 함께 조회한 뒤 합친다. (실제 영업 여부는 아래에서 시각으로 판정)
  const dayCode = getDayCode(now);
  const dayCodes = dayCode === 8 ? [8, getWeekdayCode(now)] : [dayCode];
  const raw = await fetchFacilities(kind, regions, dayCodes);

  const withGeo = raw.filter((it) => it.lat != null && it.lng != null);

  const inRadius = withGeo
    .map((it) => ({ ...it, distanceKm: haversineKm(center, { lat: it.lat, lng: it.lng }) }))
    .filter((it) => it.distanceKm <= radiusKm);

  const evaluated = inRadius
    .map((it) => {
      const state = getOpenState(it, now);
      return { ...it, isOpen: state.open, unknownHours: state.unknown, hours: state.hours };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    items: evaluated,
    regions,
    stats: {
      fetched: raw.length,
      inRadius: inRadius.length,
      open: evaluated.filter((it) => it.isOpen).length,
      unknown: evaluated.filter((it) => it.unknownHours).length,
      dayCode,
    },
  };
}
