import { formatDistance } from '../lib/geo.js';
import { formatHoursLabel } from '../lib/time.js';
import { kakaoLinkProps, kakaoLinks, openInKakaoMap } from '../lib/kakao.js';

// 카카오맵으로 나가는 링크의 target. 모바일에서 새 탭으로 열면 뒤로가기로 앱에
// 돌아올 수 없어진다 (kakaoLinkProps 주석 참고).
const linkProps = kakaoLinkProps();

function StatusChip({ item }) {
  // 카카오 장소 검색 결과는 영업시간 자체가 없다. '영업 종료' 로 보이면 오해를 준다.
  if (item.fromKakao) return <span className="chip bg-amber-100 text-amber-800">영업시간 확인 불가</span>;
  if (item.isOpen) return <span className="chip bg-emerald-100 text-emerald-700">● 지금 영업중</span>;
  if (item.unknownHours) return <span className="chip bg-amber-100 text-amber-700">시간 정보 없음</span>;
  return <span className="chip bg-slate-100 text-slate-500">영업 종료</span>;
}

export default function PlaceCard({ item, index, selected, onSelect }) {
  const stop = (e) => e.stopPropagation();

  return (
    // data-place-id: 바텀시트 중앙에 놓인 카드를 찾는 IntersectionObserver 의 표식
    // (src/hooks/useCenterItem.js). 지우면 스크롤-마커 연동이 조용히 멎는다.
    <li data-place-id={item.id}>
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
              {/*
                상세(PlaceDetail)와 같은 비율을 쓴다 — 제목은 본문의 약 1.33배(17/13),
                행간 1.3, 자간 -0.02em. 절대 크기는 상세보다 한 단계 작게 두어
                목록이 상세보다 앞서 읽히지 않게 한다.
              */}
              <h3 className="min-w-0 break-words text-[17px] font-bold leading-[1.3]
                             tracking-[-0.02em] text-slate-900">
                {item.name}
              </h3>
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

        {/* 행간 1.5 는 이미 그러했지만, 상속에 기대지 않도록 명시한다 */}
        <dl className="mt-2.5 space-y-1 text-[13px] leading-[1.5] tracking-[-0.01em]
                       text-slate-600">
          <div className="flex gap-1.5">
            <dt aria-hidden="true">📍</dt>
            <dd className="min-w-0 flex-1 break-words">{item.address || '주소 정보 없음'}</dd>
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
          {/*
            앵커로 둬야 팝업이 막히거나 스크립트가 실패해도 최소한 검색 페이지는 열린다.
            정확한 장소 페이지로 올려주는 건 onClick 의 부가 기능이다.
          */}
          <a
            href={kakaoLinks.search(item.name)}
            {...linkProps}
            onClick={(e) => {
              stop(e);
              if (openInKakaoMap(item)) e.preventDefault();
            }}
            className="btn-ghost h-10 flex-1 text-xs sm:h-auto"
          >
            🗺️ <span className="sm:hidden">카카오맵</span>
            <span className="hidden sm:inline">카카오맵으로 보기</span>
          </a>
          <a
            href={kakaoLinks.to(item.name, item.lat, item.lng)}
            {...linkProps}
            onClick={stop}
            className="btn-primary h-10 flex-1 text-xs sm:h-auto"
          >
            🧭 길찾기
          </a>
        </div>
      </div>
    </li>
  );
}
