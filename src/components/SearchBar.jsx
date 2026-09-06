import { useState } from 'react';

const EXAMPLES = ['서울시 강남구 역삼동', '성남시 분당구 정자동', '부산시 해운대구 우동'];

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
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="시/도 + 구/동 (예: 성남시 분당구 정자동)"
            aria-label="지역 검색어"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm
                       outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>

        <button type="submit" className="btn-primary shrink-0" disabled={loading || !query.trim()}>
          {loading ? '검색 중…' : '검색'}
        </button>

        <button
          type="button"
          onClick={onLocate}
          disabled={locating || loading}
          title="현재 위치로 검색"
          aria-label="현재 위치로 검색"
          className="btn-ghost shrink-0 px-3"
        >
          <span aria-hidden="true">{locating ? '⏳' : '📍'}</span>
          <span className="hidden sm:inline">내 위치</span>
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>예시</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setQuery(ex);
              onSearch(ex);
            }}
            className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
