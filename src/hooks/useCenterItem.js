import { useCallback, useEffect, useRef } from 'react';

/**
 * 스크롤 컨테이너의 **세로 중앙에 놓인 항목**을 알려준다.
 *
 * scroll 이벤트마다 모든 카드의 getBoundingClientRect 를 재는 방식은 카드가
 * 수십 개가 되면 스크롤 프레임을 잡아먹는다. 대신 IntersectionObserver 의
 * rootMargin 으로 컨테이너 가운데에 얇은 띠를 만들고, 그 띠에 걸친 카드만
 * 후보로 둔다. 실제 측정은 후보(보통 1~2개)에 대해서만 한다.
 *
 * 띠에 걸친 카드가 여럿일 때는 중앙에 가장 가까운 것을 고른다.
 * 띠가 카드 사이 여백에 빠지면 후보가 없어지는데, 이때는 직전 선택을 유지한다
 * (스크롤 도중 강조가 깜빡이는 것보다 낫다).
 */

/** rootMargin 상·하 비율. 45% 씩 깎으면 가운데 10% 띠만 남는다. */
const CENTER_BAND_PCT = 45;
/** 이 시간 동안 추가 변화가 없을 때만 확정한다(디바운스). 지도 이동 호출을 줄인다. */
const SETTLE_MS = 120;

export function useCenterItem(scrollRef, { enabled = true, itemsKey, onChange }) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lastIdRef = useRef(null);
  const suppressUntilRef = useRef(0);

  useEffect(() => {
    const root = scrollRef.current;
    if (!enabled || !root || typeof IntersectionObserver === 'undefined') return undefined;

    const cards = root.querySelectorAll('[data-place-id]');
    if (!cards.length) return undefined;

    const candidates = new Map(); // id -> element
    let timer = 0;

    const commit = () => {
      if (Date.now() < suppressUntilRef.current) return;

      const rootRect = root.getBoundingClientRect();
      const rootCenter = rootRect.top + rootRect.height / 2;

      let bestId = null;
      let bestDist = Infinity;
      candidates.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - rootCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      });

      if (bestId && bestId !== lastIdRef.current) {
        lastIdRef.current = bestId;
        onChangeRef.current?.(bestId);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.placeId;
          if (entry.isIntersecting) candidates.set(id, entry.target);
          else candidates.delete(id);
        }
        clearTimeout(timer);
        timer = setTimeout(commit, SETTLE_MS);
      },
      {
        root,
        rootMargin: `-${CENTER_BAND_PCT}% 0px -${CENTER_BAND_PCT}% 0px`,
        threshold: 0,
      },
    );

    cards.forEach((el) => observer.observe(el));
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [scrollRef, enabled, itemsKey]);

  /**
   * 우리가 직접 목록을 움직일 때(마커를 눌러 해당 카드로 스크롤 등) 감지를 잠시 끈다.
   * 끄지 않으면 '지도→목록 이동'이 다시 '목록→지도 이동'을 부르는 되먹임이 생긴다.
   * 목표 id 를 함께 넘겨 직전 값으로 기록해 두어야, 스크롤이 멎은 뒤 같은 항목이
   * 중복으로 통지되지 않는다.
   */
  const suppress = useCallback((id, ms = 700) => {
    if (id !== undefined) lastIdRef.current = id;
    suppressUntilRef.current = Date.now() + ms;
  }, []);

  return { suppress };
}
