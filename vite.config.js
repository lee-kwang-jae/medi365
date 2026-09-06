import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 공공데이터포털(apis.data.go.kr)은 브라우저 CORS를 허용하지 않으므로
 * 개발 서버에서는 반드시 프록시를 거쳐야 한다.
 *   프론트 요청:  /egen/B552657/...
 *   실제 요청  :  https://apis.data.go.kr/B552657/...
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/egen': {
        target: 'https://apis.data.go.kr',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/egen/, ''),
      },
    },
  },
});
