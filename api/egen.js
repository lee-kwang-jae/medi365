/**
 * 배포(서버리스) 환경용 응급의료포털 프록시.
 * vercel.json 의 rewrite 로  /egen/<경로>  →  /api/egen?path=<경로>  로 들어온다.
 * 공공데이터포털은 CORS 를 허용하지 않으므로 서버에서 대신 호출해 그대로 돌려준다.
 */
const UPSTREAM = 'https://apis.data.go.kr';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('path') || '';
  url.searchParams.delete('path');

  if (!/^B552657\//.test(path)) {
    res.statusCode = 400;
    res.end('invalid path');
    return;
  }

  const target = `${UPSTREAM}/${path}?${url.searchParams.toString()}`;

  try {
    const upstream = await fetch(target);
    const body = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/xml');
    res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    res.end(body);
  } catch (e) {
    res.statusCode = 502;
    res.end(`upstream error: ${e.message}`);
  }
}
