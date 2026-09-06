/**
 * 응급의료포털(E-Gen) CORS 프록시 — Cloudflare Worker
 * ------------------------------------------------------------------
 * GitHub Pages 는 정적 호스팅이라 서버 코드를 실행할 수 없다.
 * 이 Worker 가 브라우저 대신 apis.data.go.kr 을 호출하고,
 * 인증키(EGEN_SERVICE_KEY)를 여기서 주입해 클라이언트에 노출되지 않게 한다.
 *
 * 배포:
 *   npx wrangler secret put EGEN_SERVICE_KEY
 *   npx wrangler deploy
 */

const UPSTREAM = 'https://apis.data.go.kr';
const ALLOWED_PREFIX = 'B552657/'; // 응급의료정보조회 서비스만 허용

/** 허용 오리진 목록 (wrangler.toml 의 ALLOWED_ORIGINS, 쉼표 구분) */
function resolveOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = resolveOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return origin
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response('origin not allowed', { status: 403 });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405 });
    }
    if (!origin) {
      return new Response('origin not allowed', { status: 403 });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/egen\/?/, '');

    if (!path.startsWith(ALLOWED_PREFIX)) {
      return new Response('invalid path', { status: 400, headers: corsHeaders(origin) });
    }
    if (!env.EGEN_SERVICE_KEY) {
      return new Response('EGEN_SERVICE_KEY not configured', {
        status: 500,
        headers: corsHeaders(origin),
      });
    }

    const target = new URL(`${UPSTREAM}/${path}`);
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    target.searchParams.set('serviceKey', env.EGEN_SERVICE_KEY); // 클라이언트 값은 무시하고 덮어씀

    try {
      const upstream = await fetch(target.toString(), {
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...corsHeaders(origin),
          'content-type': upstream.headers.get('content-type') || 'application/xml',
          'cache-control': 'public, max-age=60',
        },
      });
    } catch (e) {
      return new Response(`upstream error: ${e.message}`, {
        status: 502,
        headers: corsHeaders(origin),
      });
    }
  },
};
