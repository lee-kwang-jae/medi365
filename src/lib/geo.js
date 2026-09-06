const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Haversine 공식으로 두 좌표 사이의 대권 거리(km)를 계산한다.
 * @param {{lat:number, lng:number}} a
 * @param {{lat:number, lng:number}} b
 * @returns {number} 거리(km)
 */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 기준 좌표에서 동/북으로 각각 km 만큼 이동한 좌표를 구한다.
 * (인접 시군구 탐지를 위한 근사 계산 — 수백 m 오차는 무시 가능)
 */
export function offsetLatLng({ lat, lng }, eastKm, northKm) {
  const dLat = northKm / 110.574;
  const dLng = eastKm / (111.32 * Math.cos(toRad(lat)) || 1);
  return { lat: lat + dLat, lng: lng + dLng };
}

/** 거리 표기 (1km 미만은 m 단위) */
export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}
