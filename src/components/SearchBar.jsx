import { useState } from 'react';

export default function SearchBar({ onSearch, onLocate, loading, locating }) {
  const [query, setQuery] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSearch(q);
  };

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex w-full items-center gap-2">
        {/* min-w-0 이 없으면 flex 항목이 콘텐츠 폭 아래로 줄지 않아 좁은 화면에서 넘친다 */}
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="지역명 (예: 정자동)"
            aria-label="지역 검색어"
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-[15px]
                       outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200
                       sm:py-2 sm:text-sm"
          />
        </div>

        <button
          type="submit"
          className="btn-primary h-11 shrink-0 sm:h-auto"
          disabled={loading || !query.trim()}
        >
          {loading ? '검색 중…' : '검색'}
        </button>

        <button
          type="button"
          onClick={onLocate}
          disabled={locating || loading}
          title="현재 위치로 검색"
          aria-label="현재 위치로 검색"
          className="btn-ghost h-11 shrink-0 px-3 sm:h-auto"
        >
          <span aria-hidden="true">{locating ? '⏳' : '📍'}</span>
          <span className="hidden sm:inline">내 위치</span>
        </button>
      </form>
    </div>
  );
}
