import { TABS } from '../lib/constants.js';

/**
 * 검색 대상 전환 — 지도 위에 떠 있는 독립 칩 세 개.
 *
 * 한 덩어리(segmented control)로 묶지 않는다. 지도 위에 얹히는 요소라 배경이
 * 계속 바뀌는데, 묶어 두면 그 판이 지도를 넓게 가린다. 칩을 떼어 놓으면 사이로
 * 지도가 그대로 보인다. 선택된 칩만 탭 고유색으로 채워 한눈에 구분된다.
 */
export default function TabBar({ value, onChange, disabled }) {
  return (
    <div role="tablist" aria-label="검색 대상" className="flex gap-2">
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(tab.key)}
            // 탭 고유색은 constants 에 있으므로 클래스가 아니라 인라인으로 준다
            style={active ? { backgroundColor: tab.accent } : undefined}
            className={[
              'flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-[13px] font-bold',
              'shadow-lg ring-1 ring-black/10 transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'text-white' : 'bg-white/95 text-slate-700 backdrop-blur hover:bg-white',
            ].join(' ')}
          >
            <span aria-hidden="true">{tab.emoji}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
