import { useCallback, useEffect, useRef } from 'react';
import { SEARCH_RADIUS_KM } from '../lib/constants.js';
import { formatHoursLabel } from '../lib/time.js';
import { formatDistance } from '../lib/geo.js';

/**
 * 첫 화면에서 지도를 맞출 기준 개수.
 * 전체를 담으면 반경 끝의 한 곳 때문에 축척이 과하게 넓어져
 * 정작 가까운 곳들이 뭉쳐 보인다. 검색 위치 + 가장 가까운 N곳만 담는다.
 * (items 는 finder 에서 거리 오름차순으로 정렬되어 온다)
 */
const FIT_NEAREST_COUNT = 5;

const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * 종류별 핀 마커 이미지.
 *   약국   → 흰 알약(캡슐)
 *   병·의원 → 흰 십자(+)
 * 핀 머리 중심은 (15, 14.5) 기준으로 그린다.
 */
const PIN_GLYPH = {
  pharmacy: (color) => `
    <g transform="rotate(-35 15 14.5)">
      <rect x="8.5" y="11" width="13" height="7" rx="3.5" fill="#fff"/>
      <line x1="15" y1="11" x2="15" y2="18" stroke="${color}" stroke-width="1.3"/>
    </g>`,
  hospital: () => `
    <path d="M13.6 9.5h2.8v3.6h3.6v2.8h-3.6v3.6h-2.8v-3.6h-3.6v-2.8h3.6z" fill="#fff"/>`,
};

