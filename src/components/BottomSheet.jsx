import { useCallback, useEffect, useRef } from 'react';

/**
 * 카카오맵 앱 방식의 바텀시트.
 *
 * 두 단계로 멈춘다. 부모 컨테이너(헤더 아래 본문) 높이에 대한 비율이다.
 *  peek — 손잡이와 지역명만 남기고 접힌다. 지도를 통째로 볼 때.
 *  open — 목록이 지도 아래 펼쳐진 기본 상태.
 *
 * **지도가 화면의 절반 아래로 내려가지 않아야 한다.**
 * 비율의 기준은 본문 높이지만, 사용자가 체감하는 것은 *휴대폰 화면* 기준이다.
 * 헤더(제목+탭)가 100px 안팎을 먹으므로 본문 기준 0.42 가 대략 화면의 절반이다.
 *   812px 화면 · 헤더 102px → 본문 710px · 시트 298px → 지도 412px (화면의 51%)
 * 이 값을 올리기 전에 반드시 실제 기기 높이로 다시 계산할 것.
 */
export const SNAP = { peek: 0.1, open: 0.42 };
const ORDER = ['peek', 'open'];

/** 드래그로 늘릴 수 있는 한계. 스냅 지점보다 살짝 넉넉히 둬야 손맛이 난다. */
const MIN_RATIO = 0.08;
const MAX_RATIO = 0.45;

/**
 * expanded(목록만 보기)에서 드래그로 빠져나오는 문턱.
 * 이 비율 아래로 내리면 목록 전용 보기를 끝내고 open 으로 돌아간다.
 */
const EXPANDED_EXIT_RATIO = 0.8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function BottomSheet({
  enabled,
  snap,
  onSnapChange,
  /** 목록만 보기 — 스냅 단계와 별개로 시트가 화면을 가득 채운다 */
  expanded = false,
  onExpandedChange,
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

  const targetHeight = useCallback(
    () => (expanded ? parentHeight() : heightFor(snap)),
    [expanded, parentHeight, heightFor, snap],
  );

  /* 스냅 상태 → 실제 높이. 드래그 중에는 아래 핸들러가 직접 높이를 쓰므로 건드리지 않는다. */
  useEffect(() => {
    const el = sheetRef.current;
    if (!enabled || !el || dragRef.current) return;
    el.style.height = `${targetHeight()}px`;
  }, [enabled, targetHeight]);

  /* 화면 회전·주소창 접힘으로 부모 높이가 바뀌면 비율을 다시 맞춘다 */
  useEffect(() => {
    if (!enabled) return undefined;
    const apply = () => {
      const el = sheetRef.current;
      if (el && !dragRef.current) el.style.height = `${targetHeight()}px`;
    };
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [enabled, targetHeight]);

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
    // 캡처는 손가락이 시트 밖으로 나가도 move 를 계속 받기 위한 것일 뿐이다.
    // 실패해도 드래그 자체는 되어야 하므로 여기서 예외가 새어나가면 안 된다 —
    // 새어나가면 아래 dragRef 할당이 건너뛰어져 시트가 아예 움직이지 않는다.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 없이 진행 */
    }
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
    // 목록만 보기에서는 상한이 화면 전체다. 평소에는 지도를 지키려고 MAX_RATIO 로 막는다.
    const lo = parent * (expanded ? EXPANDED_EXIT_RATIO - 0.2 : MIN_RATIO);
    const hi = parent * (expanded ? 1 : MAX_RATIO);
    // React 상태를 거치지 않는다. 프레임마다 리렌더하면 목록이 무거워 끊긴다.
    el.style.height = `${clamp(next, lo, hi)}px`;
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    const el = sheetRef.current;
    if (!drag || !el) return;
    dragRef.current = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* 애초에 캡처하지 못했을 수 있다 */
    }
    el.style.transition = ''; // 클래스에 정의된 전환으로 되돌린다

    const height = el.getBoundingClientRect().height;

    // 목록만 보기에서는 스냅이 아니라 '계속 볼지 / 빠져나갈지' 두 갈래다
    if (expanded) {
      const stay = height / parentHeight() >= EXPANDED_EXIT_RATIO;
      el.style.height = stay ? `${parentHeight()}px` : `${heightFor('open')}px`;
      if (!stay) {
        onExpandedChange?.(false);
        if (snap !== 'open') onSnapChange('open');
      }
      return;
    }

    const target = nearestSnap(height);
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
