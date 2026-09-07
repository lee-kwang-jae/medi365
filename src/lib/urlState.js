import { TABS } from './constants.js';

/**
 * 검색 상태(기준 좌표·지역 이름·탭)를 주소창에 담고 되읽는다.
 *
 * 모바일에서 '카카오맵으로 보기'나 '길찾기'를 누르면 카카오맵 앱이 화면을 가져간다.
 * 돌아왔을 때 브라우저가 페이지를 새로 띄우면, 상태가 메모리에만 있던 시절에는
 * 검색 결과가 통째로 날아가고 '위치를 확인해 주세요' 부터 다시 시작해야 했다.
 * 주소에 남겨두면 같은 URL 을 다시 열기만 해도 보던 목록이 그대로 복원된다.
 *
 * 좌표만 있으면 검색은 재현된다. 지역 이름(q)은 화면에 뿌릴 라벨일 뿐이라 없어도
 * 동작하고, 탭도 값이 이상하면 기본값으로 떨어진다. 복원은 실패하지 않는다.
 */

/** 좌표는 소수점 5자리면 약 1m 다. 그 아래는 주소만 길어질 뿐이다. */
const COORD_DIGITS = 5;

/** 주소창 → 초기 상태. 좌표가 없거나 숫자가 아니면 center 는 null 이다. */
export function readUrlState(search = window.location.search) {
  const p = new URLSearchParams(search);
  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));
  const tab = p.get('tab');

  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  return {
    center: hasCoords ? { lat, lng } : null,
    centerLabel: (hasCoords && p.get('q')) || '',
    tab: TABS.some((t) => t.key === tab) ? tab : TABS[0].key,
  };
}

/**
 * 상태 → 주소창. 방문 기록을 남기지 않는다(replace).
 * 검색할 때마다 기록이 쌓이면 뒤로가기를 여러 번 눌러야 앱을 빠져나가게 된다.
 */
export function writeUrlState({ center, centerLabel, tab }) {
  const p = new URLSearchParams();
  if (center) {
    p.set('lat', center.lat.toFixed(COORD_DIGITS));
    p.set('lng', center.lng.toFixed(COORD_DIGITS));
    if (centerLabel) p.set('q', centerLabel);
  }
  if (tab && tab !== TABS[0].key) p.set('tab', tab);

  const qs = p.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState(null, '', next);
  }
}
