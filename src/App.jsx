import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TabBar from './components/TabBar.jsx';
import SearchBar from './components/SearchBar.jsx';
import KakaoMap from './components/KakaoMap.jsx';
import PlaceList from './components/PlaceList.jsx';
import PlaceDetail, { PlaceDetailBody } from './components/PlaceDetail.jsx';
import BottomSheet, { SNAP } from './components/BottomSheet.jsx';
import useKakaoSdk from './hooks/useKakaoSdk.js';
import useGeolocation from './hooks/useGeolocation.js';
import { useIsDesktop } from './hooks/useMediaQuery.js';
import { useCenterItem } from './hooks/useCenterItem.js';
import { searchLocation, coordToRegion } from './lib/kakao.js';
import {
  collectFromDataset,
  collectFromApi,
  collectHolidayMap,
  collectFromKakao,
  evaluate,
  mergeRows,
} from './lib/finder.js';
import { PAGE_SIZE, SEARCH_RADIUS_KM, TABS } from './lib/constants.js';
import { readUrlState, writeUrlState } from './lib/urlState.js';
import { nowLabel } from './lib/time.js';

export default function App() {
  const { ready: sdkReady, error: sdkError } = useKakaoSdk();
  const { locate, locating } = useGeolocation();

  // 주소창에 남은 직전 검색을 그대로 이어받는다. 카카오맵에 갔다 돌아왔을 때
  // 페이지가 새로 뜨더라도 보던 목록이 살아있게 하는 것이 목적이다.
  const initial = useRef(readUrlState()).current;

  const [tab, setTab] = useState(initial.tab);
  // 검색 기준 위치. 현재 위치를 얻거나 사용자가 검색하기 전까지는 없다(null).
  // 임의의 기본 지역을 넣으면 엉뚱한 동네 결과를 내 위치인 양 보여주게 된다.
  const [center, setCenter] = useState(initial.center);
  const [centerLabel, setCenterLabel] = useState(initial.centerLabel);
  const [regionLabel, setRegionLabel] = useState('');

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // 정적 데이터는 있는데 API 만 실패한 경우 — 결과를 지우지 않고 따로 알린다
  const [apiError, setApiError] = useState(null);
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // 지금 화면에 그리는 결과 수. 검색이 바뀔 때마다 처음으로 되돌린다.
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  // 상세 시트에 띄울 장소. 시트를 닫아도 지도 위 선택(마커 상태 B)은 유지한다.
  const [detailId, setDetailId] = useState(null);
  const [clock, setClock] = useState(() => new Date());
  // 상류가 일시적으로 실패했을 때 사용자가 직접 재조회할 수 있게 하는 트리거
  const [retryKey, setRetryKey] = useState(0);

  const listRef = useRef(null);
  const reqRef = useRef(0);
  const geoTriedRef = useRef(false);

  const isDesktop = useIsDesktop();
  // 바텀시트 단계(모바일 전용). 상세를 열면 half 로 가서 지도와 반반이 된다.
  const [snap, setSnap] = useState('peek');
  const scrollRef = useRef(null);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  /* 1분마다 현재 시각 라벨 갱신 */
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  /* 최초 로딩: 현재 위치를 기준으로 시작한다 */
  useEffect(() => {
    // 복원된 검색이 있으면 현재 위치로 덮어쓰지 않는다. 사용자가 보고 있던 지역이
    // 우선이고, 내 위치는 '내 위치' 버튼으로 언제든 다시 잡을 수 있다.
    if (!sdkReady || geoTriedRef.current || initial.center) return;
    geoTriedRef.current = true;
    locate()
      .then((pos) => {
        setCenter({ lat: pos.lat, lng: pos.lng });
        setCenterLabel('현재 위치');
      })
      .catch((e) => setNotice(e.message));
  }, [sdkReady, locate, initial.center]);

  /* 검색 상태를 주소창에 반영 — 이 URL 하나면 같은 화면이 복원된다 */
  useEffect(() => {
    writeUrlState({ center, centerLabel, tab });
  }, [center, centerLabel, tab]);

  /* 중심 좌표의 행정구역 라벨 */
  useEffect(() => {
    if (!sdkReady || !center) return;
    coordToRegion(center)
      .then((r) => setRegionLabel(r?.label ?? ''))
      .catch(() => setRegionLabel(''));
  }, [sdkReady, center]);

  /*
   * 검색 파이프라인 — 기다리게 두지 않는다.
   *  1) 정적 데이터셋: 있으면 즉시 표시
   *  2) 실시간 API  : 병렬로 시작. 도착하면 합쳐서 갱신
   *  3) 12초 안에 아무것도 못 보여주면 카카오 주변 목록으로 먼저 채운다.
   *     그 뒤에 API 가 도착하면 정식 결과로 교체한다.
   * 상류가 죽어 있어도 사용자는 12초 안에 무언가를 본다.
   */
  useEffect(() => {
    if (!sdkReady || !center) return;
    const token = ++reqRef.current;
    const isStale = () => token !== reqRef.current;

    setLoading(true);
    setError(null);
    setApiError(null);
    setSelectedId(null);
    setDetailId(null);
    setRenderLimit(PAGE_SIZE);

    const now = new Date();
    const params = {
      kind: activeTab.endpoint,
      variants: activeTab.variants,
      datasetFilter: activeTab.datasetFilter,
      center,
      radiusKm: SEARCH_RADIUS_KM,
      now,
    };

    let datasetRows = null;
    let shownSomething = false;

    const show = (rows, source, extra = {}) => {
      if (isStale()) return;
      const { items: list, stats: s } = evaluate({ rows, center, now, ...extra });
      setItems(list);
      setStats({ ...s, source });
      setLoading(false);
      shownSomething = true;
    };

    // API 는 바로 시작해 두고, 기다리는 동안 다른 경로로 화면을 채운다
    const apiPromise = collectFromApi(params).then(
      (r) => ({ ok: true, ...r }),
      (e) => ({ ok: false, error: e }),
    );

    (async () => {
      // 1) 정적 데이터셋
      try {
        datasetRows = await collectFromDataset(params);
        if (isStale()) return;
        if (datasetRows?.length) show(datasetRows, 'dataset');
      } catch {
        datasetRows = null;
      }

      // 2) API 를 기다리되, 12초를 넘기면 먼저 카카오로 채운다
      const TIMEOUT = Symbol('timeout');
      const raced = await Promise.race([
        apiPromise,
        new Promise((r) => setTimeout(() => r(TIMEOUT), 12000)),
      ]);
      if (isStale()) return;

      if (raced === TIMEOUT) {
        if (!shownSomething) {
          try {
            const nearby = await collectFromKakao(params);
            if (isStale()) return;
            if (nearby.length) show(nearby, 'kakao');
          } catch {
            /* 카카오까지 안 되면 아래에서 API 최종 결과를 기다린다 */
          }
        }
      }

      // 3) API 최종 결과 반영
      const api = await apiPromise;
      if (isStale()) return;

      if (api.ok) {
        const holidayMap = await collectHolidayMap({ ...params, regions: api.regions });
        if (isStale()) return;
        show(mergeRows(datasetRows, api.items), datasetRows?.length ? 'both' : 'api', {
          holidayMap,
        });
        setApiError(null);
        return;
      }

      // API 실패 — 이미 뭔가 보여주고 있으면 알리기만 한다
      if (shownSomething) {
        setApiError(api.error.message);
        setLoading(false);
        return;
      }

      // 아무것도 못 보여준 상태 → 카카오를 마지막으로 한 번 더 시도
      try {
        const nearby = await collectFromKakao(params);
        if (isStale()) return;
        if (nearby.length) {
          show(nearby, 'kakao');
          setApiError(api.error.message);
          return;
        }
      } catch {
        /* 아래 전체 오류로 */
      }
      setItems([]);
      setStats(null);
      setError(api.error.message);
      setLoading(false);
    })();
  }, [sdkReady, tab, center, retryKey, activeTab]);

  const handleSearch = useCallback(async (query) => {
    setNotice('');
    setError(null);
    try {
      const place = await searchLocation(query);
      setCenter({ lat: place.lat, lng: place.lng });
      setCenterLabel(place.label);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const handleLocate = useCallback(async () => {
    setNotice('');
    setError(null);
    try {
      const pos = await locate();
      setCenter({ lat: pos.lat, lng: pos.lng });
      setCenterLabel('현재 위치');
    } catch (e) {
      setNotice(e.message);
    }
  }, [locate]);

  const handleRetry = useCallback(() => setRetryKey((n) => n + 1), []);

  /**
   * 지도 위 버튼에서 목록 펼치기.
   * 예전에는 지도 아래의 목록으로 스크롤했지만, 이제 목록은 바텀시트라 시트를 올린다.
   */
  const expandList = useCallback(() => {
    setSnap('full');
    if (isDesktop) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isDesktop]);

  const handleShowMore = useCallback(() => setRenderLimit((n) => n + PAGE_SIZE), []);

  /*
   * 처음 화면으로. 검색 기준을 지우면 '위치를 확인해 주세요' 안내가 다시 나오고,
   * 주소창의 검색 상태도 동기화 effect 가 알아서 비운다.
   *
   * 일부러 내 위치를 다시 잡지는 않는다. 검색에서 빠져나오려고 누른 버튼이
   * 곧바로 또 다른 검색을 시작해 버리면 빠져나올 방법이 없어진다.
   * 위치로 시작하고 싶으면 안내에 있는 '내 위치로 찾기' 를 누르면 된다.
   */
  const handleHome = useCallback(() => {
    setCenter(null);
    setCenterLabel('');
    setRegionLabel('');
    setTab(TABS[0].key);
    setItems([]);
    setStats(null);
    setError(null);
    setApiError(null);
    setNotice('');
    setSelectedId(null);
    setDetailId(null);
    setRenderLimit(PAGE_SIZE);
  }, []);

  /**
   * 목록 카드·지도 마커 공통 진입점 — 선택 + 상세 열기.
   * 모바일에서는 시트를 half 로 올려 지도와 반반이 되게 한다.
   */
  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    setDetailId(id);
    if (id) setSnap('half');
  }, []);

  /**
   * 시트를 스크롤하다 가운데로 들어온 장소.
   * 강조와 지도 이동만 하고 **상세는 열지 않는다** — 훑어보는 중에 상세가 튀어나오면
   * 스크롤이 막힌다. 상세는 명시적으로 눌렀을 때만 연다.
   */
  const handleActivate = useCallback((id) => setSelectedId(id), []);

  /* 표시 대상: 지금 영업중 (+옵션에 따라 시간 미등록 포함) */
  const visibleItems = useMemo(() => {
    // 카카오 대체 경로는 영업시간 자체가 없다. 걸러내면 아무것도 안 남으므로 전부 보여준다.
    if (stats?.source === 'kakao') return items;
    return items.filter((it) => it.isOpen);
  }, [items, stats?.source]);

  /*
   * 실제로 그리는 부분. 목록과 지도 마커가 같은 집합을 봐야 번호와 마커가 어긋나지 않는다.
   * 개수 표시(visibleItems.length)는 자르기 전 값을 그대로 쓴다 — 사용자가 알아야 할 것은
   * '지금 문 연 곳이 몇 곳인지' 이지 '우리가 몇 개를 그렸는지' 가 아니다.
   */
  const shownItems = useMemo(
    () => visibleItems.slice(0, renderLimit),
    [visibleItems, renderLimit],
  );
  const hasMore = visibleItems.length > shownItems.length;

  const detailItem = useMemo(
    () => visibleItems.find((it) => it.id === detailId) ?? null,
    [visibleItems, detailId],
  );

  /*
   * 스크롤 → 마커 연동. 상세를 보는 중이거나 데스크톱(목록이 늘 옆에 있다)에서는 끈다.
   * itemsKey 로 목록이 바뀐 것을 알려야 관찰 대상을 다시 잡는다.
   */
  const { suppress } = useCenterItem(scrollRef, {
    enabled: !isDesktop && !detailId && !!center && shownItems.length > 0,
    itemsKey: `${tab}:${shownItems.length}:${shownItems[0]?.id ?? ''}`,
    onChange: handleActivate,
  });

  /**
   * 상세를 닫고 목록으로. 보던 장소의 카드가 화면 가운데 오도록 되돌린다 —
   * 목록 맨 위로 튕기면 어디를 보고 있었는지 잃는다.
   */
  const handleCloseDetail = useCallback(() => {
    const id = detailId;
    setDetailId(null);
    if (!id || isDesktop) return;
    // 목록이 다시 그려진 다음 프레임에 위치를 잡는다
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-place-id="${CSS.escape(String(id))}"]`);
      if (!el) return;
      suppress(id); // 우리가 움직인 스크롤이 다시 지도를 움직이지 않게
      el.scrollIntoView({ block: 'center' });
    });
  }, [detailId, isDesktop, suppress]);

  if (sdkError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="text-base font-bold">카카오 지도를 불러오지 못했습니다</p>
          <p className="mt-2 leading-relaxed">{sdkError}</p>
          <p className="mt-3 text-xs text-rose-600">
            .env 의 <code className="font-mono">VITE_KAKAO_JS_KEY</code> 값과 카카오 개발자센터의
            플랫폼 &gt; Web 사이트 도메인 등록을 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    // 모바일·데스크톱 모두 화면 높이에 딱 맞춘다. 페이지 자체는 스크롤하지 않는다 —
    // 모바일은 바텀시트가 지도 위에 얹혀야 하므로 본문에 확정된 높이가 필요하다.
    // 지도 높이를 calc(100vh - 헤더높이) 같은 매직 넘버로 맞추면 헤더가 바뀔 때마다 어긋난다.
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden">
      {/* ── 상단 컨트롤 ─────────────────────────────── */}
      {/* 검색창은 지도 안으로 옮겼다(구글 지도 방식). 헤더에는 제목과 탭만 남는다. */}
      {/* 모바일에서는 고정하지 않는다. 좁은 화면에서 세로 공간을 계속 차지한다. */}
      <header className="z-20 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-3 pb-2.5 pt-2 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-[15px] font-extrabold tracking-tight sm:text-lg">
              오늘 문 연 약국·의원
            </h1>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 sm:px-2.5 sm:py-1">
                {nowLabel(clock)}
              </span>
              {/*
                처음 화면으로 빠져나오는 버튼. 이모지 대신 SVG 를 쓴다 —
                작게 두는 아이콘이라 플랫폼마다 달라지는 이모지 모양·크기가 그대로 티가 난다.
                검색 중이 아닐 때는 눌러도 달라질 게 없으므로 비활성으로 둔다(사라지게 하면
                헤더가 들썩인다).
              */}
              <button
                type="button"
                onClick={handleHome}
                disabled={!center}
                aria-label="처음 화면으로"
                title="처음 화면으로"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500
                           transition-colors hover:bg-slate-100 hover:text-slate-800
                           disabled:pointer-events-none disabled:opacity-30 sm:h-8 sm:w-8"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[18px] w-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 10.5 12 3l9 7.5" />
                  <path d="M5.5 9.5V20h13V9.5" />
                  <path d="M10 20v-5.5h4V20" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-2 sm:mt-3">
            <TabBar value={tab} onChange={setTab} disabled={!sdkReady} />
          </div>
        </div>
      </header>

      {/* ── 본문 ────────────────────────────────────── */}
      {/*
        모바일: 지도가 main 전체를 채우고 바텀시트가 그 위에 절대배치로 얹힌다.
        데스크톱: 예전처럼 목록 | 지도 2단 그리드.
      */}
      <main className="relative mx-auto w-full min-h-0 max-w-7xl flex-1
                       lg:grid lg:gap-3 lg:p-3 lg:grid-cols-[minmax(340px,400px)_1fr]">
        {/* 지도 */}
        <section
          aria-label="지도"
          className="overflow-hidden border-slate-200 bg-white
                     max-lg:absolute max-lg:inset-0
                     lg:relative lg:order-2 lg:h-full lg:rounded-2xl lg:border lg:shadow-card"
        >
          {sdkReady ? (
            <KakaoMap
              center={center}
              centerLabel={centerLabel}
              items={shownItems}
              selectedId={selectedId}
              onSelect={handleSelect}
              accent={activeTab.accent}
              kind={tab}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              지도를 불러오는 중…
            </div>
          )}

          {/*
            구글 지도처럼 검색창을 지도 위에 띄운다.
            바깥 컨테이너는 pointer-events-none 이라 검색창을 비껴간 클릭은 지도로 그대로 전달된다.
          */}
          <div className="pointer-events-none absolute inset-x-2 top-2 z-20 sm:inset-x-3 sm:top-3">
            <div className="pointer-events-auto mx-auto max-w-xl">
              <SearchBar onSearch={handleSearch} loading={loading || !sdkReady} />
            </div>
          </div>

          {/*
            목록 펼치기. 시트를 손잡이로 끌어올릴 수도 있지만, 한 번에 열고 싶을 때가 있다.
            시트가 이미 올라와 있으면 가려지므로 peek 일 때만 보인다.
            bottom 값은 시트가 peek 일 때의 높이(SNAP.peek) 바로 위 — 두 값은 함께 움직인다.
            데스크톱(lg)은 목록이 항상 옆에 보여서 숨긴다.
          */}
          <button
            type="button"
            onClick={expandList}
            aria-label="목록 펼치기"
            title="목록 펼치기"
            hidden={isDesktop || snap !== 'peek'}
            style={{ bottom: `calc(${SNAP.peek * 100}% + 12px)` }}
            className="absolute left-1/2 z-10 flex h-11 w-11 -translate-x-1/2 items-center
                       justify-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-black/10
                       transition active:scale-95 hover:bg-slate-50 lg:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" fill="currentColor">
              <circle cx="3.2" cy="5" r="1.3" />
              <circle cx="3.2" cy="10" r="1.3" />
              <circle cx="3.2" cy="15" r="1.3" />
              <rect x="6.6" y="4.1" width="10.4" height="1.8" rx="0.9" />
              <rect x="6.6" y="9.1" width="10.4" height="1.8" rx="0.9" />
              <rect x="6.6" y="14.1" width="10.4" height="1.8" rx="0.9" />
            </svg>
          </button>
        </section>

        {/* 리스트 — 모바일은 바텀시트, 데스크톱은 왼쪽 칼럼 */}
        <BottomSheet
          enabled={!isDesktop}
          snap={snap}
          onSnapChange={setSnap}
          label="검색 결과"
          desktopClassName="order-2 flex min-w-0 flex-col lg:order-1 lg:min-h-0"
        >
        {detailItem && !isDesktop ? (
          /* 반반(half) 레이아웃 — 위는 지도, 아래는 선택한 장소의 상세 */
          <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <PlaceDetailBody
              item={detailItem}
              kind={tab}
              accent={activeTab.accent}
              onClose={handleCloseDetail}
              inSheet
            />
          </div>
        ) : (
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2.5 max-lg:px-3 max-lg:pt-1">
          <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
            {!center ? (
              <div className="text-center">
                <p className="text-sm font-bold text-slate-800">위치를 확인해 주세요</p>
                <p className="mt-1 text-xs text-slate-500">
                  현재 위치를 허용하면 주변을 바로 찾아드립니다. 지역명으로 검색해도 됩니다.
                </p>
                <button
                  type="button"
                  onClick={handleLocate}
                  disabled={locating}
                  className="btn-primary mt-3 h-11 w-full text-sm"
                >
                  {locating ? '위치 확인 중…' : '📍 내 위치로 찾기'}
                </button>
              </div>
            ) : (
              <>
            {/*
              검색 바에서 위치 버튼을 뺐으므로, 다른 지역을 검색한 뒤 내 위치로
              돌아올 통로가 여기 하나뿐이다. 지우면 새로고침 말고는 방법이 없다.
            */}
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">
                <span aria-hidden="true">📍</span> {centerLabel}
              </p>
              <button
                type="button"
                onClick={handleLocate}
                disabled={locating}
                className="shrink-0 text-xs font-bold text-brand-600 transition-colors
                           hover:text-brand-700 disabled:opacity-50"
              >
                {locating ? '확인 중…' : '내 위치'}
              </button>
            </div>
            {regionLabel && <p className="mt-0.5 text-xs text-slate-500">{regionLabel}</p>}
            <p className="mt-1.5 text-xs text-slate-500">
              반경 {SEARCH_RADIUS_KM}km · {activeTab.emoji} {activeTab.label} ·{' '}
              <b className="text-brand-700">{visibleItems.length}곳</b>
              {stats ? (
                <span className="hidden text-slate-400 sm:inline">
                  {' '}
                  (조회 {stats.fetched} → 반경 내 {stats.inRadius})
                </span>
              ) : null}
              {stats?.source === 'dataset' && (
                <span className="ml-1 text-slate-400">· 저장된 자료</span>
              )}
              {stats?.source === 'kakao' && (
                <span className="ml-1 font-semibold text-amber-700">· 카카오맵 기준</span>
              )}
            </p>

            {stats?.source === 'kakao' && (
              <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900 ring-1 ring-amber-300">
                <p className="font-bold">⚠ 영업시간을 확인할 수 없습니다</p>
                <p className="mt-0.5 leading-relaxed">
                  응급의료포털이 응답하지 않아 <b>카카오맵 기준 주변 목록</b>을 표시합니다. 지금 문을
                  열었는지는 알 수 없으니 <b>방문 전 전화로 확인</b>해 주세요.
                </p>
                <button type="button" onClick={handleRetry} className="btn-ghost mt-2 h-9 w-full text-xs">
                  ↻ 다시 시도
                </button>
              </div>
            )}

            {apiError && stats?.source !== 'kakao' && (
              <div className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
                <p className="font-bold">⚠ 통신 오류</p>
                <p className="mt-0.5 leading-relaxed">{apiError}</p>
                <p className="mt-1 text-rose-600">
                  미리 받아둔 자료로 표시 중입니다. 최근 변경분이 빠져 있을 수 있습니다.
                </p>
                <button type="button" onClick={handleRetry} className="btn-ghost mt-2 h-9 w-full text-xs">
                  ↻ 다시 시도
                </button>
              </div>
            )}

            {stats?.failedRegions > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200">
                ⚠ 응급의료포털이 불안정해 일부 지역({stats.failedRegions}/{stats.totalRegions})을 불러오지
                못했습니다. 결과가 실제보다 적을 수 있습니다.
              </p>
            )}

            {stats?.holidaySeason && (
              <p className="mt-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-200">
                🏮 명절 연휴입니다 — 명절 비상진료기관{' '}
                <b>{stats.holidayEmergency}곳</b>의 공지 운영시간을 우선 반영했습니다.
              </p>
            )}
              </>
            )}

          </div>

          {notice && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              {notice}
            </p>
          )}

          {/* 스크롤-마커 연동의 관찰 대상이 되는 컨테이너 (useCenterItem 의 root) */}
          <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto lg:pr-1">
            {center && (
            <PlaceList
              items={shownItems}
              loading={loading}
              error={error}
              emptyText={activeTab.empty}
              selectedId={selectedId}
              onSelect={handleSelect}
              onRetry={handleRetry}
              total={visibleItems.length}
              onShowMore={hasMore ? handleShowMore : null}
            />
            )}
          </div>
          <footer className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 text-center text-[11px] leading-relaxed text-slate-400">
            데이터 출처: 보건복지부 응급의료포털(E-Gen) 공공데이터 · 지도: 카카오맵
            <br />
            영업시간은 기관이 등록한 정보로, 실제와 다를 수 있으니 방문 전 전화 확인을 권장합니다.
          </footer>
        </div>
        )}
        </BottomSheet>
      </main>

      {/* 모바일 상세는 바텀시트가 맡는다. 여기서 또 띄우면 지도 인스턴스가 겹친다. */}
      {isDesktop && (
        <PlaceDetail
          item={detailItem}
          kind={tab}
          accent={activeTab.accent}
          onClose={handleCloseDetail}
        />
      )}

    </div>
  );
}
