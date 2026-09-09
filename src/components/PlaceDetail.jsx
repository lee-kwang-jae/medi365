import { useEffect } from 'react';
import { formatDistance } from '../lib/geo.js';
import { formatHoursLabel } from '../lib/time.js';
import { kakaoLinkProps, kakaoLinks, openInKakaoMap, openKakaoRoute } from '../lib/kakao.js';

// 카카오맵으로 나가는 링크의 target. 모바일에서 새 탭으로 열면 뒤로가기로 앱에
// 돌아올 수 없어진다 (kakaoLinkProps 주석 참고).
const linkProps = kakaoLinkProps();

function StatusChip({ item }) {
  if (item.fromKakao) return <span className="chip bg-amber-100 text-amber-800">영업시간 확인 불가</span>;
  if (item.isOpen) return <span className="chip bg-emerald-100 text-emerald-700">● 지금 영업중</span>;
  if (item.unknownHours) return <span className="chip bg-amber-100 text-amber-700">시간 정보 없음</span>;
  return <span className="chip bg-slate-100 text-slate-500">영업 종료</span>;
}

/**
 * 상세 내용 본체 — **설명만 담는다. 지도는 넣지 않는다.**
 *
 * 예전에는 이 안에 그 장소만 담은 작은 지도를 따로 띄웠다. 그런데 뒤에 이미
 * 본 지도가 있고 선택한 곳의 핀이 확대돼 있으므로, 같은 장소를 두 번 그리는
 * 셈이었다. 작은 지도를 빼면 상세가 짧아져 지도 아래 시트에 그대로 들어간다.
 * 위치는 뒤의 본 지도가 보여주고, 여기서는 설명만 읽는다.
 *
 * @param inSheet 바텀시트 안이면 true. 닫기 버튼이 '목록으로 돌아가기'가 된다.
 */
export function PlaceDetailBody({ item, onClose, inSheet = false }) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-white/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              타이포그래피는 네이버 지도 장소 패널의 비율을 따른다.
              제목은 본문의 약 1.33배(20/15)에 자간을 좁혀 덩어리로 읽히게 하고,
              행간은 1.3 으로 붙인다. 색과 배경은 이 앱의 것을 그대로 쓴다.

              영업 상태는 이름 바로 옆에 둔다 — 여기서 가장 먼저 알아야 할 것이
              '이 곳이 지금 문을 열었는가' 이기 때문이다.
              flex-wrap 이라 이름이 길면 상태만 아랫줄로 내려가고 잘리지 않는다.
            */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 break-words text-[20px] font-extrabold leading-[1.3]
                             tracking-[-0.02em] text-slate-900">
                {item.name}
              </h2>
              <StatusChip item={item} />
            </div>
            {/* 종별·명절 배지는 둘 다 없을 수 있다. 빈 줄이 남지 않게 조건부로 그린다 */}
            {(item.division || item.holidayEmergency) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {item.division && (
                  <span className="chip bg-slate-100 text-slate-600">{item.division}</span>
                )}
                {item.holidayEmergency && (
                  <span className="chip bg-violet-100 text-violet-700">🏮 명절 비상진료</span>
                )}
              </div>
            )}
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

      {/*
        정보 줄도 네이버 지도의 리듬을 따른다 — 15px · 행간 1.5(22.5px).
        거기서는 아이콘 없는 한 덩어리 텍스트라 줄 간격이 곧 행간(약 22.7px)이지만,
        여기는 줄마다 아이콘이 있고 주소가 두 줄로 넘어가므로 4px 만 띄운다.
        완전히 붙이면 주소의 둘째 줄과 다음 항목이 구분되지 않는다.
      */}
      <dl className="space-y-1 px-4 pb-4 pt-1 text-[15px] leading-[1.5] tracking-[-0.01em]
                     text-slate-700">
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
          onClick={(e) => {
            if (openKakaoRoute(item)) e.preventDefault();
          }}
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
 * 모바일에서는 이것 대신 바텀시트가 같은 본체를 담는다.
 *
 * 배경을 가리지 않는다(scrim 없음). 뒤의 본 지도에서 선택한 곳의 핀이 커져 있는데
 * 그 위에 어두운 막을 덮으면 정작 봐야 할 것이 흐려진다.
 */
export default function PlaceDetail({ item, onClose }) {
  /* Esc 로 닫기 */
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`${item.name} 상세`}
      className="sheet-in fixed bottom-6 left-1/2 z-50 max-h-[70vh] w-[min(28rem,calc(100vw-3rem))]
                 -translate-x-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
    >
      <PlaceDetailBody item={item} onClose={onClose} />
    </div>
  );
}
