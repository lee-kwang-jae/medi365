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

/** 탭 라벨과 같은 아이콘을 지도 마커에도 쓴다 */
const PIN_EMOJI = {
  pharmacy: '\u{1F48A}', // 💊
  hospital: '\u{1F3E5}', // 🏥
  pediatric: '\u{1F9D2}', // 🧒
};

/**
 * 마커 한 개의 DOM 을 만든다.
 *
 * 바깥 .mk-anchor 는 0x0 이라 CustomOverlay 의 (xAnchor .5, yAnchor .5) 가
 * 정확히 좌표를 가리킨다. 실제 마커(.mk)는 그 안에서 transform 으로 움직이므로
 * 상태 전환(원형 1.0x ↔ 핀형 1.4x, 앵커 중심 ↔ 하단 정점)이 CSS 로 애니메이션된다.
 * 기하 정의는 src/index.css 의 '지도 마커' 절 참고.
 */
function createMarkerElement({ item, kind, color, onToggle }) {
  const anchor = document.createElement('div');
  anchor.className = 'mk-anchor';

  const mk = document.createElement('div');
  mk.className = 'mk';
  mk.style.setProperty('--mk-color', color);
  mk.setAttribute('role', 'button');
  mk.setAttribute('tabindex', '0');
  mk.setAttribute('aria-label', item.name);
  mk.title = item.name;
  mk.innerHTML =
    '<div class="mk__tail"></div>' +
    `<div class="mk__head"><span class="mk__icon">${PIN_EMOJI[kind] ?? PIN_EMOJI.hospital}</span></div>`;

  const activate = (e) => {
    // 지도의 click 핸들러(선택 해제)까지 올라가지 않게 막는다
    e.stopPropagation();
    onToggle();
  };
  mk.addEventListener('click', activate);
  mk.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(e);
    }
  });

  anchor.appendChild(mk);
  return { anchor, mk };
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
  // 마커 클릭 핸들러가 최신 선택 상태를 보려면 ref 가 필요하다(재클릭 = 해제)
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

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

    // 지도 배경 클릭 시 선택 해제 (마커 클릭은 stopPropagation 으로 여기까지 오지 않는다)
    kakao.maps.event.addListener(map, 'click', () => selectRef.current?.(null));

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
      markersRef.current.forEach((m) => m.overlay.setMap(null));
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
    markersRef.current.forEach((m) => m.overlay.setMap(null));
    markersRef.current = new Map();

    items.forEach((item) => {
      const position = new kakao.maps.LatLng(item.lat, item.lng);

      const { anchor, mk } = createMarkerElement({
        item,
        kind,
        color: accent,
        // 같은 마커 재클릭이면 해제, 아니면 그 마커를 선택 (단일 선택)
        onToggle: () =>
          selectRef.current?.(selectedRef.current === item.id ? null : item.id),
      });

      const overlay = new kakao.maps.CustomOverlay({
        map,
        position,
        content: anchor,
        // 콘텐츠가 0x0 이라 이 앵커는 곧 좌표 그 자체다. 상태별 위치는 CSS 가 맡는다.
        xAnchor: 0.5,
        yAnchor: 0.5,
        clickable: true,
        zIndex: 1,
      });

      markersRef.current.set(item.id, { overlay, mk, position });
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

  /* 선택 상태: 마커 상태 A↔B 전환 + panTo + 인포윈도우 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 모든 마커를 상태 A 로 되돌린 뒤, 선택된 것만 상태 B 로
    markersRef.current.forEach((m, id) => {
      const on = id === selectedId;
      m.mk.classList.toggle('is-selected', on);
      m.mk.setAttribute('aria-pressed', String(on));
      m.overlay.setZIndex(on ? 10 : 1);
    });

    if (!selectedId) {
      infoRef.current?.close();
      return;
    }

    const item = items.find((it) => it.id === selectedId);
    const marker = markersRef.current.get(selectedId);
    if (!item || !marker) return;

    map.panTo(marker.position);
    infoRef.current.setContent(infoWindowHtml(item));
    infoRef.current.setPosition(marker.position);
    infoRef.current.open(map);
  }, [selectedId, items]);

  return <div ref={boxRef} className="h-full w-full" />;
}
