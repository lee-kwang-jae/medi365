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

function StatusChip({ item }) {
  if (item.fromKakao) return <span className="chip bg-amber-100 text-amber-800">영업시간 확인 불가</span>;
  if (item.isOpen) return <span className="chip bg-emerald-100 text-emerald-700">● 지금 영업중</span>;
  if (item.unknownHours) return <span className="chip bg-amber-100 text-amber-700">시간 정보 없음</span>;
  return <span className="chip bg-slate-100 text-slate-500">영업 종료</span>;
}

/**
 * 상세 내용 본체.
 *
 * 두 곳에서 쓰인다 — 데스크톱은 가운데 모달(`PlaceDetail`), 모바일은 바텀시트의
 * 반반(half) 상태 안. 같은 마크업을 두 벌 두면 한쪽만 고치는 사고가 나므로 하나로 둔다.
 *
 * @param inSheet 바텀시트 안이면 true. 닫기 버튼이 '목록으로 돌아가기'가 되고,
 *   시트가 이미 스크롤 컨테이너이므로 자체 높이 제한을 걸지 않는다.
 */
export function PlaceDetailBody({ item, kind, accent, onClose, inSheet = false }) {
  const mapBoxRef = useRef(null);

  /* 상세 전용 지도 — 열릴 때 만들고 닫을 때 버린다 */
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

    // 시트가 열리거나 스냅이 바뀌는 동안에는 컨테이너 크기가 확정되지 않는다.
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

  return (
    <>
      <div className="sticky top-0 z-10 bg-white/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-extrabold text-slate-900">{item.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {item.division && (
                <span className="chip bg-slate-100 text-slate-600">{item.division}</span>
              )}
              <StatusChip item={item} />
              {item.holidayEmergency && (
                <span className="chip bg-violet-100 text-violet-700">🏮 명절 비상진료</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={inSheet ? '목록으로 돌아가기' : '닫기'}
            className="shrink-0 rounded-full px-2.5 py-2 text-sm leading-none text-slate-400
                       hover:bg-slate-100 hover:text-slate-700"
          >
            {inSheet ? '← 목록' : '✕'}
          </button>
        </div>
      </div>

      {/* 이 장소만 담은 지도 */}
      <div className="px-4">
        <div
          ref={mapBoxRef}
          className={`w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
            inSheet ? 'h-40' : 'h-48 sm:h-56'
          }`}
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
        {item.tel && (
          <div className="flex gap-2">
            <dt aria-hidden="true">☎</dt>
            <dd>{item.tel}</dd>
          </div>
        )}
        {item.holidayNote && (
          <p className="pt-1 text-xs font-medium text-violet-700">{item.holidayNote}</p>
        )}
        {item.etc && <p className="pt-1 text-xs text-slate-400">{item.etc}</p>}
      </dl>

      <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-4 py-3
                      pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
    </>
  );
}

/**
 * 데스크톱 전용 상세 모달.
 * 모바일에서는 이것 대신 바텀시트가 half 상태로 열리며 같은 본체를 담는다 —
 * 둘 다 띄우면 카카오 지도 인스턴스가 두 개 생기고 배경 스크롤 잠금도 겹친다.
 */
export default function PlaceDetail({ item, kind, accent, onClose }) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} 상세`}
        onClick={(e) => e.stopPropagation()}
        className="sheet-in max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <PlaceDetailBody item={item} kind={kind} accent={accent} onClose={onClose} />
      </div>
    </div>
  );
}
