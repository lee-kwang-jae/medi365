import { HOLIDAYS, HOLIDAY_SEASONS } from './constants.js';

/**
 * 응급의료포털(E-Gen) 진료시간 필드 규칙
 * ------------------------------------------------------------------
 *  dutyTime1s ~ dutyTime8s : 요일별 진료 "시작" 시각 (HHMM)   ← QT31~QT38
 *  dutyTime1c ~ dutyTime8c : 요일별 진료 "종료" 시각 (HHMM)   ← QT41~QT48
 *      1=월 2=화 3=수 4=목 5=금 6=토 7=일 8=공휴일
 *
 *  Open API 요청 파라미터(QT)로는 "요일"까지만 좁힐 수 있고 시:분 단위
 *  영업 여부는 걸러주지 않는다. 따라서 요일은 QT 로 서버에서 좁히고,
 *  현재 시각(HHMM) 기준 실제 영업 여부는 위 응답 필드로 클라이언트에서 판정한다.
 */

export const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 공휴일 여부 */
export function isHoliday(date) {
  return HOLIDAYS.has(toDateKey(date));
}

/** 설·추석 연휴 기간인지 (명절 비상진료 API 호출 여부를 가른다) */
export function isHolidaySeason(date) {
  return HOLIDAY_SEASONS.has(toDateKey(date));
}

/** Date → 'YYYYMMDD' (명절 API 의 QT 파라미터 형식) */
export function toCompactDate(date) {
  return toDateKey(date).replace(/-/g, '');
}

/**
 * 명절 API 의 진료시간 문자열('09:00~17:00')을 내부 hours 모델로 변환한다.
 * 시간 형식이 아닌 값(예: '24시간')은 문구를 그대로 보존한다.
 */
export function parseHolidayTime(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2}):?(\d{2})\s*[~\-–]\s*(\d{1,2}):?(\d{2})/);
  if (!m) return { note: String(raw).trim() };

  const startRaw = `${m[1].padStart(2, '0')}${m[2]}`;
  const endRaw = `${m[3].padStart(2, '0')}${m[4]}`;
  const start = parseHHMM(startRaw);
  let end = parseHHMM(endRaw);
  if (start == null || end == null) return { note: String(raw).trim() };
  if (end <= start) end += 24 * 60; // 익일까지 운영
  return { start, end, startRaw, endRaw };
}

/**
 * E-Gen 요일 코드 (1=월 … 7=일, 8=공휴일)
 * @param {Date} date
 * @param {boolean} [holidayAware=true] 공휴일이면 8을 반환할지 여부
 */
export function getDayCode(date, holidayAware = true) {
  if (holidayAware && isHoliday(date)) return 8;
  const day = date.getDay(); // 0=일 … 6=토
  return day === 0 ? 7 : day;
}

/** 공휴일 데이터가 비어 있을 때 되돌아갈 실제 요일 코드 */
export function getWeekdayCode(date) {
  return getDayCode(date, false);
}

/** 하루 전 요일 코드 (심야영업 판정용) */
export function getPrevDayCode(date) {
  const prev = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  return getDayCode(prev);
}

/** Date → 자정 기준 경과 분 */
export function toMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** 'HHMM' → 분. 유효하지 않으면 null */
export function parseHHMM(value) {
  if (!value) return null;
  const s = String(value).replace(/\D/g, '');
  if (s.length !== 4 && s.length !== 3) return null;
  const padded = s.padStart(4, '0');
  const h = Number(padded.slice(0, 2));
  const m = Number(padded.slice(2, 4));
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  return h * 60 + m; // 24시 이상(2400 등)도 그대로 허용
}

/** 'HHMM' → 'HH:MM' */
export function formatHHMM(value) {
  const min = parseHHMM(value);
  if (min == null) return '';
  // '2400'(자정 마감)은 '00:00' 이 아니라 '24:00' 으로 보여야 뜻이 통한다
  const h = min === 1440 ? 24 : Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 특정 요일 코드의 영업시간을 꺼낸다.
 * 공휴일(8) 정보가 없으면 실제 요일 시간표로 되돌아간다.
 * @returns {{code:number, start:number, end:number, startRaw:string, endRaw:string}|null}
 */
export function getHours(item, code) {
  const tryCode = (c) => {
    const startRaw = item[`dutyTime${c}s`];
    const endRaw = item[`dutyTime${c}c`];
    const start = parseHHMM(startRaw);
    let end = parseHHMM(endRaw);
    if (start == null || end == null) return null;
    // 종료가 시작보다 이르면 익일까지 영업(심야) 으로 간주
    if (end <= start) end += 24 * 60;
    return { code: c, start, end, startRaw, endRaw };
  };

  return tryCode(code);
}

/**
 * 오늘(또는 지정 요일)의 영업시간. 공휴일 데이터가 없으면 평일 시간표로 폴백.
 */
export function getTodayHours(item, date = new Date()) {
  const code = getDayCode(date);
  const primary = getHours(item, code);
  if (primary) return primary;
  if (code === 8) return getHours(item, getWeekdayCode(date)); // 공휴일 정보 미등록 → 평일표
  return null;
}

/** 'HH:MM ~ HH:MM' 형태의 표기 (없으면 '정보 없음') */
export function formatHoursLabel(hours) {
  if (!hours) return '영업시간 정보 없음';
  if (hours.note) return hours.note; // 명절 API 의 자유 문구 (예: '24시간')
  const s = formatHHMM(hours.startRaw);
  const e = formatHHMM(hours.endRaw);
  const overnight = hours.end > 24 * 60 ? ' (익일)' : '';
  return `${s} ~ ${e}${overnight}`;
}

/**
 * 지금 이 시각에 영업 중인지 판정한다.
 *  - 오늘 시간표 안에 들어오는 경우
 *  - 어제 심야영업(익일 새벽까지)이 아직 이어지는 경우
 * @returns {{open:boolean, unknown:boolean, hours:object|null}}
 */
export function getOpenState(item, date = new Date()) {
  const now = toMinutes(date);
  const today = getTodayHours(item, date);

  if (today && now >= today.start && now < today.end) {
    return { open: true, unknown: false, hours: today };
  }

  // 어제 심야영업이 오늘 새벽까지 이어지는지 확인
  const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1000);
  const prev = getTodayHours(item, yesterday);
  if (prev && prev.end > 24 * 60 && now + 24 * 60 < prev.end) {
    return { open: true, unknown: false, hours: today ?? prev };
  }

  if (!today) return { open: false, unknown: true, hours: null };
  return { open: false, unknown: false, hours: today };
}

/** 'HH:MM' 현재 시각 문자열 */
export function nowLabel(date = new Date()) {
  const day = DAY_LABELS[date.getDay()];
  const holiday = isHoliday(date) ? ' · 공휴일' : '';
  return `${date.getMonth() + 1}/${date.getDate()}(${day})${holiday} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
