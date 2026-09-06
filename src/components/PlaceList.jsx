import PlaceCard from './PlaceCard.jsx';

function Skeleton() {
  return (
    <li className="animate-pulse rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="h-4 w-1/2 rounded bg-slate-200" />
      <div className="mt-3 h-3 w-4/5 rounded bg-slate-100" />
      <div className="mt-2 h-3 w-2/5 rounded bg-slate-100" />
      <div className="mt-3 h-8 w-full rounded bg-slate-100" />
    </li>
  );
}

export default function PlaceList({
  items,
  loading,
  error,
  emptyText,
  selectedId,
  onSelect,
  onRetry,
}) {
  if (loading) {
    return (
      <ul className="space-y-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} />
        ))}
      </ul>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <p className="font-bold">문제가 발생했습니다</p>
        <p className="mt-1 leading-relaxed">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-ghost mt-3 h-10 w-full text-sm">
            ↻ 다시 시도
          </button>
        )}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-3xl" aria-hidden="true">
          🌙
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-700">{emptyText}</p>
        <p className="mt-1 text-xs text-slate-500">
          다른 지역으로 검색하거나 상단의 &lsquo;영업시간 미등록 포함&rsquo; 옵션을 켜 보세요.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <PlaceCard
          key={item.id}
          item={item}
          index={i}
          selected={item.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
