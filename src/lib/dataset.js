/**
 * 미리 수집해 둔 정적 데이터셋 읽기
 * ------------------------------------------------------------------
 * scripts/fetch-data.mjs 가 하루 한 번 만들어 public/data/ 에 두는 파일을 읽는다.
 * 사용자의 검색이 응급의료포털을 직접 타지 않으므로 상류 장애의 영향을 받지 않는다.
 *
 * 좌표 격자(0.1도 ≈ 위도 11km / 경도 9km)로 나뉘어 있어, 검색 반경이 걸치는
 * 격자만 읽으면 된다. 행정구역 이름을 맞출 필요가 없다.
 */
import { offsetLatLng } from './geo.js';

const BASE = `${import.meta.env.BASE_URL || '/'}data`.replace(/\/{2,}/g, '/');
export const GRID = 0.1;

// 1e-9 보정: 37.4/0.1 이 373.9999… 로 떨어지는 부동소수점 오차를 막는다.
// scripts/fetch-data.mjs 의 gridKey 와 반드시 같은 식이어야 한다.
const gridKey = (lat, lng) =>
  `${Math.floor(lat / GRID + 1e-9)}_${Math.floor(lng / GRID + 1e-9)}`;

/** 수집기가 만든 배열의 컬럼 순서 (scripts/fetch-data.mjs 의 parseItems 와 짝) */
const F = {
  hpid: 0,
  name: 1,
  addr: 2,
  tel: 3,
  div: 4,
  emergency: 5,
  etc: 6,
  lat: 7,
  lng: 8,
  times: 9, // 이후 16칸: 1s,1c,2s,2c … 8s,8c
};

function toItem(row, kind) {
  const item = {
    id: row[F.hpid] || `${row[F.name]}-${row[F.lat]}-${row[F.lng]}`,
    kind,
    name: row[F.name],
    address: row[F.addr],
    tel: row[F.tel],
    division: row[F.div],
    emergency: row[F.emergency],
    etc: row[F.etc],
    lat: row[F.lat],
    lng: row[F.lng],
  };
  for (let i = 0; i < 8; i += 1) {
    item[`dutyTime${i + 1}s`] = row[F.times + i * 2] || '';
    item[`dutyTime${i + 1}c`] = row[F.times + i * 2 + 1] || '';
  }
  return item;
}

/** 반경이 걸치는 격자 키 목록. 중심 기준 상하좌우 끝점의 격자를 모두 포함한다. */
export function cellsForRadius(center, radiusKm) {
  const west = offsetLatLng(center, -radiusKm, 0);
  const east = offsetLatLng(center, radiusKm, 0);
  const south = offsetLatLng(center, 0, -radiusKm);
  const north = offsetLatLng(center, 0, radiusKm);

  const keys = new Set();
  for (let la = Math.floor(south.lat / GRID); la <= Math.floor(north.lat / GRID); la += 1) {
    for (let ln = Math.floor(west.lng / GRID); ln <= Math.floor(east.lng / GRID); ln += 1) {
      keys.add(`${la}_${ln}`);
    }
  }
  return [...keys];
}

let indexPromise = null;
/** 데이터셋 메타(생성 시각, 건수). 파일이 없으면 null → 호출부가 API 로 폴백한다. */
export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return indexPromise;
}

let pediatricPromise = null;
/**
 * 소아청소년과(D002) 등록 기관의 hpid 집합.
 * 병의원 목록에는 진료과목 필드가 없어 서버 필터(QD)로만 알 수 있다.
 * 수집기가 미리 받아둔 목록을 읽는다.
 */
export function loadPediatricSet() {
  if (!pediatricPromise) {
    pediatricPromise = fetch(`${BASE}/tags/pediatric.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ids) => new Set(ids))
      .catch(() => new Set());
  }
  return pediatricPromise;
}

const cellCache = new Map();

async function loadCell(kind, key) {
  const cacheKey = `${kind}/${key}`;
  if (!cellCache.has(cacheKey)) {
    cellCache.set(
      cacheKey,
      fetch(`${BASE}/${kind}/${key}.json`)
        .then((r) => (r.ok ? r.json() : [])) // 데이터가 없는 격자(바다·산)는 404 가 정상이다
        .catch(() => []),
    );
  }
  return cellCache.get(cacheKey);
}

/**
 * 반경 안의 격자들을 읽어 합친다.
 *
 * 도시 단위로 조금씩 넓혀가는 중이라 아직 수집하지 않은 지역이 있다.
 * 필요한 격자 중 **하나라도 수집 범위 밖이면 null 을 돌려** 호출부가 실시간 API 로
 * 폴백하게 한다. 그렇지 않으면 미수집 지역이 오류 없이 조용히 0건이 된다.
 *
 * @returns {Promise<Array|null>} 데이터셋이 없거나 범위 밖이면 null
 */
export async function loadFromDataset(kind, center, radiusKm, regions) {
  const index = await loadIndex();
  if (!index) return null;
  if (!index.cells?.[kind]?.length) return null;

  if (!index.complete) {
    // 부분 수집 상태 — 검색 반경에 걸친 시군구가 **모두** 수집됐을 때만 정적 데이터를 쓴다.
    // 격자 존재 여부로 판정하면 안 된다(위 주석 참고).
    if (!regions?.length) return null;
    const collected = new Set(index.regions || []);
    const ok = regions.every(
      (r) => collected.has(`${r.q0}|${r.q1}`) || collected.has(`${r.q0}|*`),
    );
    if (!ok) return null;
  }

  const cells = cellsForRadius(center, radiusKm);
  const chunks = await Promise.all(cells.map((key) => loadCell(kind, key)));

  const merged = new Map();
  chunks.flat().forEach((row) => {
    const item = toItem(row, kind);
    if (!merged.has(item.id)) merged.set(item.id, item);
  });
  return [...merged.values()];
}
