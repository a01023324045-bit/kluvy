// 근무 데이터 모델 공통 규칙 (렌더링·추천·파서·편집이 함께 쓰는 판정 함수)
//
import { HOLIDAYS } from './holidays.js';
import { weekdayOfKey } from './dates.js';

// 데이터 구조 (Firebase schedules/{YYYY-MM-DD} — 필드 의미 변경 금지, 추가만)
//   my : { type, start, end, manual?, editedAt? }     규호  (manual/editedAt: 3단계 — 편집창에서 직접 넣은 값 표시)
//   gf : { type, destination, start, end, flight?, isQuickTurn, isPureStay?, isInbound?,
//          isArrivalOnly?, isNightTurn?, isStayBase?, manual?, editedAt?, timesFrom? } 예진
//        (timesFrom: 'flightTimes' = 시각이 빠진 비행을 편명 시간표로 채움)
//   date : { time: "HH:MM~HH:MM", memo } | null       데이트
//   myPromise / gfPromise : string                    개인 약속

/** 규호 휴무 코드 */
export const KYUHO_OFF_TYPES = ['O', '대휴', '연차', '휴가'];

/**
 * 석근 계열(석근·석5)의 '휴일' 판정에 토·일을 포함하는가. (2026-11-13 사용자 확정: 토·일도 15:00~21:00)
 * 사용자 확정: "석근도 공휴일일 때 공휴일석근(15:00~21:00)". 조근은 주말·공휴일 모두 05~09 로 확정돼 있어 같은 기준(true)으로 둔다.
 * 주말은 평일 석근(13~21)이 맞다고 하면 false 로 바꾸면 된다 (엑셀·사진·마이그레이션 모두 이 값을 따름).
 */
export const HOLIDAY_SEOK_INCLUDES_WEEKEND = true;

/**
 * 규호 근무 사전 — 근무명 → 기본 시간·계열(kind). 엑셀 파서·편집창 자동시간·추천·색상이 모두 이 표를 쓴다.
 *  kind: jo(조근 계열) · seok(석근 계열) · il(일근) · off(쉬는 날)
 *  석5 = 석근과 같은 시간, 근무 사무실만 다름 (표시명 '석5' 유지)
 */
export const KYUHO_SHIFTS = Object.freeze({
  조근: { start: '05:00', end: '13:00', kind: 'jo' },
  평일조근: { start: '05:00', end: '13:00', kind: 'jo' },
  공휴일조근: { start: '05:00', end: '09:00', kind: 'jo' },
  석근: { start: '13:00', end: '21:00', kind: 'seok' },
  공휴일석근: { start: '15:00', end: '21:00', kind: 'seok' },
  석5: { start: '13:00', end: '21:00', kind: 'seok' },
  공휴일석5: { start: '15:00', end: '21:00', kind: 'seok' },
  석1: { start: '12:00', end: '20:00', kind: 'seok' },
  일근: { start: '09:00', end: '18:00', kind: 'il' }
});

/** 토·일·법정공휴일인가 (includeWeekend=false 면 공휴일만) — 공휴일조근·공휴일석근 판정 공통 */
export function isKyuhoHoliday(dateKey, holidays = HOLIDAYS, includeWeekend = true) {
  const dow = weekdayOfKey(dateKey);
  return (includeWeekend && (dow === 0 || dow === 6)) || Boolean(holidays[dateKey]);
}

/** 규호 근무 계열: off | jo | seok | il | other | none */
export function kyuhoKind(type) {
  const t = String(type || '').trim();
  if (!t || t === '-') return 'none';
  if (KYUHO_OFF_TYPES.includes(t)) return 'off';
  if (KYUHO_SHIFTS[t]) return KYUHO_SHIFTS[t].kind;
  if (t.includes('석')) return 'seok';
  if (t.includes('조근')) return 'jo';
  return 'other';
}

/** 예진 근무 계열: off | quick | stay | standby | tr | other | none (달력 색상과 같은 판정) */
export function gfKind(gf) {
  if (!gf || !gf.type) return 'none';
  const t = String(gf.type);
  if (t === 'OFF') return 'off';
  if (t === '퀵턴' || gf.isQuickTurn) return 'quick';
  if (t === '체류' || t === 'L/O' || t === '비행') return 'stay';
  if (t.includes('SB') || t.includes('IS') || t.includes('GS')) return 'standby';
  if (t === 'TR') return 'tr';
  return 'other';
}

