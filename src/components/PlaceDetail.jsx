import { useEffect, useRef } from 'react';
import { formatDistance } from '../lib/geo.js';
import { formatHoursLabel } from '../lib/time.js';
import { kakaoLinkProps, kakaoLinks, openInKakaoMap } from '../lib/kakao.js';

// 카카오맵으로 나가는 링크의 target. 모바일에서 새 탭으로 열면 뒤로가기로 앱에
// 돌아올 수 없어진다 (kakaoLinkProps 주석 참고).
const linkProps = kakaoLinkProps();

/** 상세 지도의 확대 수준. 1 이 가장 가깝고 숫자가 클수록 넓게 본다 */
const DETAIL_LEVEL = 3;

const PIN_EMOJI = {
  pharmacy: '\u{1F48A}', // 💊
  hospital: '\u{1F3E5}', // 🏥
  pediatric: '\u{1F9D2}', // 🧒
};

/**
 * 선택한 장소 하나만 보여주는 상세 시트.
 * 목록·지도의 넓은 축척과 달리, 그 장소를 중심으로 한 전용 지도를 따로 띄운다.
 * 모바일에서는 아래에서 올라오는 시트, 데스크톱에서는 가운데 모달로 보인다.
 */
export default function PlaceDetail({ item, kind, accent, onClose }) {
  const mapBoxRef = useRef(null);

  /* 상세 전용 지도 — 시트가 열릴 때 만들고 닫을 때 버린다 */
  useEffect(() => {
    if (!item || !mapBoxRef.current || !window.kakao?.maps) return undefined;
    const { kakao } = window;
    const box = mapBoxRef.current;

    const position = new kakao.maps.LatLng(item.lat, item.lng);
    const map = new kakao.maps.Map(box, { center: position, level: DETAIL_LEVEL });
    map.setZoomable(false); // 작은 지도라 확대/축소는 막고 '카카오맵으로 보기' 로 유도

    const content = document.createElement('div');
    content.className = 'mk-anchor';
    content.innerHTML =
      `<div class="mk is-selected" style="--mk-color:${accent}">` +
      `<div class="mk__body"><span class="mk__icon">${PIN_EMOJI[kind] ?? PIN_EMOJI.hospital}</span></div>` +
      '</div>';

    const overlay = new kakao.maps.CustomOverlay({
      map,
      position,
      content,
      xAnchor: 0.5,
      yAnchor: 0.5,
    });

    // 시트가 열리는 애니메이션 도중에는 컨테이너 크기가 확정되지 않는다.
    // 크기가 잡히는 시점에 relayout 하지 않으면 축척이 어긋난다.
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.relayout();
            map.setCenter(position);
          })
        : null;
    observer?.observe(box);

    return () => {
      observer?.disconnect();
      overlay.setMap(null);
    };
  }, [item, kind, accent]);

  /* Esc 로 닫기 + 뒤 배경 스크롤 잠금 */
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} 상세`}
        onClick={(e) => e.stopPropagation()}
        className="sheet-in max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl
                   sm:max-h-[85vh] sm:max-w-md sm:rounded-2xl"
      >
        {/* 모바일 시트 손잡이 */}
        <div className="sticky top-0 z-10 rounded-t-2xl bg-white/95 px-4 pb-2 pt-3 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-base font-extrabold text-slate-900">{item.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {item.division && (
                  <span className="chip bg-slate-100 text-slate-600">{item.division}</span>
                )}
                {item.isOpen ? (
                  <span className="chip bg-emerald-100 text-emerald-700">● 지금 영업중</span>
                ) : item.unknownHours ? (
                  <span className="chip bg-amber-100 text-amber-700">시간 정보 없음</span>
                ) : (
                  <span className="chip bg-slate-100 text-slate-500">영업 종료</span>
                )}
                {item.holidayEmergency && (
                  <span className="chip bg-violet-100 text-violet-700">🏮 명절 비상진료</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 rounded-full p-2 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 이 장소만 담은 지도 */}
        <div className="px-4">
          <div
            ref={mapBoxRef}
            className="h-48 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-56"
          />
        </div>

        <dl className="space-y-2 px-4 py-4 text-sm text-slate-700">
          <div className="flex gap-2">
            <dt aria-hidden="true">📍</dt>
            <dd className="min-w-0 flex-1 break-words">{item.address || '주소 정보 없음'}</dd>
          </div>
          <div className="flex gap-2">
            <dt aria-hidden="true">🕒</dt>
            <dd>{formatHoursLabel(item.hours)}</dd>
          </div>
          <div className="flex gap-2">
            <dt aria-hidden="true">🧭</dt>
            <dd>검색 위치에서 {formatDistance(item.distanceKm)}</dd>
          </div>
          {item.holidayNote && (
            <p className="pt-1 text-xs font-medium text-violet-700">{item.holidayNote}</p>
          )}
          {item.etc && <p className="pt-1 text-xs text-slate-400">{item.etc}</p>}
        </dl>

        <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-4 py-3">
          {item.tel && (
            <a href={`tel:${item.tel}`} className="btn-ghost h-11 flex-1 text-sm">
              ☎ 전화
            </a>
          )}
          <a
            href={kakaoLinks.search(item.name)}
            {...linkProps}
            onClick={(e) => {
              if (openInKakaoMap(item)) e.preventDefault();
            }}
            className="btn-ghost h-11 flex-1 text-sm"
          >
            🗺️ 카카오맵
          </a>
          <a
            href={kakaoLinks.to(item.name, item.lat, item.lng)}
            {...linkProps}
            className="btn-primary h-11 flex-1 text-sm"
          >
            🧭 길찾기
          </a>
        </div>
      </div>
    </div>
  );
}
