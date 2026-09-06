import { coordToRegion } from './kakao.js';
import { fetchFacilities, fetchHolidayClinics } from './egen.js';
import { loadFromDataset, loadPediatricSet } from './dataset.js';
import { haversineKm, offsetLatLng } from './geo.js';
import {
  getDayCode,
  getWeekdayCode,
  getOpenState,
  isHolidaySeason,
  toCompactDate,
  toMinutes,
  parseHolidayTime,
} from './time.js';
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
 * 소아 탭의 정적 경로 필터.
 * 실시간 API 는 QD/QN 으로 서버에서 걸렀지만, 정적 데이터셋에는 진료과목 필드가 없다.
 * 대신 수집기가 받아둔 소아청소년과(D002) hpid 목록과, 이름 규칙을 그대로 적용한다.
 */
async function filterPediatric(items, variants) {
  const ids = await loadPediatricSet();
  const nameRule = variants?.find((v) => v.qn);
  const excludeDiv = nameRule?.excludeDivPattern && new RegExp(nameRule.excludeDivPattern);
  const excludeAfter = nameRule?.excludeAfterPattern && new RegExp(nameRule.excludeAfterPattern);
  const qn = nameRule?.qn;

  return items.filter((it) => {
    if (ids.has(it.id)) return true; // 소아청소년과 등록 기관
    if (!qn || !it.name?.includes(qn)) return false;
    if (excludeDiv?.test(it.division || '')) return false;
    if (excludeAfter) {
      const at = it.name.indexOf(qn);
      const tail = at < 0 ? it.name : it.name.slice(at + qn.length);
      if (excludeAfter.test(tail)) return false;
    }
    return true;
  });
}

/**
 * 미리 수집해 둔 정적 데이터셋에서 후보를 읽는다.
 * 상류(E-Gen)를 타지 않으므로 장애의 영향을 받지 않고 응답도 빠르다.
 * @returns {Promise<object|null>} 데이터셋이 없으면 null → 호출부가 API 로 폴백
 */
async function loadCandidates({ kind, variants, datasetFilter, center, radiusKm }) {
  const rows = await loadFromDataset(kind, center, radiusKm);
  if (!rows) return null;

  const items = datasetFilter === 'pediatric' ? await filterPediatric(rows, variants) : rows;
  return { items, failed: 0, total: 0, source: 'dataset' };
}

/**
 * 오늘·지금 문 연 약국/병의원을 반경 내에서 찾아 거리순으로 돌려준다.
 *
 * @param {object} params
 * @param {'pharmacy'|'hospital'} params.kind
 * @param {Array<object>} [params.variants] 조회 갈래 (진료과목·기관명 필터)
 * @param {{lat:number,lng:number}} params.center
 * @param {Date} [params.now]
 * @param {number} [params.radiusKm]
 * @returns {Promise<{items:Array, regions:Array, stats:object}>}
 */
export async function findOpenFacilities({
  kind,
  variants,
  datasetFilter,
  center,
  now = new Date(),
  radiusKm = SEARCH_RADIUS_KM,
}) {
  const dayCode = getDayCode(now);
  const holidaySeason = isHolidaySeason(now);

  // 명절 연휴에는 요일 시간표가 사실상 무의미하고, 명절 API 에는 좌표가 없다.
  // 그래서 목록 API 를 요일 필터 없이(dayCodes=null) 불러 전체 좌표를 확보한 뒤
  // 명절 API 결과를 hpid 로 조인한다.
  // 평상시에는 공휴일(8) 시간표 미등록 기관이 서버에서 걸러지므로 실제 요일로도 함께 조회한다.
  const dayCodes = holidaySeason
    ? null
    : dayCode === 8
      ? [8, getWeekdayCode(now)]
      : [dayCode];

  const compactDate = toCompactDate(now);

  // 1순위: 미리 수집해 둔 정적 데이터셋. 없으면 실시간 API 로 폴백한다.
  let raw = await loadCandidates({ kind, variants, datasetFilter, center, radiusKm });
  let regions = [];
  if (!raw) {
    regions = await resolveRegions(center, radiusKm);
    if (!regions.length) {
      throw new Error('검색 위치의 행정구역을 확인하지 못했습니다. 다른 지역명으로 시도해 보세요.');
    }
    raw = await fetchFacilities(kind, regions, dayCodes, variants);
    raw.source = 'api';
  }

  // 명절 비상진료는 그날에만 필요하고 실시간 조회뿐이므로 별도로 가져온다
  let holidayMap = new Map();
  if (holidaySeason) {
    const holidayRegions = regions.length ? regions : await resolveRegions(center, radiusKm);
    holidayMap = await fetchHolidayClinics(holidayRegions, compactDate).catch(() => new Map());
  }

  const withGeo = raw.items.filter((it) => it.lat != null && it.lng != null);

  const inRadius = withGeo
    .map((it) => ({ ...it, distanceKm: haversineKm(center, { lat: it.lat, lng: it.lng }) }))
    .filter((it) => it.distanceKm <= radiusKm);

  const nowMinutes = toMinutes(now);

  const evaluated = inRadius
    .map((it) => {
      const holiday = holidayMap.get(it.id);

      // 명절 비상진료기관으로 등록된 곳은 그날 공지된 운영시간이 우선한다
      if (holiday) {
        const hours = parseHolidayTime(holiday.timeRaw);
        const open = hours?.start != null ? nowMinutes >= hours.start && nowMinutes < hours.end : true;
        return {
          ...it,
          holidayEmergency: true,
          holidayNote: holiday.etc || '',
          tel: it.tel || holiday.tel,
          hours: hours ?? null,
          // 시간 문구를 해석하지 못하면(예: '24시간') 열려 있는 것으로 본다
          isOpen: open,
          unknownHours: !hours,
        };
      }

      const state = getOpenState(it, now);
      return {
        ...it,
        holidayEmergency: false,
        isOpen: state.open,
        unknownHours: state.unknown,
        hours: state.hours,
      };
    })
    // 명절 비상진료기관을 같은 거리대에서 우선 노출
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    items: evaluated,
    regions,
    stats: {
      fetched: raw.items.length,
      failedRegions: raw.failed,
      totalRegions: raw.total,
      source: raw.source,
      inRadius: inRadius.length,
      open: evaluated.filter((it) => it.isOpen).length,
      unknown: evaluated.filter((it) => it.unknownHours).length,
      holidayEmergency: evaluated.filter((it) => it.holidayEmergency).length,
      holidaySeason,
      dayCode,
    },
  };
}