// ---------------- 수동 입력 표시 (3단계) ----------------
// 편집창(단일·일괄)으로 넣은 근무에는 manual:true + editedAt(ms) 를 남긴다.
// 근무표 업로드(엑셀·사진·간편 텍스트)는 이 표시가 있는 칸을 기본으로 덮지 않는다(미리보기에서 체크하면 덮어씀).
// 플래그 없는 옛 데이터는 수동 여부를 알 수 없으므로 '변경' 표시만 한다.
const FLAG_FIELDS = ['manual', 'editedAt', 'timesFrom'];

export function isManual(v) {
  return Boolean(v && typeof v === 'object' && v.manual === true);
}

export function markManual(v, at = Date.now()) {
  return { ...v, manual: true, editedAt: at };
}

/** 업로드로 넣는 값: 수동 표시 제거 */
export function stripManual(v) {
  if (!v || typeof v !== 'object') return v;
  const { manual, editedAt, ...rest } = v; // eslint-disable-line no-unused-vars
  return rest;
}

/** 비교용 핵심 내용: 표시 필드·빈 값('' / false / null) 제거 */
export function dutyCore(v) {
  if (!v || typeof v !== 'object') return null;
  const o = {};
  for (const k of Object.keys(v).sort()) {
    if (FLAG_FIELDS.includes(k)) continue;
    const x = v[k];
    if (x === '' || x === false || x === null || x === undefined) continue;
    o[k] = x;
  }
  return Object.keys(o).length ? o : null;
}

/** 근무 내용이 같은가 (수동 표시·빈 값 차이는 무시) */
export function sameDuty(a, b) {
  return JSON.stringify(dutyCore(a)) === JSON.stringify(dutyCore(b));
}

/** 예진 공항 대기 코드: 인천(IS?)·김포(GS?) + 근무조 알파벳 (ISA, ISB, ISC, ISD, GSA, GSB, GSC, GSD …) */
export const AIRPORT_STANDBY_RE = /^(IS|GS)[A-Z]$/;

/** 자동 기본시간 (사진/입력에 시간이 없을 때만 사용). GSA 는 원 대화에서 05:00~10:00 으로 확정. */
export const GF_DEFAULT_TIMES = {
  SBY: ['06:00', '19:00'],
  ISA: ['06:30', '11:30'],
  ISD: ['18:30', '21:30'],
  GSA: ['05:00', '10:00'],
  TR: ['08:00', '17:00']
};

export function isAirportStandby(type) {
  return AIRPORT_STANDBY_RE.test(String(type || ''));
}

/** 노란색 대기 계열 (SBY + 공항 대기) — 달력 색상 판정과 같은 기준 */
export function isStandbyType(type) {
  const t = String(type || '');
  return t.includes('SB') || t.includes('IS') || t.includes('GS');
}

/**
 * 자유 문자열에서 예진 대기/공항대기 코드 추출. 예: "GSD" → "GSD", "isb 대기" → "ISB", "SBY" → "SBY"
 * 공항 대기 코드가 SBY 보다 우선. 못 찾으면 null.
 */
export function extractStandbyCode(raw) {
  const s = String(raw || '').toUpperCase();
  const m = s.match(/(?:^|[^A-Z])((?:IS|GS)[A-Z])(?![A-Z])/);
  if (m) return m[1];
  if (s.includes('SBY')) return 'SBY';
  return null;
}

/** 대기 코드의 기본 시간 [start, end] (없으면 ['', '']) */
export function defaultTimesFor(code) {
  return GF_DEFAULT_TIMES[code] ? [...GF_DEFAULT_TIMES[code]] : ['', ''];
}

export function isStayFlight(dest) {
  if (!dest) return false;
  const stayDestinations = [
    "로마", "파리", "바르셀로나", "프랑크푸르트", "밴쿠버", "비슈케크", "자카르타",
    "싱가포르", "다낭", "나트랑", "푸꾸옥", "사이판", "세부", "치앙마이", "방콕",
    "칼리보", "부산", "제주체류"
  ];
  return stayDestinations.some(d => dest.includes(d));
}

export function calculateBarPosition(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  let [eh, em] = endTime.split(':').map(Number);
  if (eh < sh) eh += 24;

  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const totalMin = 24 * 60;

  const left = Math.max(0, Math.min(100, (startMin / totalMin) * 100));
  const width = Math.max(3, Math.min(100 - left, ((endMin - startMin) / totalMin) * 100));
  return { left, width };
}

// ---------------- 편집 저장 규칙 ----------------

/**
 * 수동 편집으로 만든 gf 를 기존 gf 와 합친다.
 * - 근무 형태(type)가 같으면 편명(flight)·귀국편(isInbound)·체류기지(isStayBase) 등 편집창에 없는 필드를 보존한다.
 * - 시간을 새로 넣었으면 '도착일만(isArrivalOnly)' 표시는 해제, 시간이 바뀌었으면 심야퀵턴 여부를 다시 계산.
 * - 형태가 바뀌면 새 값만 사용 (이전 비행의 부가정보가 엉뚱하게 남지 않도록).
 */
