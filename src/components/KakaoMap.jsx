import { useEffect, useRef } from 'react';
import { SEARCH_RADIUS_KM } from '../lib/constants.js';
import { formatHoursLabel } from '../lib/time.js';
import { formatDistance } from '../lib/geo.js';

const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** 색상만 다른 SVG 핀 마커 이미지 */
function pinImage(kakao, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 13.2 23.6 13.8 24.2a1.7 1.7 0 0 0 2.4 0C16.8 38.6 30 25.5 30 15 30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="14.5" r="5.6" fill="#fff"/>
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

export default function KakaoMap({ center, centerLabel, items, selectedId, onSelect, accent }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const infoRef = useRef(null);
  const circleRef = useRef(null);
  const centerOverlayRef = useRef(null);
  const markersRef = useRef(new Map());
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

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

    const onIdleResize = () => map.relayout();
    window.addEventListener('resize', onIdleResize);
    return () => window.removeEventListener('resize', onIdleResize);
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

    const image = pinImage(kakao, accent);
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
      items.slice(0, 30).forEach((it) => bounds.extend(new kakao.maps.LatLng(it.lat, it.lng)));

      // 첫 렌더에서는 지도 컨테이너 크기가 아직 확정되지 않은 상태로 setBounds 가 실행돼
      // 축척이 엉뚱하게 잡힌다. 레이아웃이 끝난 다음 프레임에 relayout 후 맞춘다.
      let cancelled = false;
      const raf = requestAnimationFrame(() => {
        if (cancelled) return;
        map.relayout();
        map.setBounds(bounds, 40, 40, 40, 40);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }

    map.setLevel(6);
    map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, accent]);

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
