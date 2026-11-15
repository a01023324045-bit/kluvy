// 예진 근무의 편명 통계 (v2.5.1) — 순수 함수, DOM 없음
//   "12월 근무표를 등록했는데 편명이 하나도 안 들어왔다" 제보 → 반영 직후 요약 바에
//   `✈️ 편명 24개 · 비행일 18일 중 3일은 편명 없음` 처럼 보여 주기 위한 계산.
//   통계는 '이 달 달력(scheduleDB)에 실제로 들어 있는 값' 기준이다 (수동 입력·이전 값 포함).
import { gfFlights } from './flight.js';
import { makeDateKey } from './dates.js';

const md = key => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

/**
 * 사진에서 '체류'로만 읽고 시각·편명·L/O 시각·칸 글자(cellText)가 하나도 없는 칸 (v2.5.1).
 *  실제 12월 사진 12/10 이 이렇게 들어왔다 — AI 가 '청주 (체류)' 만 돌려주고 시각·편명은 빠뜨려 L/O 만 있는 날(isPureStay)처럼 보인다.
 *  진짜 L/O 날은 'L/O 17:00~17:50' 시각이 칸에 있어 layovers 가 있으므로 구별된다. ✋ 수동 입력 칸은 제외.
 */
export function isThinStay(gf) {
  if (!gf || typeof gf !== 'object' || gf.manual) return false;
  if (String(gf.type || '').trim() !== '체류' || !gf.isPureStay || gf.isArrivalOnly) return false;
  const lay = Array.isArray(gf.layovers) ? gf.layovers : (gf.layovers && typeof gf.layovers === 'object' ? Object.values(gf.layovers) : []);
  return !gf.start && !gf.end && !String(gf.flight || '').trim() && !lay.length;
}

/**
 * 비행 근무일인가: 퀵턴·체류 중 편명이 있어야 하는 날.
 * L/O 만 있는 날(isPureStay)·전날 출발해 오늘 착륙만 하는 날(isArrivalOnly)·OFF·대기·TR 은 제외.
 * 단, 시각·편명이 모두 비어 '체류'로만 읽힌 칸(isThinStay)은 읽다 만 비행일로 본다.
 */
export function isFlightDuty(gf) {
  if (!gf || typeof gf !== 'object') return false;
  const t = String(gf.type || '').trim();
  if (t !== '체류' && t !== '퀵턴') return false;
  if (isThinStay(gf)) return true;
  return !gf.isPureStay && !gf.isArrivalOnly;
}

/**
 * 한 달의 편명 통계.
 * @returns {{year:number, month:number, flightDays:number, flightCount:number, missingDays:string[], days:{dateKey:string, flights:string[], thin:boolean}[]}}
 *   flightDays: 비행 근무일 수 / flightCount: 읽은 편명 개수(레그 수) / missingDays: 편명이 없는 비행일 / days: 비행일별 편명(TW721 …)
 */
export function flightStatsForMonth(db, year, month) {
  const last = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const dateKey = makeDateKey(year, month, d);
    const gf = db && db[dateKey] && db[dateKey].gf;
    if (!isFlightDuty(gf)) continue;
    days.push({ dateKey, flights: gfFlights(gf).map(l => l.iata), thin: isThinStay(gf) });
  }
  return {
    year, month,
    flightDays: days.length,
    flightCount: days.reduce((n, x) => n + x.flights.length, 0),
    missingDays: days.filter(x => !x.flights.length).map(x => x.dateKey),
    days
  };
}

/**
 * 요약 한 줄. 비행일이 없으면 ''.
 *  - 모두 있음: ✈️ 편명 24개 · 비행일 18일 모두 편명 있음
 *  - 일부 없음: ✈️ 편명 24개 · 비행일 18일 중 3일은 편명 없음
 *  - 하나도 없음: ⚠️ ✈️ 편명 0개 · 비행일 18일 중 18일은 편명 없음
 */
export function flightStatsText(st) {
  if (!st || !st.flightDays) return '';
  const miss = st.missingDays.length;
  const base = `✈️ 편명 ${st.flightCount}개 · 비행일 ${st.flightDays}일`;
  if (!miss) return `${base} 모두 편명 있음`;
  return `${st.flightCount === 0 ? '⚠️ ' : ''}${base} 중 ${miss}일은 편명 없음`;
}

/** [자세히] 줄: 날짜별로 읽은 편명 ('12/3 TW721/TW806', 없으면 '12/5 편명 없음') */
export function flightStatsDetails(st) {
  if (!st || !st.flightDays) return [];
  const out = [`✈️ 날짜별 편명 (비행일 ${st.flightDays}일 · 편명 ${st.flightCount}개)`];
  for (const d of st.days) out.push(`${md(d.dateKey)} ${d.flights.length ? d.flights.join('/') : (d.thin ? '편명 없음 (시각도 비어 있음 — 체류로만 읽힘)' : '편명 없음')}`);
  return out;
}

/** 편명 다시 읽기 버튼이 필요한가 (편명 없는 비행일이 있음) */
export function needsFlightReread(st) {
  return Boolean(st && st.flightDays > 0 && st.missingDays.length > 0);
}
