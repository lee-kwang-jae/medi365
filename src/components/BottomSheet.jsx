import { useCallback, useEffect, useRef } from 'react';

/**
 * 카카오맵 앱 방식의 바텀시트.
 *
 * 두 단계로 멈춘다. 부모 컨테이너(헤더 아래 본문) 높이에 대한 비율이다.
 *  closed — 손으로 끌어내리면 시트가 화면 밖으로 사라지고 지도만 남는다.
 *  open   — 목록이 지도 아래 펼쳐진 기본 상태.
 *
 * closed 는 높이가 0 이라 손잡이도 사라진다. 되돌아오는 길은 지도 하단 중앙의
 * 동그란 목록 버튼뿐이므로, 그 버튼을 지우면 목록으로 돌아갈 방법이 없어진다.
 *
 * **open 에서 지도가 화면의 절반 아래로 내려가지 않아야 한다.**
 * 비율의 기준은 본문 높이지만, 사용자가 체감하는 것은 *휴대폰 화면* 기준이다.
 * 헤더가 100px 안팎을 먹으므로 본문 기준 0.42 가 대략 화면의 절반이다.
 *   812px 화면 · 헤더 47px → 본문 765px · 시트 321px → 지도 444px (화면의 55%)
 * 이 값을 올리기 전에 반드시 실제 기기 높이로 다시 계산할 것.
 */
export const SNAP = { closed: 0, open: 0.42 };
const ORDER = ['closed', 'open'];

/** 드래그 범위. 아래로는 완전히 닫히고, 위로는 지도를 지키려고 막는다. */
const MIN_RATIO = 0;
const MAX_RATIO = 0.45;

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
  // 본문에서 손을 댔지만 아직 스크롤인지 시트 드래그인지 판단하지 않은 상태
  const pendingRef = useRef(null);

  const parentHeight = useCallback(
    () => sheetRef.current?.parentElement?.clientHeight || window.innerHeight,
    [],
  );
  const heightFor = useCallback(
    (name) => parentHeight() * (SNAP[name] ?? SNAP.open),
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

  /** 실제 드래그 시작. 잡은 순간의 높이를 기준으로 삼는다. */
  const beginDrag = (el, clientY, pointerId) => {
    // 캡처는 손가락이 시트 밖으로 나가도 move 를 계속 받기 위한 것일 뿐이다.
    // 실패해도 드래그 자체는 되어야 하므로 여기서 예외가 새어나가면 안 된다 —
    // 새어나가면 아래 dragRef 할당이 건너뛰어져 시트가 아예 움직이지 않는다.
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* 캡처 없이 진행 */
    }
    el.style.transition = 'none';
    dragRef.current = { startY: clientY, startHeight: el.getBoundingClientRect().height };
  };

  const onPointerDown = (e) => {
    const el = sheetRef.current;
    if (!enabled || !el) return;
    beginDrag(el, e.clientY, e.pointerId);
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
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* 애초에 캡처하지 못했을 수 있다 */
    }
    el.style.transition = ''; // 클래스에 정의된 전환으로 되돌린다

    const target = nearestSnap(el.getBoundingClientRect().height);
    el.style.height = `${heightFor(target)}px`;
    if (target !== snap) onSnapChange(target);
  };

  /* ── 목록(흰 박스) 본문에서 끌어내리기 ──────────────────────────
   * 본문은 스크롤도 해야 하므로 손잡이처럼 무조건 잡으면 안 된다.
   * **목록이 맨 위에 있고 아래로 끄는** 제스처일 때만 시트 드래그로 넘긴다.
   * 위로 끌거나 이미 스크롤이 내려가 있으면 평소대로 목록이 스크롤된다.
   * ──────────────────────────────────────────────────────────── */

  /** 이만큼 움직이기 전에는 스크롤인지 시트 드래그인지 판단하지 않는다 */
  const DRAG_START_PX = 8;

  /** e.target 에서 시트 안쪽으로 올라가며 실제로 스크롤되는 조상을 찾는다 */
  const scrollableAncestor = (from, root) => {
    let node = from;
    while (node && node !== root) {
      if (node.scrollHeight > node.clientHeight + 1) {
        const oy = getComputedStyle(node).overflowY;
        if (oy === 'auto' || oy === 'scroll') return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const onBodyPointerDown = (e) => {
    const el = sheetRef.current;
    if (!enabled || !el) return;
    // 버튼·링크를 누르는 중이면 시트를 끌 일이 아니다
    if (e.target.closest?.('a,button,input,select,textarea')) return;
    pendingRef.current = {
      startY: e.clientY,
      scroller: scrollableAncestor(e.target, el),
    };
  };

  const onBodyPointerMove = (e) => {
    if (dragRef.current) return onPointerMove(e);

    const pending = pendingRef.current;
    const el = sheetRef.current;
    if (!pending || !el) return;

    const dy = e.clientY - pending.startY;
    if (dy < -DRAG_START_PX) {
      pendingRef.current = null; // 위로 = 목록 스크롤. 시트는 건드리지 않는다
      return;
    }
    if (dy < DRAG_START_PX) return; // 아직 판단하기 이르다

    // 목록이 이미 내려가 있으면 먼저 위로 다 올라간 뒤에야 시트가 따라온다
    if (pending.scroller && pending.scroller.scrollTop > 0) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    beginDrag(el, e.clientY, e.pointerId);
  };

  const onBodyPointerUp = (e) => {
    pendingRef.current = null;
    if (dragRef.current) endDrag(e);
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

      {/*
        목록 본문. 손잡이뿐 아니라 이 흰 박스를 끌어도 시트가 내려간다.
        touch-action 은 건드리지 않는다 — pan-y 를 막으면 목록 스크롤이 죽는다.
        스크롤이 맨 위일 때만 드래그로 넘어가므로 두 동작이 부딪히지 않는다.
      */}
      <div
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerUp}
        onPointerCancel={onBodyPointerUp}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </section>
  );
}
