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
 * 실행: node scripts/fetch-data.mjs [--sido 경기도] [--kind pharmacy]
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
const MAX_ATTEMPTS = 8;
const CONCURRENCY = 3;

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
async function fetchPage(kind, sido, pageNo) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    Q0: sido,
    ORD: 'NAME',
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
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

async function collectSido(kind, sido) {
  const first = await fetchPage(kind, sido, 1);
  const items = parseItems(first.xml, kind);
  const pages = Math.ceil(first.totalCount / PAGE_SIZE);

  for (let p = 2; p <= pages; p += 1) {
    const { xml } = await fetchPage(kind, sido, p);
    items.push(...parseItems(xml, kind));
  }
  return { items, totalCount: first.totalCount };
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

async function run() {
  const args = process.argv.slice(2);
  const pick = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const onlySido = pick('--sido');
  const onlyKind = pick('--kind');

  const sidoList = onlySido ? [onlySido] : SIDO;
  const kinds = onlyKind ? [onlyKind] : ['pharmacy', 'hospital'];

  const summary = { generatedAt: new Date().toISOString(), grid: GRID, kinds: {} };

  for (const kind of kinds) {
    const started = Date.now();
    const tasks = sidoList.map((sido) => async () => {
      const r = await collectSido(kind, sido);
      process.stdout.write(`  ${sido} ${r.items.length}/${r.totalCount}\n`);
      return r.items;
    });

    console.log(`\n[${kind}] ${sidoList.length}개 시도 수집`);
    const perSido = await pool(tasks, CONCURRENCY);
    const all = perSido.flat();

    // 격자별로 나누고, 파일 내용이 매번 같도록 정렬한다 (변경 없으면 커밋도 없다)
    const buckets = new Map();
    for (const row of all) {
      const key = gridKey(row[7], row[8]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }

    const dir = path.join(OUT_DIR, kind);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    let bytes = 0;
    const cells = {};
    for (const [key, rows] of [...buckets].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const json = JSON.stringify(rows);
      fs.writeFileSync(path.join(dir, `${key}.json`), json);
      bytes += json.length;
      cells[key] = rows.length;
    }

    summary.kinds[kind] = { count: all.length, cells: buckets.size, bytes };
    console.log(
      `[${kind}] ${all.length}건 · 격자 ${buckets.size}개 · ${(bytes / 1024 / 1024).toFixed(1)}MB · ${(
        (Date.now() - started) / 1000
      ).toFixed(0)}초`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(summary, null, 2));
  console.log('\n완료:', path.relative(ROOT, OUT_DIR));
}

run().catch((e) => {
  console.error('수집 실패:', e.message);
  process.exit(1);
});
