import { formatDistance } from '../lib/geo.js';
import { formatHoursLabel } from '../lib/time.js';
import { findPlaceUrl, kakaoLinks } from '../lib/kakao.js';

/**
 * [카카오맵으로 보기]
 *  E-Gen 응답에는 place_url 이 없으므로 클릭 시 Kakao Local 로 장소를 찾아
 *  place_url 로 이동한다. 팝업 차단을 피하려고 창은 클릭 즉시 열고,
 *  주소는 조회가 끝난 뒤 채운다. 조회 실패 시 검색 URL 로 폴백.
 */
async function openInKakaoMap(item) {
  const fallback = kakaoLinks.search(item.name);
  const win = window.open('about:blank', '_blank', 'noopener');
  try {
    const url = await findPlaceUrl(item.name, { lat: item.lat, lng: item.lng });
    const target = url || fallback;
    if (win) win.location.href = target;
    else window.open(target, '_blank', 'noopener');
  } catch {
    if (win) win.location.href = fallback;
  }
}

function StatusChip({ item }) {
  if (item.isOpen) return <span className="chip bg-emerald-100 text-emerald-700">● 지금 영업중</span>;
  if (item.unknownHours) return <span className="chip bg-amber-100 text-amber-700">시간 정보 없음</span>;
  return <span className="chip bg-slate-100 text-slate-500">영업 종료</span>;
}

export default function PlaceCard({ item, index, selected, onSelect }) {
  const stop = (e) => e.stopPropagation();

  return (
    <li>
      {/* 카드 전체가 클릭 대상이지만 내부에 링크/버튼이 있으므로 div + role=button 사용 */}
      <div
        role="button"
        tabIndex={0}
        aria-current={selected || undefined}
        onClick={() => onSelect(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(item.id);
          }
        }}
        className={[
          'cursor-pointer rounded-xl border bg-white p-3.5 shadow-card outline-none transition',
          selected
            ? 'border-brand-500 ring-2 ring-brand-200'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-300',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-400">{index + 1}</span>
              <h3 className="truncate text-[15px] font-bold text-slate-900">{item.name}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {item.division && (
                <span className="chip bg-slate-100 text-slate-600">{item.division}</span>
              )}
              <StatusChip item={item} />
              {item.holidayEmergency && (
                <span className="chip bg-violet-100 text-violet-700">🏮 명절 비상진료</span>
              )}
              {item.emergency && (
                <span className="chip bg-rose-100 text-rose-700">{item.emergency}</span>
              )}
            </div>
          </div>
          <span className="shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">
            {formatDistance(item.distanceKm)}
          </span>
        </div>

        <dl className="mt-2.5 space-y-1 text-[13px] text-slate-600">
          <div className="flex gap-1.5">
            <dt aria-hidden="true">📍</dt>
            <dd className="min-w-0 flex-1">{item.address || '주소 정보 없음'}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt aria-hidden="true">🕒</dt>
            <dd>{formatHoursLabel(item.hours)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt aria-hidden="true">☎</dt>
            <dd>
              {item.tel ? (
                <a
                  href={`tel:${item.tel}`}
                  onClick={stop}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  {item.tel}
                </a>
              ) : (
                '전화번호 없음'
              )}
            </dd>
          </div>
          {item.holidayNote && (
            <p className="pt-0.5 text-xs font-medium text-violet-700">{item.holidayNote}</p>
          )}
          {item.etc && <p className="pt-0.5 text-xs text-slate-400">{item.etc}</p>}
        </dl>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              openInKakaoMap(item);
            }}
            className="btn-ghost flex-1 text-xs"
          >
            🗺️ 카카오맵으로 보기
          </button>
          <a
            href={kakaoLinks.to(item.name, item.lat, item.lng)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className="btn-primary flex-1 text-xs"
          >
            🧭 길찾기
          </a>
        </div>
      </div>
    </li>
  );
}
