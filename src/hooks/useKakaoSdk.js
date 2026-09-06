import { useEffect, useState } from 'react';
import { loadKakaoSdk } from '../lib/kakao.js';

/** 카카오 지도 SDK 로딩 상태 */
export default function useKakaoSdk() {
  const [ready, setReady] = useState(() => Boolean(window.kakao?.maps?.services));
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadKakaoSdk()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  return { ready, error };
}
