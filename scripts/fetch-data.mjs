/**
 * 응급의료포털(E-Gen) 전국 데이터 수집기
 * ------------------------------------------------------------------
 * 앱이 검색할 때마다 E-Gen 을 호출하면 상류 장애를 그대로 맞는다.
 * 이 데이터는 하루에 한 번 바뀔까 말까 하므로 미리 받아 정적 파일로 둔다.
 *
 * 출력: public/data/{pharmacy|hospital}/{격자키}.json  +  index.json
 *
 * 행정구역 이름 대신 **좌표 격자**로 나눈다.
 *   - 카카오가 주는 지역명과 E-Gen 표기를 맞출 필요가 없다
 *   - 앱은 검색 좌표 주변 격자만 읽으면 된다 (반경 3km 면 1~4개)
 *
 * 실행: node scripts/fetch-data.mjs                       (전국, 통째로 재생성)
 *       node scripts/fetch-data.mjs --sido 경기도 --sigungu 하남시   (부분, 병합)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');

/** 격자 크기(도). 0.1도 ≈ 위도 11km / 경도 9km */
export const GRID = 0.1;
export const gridKey = (lat, lng) => `${Math.floor(lat / GRID)}_${Math.floor(lng / GRID)}`;

const SIDO = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시',
  '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
];

const ENDPOINT = {
  pharmacy: 'B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire',
  hospital: 'B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire',
};

const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 12;
const SIDO_ATTEMPTS = 3;
const CONCURRENCY = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadKey() {
  const fromEnv = process.env.EGEN_SERVICE_KEY;
  if (fromEnv) return fromEnv;
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) throw new Error('EGEN_SERVICE_KEY 가 없습니다 (.env 또는 환경변수)');
  const line = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('EGEN_SERVICE_KEY='));
  if (!line) throw new Error('.env 에 EGEN_SERVICE_KEY 가 없습니다');
  return line.slice(line.indexOf('=') + 1).trim();
}

const KEY = loadKey();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
};

/**
 * 한 페이지 조회. 상류가 자주 흔들리므로 넉넉히 재시도한다.
 * 여기서의 재시도는 사용자를 기다리게 하지 않으므로 앱보다 공격적이어도 된다.
 */
async function fetchPage(kind, sido, pageNo, extra = {}) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    Q0: sido,
    ORD: 'NAME',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    ...extra,
  });
  const url = `https://apis.data.go.kr/${ENDPOINT[kind]}?${params}`;

  let lastReason = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url);
      const xml = await res.text();
      const code = tag(xml, 'resultCode') || tag(xml, 'returnReasonCode');
      if (code === '00' || code === '0000') {
        return { xml, totalCount: Number(tag(xml, 'totalCount') || 0) };
      }
      lastReason = `HTTP ${res.status} code=${code || '-'}`;
    } catch (e) {
      lastReason = e.message;
    }
    await sleep(Math.min(8000, 700 * attempt));
  }
  throw new Error(`${kind} ${sido} p${pageNo} 실패: ${lastReason}`);
}

/** <item> 하나 → 앱이 쓰는 필드만 남긴 배열 (용량을 줄이려고 객체 대신 배열) */
function parseItems(xml, kind) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const lat = Number(tag(it, 'wgs84Lat'));
    const lng = Number(tag(it, 'wgs84Lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;

    const times = [];
    for (let i = 1; i <= 8; i += 1) {
      times.push(tag(it, `dutyTime${i}s`), tag(it, `dutyTime${i}c`));
    }
    out.push([
      tag(it, 'hpid'),
      tag(it, 'dutyName'),
      tag(it, 'dutyAddr'),
      tag(it, 'dutyTel1'),
      kind === 'hospital' ? tag(it, 'dutyDivNam') : '약국',
      kind === 'hospital' ? tag(it, 'dutyEmclsName') : '',
      tag(it, 'dutyEtc'),
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6)),
      ...times,
    ]);
  }
  return out;
}

async function collectSido(kind, sido, extra = {}) {
  // 페이지 재시도를 다 쓰고도 실패하면 시도 전체를 처음부터 다시 받는다.
  // 상류가 몇 분씩 통째로 죽는 일이 있어 페이지 단위 재시도만으로는 부족하다.
  let lastError;
  for (let round = 1; round <= SIDO_ATTEMPTS; round += 1) {
    try {
      return await collectSidoOnce(kind, sido, extra);
    } catch (e) {
      lastError = e;
      if (round < SIDO_ATTEMPTS) {
        console.log(`  ${sido} 재시도 ${round}/${SIDO_ATTEMPTS - 1} — ${e.message}`);
        await sleep(30000);
      }
    }
  }
  throw lastError;
}

async function collectSidoOnce(kind, sido, extra = {}) {
  const first = await fetchPage(kind, sido, 1, extra);
  const items = parseItems(first.xml, kind);
  const pages = Math.ceil(first.totalCount / PAGE_SIZE);

  for (let p = 2; p <= pages; p += 1) {
    const { xml } = await fetchPage(kind, sido, p, extra);
    items.push(...parseItems(xml, kind));
  }
  return { items, totalCount: first.totalCount };
}

/**
 * 소아청소년과(D002) 등록 기관의 hpid 집합.
 * 병의원 목록 응답에는 진료과목 필드가 없어 클라이언트가 거를 수 없다.
 * 서버 필터(QD)로만 알 수 있으므로 여기서 미리 받아 hpid 목록으로 저장한다.
 */
