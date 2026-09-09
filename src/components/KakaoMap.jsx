import { useCallback, useEffect, useRef } from 'react';
import { SEARCH_RADIUS_KM, INITIAL_VIEW } from '../lib/constants.js';

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
  mk.innerHTML = `<div class="mk__body"><span class="mk__icon">${PIN_EMOJI[kind] ?? PIN_EMOJI.hospital}</span></div>`;

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

/**
 * @param bottomInsetRatio 지도 아래쪽이 바텀시트에 가려지는 비율(0~1).
 *   지도 div 자체는 화면 전체를 차지하므로, 이 값을 빼지 않으면 panTo·setBounds 가
 *   '보이지 않는 중앙'을 기준으로 잡아 선택한 마커가 시트 뒤로 숨는다.
 * @param onBackgroundTap 마커가 아닌 지도 배경을 눌렀을 때. 무엇을 할지는 여기서
 *   정하지 않는다 — 선택 해제인지 시트를 닫는 것인지는 화면 상태를 가진 App 이 안다.
 *   (마커 클릭은 stopPropagation 으로 막혀 있어 여기까지 오지 않는다)
 */
export default function KakaoMap({
  center,
  centerLabel,
  items,
  selectedId,
  onSelect,
  onBackgroundTap,
  accent,
  kind,
  bottomInsetRatio = 0,
}) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const centerOverlayRef = useRef(null);
  const markersRef = useRef(new Map());
  const pendingBoundsRef = useRef(null);
  // relayout 후 중심을 되돌리기 위한 값. 컨테이너가 0 크기일 때 만들어진 지도는
  // 크기가 잡히면서 중심이 틀어진다.
  const viewCenterRef = useRef(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // 지도 생성 효과는 한 번만 도므로, 배경 탭 핸들러도 ref 로 최신값을 읽는다
  const backgroundTapRef = useRef(onBackgroundTap);
  backgroundTapRef.current = onBackgroundTap;
  // 마커 클릭 핸들러가 최신 선택 상태를 보려면 ref 가 필요하다(재클릭 = 해제)
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  // fitPending 은 의존성 없이 고정된 콜백이라 최신 값을 ref 로 읽는다
  const insetRatioRef = useRef(bottomInsetRatio);
  insetRatioRef.current = bottomInsetRatio;

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
    // 아래쪽은 시트에 가려지므로 그만큼 여백으로 잡아야 결과가 시트 뒤로 들어가지 않는다
    const bottomPad = 40 + height * insetRatioRef.current;
    map.setBounds(pendingBoundsRef.current, 40, 40, bottomPad, 40);
    pendingBoundsRef.current = null;

    /*
     * 맞춘 결과를 '되돌릴 중심'으로 새로 기록한다.
     * 이걸 빼면 이후의 relayout(주소창 접힘·회전 등)이 viewCenterRef 에 남아 있던
     * *검색 좌표* 로 되돌려, 방금 맞춘 화면을 지운다. 실제로 이 때문에 마커가
     * 전부 시트 뒤로 내려가 있었다.
     */
    viewCenterRef.current = map.getCenter();
  }, []);

  /* 지도 최초 생성 */
  useEffect(() => {
    const { kakao } = window;
    const map = new kakao.maps.Map(boxRef.current, {
      center: new kakao.maps.LatLng(
        center?.lat ?? INITIAL_VIEW.lat,
        center?.lng ?? INITIAL_VIEW.lng,
      ),
      level: center ? 6 : INITIAL_VIEW.level,
    });
    // 검색창이 지도 위쪽에 떠 있으므로 줌 컨트롤은 우측 하단으로 뺀다
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.BOTTOMRIGHT);
    mapRef.current = map;
    viewCenterRef.current = map.getCenter();

    /*
     * 지도 배경 클릭. 마커 클릭은 stopPropagation 으로 여기까지 오지 않는다.
     *
     * 카카오 SDK 는 드래그(지도 이동)로 끝난 제스처에는 click 을 쏘지 않으므로,
     * 지도를 밀어서 옮긴 뒤에 시트가 닫히는 일은 없다. 이 전제가 깨지면
     * 지도를 조금만 움직여도 목록이 사라지므로, SDK 를 올릴 때 함께 확인할 것.
     */
    kakao.maps.event.addListener(map, 'click', () =>
      backgroundTapRef.current
        ? backgroundTapRef.current()
        : selectRef.current?.(null),
    );

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
    if (center) circleRef.current.setMap(map);

    centerOverlayRef.current = new kakao.maps.CustomOverlay({
      position: map.getCenter(),
      yAnchor: 0.5,
      zIndex: 5,
      content: centerContent(centerLabel || '검색 위치'),
    });
    if (center) centerOverlayRef.current.setMap(map);

    const onResize = () => {
      map.relayout();
      // 맞출 bounds 가 있으면 그쪽이 우선, 없으면 원래 보던 중심으로 되돌린다
      if (pendingBoundsRef.current) fitPending();
      else if (viewCenterRef.current) map.setCenter(viewCenterRef.current);
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
      markersRef.current.forEach((m) => m.overlay.setMap(null));
      markersRef.current = new Map();
      circleRef.current?.setMap(null);
      centerOverlayRef.current?.setMap(null);
      pendingBoundsRef.current = null;
      circleRef.current = null;
      centerOverlayRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 중심 좌표 변경 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!center) {
      // 아직 검색 위치가 없다 — 반경 원과 중심 표식을 숨긴다
      circleRef.current?.setMap(null);
      centerOverlayRef.current?.setMap(null);
      return;
    }
    const pos = new window.kakao.maps.LatLng(center.lat, center.lng);
    viewCenterRef.current = pos;
    map.setCenter(pos);
    circleRef.current?.setMap(map);
    circleRef.current?.setPosition(pos);
    centerOverlayRef.current?.setMap(map);
    centerOverlayRef.current?.setPosition(pos);
    centerOverlayRef.current?.setContent(centerContent(centerLabel || '검색 위치'));
  }, [center?.lat, center?.lng, centerLabel]);

  /* 마커 갱신 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { kakao } = window;

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

    if (items.length && center) {
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
    if (center) {
      map.setLevel(6);
      map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, accent, kind]);

  /* 선택 상태: 마커 상태 A↔B 전환 + panTo (상세는 PlaceDetail 시트가 맡는다) */
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

    if (!selectedId) return;

    const marker = markersRef.current.get(selectedId);
    if (!marker) return;

    /*
     * 시트에 가려지지 않는 위쪽 영역의 한가운데로 옮긴다.
     * 지도 중심을 아래로 inset/2 만큼 내리면 마커는 그만큼 위로 올라온다.
     * 투영으로 한 번에 목표 좌표를 구해 panTo 를 한 번만 부른다 — panTo 뒤에
     * panBy 를 이어 붙이면 애니메이션이 두 번 겹쳐 화면이 튄다.
     */
    const inset = boxRef.current.clientHeight * bottomInsetRatio;
    if (inset < 1) {
      map.panTo(marker.position);
      return;
    }

    const projection = map.getProjection();
    const point = projection.containerPointFromCoords(marker.position);
    point.y += inset / 2;
    map.panTo(projection.coordsFromContainerPoint(point));
  }, [selectedId, items, bottomInsetRatio]);

  return <div ref={boxRef} className="h-full w-full" />;
}
