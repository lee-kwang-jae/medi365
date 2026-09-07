import { useEffect, useState } from 'react';

/**
 * CSS 미디어쿼리를 JS 에서 구독한다.
 *
 * 화면 폭에 따라 **동작 자체가 갈릴 때** 쓴다. 보이기/숨기기만이면 Tailwind 의
 * `lg:` 접두사로 충분하다. 바텀시트는 데스크톱에서 드래그 핸들러·스크롤 감시를
 * 아예 붙이지 말아야 하므로 여기서 판단이 필요하다.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);

    setMatches(mql.matches); // query 가 바뀐 첫 프레임을 놓치지 않도록
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind 의 `lg` 중단점과 같은 값 */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