function pinImage(kakao, color, kind) {
  const glyph = (PIN_GLYPH[kind] ?? PIN_GLYPH.hospital)(color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 13.2 23.6 13.8 24.2a1.7 1.7 0 0 0 2.4 0C16.8 38.6 30 25.5 30 15 30 6.7 23.3 0 15 0z" fill="${color}"/>
    ${glyph}
  </svg>`;
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    new kakao.maps.Size(30, 40),
    { offset: new kakao.maps.Point(15, 39) },
  );
}

function centerContent(label) {
  return (
    '<div style="display:flex;align-items:center;gap:6px;transform:translateX(8px)">' +
    '<span style="width:14px;height:14px;border-radius:9999px;background:#ef4444;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>' +
    `<span style="background:#fff;border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:700;color:#334155;box-shadow:0 1px 4px rgba(0,0,0,.2);white-space:nowrap">${escapeHtml(label)}</span>` +
    '</div>'
  );
}

function infoWindowHtml(item) {
  const tel = item.tel
    ? `<a href="tel:${escapeHtml(item.tel)}" style="color:#1c66f5;font-weight:600">${escapeHtml(item.tel)}</a>`
    : '<span style="color:#94a3b8">전화번호 없음</span>';

  return `
    <div class="kakao-iw">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px">${escapeHtml(item.name)}</div>
      <div style="color:#475569;margin-bottom:4px">${escapeHtml(item.address)}</div>
      <div style="margin-bottom:4px">☎ ${tel}</div>
      <div style="margin-bottom:4px">🕒 ${escapeHtml(formatHoursLabel(item.hours))}</div>
      <div style="color:#64748b">📍 ${escapeHtml(formatDistance(item.distanceKm))}</div>
    </div>`;
}

export default function KakaoMap({ center, centerLabel, items, selectedId, onSelect, accent, kind }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const infoRef = useRef(null);
  const circleRef = useRef(null);
  const centerOverlayRef = useRef(null);
  const markersRef = useRef(new Map());
  const pendingBoundsRef = useRef(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  /**
   * 대기 중인 bounds 를 지도에 적용한다.
   * 컨테이너가 아직 0 크기면(숨겨진 탭·레이아웃 전) 적용하지 않고 보류한다.
   * 0 크기 상태에서 setBounds 를 호출하면 축척이 최대로 축소돼 버린다.
   */
  const fitPending = useCallback(() => {
    const map = mapRef.current;
    const box = boxRef.current;
    if (!map || !box || !pendingBoundsRef.current) return;

    const { width, height } = box.getBoundingClientRect();
    if (width < 2 || height < 2) return; // 아직 크기가 없다 → 다음 기회에

    map.relayout();
    map.setBounds(pendingBoundsRef.current, 40, 40, 40, 40);
    pendingBoundsRef.current = null;
  }, []);

  /* 지도 최초 생성 */
  useEffect(() => {
    const { kakao } = window;
    const map = new kakao.maps.Map(boxRef.current, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: 6,
    });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    mapRef.current = map;

    infoRef.current = new kakao.maps.InfoWindow({ removable: true, zIndex: 20 });

    circleRef.current = new kakao.maps.Circle({
      center: map.getCenter(),
      radius: SEARCH_RADIUS_KM * 1000,
      strokeWeight: 1,
      strokeColor: '#1c66f5',
      strokeOpacity: 0.6,
      strokeStyle: 'shortdash',
      fillColor: '#1c66f5',
      fillOpacity: 0.05,
    });
    circleRef.current.setMap(map);

    centerOverlayRef.current = new kakao.maps.CustomOverlay({
      position: map.getCenter(),
      yAnchor: 0.5,
      zIndex: 5,
      content: centerContent(centerLabel || '검색 위치'),
    });
    centerOverlayRef.current.setMap(map);

    const onResize = () => {
      map.relayout();
      fitPending();
    };
    window.addEventListener('resize', onResize);

    // 숨겨진 탭에서 열렸다가 나중에 보이는 경우까지 잡으려면 컨테이너를 직접 관찰해야 한다
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    observer?.observe(boxRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();

      // 이 효과가 만든 것은 이 효과가 치운다.
      // 정리하지 않으면 재마운트 때 원·중심 오버레이가 그대로 겹쳐 쌓인다.
      infoRef.current?.close();
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = new Map();
      circleRef.current?.setMap(null);
      centerOverlayRef.current?.setMap(null);
      pendingBoundsRef.current = null;
      circleRef.current = null;
      centerOverlayRef.current = null;
      infoRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 중심 좌표 변경 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pos = new window.kakao.maps.LatLng(center.lat, center.lng);
    map.setCenter(pos);
    circleRef.current?.setPosition(pos);
    centerOverlayRef.current?.setPosition(pos);
    centerOverlayRef.current?.setContent(centerContent(centerLabel || '검색 위치'));
  }, [center.lat, center.lng, centerLabel]);

  /* 마커 갱신 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { kakao } = window;

    infoRef.current?.close();
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = new Map();

    const image = pinImage(kakao, accent, kind);
    items.forEach((item) => {
      const marker = new kakao.maps.Marker({
        map,
        position: new kakao.maps.LatLng(item.lat, item.lng),
        title: item.name,
        image,
      });
      kakao.maps.event.addListener(marker, 'click', () => selectRef.current?.(item.id));
      markersRef.current.set(item.id, marker);
    });

    if (items.length) {
      const bounds = new kakao.maps.LatLngBounds();
      bounds.extend(new kakao.maps.LatLng(center.lat, center.lng));
      items
        .slice(0, FIT_NEAREST_COUNT)
        .forEach((it) => bounds.extend(new kakao.maps.LatLng(it.lat, it.lng)));

      // 컨테이너 크기가 잡힌 뒤에 적용한다 (fitPending 주석 참고)
      pendingBoundsRef.current = bounds;
      fitPending();
      return undefined;
    }

    pendingBoundsRef.current = null;
    map.setLevel(6);
    map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, accent, kind]);

  /* 선택 항목: panTo + 인포윈도우 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedId) {
      infoRef.current?.close();
      return;
    }
    const item = items.find((it) => it.id === selectedId);
    const marker = markersRef.current.get(selectedId);
    if (!item || !marker) return;

    map.panTo(new window.kakao.maps.LatLng(item.lat, item.lng));
    infoRef.current.setContent(infoWindowHtml(item));
    infoRef.current.open(map, marker);
  }, [selectedId, items]);

  return <div ref={boxRef} className="h-full w-full" />;
}
