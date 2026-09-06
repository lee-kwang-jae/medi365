import { useCallback, useState } from 'react';

const OPTIONS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 };

/** 브라우저 Geolocation 으로 현재 좌표를 얻는다. */
export default function useGeolocation() {
  const [locating, setLocating] = useState(false);

  const locate = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다.'));
          return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocating(false);
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              label: '현재 위치',
            });
          },
          (err) => {
            setLocating(false);
            const message =
              err.code === err.PERMISSION_DENIED
                ? '위치 권한이 거부되었습니다. 지역명으로 검색해 주세요.'
                : '현재 위치를 가져오지 못했습니다.';
            reject(new Error(message));
          },
          OPTIONS,
        );
      }),
    [],
  );

  return { locate, locating };
}