export function mergeGf(prevGf, newGf) {
  if (!prevGf || typeof prevGf !== 'object' || prevGf.type !== newGf.type) return { ...newGf };
  const merged = { ...prevGf, ...newGf };
  if (merged.isArrivalOnly && (newGf.start || newGf.end)) merged.isArrivalOnly = false;
  const timesChanged = (prevGf.start || '') !== (newGf.start || '') || (prevGf.end || '') !== (newGf.end || '');
  if (timesChanged && 'isNightTurn' in prevGf) {
    merged.isNightTurn = Boolean(newGf.isQuickTurn) && (String(newGf.destination || '').includes('우한') || Boolean(newGf.end && newGf.end <= '06:00'));
  }
  return merged;
}

/** my 도 같은 원칙으로 (현재 my 에는 부가 필드가 없지만 2단계 확장 대비) */
export function mergeMy(prevMy, newMy) {
  if (!prevMy || typeof prevMy !== 'object' || prevMy.type !== newMy.type) return { ...newMy };
  return { ...prevMy, ...newMy };
}

/**
 * 편집 내용을 여러 날짜에 적용 (단일 수정 = 날짜 1개, 일괄 수정 = 기간).
 * @param {object} scheduleDB  수정할 DB (직접 변경)
 * @param {string[]} dateKeys
 * @param {{my:object, gf:object, date:object|null, myPromise:string, gfPromise:string}} payload
 * @param {{kyuho:boolean, yejin:boolean, plan:boolean}} targets  덮어쓸 대상 (선택 안 한 항목은 손대지 않음)
 * @param {{manualAt?:number}} [opts]  manualAt 이 있으면 규호·예진 근무에 수동 입력 표시(manual/editedAt)
 * @returns {number} 적용한 날짜 수
 */
export function applyEditToDates(scheduleDB, dateKeys, payload, targets = { kyuho: true, yejin: true, plan: true }, opts = {}) {
  let n = 0;
  const mark = v => (opts.manualAt ? markManual(v, opts.manualAt) : v);
  for (const key of dateKeys) {
    if (!scheduleDB[key]) scheduleDB[key] = {};
    const day = scheduleDB[key];
    if (targets.kyuho) day.my = mark(mergeMy(day.my, payload.my));
    if (targets.yejin) day.gf = mark(mergeGf(day.gf, payload.gf));
    if (targets.plan) {
      day.date = payload.date ? { ...payload.date } : null;
      day.myPromise = payload.myPromise;
      day.gfPromise = payload.gfPromise;
    }
    n++;
  }
  return n;
}

// ---------------- 석근 계열 휴일 규칙 마이그레이션 (3단계, 1회성·멱등) ----------------
/**
 * 저장된 규호 근무를 새 규칙으로 보정한다. 수동 입력(manual) 표시가 있는 값은 건드리지 않는다.
 *  - 휴일(isKyuhoHoliday, 석근 기준)에 저장된 '석근 13:00~21:00' → '공휴일석근 15:00~21:00'
 *  - 시간 없이 저장된 '석5'(1·2단계 파서가 시간을 몰랐음) → 평일 '석5 13~21' / 휴일 '공휴일석5 15~21'
 * 다시 돌려도 바뀌는 것이 없다(멱등). 두 폰이 동시에 돌려도 같은 값을 같은 칸(my)에 쓰므로 안전.
 * @returns {string[]} 바꾼 날짜
 */
export function migrateKyuhoSeokRules(scheduleDB, holidays = HOLIDAYS, includeWeekend = HOLIDAY_SEOK_INCLUDES_WEEKEND) {
  const changed = [];
  for (const [key, day] of Object.entries(scheduleDB || {})) {
    const my = day && day.my;
    if (!my || typeof my !== 'object' || isManual(my) || !/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const type = String(my.type || '').trim();
    const hol = isKyuhoHoliday(key, holidays, includeWeekend);
    let next = null;
    if (type === '석근' && my.start === '13:00' && my.end === '21:00' && hol) next = { type: '공휴일석근', ...KYUHO_SHIFTS.공휴일석근 };
    else if (type === '석5' && !my.start && !my.end) next = hol ? { type: '공휴일석5', ...KYUHO_SHIFTS.공휴일석5 } : { type: '석5', ...KYUHO_SHIFTS.석5 };
    if (!next) continue;
    const { kind, ...times } = next; // eslint-disable-line no-unused-vars
    day.my = { ...my, ...times };
    changed.push(key);
  }
  return changed;
}
