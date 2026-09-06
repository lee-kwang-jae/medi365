import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 공공데이터포털(apis.data.go.kr)은 브라우저 CORS 를 허용하지 않으므로 항상 프록시를 경유한다.
 *   개발  : 아래 server.proxy  ('/egen/*' → apis.data.go.kr/*)
 *   배포  : Cloudflare Worker (worker/egen-proxy.js) — VITE_EGEN_PROXY_BASE 로 지정
 *
 * 인증키(EGEN_SERVICE_KEY)는 VITE_ 접두사가 없어 클라이언트 번들에 포함되지 않는다.
 * 프록시가 요청을 흘려보낼 때 서버 쪽에서 붙여준다.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' : VITE_ 접두사 없는 변수까지 로드

  return {
    plugins: [react()],
    // GitHub Pages 프로젝트 사이트는 /<repo>/ 하위에 배포된다
    base: env.VITE_BASE_PATH || '/',
    server: {
      port: 5173,
      proxy: {
        '/egen': {
          target: 'https://apis.data.go.kr',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => {
            const [pathname, search = ''] = path.replace(/^\/egen/, '').split('?');
            const params = new URLSearchParams(search);
            params.set('serviceKey', env.EGEN_SERVICE_KEY || '');
            return `${pathname}?${params.toString()}`;
          },
        },
      },
    },
  };
});
