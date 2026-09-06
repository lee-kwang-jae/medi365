/**
 * 응급의료포털(E-Gen) CORS 프록시 — Vercel 서버리스 함수
 * ------------------------------------------------------------------
 * apis.data.go.kr 은 브라우저 직접 호출을 허용하지 않으므로 서버에서 대신 호출한다.
 * 인증키(EGEN_SERVICE_KEY)도 여기서 주입해 클라이언트 번들에 노출되지 않게 한다.
 *
 * vercel.json 의 rewrite 로  /egen/<경로>  →  /api/egen?path=<경로>  로 들어온다.
 * 필요한 환경변수: EGEN_SERVICE_KEY (Vercel 프로젝트 설정에 등록)
 */
const UPSTREAM = 'https://apis.data.go.kr';
const ALLOWED_PREFIX = 'B552657/'; // 응급의료정보조회 서비스만 허용

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('method not allowed');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path') || '';
  url.searchParams.delete('path');
  url.searchParams.delete('serviceKey'); // 클라이언트가 보낸 값은 무시

  if (!path.startsWith(ALLOWED_PREFIX)) {
    res.status(400).send('invalid path');
    return;
  }
  if (!process.env.EGEN_SERVICE_KEY) {
    res.status(500).send('EGEN_SERVICE_KEY not configured');
    return;
  }

  const target = new URL(`${UPSTREAM}/${path}`);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  target.searchParams.set('serviceKey', process.env.EGEN_SERVICE_KEY);

  try {
    const upstream = await fetch(target.toString());
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/xml');
    res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    res.send(body);
  } catch (e) {
    res.status(502).send(`upstream error: ${e.message}`);
  }
}
