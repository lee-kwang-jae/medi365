import { TABS } from '../lib/constants.js';

export default function TabBar({ value, onChange, disabled }) {
  return (
    <div
      role="tablist"
      aria-label="검색 대상"
      className="inline-flex w-full gap-1 rounded-xl bg-slate-200/70 p-1 sm:w-auto"
    >
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
            className={[
              'flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-bold transition-all',
              'sm:flex-none sm:px-4 sm:text-sm',
              active
                ? 'bg-white text-slate-900 shadow-card ring-1 ring-black/5'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            <span className="mr-1" aria-hidden="true">
              {tab.emoji}
            </span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
