// 데이트 추천 (2단계: 시간 겹침 계산)
// 날짜마다 두 사람의 '못 만나는 구간'을 KST 분 단위로 만든다(자정 넘는 근무·체류·귀국 착륙 + 이동 여유 포함).
// 활동 시간대(기본 09:00~24:00)에서 그 구간들을 빼고, 남는 구간 중 최소 길이(기본 3시간) 이상을 추천한다.
// 규칙·가정치는 recommend-rules.js 에 데이터로 모여 있다.
import { isAirportStandby, defaultTimesFor } from './schedule-model.js';
import { makeDateKey } from './dates.js';
import { getKstDiffHours } from './timezone.js';
import { ASSUMPTIONS, KYUHO_RULES, RECO_DEFAULTS } from './recommend-rules.js';

const DAY = 1440;

/** "HH:MM" → 분 (잘못된 값은 null). "24:00" 허용 */
export function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}
export function fmtMin(m) {
  const d = ((m % DAY) + DAY) % DAY;
  const v = (m > 0 && d === 0) ? DAY : d;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 날짜 키 → 절대 일 번호 (UTC 기준, 폰 시간대와 무관) */
export function dayIndex(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function keyOfIndex(idx) {
  const dt = new Date(idx * 86400000);
  return makeDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 시작~끝(분, 같은 날 기준). 끝이 시작보다 이르면 다음 날로 넘어간 것 */
function span(base, start, end) {
  const s = base + start;
  let e = base + end;
  if (e <= s) e += DAY;
  return [s, e];
}

/**
 * 규호 하루의 못 만나는 구간들 (절대 분). 근무를 모르면 null.
 * @returns {{busy:[number,number][], off:boolean, note:string}|null}
 */
export function kyuhoBusy(dateKey, my, A = ASSUMPTIONS) {
  const type = my && my.type ? String(my.type).trim() : '';
  if (!type || type === '-') return null;
  const base = dayIndex(dateKey) * DAY;
  const rule = KYUHO_RULES[type];
  if (rule && rule.off) return { busy: [], off: true, note: `규호 ${type}` };
  let s = toMin(my.start); let e = toMin(my.end);
  if ((s === null || e === null) && rule) { s = toMin(rule.start); e = toMin(rule.end); }
  if (s === null || e === null) return { busy: [[base, base + DAY]], off: false, note: `규호 ${type}(시간 미정)` };
  const [as, ae] = span(base, s, e);
  return { busy: [[as - A.kyuhoPreWorkMin, ae + A.kyuhoPostWorkMin]], off: false, note: `규호 ${type} ${fmtMin(s)}~${fmtMin(e)}` };
}

const isStay = gf => Boolean(gf) && (gf.type === '체류' || String(gf.type || '').toUpperCase() === 'L/O');
const isOal = gf => /OAL/i.test(`${gf.type || ''} ${gf.destination || ''} ${gf.flight || ''}`);

/**
 * 예진 하루의 못 만나는 구간들 (절대 분, 다음 날로 넘어갈 수 있음). 근무를 모르면 null.
 * @param {object} ctx { prev: 전날 gf, next: 다음 날 gf, prevKey }
 */
export function yejinBusy(dateKey, gf, ctx = {}, A = ASSUMPTIONS) {
  const type = gf && gf.type ? String(gf.type).trim() : '';
  if (!type || type === '-') return null;
  const base = dayIndex(dateKey) * DAY;
  const whole = (note) => ({ busy: [[base, base + DAY]], off: false, note });
  const s = toMin(gf.start); const e = toMin(gf.end);
  const up = type.toUpperCase();

  if (up.includes('OFF')) return { busy: [], off: true, note: '예진 OFF' };

  if (up === 'SBY') {
    return { busy: [[base, base + toMin(A.yejinHomeSbyFreeFrom)]], off: false, note: `예진 자가 SBY → ${A.yejinHomeSbyFreeFrom}~` };
  }

  if (isAirportStandby(up)) {
    let [ds, de] = [s, e];
    if (ds === null || de === null) { const [a, b] = defaultTimesFor(up); ds = toMin(a); de = toMin(b); }
    if (ds === null || de === null) return whole(`예진 ${up}(시간 미정)`);
    const [as, ae] = span(base, ds, de);
    return { busy: [[as - A.yejinPreDutyMin, ae + A.yejinStandbyPostMin]], off: false, note: `예진 ${up} ${fmtMin(ds)}~${fmtMin(de)}` };
  }

  if (up === 'TR' || type.includes('훈련')) {
    let [ds, de] = [s, e];
    if (ds === null || de === null) { const [a, b] = defaultTimesFor('TR'); ds = toMin(a); de = toMin(b); }
    const [as, ae] = span(base, ds, de);
    return { busy: [[as - A.yejinPreDutyMin, ae + A.yejinTrPostMin]], off: false, note: `예진 TR ${fmtMin(ds)}~${fmtMin(de)}` };
  }

  if (isOal(gf)) {
    if (e === null) return whole('예진 OAL 복귀(시간 미정)');
    const end = base + e + (s !== null && e <= s ? DAY : 0);
    return { busy: [[base, end + A.yejinFlightPostMin]], off: false, note: `예진 OAL 복귀 ${fmtMin(e)} 착` };
  }

  if (isStay(gf)) {
    if (gf.isPureStay || up === 'L/O') return whole(`예진 체류 중(${gf.destination || 'L/O'})`);
    if (gf.isInbound) {
      // 출발은 현지시각 → KST, 착륙(end)은 인천(KST)
      const diff = getKstDiffHours(gf.destination || '', dateKey); // 현지 - KST (시간)
      const depKst = s === null ? base : base + s - Math.round((diff || 0) * 60);
      if (e === null) return { busy: [[base, base + DAY]], off: false, note: `예진 ${gf.destination} 귀국(착륙 미정)` };
      let land = base + e;
      while (land <= depKst) land += DAY;
      return { busy: [[base, land + A.yejinInboundRestMin]], off: false, note: `예진 ${gf.destination} 귀국 ${fmtMin(land)} KST 착륙` };
    }
    if (gf.isArrivalOnly) {
      const prev = ctx.prev;
      if (prev && prev.isInbound && toMin(prev.end) !== null) return { busy: [], off: false, note: '예진 도착일(전날 귀국편으로 계산)' };
      return { busy: [[base, base + toMin(A.yejinArrivalOnlyFreeFrom)]], off: false, note: `예진 도착일 → ${A.yejinArrivalOnlyFreeFrom}~` };
    }
    const prevStay = isStay(ctx.prev) && !ctx.prev.isInbound && !ctx.prev.isArrivalOnly;
    if (prevStay && !isStay(ctx.next)) {
      // 연속 체류의 마지막 날(지방 N레그 복귀 등): 착륙 시각(국내 = KST) + 여유까지
      if (e === null) return whole(`예진 ${gf.destination} 체류 마지막 날(시간 미정)`);
      return { busy: [[base, base + e + A.yejinFlightPostMin]], off: false, note: `예진 ${gf.destination} 복귀 ${fmtMin(e)} 착` };
    }
    if (prevStay) return whole(`예진 ${gf.destination} 체류 중`);
    // 출발일: 쇼업 전까지는 가능, 그 뒤로는 그날 끝까지 불가 (다음 날은 그날 기록으로 판단)
    if (s === null) return whole(`예진 ${gf.destination} 출발(시간 미정)`);
    return { busy: [[base + s - A.yejinPreDutyMin, base + DAY]], off: false, note: `예진 ${gf.destination} 출발 ${fmtMin(s)}` };
  }

  if (up === '퀵턴' || gf.isQuickTurn) {
    if (s === null || e === null) return whole(`예진 퀵턴 ${gf.destination || ''}(시간 미정)`);
    const [as, ae] = span(base, s, e);
    const night = Boolean(gf.isNightTurn) || ae > base + DAY || e <= toMin('06:00');
    const busy = [as - A.yejinPreDutyMin, ae + A.yejinFlightPostMin];
    if (night) {
      const arrivalDayBase = Math.floor(ae / DAY) * DAY;
      busy[1] = Math.max(busy[1], arrivalDayBase + toMin(A.yejinNightTurnFreeFrom));
      return { busy: [busy], off: false, note: `예진 심야 퀵턴 ${gf.destination || ''} ${fmtMin(s)}~${fmtMin(e)} → 도착일 ${A.yejinNightTurnFreeFrom}~` };
    }
    return { busy: [busy], off: false, note: `예진 퀵턴 ${gf.destination || ''} ${fmtMin(s)}~${fmtMin(e)}` };
  }

  // 그 밖의 직접 입력(교육 등)
  if (s !== null && e !== null) {
    const [as, ae] = span(base, s, e);
    return { busy: [[as - A.yejinPreDutyMin, ae + A.yejinTrPostMin]], off: false, note: `예진 ${type} ${fmtMin(s)}~${fmtMin(e)}` };
  }
  return whole(`예진 ${type}(시간 미정)`);
}

/** 구간 합치기 */
function mergeIntervals(list) {
  const a = list.filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, e] of a) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}

/** window 에서 busy 를 뺀 남는 구간 */
export function subtractIntervals([ws, we], busy) {
  let free = [[ws, we]];
  for (const [bs, be] of mergeIntervals(busy)) {
    const next = [];
    for (const [fs, fe] of free) {
      if (be <= fs || bs >= fe) { next.push([fs, fe]); continue; }
      if (bs > fs) next.push([fs, bs]);
      if (be < fe) next.push([be, fe]);
    }
    free = next;
  }
  return free;
}

export function normalizePrefs(p = {}) {
  const as = toMin(p.activeStart) ?? toMin(RECO_DEFAULTS.activeStart);
  let ae = toMin(p.activeEnd) ?? toMin(RECO_DEFAULTS.activeEnd);
  if (ae <= as) ae = toMin(RECO_DEFAULTS.activeEnd);
  const mh = Number(p.minHours);
  return { activeStart: fmtMin(as), activeEnd: ae === DAY ? '24:00' : fmtMin(ae), minHours: mh > 0 && mh <= 15 ? mh : RECO_DEFAULTS.minHours, _as: as, _ae: ae };
}

/**
 * 한 달 추천.
 * @returns {{day:number, type:'종일'|'오후'|'저녁'|'여행', text:string, slots?:{start:string,end:string}[], days?:number[], reasons?:string[]}[]}
 */
export function computeAvailableDays(scheduleDB, currentYear, currentMonth, prefs = RECO_DEFAULTS, A = ASSUMPTIONS) {
  const P = normalizePrefs(prefs);
  const totalDays = new Date(currentYear, currentMonth, 0).getDate();
  const firstIdx = dayIndex(makeDateKey(currentYear, currentMonth, 1));
  // 전날(자정 넘는 근무·귀국) 부터 계산
  const busyK = []; const busyY = [];
  const info = {};
  for (let idx = firstIdx - 1; idx < firstIdx + totalDays; idx++) {
    const key = keyOfIndex(idx);
    const day = scheduleDB[key] || {};
    const ctx = { prev: (scheduleDB[keyOfIndex(idx - 1)] || {}).gf, next: (scheduleDB[keyOfIndex(idx + 1)] || {}).gf };
    const k = day.my ? kyuhoBusy(key, day.my, A) : null;
    const y = day.gf ? yejinBusy(key, day.gf, ctx, A) : null;
    if (k) busyK.push(...k.busy);
    if (y) busyY.push(...y.busy);
    info[idx] = { k, y };
  }
  const minLen = Math.round(P.minHours * 60);
  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    const idx = firstIdx + d - 1;
    const { k, y } = info[idx];
    if (!k || !y) continue; // 한 사람이라도 근무를 모르면 추천하지 않음
    const base = idx * DAY;
    const win = [base + P._as, base + P._ae];
    const all = [...busyK, ...busyY];
    const slots = subtractIntervals(win, all).filter(([s, e]) => e - s >= minLen);
    if (!slots.length) continue;
    const dayHasBusy = all.some(([s, e]) => e > base && s < base + DAY);
    const allDay = slots.length === 1 && slots[0][0] === win[0] && slots[0][1] === win[1] && !dayHasBusy;
    const slotText = slots.map(([s, e]) => `${fmtMin(s - base)}~${fmtMin(e - base)}`).join(', ');
    const reasons = [k.note, y.note];
    const prev = info[idx - 1] || {};
    for (const p of [prev.k, prev.y]) if (p && p.busy.some(([, e]) => e > base + P._as)) reasons.push(`(전날) ${p.note}`);
    days.push({
      day: d,
      type: allDay ? '종일' : (slots[0][0] - base < 17 * 60 ? '오후' : '저녁'),
      text: allDay ? `${currentMonth}/${d}(종일)` : `${currentMonth}/${d}(${slotText})`,
      slots: slots.map(([s, e]) => ({ start: fmtMin(s - base), end: fmtMin(e - base) })),
      reasons
    });
  }
  // 종일 가능한 날이 연속이면 여행 칩 하나로
  const out = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i].type === '종일') {
      let j = i;
      while (j + 1 < days.length && days[j + 1].type === '종일' && days[j + 1].day === days[j].day + 1) j++;
      if (j - i + 1 >= A.tripMinDays) {
        out.push({ day: days[i].day, type: '여행', text: `${currentMonth}/${days[i].day}~${days[j].day} 여행 가능`, days: days.slice(i, j + 1).map(x => x.day), reasons: ['두 사람 모두 종일 가능'] });
        i = j;
        continue;
      }
    }
    out.push(days[i]);
  }
  return out;
}

/** 칩 앞 아이콘 */
export function recoIcon(type) {
  return type === '종일' ? '💖' : type === '여행' ? '🧳' : type === '오후' ? '✨' : '🌙';
}
