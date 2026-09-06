import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TabBar from './components/TabBar.jsx';
import SearchBar from './components/SearchBar.jsx';
import KakaoMap from './components/KakaoMap.jsx';
import PlaceList from './components/PlaceList.jsx';
import PlaceDetail from './components/PlaceDetail.jsx';
import useKakaoSdk from './hooks/useKakaoSdk.js';
import useGeolocation from './hooks/useGeolocation.js';
import { searchLocation, coordToRegion } from './lib/kakao.js';
import { findOpenFacilities } from './lib/finder.js';
import { DEFAULT_CENTER, SEARCH_RADIUS_KM, TABS } from './lib/constants.js';
import { nowLabel } from './lib/time.js';

export default function App() {
  const { ready: sdkReady, error: sdkError } = useKakaoSdk();
  const { locate, locating } = useGeolocation();

  const [tab, setTab] = useState('pharmacy');
  const [center, setCenter] = useState({ lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng });
  const [centerLabel, setCenterLabel] = useState(DEFAULT_CENTER.label);
  const [regionLabel, setRegionLabel] = useState('');

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // 상세 시트에 띄울 장소. 시트를 닫아도 지도 위 선택(마커 상태 B)은 유지한다.
  const [detailId, setDetailId] = useState(null);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  // 상류가 일시적으로 실패했을 때 사용자가 직접 재조회할 수 있게 하는 트리거
  const [retryKey, setRetryKey] = useState(0);

  const listRef = useRef(null);
  const reqRef = useRef(0);
  const geoTriedRef = useRef(false);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  /* 1분마다 현재 시각 라벨 갱신 */
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  /* 최초 로딩: 현재 위치 취득 (거부 시 기본 좌표 유지) */
  useEffect(() => {
    if (!sdkReady || geoTriedRef.current) return;
    geoTriedRef.current = true;
    locate()
      .then((pos) => {
        setCenter({ lat: pos.lat, lng: pos.lng });
        setCenterLabel('현재 위치');
      })
      .catch((e) => setNotice(`${e.message} 기본 위치(${DEFAULT_CENTER.name})를 기준으로 표시합니다.`));
  }, [sdkReady, locate]);

  /* 중심 좌표의 행정구역 라벨 */
  useEffect(() => {
    if (!sdkReady) return;
    coordToRegion(center)
      .then((r) => setRegionLabel(r?.label ?? ''))
      .catch(() => setRegionLabel(''));
  }, [sdkReady, center]);

  /* 중심 좌표 또는 탭이 바뀌면 재조회 */
  useEffect(() => {
    if (!sdkReady) return;
    const token = ++reqRef.current;

    setLoading(true);
    setError(null);
    setSelectedId(null);
    setDetailId(null);

    findOpenFacilities({
      kind: activeTab.endpoint,
      variants: activeTab.variants,
      datasetFilter: activeTab.datasetFilter,
      center,
      now: new Date(),
    })
      .then(({ items: found, stats: s }) => {
        if (token !== reqRef.current) return;
        setItems(found);
        setStats(s);
      })
      .catch((e) => {
        if (token !== reqRef.current) return;
        setItems([]);
        setStats(null);
        setError(e.message);
      })
      .finally(() => {
        if (token === reqRef.current) setLoading(false);
      });
  }, [sdkReady, tab, center, retryKey]);

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

  /** 지도 위 버튼에서 목록으로 이동 (모바일은 목록이 지도 아래에 있다) */
  const scrollToList = useCallback(() => {
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /** 목록 카드·지도 마커 공통 진입점. 장소를 선택하고 상세 시트를 연다. */
  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    setDetailId(id);
  }, []);

  /* 표시 대상: 지금 영업중 (+옵션에 따라 시간 미등록 포함) */
  const visibleItems = useMemo(
    () => items.filter((it) => it.isOpen || (includeUnknown && it.unknownHours)),
    [items, includeUnknown],
  );

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
    // 데스크톱은 화면 높이에 딱 맞춰 페이지 스크롤을 없앤다.
    // 지도 높이를 calc(100vh - 헤더높이) 같은 매직 넘버로 맞추면 헤더가 바뀔 때마다 어긋난다.
    <div className="flex min-h-full flex-col lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      {/* ── 상단 컨트롤 ─────────────────────────────── */}
      {/* 검색창은 지도 안으로 옮겼다(구글 지도 방식). 헤더에는 제목과 탭만 남는다. */}
      {/* 모바일에서는 고정하지 않는다. 좁은 화면에서 세로 공간을 계속 차지한다. */}
      <header className="z-20 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-3 pb-2.5 pt-2 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-[15px] font-extrabold tracking-tight sm:text-lg">
              오늘 문 연 약국·의원
            </h1>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 sm:px-2.5 sm:py-1">
              {nowLabel(clock)}
            </span>
          </div>

          <div className="mt-2 sm:mt-3">
            <TabBar value={tab} onChange={setTab} disabled={!sdkReady} />
          </div>
        </div>
      </header>

      {/* ── 본문 ────────────────────────────────────── */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-3 p-3 sm:px-4 lg:min-h-0 lg:grid-cols-[minmax(340px,400px)_1fr]">
        {/* 지도 */}
        <section
          aria-label="지도"
          className="relative order-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card
                     max-lg:h-[52vh] max-lg:[@supports(height:1dvh)]:h-[52dvh]
                     lg:order-2 lg:h-full"
        >
          {sdkReady ? (
            <KakaoMap
              center={center}
              centerLabel={centerLabel}
              items={visibleItems}
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
            <div className="pointer-events-auto mx-auto max-w-xl rounded-xl bg-white/95 p-2 shadow-lg ring-1 ring-black/10 backdrop-blur">
              <SearchBar
                onSearch={handleSearch}
                onLocate={handleLocate}
                loading={loading || !sdkReady}
                locating={locating}
              />
            </div>
          </div>

          {/*
            목록으로 이동. 모바일은 지도 아래에 목록이 이어지므로 스크롤이 필요하다.
            데스크톱(lg)은 목록이 항상 옆에 보여서 숨긴다.
          */}
          <button
            type="button"
            onClick={scrollToList}
            aria-label="목록으로 이동"
            title="목록으로"
            className="absolute bottom-3 left-1/2 z-10 flex h-11 w-11 -translate-x-1/2 items-center
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

        {/* 리스트 */}
        <section
          ref={listRef}
          aria-label="검색 결과"
          className="order-2 flex min-w-0 flex-col gap-2.5 lg:order-1 lg:min-h-0"
        >
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
            <p className="truncate text-sm font-bold text-slate-800">
              <span aria-hidden="true">📍</span> {centerLabel}
            </p>
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
            </p>

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

            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(e) => setIncludeUnknown(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
              />
              영업시간 미등록({stats?.unknown ?? 0}곳)도 함께 표시
            </label>
          </div>

          {notice && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              {notice}
            </p>
          )}

          <div className="scroll-thin min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
            <PlaceList
              items={visibleItems}
              loading={loading}
              error={error}
              emptyText={activeTab.empty}
              selectedId={selectedId}
              onSelect={handleSelect}
              onRetry={handleRetry}
            />
          </div>
          <footer className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 text-center text-[11px] leading-relaxed text-slate-400">
            데이터 출처: 보건복지부 응급의료포털(E-Gen) 공공데이터 · 지도: 카카오맵
            <br />
            영업시간은 기관이 등록한 정보로, 실제와 다를 수 있으니 방문 전 전화 확인을 권장합니다.
          </footer>
        </section>
      </main>

      <PlaceDetail
        item={visibleItems.find((it) => it.id === detailId) ?? null}
        kind={tab}
        accent={activeTab.accent}
        onClose={() => setDetailId(null)}
      />

    </div>
  );
}
