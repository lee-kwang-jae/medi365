import { useCallback, useEffect, useRef } from 'react';

/**
 * 카카오맵 앱 방식의 바텀시트.
 *
 * 두 단계로 멈춘다. 부모 컨테이너 높이에 대한 비율이다.
 *  peek — 요약만. 지도를 넓게 볼 때.
 *  open — 목록이 지도 아래에 펼쳐진 기본 상태.
 *
 * **어느 단계에서도 지도를 덮지 않는다.** 목록을 아무리 스크롤해도 지도는 위에
 * 남아 있어야 한다 — 그게 지도 앱과 목록 페이지를 가르는 지점이다.
 * 그래서 MAX_RATIO 로 드래그 상한까지 막는다. 이 값을 올리면 지도가 사라진다.
 */
export const SNAP = { peek: 0.3, open: 0.62 };
const ORDER = ['peek', 'open'];

/** 드래그로 늘릴 수 있는 한계. 스냅 지점보다 살짝 넉넉히 둬야 손맛이 난다. */
const MIN_RATIO = 0.22;
const MAX_RATIO = 0.64;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function BottomSheet({
  enabled,
  snap,
  onSnapChange,
  label = '목록',
  desktopClassName = '',
  children,
}) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  const parentHeight = useCallback(
    () => sheetRef.current?.parentElement?.clientHeight || window.innerHeight,
    [],
  );
  const heightFor = useCallback(
    (name) => parentHeight() * (SNAP[name] ?? SNAP.half),
    [parentHeight],
  );

  /* 스냅 상태 → 실제 높이. 드래그 중에는 아래 핸들러가 직접 높이를 쓰므로 건드리지 않는다. */
  useEffect(() => {
    const el = sheetRef.current;
    if (!enabled || !el || dragRef.current) return;
    el.style.height = `${heightFor(snap)}px`;
  }, [enabled, snap, heightFor]);

  /* 화면 회전·주소창 접힘으로 부모 높이가 바뀌면 비율을 다시 맞춘다 */
  useEffect(() => {
    if (!enabled) return undefined;
    const apply = () => {
      const el = sheetRef.current;
      if (el && !dragRef.current) el.style.height = `${heightFor(snap)}px`;
    };
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [enabled, snap, heightFor]);

  const nearestSnap = useCallback(
    (height) => {
      const ratio = height / parentHeight();
      return ORDER.reduce((best, name) =>
        Math.abs(SNAP[name] - ratio) < Math.abs(SNAP[best] - ratio) ? name : best,
      );
    },
    [parentHeight],
  );

  const onPointerDown = (e) => {
    const el = sheetRef.current;
    if (!enabled || !el) return;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    dragRef.current = { startY: e.clientY, startHeight: el.getBoundingClientRect().height };
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    const el = sheetRef.current;
    if (!drag || !el) return;
    const parent = parentHeight();
    // 손가락을 위로 올리면(clientY 감소) 시트가 커진다
    const next = drag.startHeight - (e.clientY - drag.startY);
    // React 상태를 거치지 않는다. 프레임마다 리렌더하면 목록이 무거워 끊긴다.
    el.style.height = `${clamp(next, parent * MIN_RATIO, parent * MAX_RATIO)}px`;
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    const el = sheetRef.current;
    if (!drag || !el) return;
    dragRef.current = null;
    el.releasePointerCapture?.(e.pointerId);
    el.style.transition = ''; // 클래스에 정의된 전환으로 되돌린다

    const target = nearestSnap(el.getBoundingClientRect().height);
    el.style.height = `${heightFor(target)}px`;
    if (target !== snap) onSnapChange(target);
  };

  // 데스크톱에서는 시트가 아니라 왼쪽 칼럼이다. 드래그 핸들러도 붙이지 않는다.
  if (!enabled) return <section className={desktopClassName}>{children}</section>;

  return (
    <section
      ref={sheetRef}
      aria-label={label}
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl
                 border-t border-slate-200 bg-white shadow-[0_-4px_24px_rgba(15,23,42,0.12)]
                 transition-[height] duration-300 ease-out"
    >
      {/*
        손잡이. touch-action:none 이 없으면 브라우저가 이 제스처를 페이지 스크롤로
        가로채 시트가 따라오지 않는다.
      */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="separator"
        aria-label="목록 크기 조절"
        className="shrink-0 cursor-grab touch-none px-4 pb-1 pt-2.5 active:cursor-grabbing"
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-300" />
      </div>

      {children}
    </section>
  );
}
