/**
 * apis.data.go.kr 게이트웨이가 살아나는 순간을 기다렸다가 수집을 시작한다.
 *
 * 이전 큐는 매 시도마다 실제 수집(10분 소요)을 돌려서 장애 중에 자원을 크게 낭비했다.
 * 여기서는 값싼 헬스 체크만 주기적으로 하고, 통과했을 때만 수집기를 부른다.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:https';

const TARGETS = [
  ['경기도', '하남시'],
  ['경기도', '성남시분당구'],
  ['경기도', '성남시수정구'],
  ['경기도', '성남시중원구'],
];
const PROBE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_WAIT_MS = 12 * 60 * 60 * 1000;

const ts = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`${ts()} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** TLS 핸드셰이크까지만 확인한다. 인증키를 쓰지 않으므로 호출 한도를 소모하지 않는다. */
function probe() {
  return new Promise((resolve) => {
    const req = request(
      { host: 'apis.data.go.kr', port: 443, path: '/', method: 'HEAD', timeout: 8000 },
      (res) => { res.resume(); resolve({ ok: true, detail: `HTTP ${res.statusCode}` }); },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: '연결 타임아웃' }); });
    req.on('error', (e) => resolve({ ok: false, detail: e.code || e.message }));
    req.end();
  });
}

function collect(sido, sigungu) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/fetch-data.mjs', '--sido', sido, '--sigungu', sigungu], {
      stdio: 'inherit',
    });
    p.on('close', (code) => resolve(code === 0));
  });
}

const startedAt = Date.now();
let round = 0;

while (Date.now() - startedAt < MAX_WAIT_MS) {
  round += 1;
  const { ok, detail } = await probe();
  log(`헬스체크 ${round}: ${ok ? '통과' : '실패'} (${detail})`);

  if (ok) {
    log('게이트웨이 복구 감지 — 수집 시작');
    const failed = [];
    for (const [sido, sigungu] of TARGETS) {
      log(`--- ${sido} ${sigungu} ---`);
      if (await collect(sido, sigungu)) log(`${sigungu} 수집 완료`);
      else { log(`${sigungu} 수집 실패`); failed.push(sigungu); }
    }
    if (failed.length === 0) { log('전체 수집 완료'); break; }
    log(`일부 실패(${failed.join(', ')}) — 계속 대기`);
  }

  await sleep(PROBE_INTERVAL_MS);
}

log('감시 종료');