async function collectPediatric(sidoList, extra = {}) {
  const tasks = sidoList.map((sido) => async () => {
    const r = await collectSido('hospital', sido, { ...extra, QD: 'D002' });
    process.stdout.write(`  ${sido} ${r.items.length}\n`);
    return r.items.map((row) => row[0]).filter(Boolean);
  });
  const ids = (await pool(tasks, CONCURRENCY)).flat();
  return [...new Set(ids)].sort();
}

/** 동시 실행 수를 제한해 상류 부담을 줄인다 */
async function pool(tasks, limit) {
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor;
        cursor += 1;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

/** 격자별로 나누고, 파일 내용이 매번 같도록 정렬한다 (변경 없으면 커밋도 없다) */
function toBuckets(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = gridKey(row[7], row[8]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  return buckets;
}

const readJson = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;

/**
 * 격자 파일 기록.
 *  - 전국 수집: 통째로 새로 쓴다
 *  - 부분 수집(--sido / --sigungu): 기존 파일에 hpid 기준으로 덮어쓴다(upsert).
 *    도시 하나씩 정상화하는 용도라 다른 지역 데이터를 건드리면 안 된다.
 */
function writeBuckets(kind, rows, partial) {
  const dir = path.join(OUT_DIR, kind);
  if (!partial) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  for (const [key, list] of toBuckets(rows)) {
    const file = path.join(dir, `${key}.json`);
    let merged = list;
    if (partial) {
      const byId = new Map(readJson(file, []).map((r) => [r[0], r]));
      list.forEach((r) => byId.set(r[0], r));
      merged = [...byId.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    }
    fs.writeFileSync(file, JSON.stringify(merged));
  }

  // 실제로 데이터가 있는 격자 목록. 앱은 이 목록에 없는 격자를 만나면 API 로 폴백한다.
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

async function run() {
  const args = process.argv.slice(2);
  const pick = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const onlySido = pick('--sido');
  const onlySigungu = pick('--sigungu');
  const onlyKind = pick('--kind');
  const partial = Boolean(onlySido || onlySigungu);

  if (onlySigungu && !onlySido) {
    throw new Error('--sigungu 는 --sido 와 함께 써야 합니다');
  }

  const sidoList = onlySido ? [onlySido] : SIDO;
  const kinds = onlyKind ? [onlyKind] : ['pharmacy', 'hospital'];
  const extra = onlySigungu ? { Q1: onlySigungu } : {};

  const label = onlySigungu ? `${onlySido} ${onlySigungu}` : onlySido || '전국';
  console.log(`대상: ${label} · ${kinds.join(', ')} · ${partial ? '부분(병합)' : '전체(재생성)'}`);

  const collected = {};

  /*
   * 상류가 수집 도중 죽는 일이 잦다. 하나라도 실패하면 아무것도 쓰지 않고 끝낸다.
   * 그래야 이미 배포된 데이터가 반쪽짜리로 덮이지 않는다.
   */
  for (const kind of kinds) {
    const started = Date.now();
    console.log(`\n[${kind}] 수집`);
    const tasks = sidoList.map((sido) => async () => {
      const r = await collectSido(kind, sido, extra);
      process.stdout.write(`  ${sido}${onlySigungu ? ' ' + onlySigungu : ''} ${r.items.length}/${r.totalCount}\n`);
      return r.items;
    });
    collected[kind] = (await pool(tasks, CONCURRENCY)).flat();
    console.log(`[${kind}] ${collected[kind].length}건 · ${((Date.now() - started) / 1000).toFixed(0)}초`);
  }

  let pediatricIds = null;
  if (kinds.includes('hospital')) {
    console.log('\n[pediatric] 소아청소년과(D002) 등록 기관 수집');
    pediatricIds = await collectPediatric(sidoList, extra);
    console.log(`[pediatric] ${pediatricIds.length}건`);
  }

  // ── 여기까지 왔으면 전부 성공. 이제 기록한다 ──
  const indexFile = path.join(OUT_DIR, 'index.json');
  const summary = readJson(indexFile, { grid: GRID, kinds: {}, cells: {} });
  summary.generatedAt = new Date().toISOString();
  summary.grid = GRID;
  summary.cells = summary.cells || {};
  summary.kinds = summary.kinds || {};

  for (const [kind, rows] of Object.entries(collected)) {
    const cells = writeBuckets(kind, rows, partial);
    summary.cells[kind] = cells;
    summary.kinds[kind] = { cells: cells.length, lastAdded: rows.length, region: label };
    console.log(`[${kind}] 격자 ${cells.length}개`);
  }

  if (pediatricIds) {
    const tagDir = path.join(OUT_DIR, 'tags');
    fs.mkdirSync(tagDir, { recursive: true });
    const file = path.join(tagDir, 'pediatric.json');
    const prev = partial ? readJson(file, []) : [];
    const ids = [...new Set([...prev, ...pediatricIds])].sort();
    fs.writeFileSync(file, JSON.stringify(ids));
    summary.pediatric = ids.length;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(summary, null, 2));
  console.log('\n완료:', path.relative(ROOT, OUT_DIR));
}

run().catch((e) => {
  console.error('수집 실패:', e.message);
  process.exit(1);
});
