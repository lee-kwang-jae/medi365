/**
 * 응급의료포털(E-Gen) 공공데이터 Open API 클라이언트
 * ------------------------------------------------------------------
 *  · 약국   : ErmctInsttInfoInqireService/getParmacyListInfoInqire
 *  · 병·의원: HsptlAsembySearchService/getHsptlMdcncListInfoInqire
 *
 *  apis.data.go.kr 은 CORS 를 허용하지 않으므로 항상 프록시를 경유한다.
 *    개발  : vite.config.js 의 server.proxy ('/egen' → apis.data.go.kr)
 *    배포  : Cloudflare Worker (worker/egen-proxy.js), VITE_EGEN_PROXY_BASE 로 지정
 *
 *  인증키는 프록시가 서버에서 주입한다. 클라이언트는 키를 알지도, 보내지도 않는다.
 */

const PROXY_BASE = import.meta.env.VITE_EGEN_PROXY_BASE || '/egen';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

/** 상대 경로 프록시는 Vite dev 서버에서만 동작한다 */
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const PROXY_MISCONFIGURED = !PROXY_BASE.startsWith('http') && !isLocal;

export const ENDPOINTS = {
  pharmacy: `${PROXY_BASE}/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire`,
  hospital: `${PROXY_BASE}/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire`,
};

export class EgenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EgenError';
    this.code = code;
  }
}

const text = (node, tag) => node.getElementsByTagName(tag)?.[0]?.textContent?.trim() ?? '';

/** 응답 XML 한 건(<item>) → 앱 내부 모델 */
function parseItem(node, kind) {
  const lat = Number(text(node, 'wgs84Lat'));
  const lng = Number(text(node, 'wgs84Lon'));

  const item = {
    id: text(node, 'hpid') || `${text(node, 'dutyName')}-${lat}-${lng}`,
    kind,
    name: text(node, 'dutyName'),
    address: text(node, 'dutyAddr'),
    tel: text(node, 'dutyTel1'),
    division: text(node, 'dutyDivNam'), // 의원 / 병원 / 종합병원 / 약국 …
    emergency: text(node, 'dutyEmclsName'),
    etc: text(node, 'dutyEtc'),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };

  // dutyTime1s ~ dutyTime8c (요일별 진료 시작/종료)
  for (let i = 1; i <= 8; i += 1) {
    item[`dutyTime${i}s`] = text(node, `dutyTime${i}s`);
    item[`dutyTime${i}c`] = text(node, `dutyTime${i}c`);
  }
  return item;
}

async function requestPage({ kind, q0, q1, dayCode, pageNo }) {
  if (PROXY_MISCONFIGURED) {
    throw new EgenError(
      '배포 환경에 API 프록시 주소가 설정되지 않았습니다. ' +
        '빌드 시 VITE_EGEN_PROXY_BASE 에 Cloudflare Worker 주소를 지정해야 합니다.',
      'NO_PROXY',
    );
  }

  const params = new URLSearchParams({
    Q0: q0,
    QT: String(dayCode), // 요일(1=월 … 7=일, 8=공휴일)
    ORD: 'NAME',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
  });
  if (q1) params.set('Q1', q1);

  const res = await fetch(`${ENDPOINTS[kind]}?${params.toString()}`);
  if (!res.ok) {
    throw new EgenError(`응급의료포털 요청 실패 (HTTP ${res.status})`, String(res.status));
  }

  const raw = await res.text();
  const doc = new DOMParser().parseFromString(raw, 'text/xml');

  if (doc.getElementsByTagName('parsererror').length) {
    // data.go.kr 는 인증키 오류 시 XML 이 아닌 문서를 돌려주기도 한다
    throw new EgenError(
      raw.includes('SERVICE_KEY')
        ? '인증키가 등록되지 않았거나 잘못되었습니다. (SERVICE KEY IS NOT REGISTERED)'
        : '응급의료포털 응답을 해석할 수 없습니다.',
      'PARSE',
    );
  }

  const code = text(doc, 'resultCode') || text(doc, 'returnReasonCode');
  const msg = text(doc, 'resultMsg') || text(doc, 'returnAuthMsg');
  if (code && code !== '00' && code !== '0000') {
    throw new EgenError(`응급의료포털 오류: ${msg || '알 수 없는 오류'} (${code})`, code);
  }

  const nodes = Array.from(doc.getElementsByTagName('item'));
  const totalCount = Number(text(doc, 'totalCount') || nodes.length);
  return { items: nodes.map((n) => parseItem(n, kind)), totalCount };
}

/** 한 개 시군구(또는 시도 전체)에 대해 전체 페이지를 수집 */
async function fetchRegion({ kind, q0, q1, dayCode }) {
  const first = await requestPage({ kind, q0, q1, dayCode, pageNo: 1 });
  const collected = [...first.items];

  const totalPages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE) || 1);
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        requestPage({ kind, q0, q1, dayCode, pageNo: i + 2 }).catch(() => ({ items: [] })),
      ),
    );
    rest.forEach((page) => collected.push(...page.items));
  }
  return collected;
}

/**
 * 여러 시군구를 동시에 조회하고 hpid 기준으로 중복 제거한다.
 * (반경 10km 가 행정구역 경계를 넘는 경우를 커버하기 위함)
 *
 * @param {'pharmacy'|'hospital'} kind
 * @param {Array<{q0:string, q1?:string}>} regions
 * @param {number[]} dayCodes E-Gen 요일 코드 목록 (공휴일이면 [8, 실제요일])
 */
export async function fetchFacilities(kind, regions, dayCodes) {
  const jobs = regions.flatMap((r) =>
    dayCodes.map((dayCode) => fetchRegion({ kind, q0: r.q0, q1: r.q1, dayCode })),
  );
  const results = await Promise.allSettled(jobs);

  const merged = new Map();
  let lastError = null;

  results.forEach((r) => {
    if (r.status === 'rejected') {
      lastError = r.reason;
      return;
    }
    r.value.forEach((item) => {
      if (!merged.has(item.id)) merged.set(item.id, item);
    });
  });

  // 전부 실패한 경우에만 에러를 올린다 (일부 실패는 무시하고 진행)
  if (merged.size === 0 && lastError) throw lastError;

  return Array.from(merged.values());
}
