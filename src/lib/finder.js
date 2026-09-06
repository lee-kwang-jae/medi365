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
 * 조회에 쓸 E-Gen 요일 코드.
 *  - 명절 연휴: null (요일 필터 없이 전체를 받아 명절 API 와 hpid 로 조인해야 한다)
 *  - 공휴일   : [8, 실제요일] (공휴일 시간표 미등록 기관이 서버에서 걸러지므로)
 */
function dayCodesFor(now) {
  if (isHolidaySeason(now)) return null;
  const code = getDayCode(now);
  return code === 8 ? [8, getWeekdayCode(now)] : [code];
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

/* ── 후보 수집: 정적 데이터셋 / 실시간 API ──────────────────────────── */

/**
 * 미리 수집해 둔 정적 데이터셋에서 후보를 읽는다.
 * 상류를 타지 않으므로 장애와 무관하고 즉시 응답한다.
 * @returns {Promise<Array|null>} 데이터가 없으면 null
 */
export async function collectFromDataset({
  kind,
  variants,
  datasetFilter,
  center,
  radiusKm = SEARCH_RADIUS_KM,
}) {
  const rows = await loadFromDataset(kind, center, radiusKm);
  if (!rows?.length) return null;
  return datasetFilter === 'pediatric' ? filterPediatric(rows, variants) : rows;
}

/** 실시간 API 에서 후보를 읽는다. 실패하면 예외를 던진다. */
export async function collectFromApi({
  kind,
  variants,
  center,
  radiusKm = SEARCH_RADIUS_KM,
  now,
}) {
  const regions = await resolveRegions(center, radiusKm);
  if (!regions.length) {
    throw new Error('검색 위치의 행정구역을 확인하지 못했습니다.');
  }
  const raw = await fetchFacilities(kind, regions, dayCodesFor(now), variants);
  return { items: raw.items, failed: raw.failed, total: raw.total, regions };
}

/**
 * 명절 비상진료기관. 그날에만 의미가 있고 실시간 조회뿐이다.
 * 실패해도 전체를 막지 않는다.
 */
export async function collectHolidayMap({
  center,
  radiusKm = SEARCH_RADIUS_KM,
  now,
  regions,
}) {
  if (!isHolidaySeason(now)) return new Map();
  const rs = regions?.length ? regions : await resolveRegions(center, radiusKm);
  return fetchHolidayClinics(rs, toCompactDate(now)).catch(() => new Map());
}

/* ── 판정: 시각 필터 · 반경 필터 · 정렬 ─────────────────────────────── */

/**
 * 후보 목록을 받아 오늘·지금 문 연 곳을 거리순으로 돌려준다.
 * 수집 경로(정적/API)와 무관하게 같은 규칙을 적용한다.
 */
export function evaluate({ rows, center, now = new Date(), radiusKm = SEARCH_RADIUS_KM, holidayMap = new Map() }) {
  const nowMinutes = toMinutes(now);

  const inRadius = rows
    .filter((it) => it.lat != null && it.lng != null)
    .map((it) => ({ ...it, distanceKm: haversineKm(center, { lat: it.lat, lng: it.lng }) }))
    .filter((it) => it.distanceKm <= radiusKm);

  const evaluated = inRadius
    .map((it) => {
      const holiday = holidayMap.get(it.id);

      // 명절 비상진료기관으로 등록된 곳은 그날 공지된 운영시간이 우선한다
      if (holiday) {
        const hours = parseHolidayTime(holiday.timeRaw);
        const open =
          hours?.start != null ? nowMinutes >= hours.start && nowMinutes < hours.end : true;
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
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    items: evaluated,
    stats: {
      fetched: rows.length,
      inRadius: inRadius.length,
      open: evaluated.filter((it) => it.isOpen).length,
      unknown: evaluated.filter((it) => it.unknownHours).length,
      holidayEmergency: evaluated.filter((it) => it.holidayEmergency).length,
      holidaySeason: isHolidaySeason(now),
    },
  };
}

/** 두 경로의 결과를 hpid 로 합친다. 같은 기관이면 더 최신인 API 쪽을 쓴다. */
export function mergeRows(datasetRows, apiRows) {
  const merged = new Map();
  (datasetRows || []).forEach((r) => merged.set(r.id, r));
  (apiRows || []).forEach((r) => merged.set(r.id, r));
  return [...merged.values()];
}
