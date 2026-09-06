/**
 * 응급의료포털(E-Gen) 공공데이터 Open API 클라이언트
 * ------------------------------------------------------------------
 *  · 약국   : ErmctInsttInfoInqireService/getParmacyListInfoInqire
 *  · 병·의원: HsptlAsembySearchService/getHsptlMdcncListInfoInqire
 *
 *  apis.data.go.kr 은 CORS 를 허용하지 않으므로 항상 프록시를 경유한다.
 *    개발  : vite.config.js 의 server.proxy ('/egen' → apis.data.go.kr)
 *    배포  : api/egen.js + vercel.json rewrite (같은 '/egen' 경로)
 *
 *  인증키는 프록시가 서버에서 주입한다. 클라이언트는 키를 알지도, 보내지도 않는다.
 */

const PROXY_BASE = import.meta.env.VITE_EGEN_PROXY_BASE || '/egen';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
/** 상류(data.go.kr)가 응답하지 않을 때 화면이 영원히 "검색 중" 에 머무는 것을 막는다 */
const REQUEST_TIMEOUT_MS = 15_000;

export const ENDPOINTS = {
  pharmacy: `${PROXY_BASE}/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire`,
  hospital: `${PROXY_BASE}/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire`,
  // 국립중앙의료원_전국 명절 비상 진료기관 정보 조회 서비스
  holiday: `${PROXY_BASE}/B552657/HolidyEmgncClnicInsttInfoInqireService/getHolidyClnicPosblEgytInfoInqire`,
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

/** 공통 처리: fetch → XML 파싱 → 오류 판정. 성공 시 Document 반환 */
async function fetchXmlDoc(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  let raw;
  try {
    res = await fetch(url, { signal: controller.signal });
    raw = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new EgenError(
        `응급의료포털이 ${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.`,
        'TIMEOUT',
      );
    }
    throw new EgenError(`응급의료포털에 연결하지 못했습니다: ${e.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  // data.go.kr 는 오류도 XML(<cmmMsgHeader>)로 돌려주므로 상태 코드보다 본문이 유용하다
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  const parseFailed = doc.getElementsByTagName('parsererror').length > 0;

  if (!parseFailed) {
    const code = text(doc, 'resultCode') || text(doc, 'returnReasonCode');
    const msg = text(doc, 'resultMsg') || text(doc, 'returnAuthMsg') || text(doc, 'errMsg');
    if (code && code !== '00' && code !== '0000') {
      const hint = /SERVICE_KEY|SERVICE KEY/i.test(raw)
        ? ' — EGEN_SERVICE_KEY 에 공공데이터포털 "Decoding" 키가 들어갔는지, 해당 서비스 활용신청이 승인됐는지 확인하세요.'
        : '';
      throw new EgenError(`응급의료포털 오류: ${msg || '알 수 없는 오류'} (${code})${hint}`, code);
    }
  }

  if (!res.ok) {
    // 404 는 대개 프록시(/egen rewrite)가 배포에 반영되지 않은 경우다
    const hint = res.status === 404 ? ' API 프록시(/egen) 설정을 확인하세요.' : '';
    throw new EgenError(`응급의료포털 요청 실패 (HTTP ${res.status}).${hint}`, String(res.status));
  }

  if (parseFailed) {
    throw new EgenError('응급의료포털 응답을 해석할 수 없습니다.', 'PARSE');
  }

  return doc;
}

async function requestPage({ kind, q0, q1, dayCode, qd, qn, pageNo }) {
  const params = new URLSearchParams({
    Q0: q0,
    ORD: 'NAME',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
  });
  if (q1) params.set('Q1', q1);
  // dayCode 가 없으면 요일 필터 없이 전체 목록을 받는다 (명절 조인용 좌표 확보 목적)
  if (dayCode != null) params.set('QT', String(dayCode)); // 1=월 … 7=일, 8=공휴일
  // 진료과목. 응답에 진료과목 필드가 없어 이 필터는 서버에서만 걸 수 있다
  if (qd) params.set('QD', qd);
  if (qn) params.set('QN', qn); // 기관명 부분일치

  const doc = await fetchXmlDoc(`${ENDPOINTS[kind]}?${params.toString()}`);
  const nodes = Array.from(doc.getElementsByTagName('item'));
  const totalCount = Number(text(doc, 'totalCount') || nodes.length);
  return { items: nodes.map((n) => parseItem(n, kind)), totalCount };
}

/** 한 개 시군구(또는 시도 전체)에 대해 전체 페이지를 수집 */
async function fetchRegion({ kind, q0, q1, dayCode, qd, qn }) {
  const first = await requestPage({ kind, q0, q1, dayCode, qd, qn, pageNo: 1 });
  const collected = [...first.items];

  const totalPages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE) || 1);
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        requestPage({ kind, q0, q1, dayCode, qd, qn, pageNo: i + 2 }).catch(() => ({ items: [] })),
      ),
    );
    rest.forEach((page) => collected.push(...page.items));
  }
  return collected;
}

/** 조회 갈래별 후처리 필터 (종별 제외 / 이름 뒷부분 제외) */
function applyVariantFilters(items, v) {
  let result = items;

  if (v.excludeDivPattern) {
    const byDiv = new RegExp(v.excludeDivPattern);
    result = result.filter((it) => !byDiv.test(it.division || ''));
  }

  if (v.excludeAfterPattern && v.qn) {
    const byTail = new RegExp(v.excludeAfterPattern);
    result = result.filter((it) => {
      const name = it.name || '';
      const at = name.indexOf(v.qn);
      // qn 이 없으면(있을 수 없지만) 이름 전체를 대상으로 본다
      const tail = at < 0 ? name : name.slice(at + v.qn.length);
      return !byTail.test(tail);
    });
  }

  return result;
}

/**
 * 여러 시군구를 동시에 조회하고 hpid 기준으로 중복 제거한다.
 * (검색 반경이 행정구역 경계를 넘는 경우를 커버하기 위함)
 *
 * @param {'pharmacy'|'hospital'} kind
 * @param {Array<{q0:string, q1?:string}>} regions
 * @param {number[]|null} dayCodes E-Gen 요일 코드 목록 (공휴일이면 [8, 실제요일]).
 *                                  null 이면 요일 필터 없이 전체를 받는다.
 * @param {Array<{qd?:string, qn?:string, excludeDivPattern?:string, excludeAfterPattern?:string}>} [variants]
 *        조회 갈래. 여러 개를 주면 각각 조회한 뒤 hpid 로 합친다.
 *        excludeDivPattern   그 갈래에서 제외할 종별(dutyDivNam) 정규식
 *        excludeAfterPattern 기관명 중 qn 뒤쪽 부분에 이 패턴이 있으면 제외
 */
export async function fetchFacilities(kind, regions, dayCodes, variants) {
  const codes = dayCodes?.length ? dayCodes : [null];
  const list = variants?.length ? variants : [{}];

  const jobs = list.flatMap((v) =>
    regions.flatMap((r) =>
      codes.map(async (dayCode) => {
        const items = await fetchRegion({
          kind,
          q0: r.q0,
          q1: r.q1,
          dayCode,
          qd: v.qd,
          qn: v.qn,
        });
        return applyVariantFilters(items, v);
      }),
    ),
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

/* ──────────────────────────────────────────────────────────────
 * 국립중앙의료원 「전국 명절 비상 진료기관 정보 조회 서비스」
 *
 *  · 오퍼레이션 : getHolidyClnicPosblEgytInfoInqire
 *  · 요청       : Q0(시도) Q1(시군구) QD(진료과목, H=약국) QT(명절일자 YYYYMMDD)
 *  · 응답       : hpid dutyName dutyAddr dutyTel1 dutyDivNam
 *                 dutyDay1~10(진료일자) dutyDaytime1~10('09:00~17:00') dutyDayEtc
 *
 *  ※ 이 API 응답에는 좌표(wgs84Lat/Lon)가 없다. 지도 표시와 반경 필터에는
 *    좌표가 필수이므로, 명절에는 약국/병의원 목록 API 를 "요일 필터 없이"
 *    호출해 좌표를 확보한 뒤 hpid 로 조인한다. (finder.js 참조)
 *  ※ 개발계정 트래픽이 1,000회/일로 빠듯해 명절 연휴에만 호출한다.
 * ────────────────────────────────────────────────────────────── */

/** 응답 한 건 → { hpid, name, addr, tel, divName, timeRaw, etc } */
function parseHolidayItem(node, compactDate) {
  const item = {
    hpid: text(node, 'hpid'),
    name: text(node, 'dutyName'),
    addr: text(node, 'dutyAddr'),
    tel: text(node, 'dutyTel1'),
    divName: text(node, 'dutyDivNam'),
    etc: text(node, 'dutyDayEtc'),
    timeRaw: '',
  };

  // dutyDay1~10 중 오늘 날짜와 일치하는 칸의 dutyDaytime{n} 을 고른다
  for (let i = 1; i <= 10; i += 1) {
    const day = text(node, `dutyDay${i}`).replace(/\D/g, '');
    if (day && day === compactDate) {
      item.timeRaw = text(node, `dutyDaytime${i}`);
      break;
    }
  }
  return item;
}

async function requestHolidayPage({ q0, q1, compactDate, pageNo }) {
  const params = new URLSearchParams({
    Q0: q0,
    QT: compactDate, // 명절일자 YYYYMMDD
    ORD: 'NAME',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
  });
  if (q1) params.set('Q1', q1);

  const doc = await fetchXmlDoc(`${ENDPOINTS.holiday}?${params.toString()}`);
  const nodes = Array.from(doc.getElementsByTagName('item'));
  const totalCount = Number(text(doc, 'totalCount') || nodes.length);
  return { items: nodes.map((n) => parseHolidayItem(n, compactDate)), totalCount };
}

/**
 * 명절 비상진료기관을 시군구별로 조회해 hpid → 정보 맵으로 돌려준다.
 * 일부 지역 조회가 실패해도 나머지는 그대로 사용한다 (부가 정보이므로 전체를 막지 않는다).
 *
 * @param {Array<{q0:string, q1?:string}>} regions
 * @param {string} compactDate 'YYYYMMDD'
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchHolidayClinics(regions, compactDate) {
  const results = await Promise.allSettled(
    regions.map(async (r) => {
      const first = await requestHolidayPage({
        q0: r.q0,
        q1: r.q1,
        compactDate,
        pageNo: 1,
      });
      const collected = [...first.items];

      const totalPages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE) || 1);
      if (totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            requestHolidayPage({ q0: r.q0, q1: r.q1, compactDate, pageNo: i + 2 }).catch(() => ({
              items: [],
            })),
          ),
        );
        rest.forEach((page) => collected.push(...page.items));
      }
      return collected;
    }),
  );

  const byHpid = new Map();
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((item) => {
      if (item.hpid && !byHpid.has(item.hpid)) byHpid.set(item.hpid, item);
    });
  });
  return byHpid;
}
