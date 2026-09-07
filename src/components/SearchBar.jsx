import { useRef, useState } from 'react';

/**
 * 지도 위에 떠 있는 검색 바 (구글 지도 방식).
 * 바깥 카드 + 안쪽 입력창으로 테두리가 겹치지 않도록, 이 컴포넌트 자체가
 * 하나의 알약(pill)이 된다. 입력창은 테두리 없이 그 안에 얹는다.
 */
export default function SearchBar({ onSearch, loading }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSearch(q);
  };

  /* 지우고 나면 바로 다음 지역명을 칠 수 있어야 한다 — 포커스를 입력창에 돌려준다 */
  const clear = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      className="flex h-11 w-full items-center gap-1 rounded-full bg-white pl-3 pr-1
                 shadow-lg ring-1 ring-black/10 transition
                 focus-within:ring-2 focus-within:ring-brand-400"
    >
      <span className="shrink-0 text-slate-400" aria-hidden="true">
        🔍
      </span>

      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="지역명 (예: 정자동)"
        aria-label="지역 검색어"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none
                   placeholder:text-slate-400"
      />

      {/*
        지우기. 브라우저가 type=search 에 붙여 주는 기본 ✕ 는 포커스가 있을 때만
        나오고 모양도 제각각이라 index.css 에서 감추고 직접 그린다.
        글자가 없을 때는 눌러도 할 일이 없으므로 아예 렌더하지 않는다.
      */}
      {query && (
        <button
          type="button"
          onClick={clear}
          aria-label="검색어 지우기"
          title="지우기"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400
                     transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <svg
            viewBox="0 0 20 20"
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
          </svg>
        </button>
      )}

      {/* 문구가 바뀌어도 폭이 흔들리지 않도록 너비를 고정한다 */}
      <button
        type="submit"
        disabled={loading || !query.trim()}
        aria-label="검색"
        className="flex h-9 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600
                   text-[13px] font-bold text-white transition-colors hover:bg-brand-700
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
        ) : (
          '검색'
        )}
      </button>
    </form>
  );
}
