// 체류지 현지시각 → 한국시각(KST) 변환
// 장소·시간대는 places.js 한 곳에서만 관리한다 (flight.js 공항 시간대와 같은 표).
// 도시별 IANA 시간대 + Intl 로 '그 날짜'의 실제 시차를 계산한다 (서머타임 반영).
//   예) 로마: 2026-10-24 까지 KST-7 (서머타임), 2026-10-25 부터 KST-8
//       시드니: 2026-10-04 ~ 2027-04-04 AEDT(UTC+11) = KST+2, 그 밖 KST+1
//       밴쿠버: BC주 2026-11-01부터 서머타임 영구화(UTC-7 고정) → 11월에도 KST-16 (places.js rule)
// 달력 칸·상세 카드·미리보기의 한국시각 표시는 모두 stayKstInfo() 하나를 쓴다.
// 표에 없는 목적지는 조용히 빠지지 않고 status:'unknown' → 화면에 '(KR ?)' + console.warn (같은 이름은 1번만).
import { PLACES, LEGACY_CITY_ORDER, findPlace, placeByIata, placeZone } from './places.js';

/** 운영본 시차표 형식 [도시, IANA, 고정 시차, rule?] — 하위 호환·테스트용 (운영본 도시 21곳, 같은 순서) */
export const CITY_TIMEZONES = LEGACY_CITY_ORDER.map(name => {
  const p = PLACES.find(x => x.name === name);
  return p.rule ? [p.name, p.tz, p.legacy, { ...p.rule }] : [p.name, p.tz, p.legacy];
});

/** 운영본 고정 시차표 (날짜를 모를 때의 폴백) */
export const TIMEZONE_OFFSET_HOURS = Object.fromEntries(CITY_TIMEZONES.map(([c, , h]) => [c, h]));

const KST_TZ = 'Asia/Seoul';
const KST_OFFSET_MIN = 9 * 60;
const dtfCache = new Map();

function getFormatter(timeZone) {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return dtfCache.get(timeZone);
}

/** 특정 UTC 시각에서 그 타임존의 UTC 오프셋(분) */
export function tzOffsetMinutes(timeZone, utcMs) {
  const parts = {};
  for (const p of getFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return Math.round((asUTC - utcMs) / 60000);
}

/** 그 타임존의 현지 벽시계 시각 → UTC ms */
export function localWallToUtc(timeZone, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(timeZone, guess);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(timeZone, utc);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return utc;
}

/** 목적지 → 장소 (places.js). 옛 이름 유지 */
export function findCity(dest) {
  return findPlace(dest);
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayKstKey() {
  const t = new Date(Date.now() + KST_OFFSET_MIN * 60000);
  return t.toISOString().slice(0, 10);
}

/**
 * 그 날짜에 '현지시각 - 한국시각' (시간 단위, 예: 로마 여름 -7, 겨울 -8, 시드니 11월 +2). 미등록 목적지는 null.
 * dateKey 가 없으면 운영본 고정값(운영본 도시) / 오늘 기준(그 밖).
 */
export function getKstDiffHours(dest, dateKey) {
  const place = findPlace(dest);
  if (!place) return null;
  if (!dateKey && typeof place.legacy === 'number') return place.legacy;
  const key = dateKey || todayKstKey();
  try {
    const [y, m, d] = key.split('-').map(Number);
    const off = tzOffsetMinutes(placeZone(place, key), Date.UTC(y, m - 1, d, 12, 0));
    return (off - KST_OFFSET_MIN) / 60;
  } catch (e) {
    return typeof place.legacy === 'number' ? place.legacy : null;
  }
}

/** '(KR 01:50)' / '(KR+1일 02:15)' / '(KR-1일 23:30)' */
export function formatKst(time, dayDiff) {
  if (!dayDiff) return `(KR ${time})`;
  return `(KR${dayDiff > 0 ? '+' : ''}${dayDiff}일 ${time})`;
}

export const KST_UNKNOWN = '(KR ?)';

/** 운영본 방식(고정 시차) 변환 — dateKey 가 없을 때 / Intl 실패 시 */
function convertWithFixedOffset(offset, localTimeStr) {
  if (offset === null || offset === undefined || offset === 0) return "";
  const [h, m] = String(localTimeStr).split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  let kstH = h - offset;
  let dayDiff = 0;
  if (kstH >= 24) { kstH -= 24; dayDiff = 1; }
  else if (kstH < 0) { kstH += 24; dayDiff = -1; }
  return formatKst(`${pad(kstH)}:${pad(m)}`, dayDiff);
}

function utcToKst(utc) {
  const k = new Date(utc + KST_OFFSET_MIN * 60000);
  return { date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`, time: `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}` };
}

function keyDiff(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

/**
 * 체류지 현지시각(HH:MM, 그 날짜 dateKey 의 현지 날짜) → "(KR 01:50)" / "(KR+1일 02:15)". 변환 불가·같은 시각대면 "".
 * (날짜 넘김은 dateKey 기준. 출국편 도착이 다음 날인지까지 따지려면 stayKstInfo 사용)
 * @param {string} dest 도착지/도시명 (예: "로마", "SYD")
 * @param {string} localTimeStr 현지 시각 "HH:MM"
 * @param {string} [dateKey] 그 일정의 날짜 "YYYY-MM-DD" (서머타임 계산용)
 */
export function convertLocalToKST(dest, localTimeStr, dateKey) {
  if (!localTimeStr || !dest) return "";
  const place = findPlace(dest);
  if (!place) return "";
  if (!dateKey && typeof place.legacy === 'number') return convertWithFixedOffset(place.legacy, localTimeStr);
  const key = dateKey || todayKstKey();
  const mm = HHMM.exec(String(localTimeStr).trim());
  if (!mm) return "";
  try {
    const tz = placeZone(place, key);
    const [y, mo, d] = key.split('-').map(Number);
    const utc = localWallToUtc(tz, y, mo, d, Number(mm[1]), Number(mm[2]));
    if (tzOffsetMinutes(tz, utc) === KST_OFFSET_MIN) return "";
    const k = utcToKst(utc);
    return formatKst(k.time, keyDiff(key, k.date));
  } catch (e) {
    return convertWithFixedOffset(place.legacy, localTimeStr);
  }
}

const ROUTE_RE = /\b([A-Z]{3})\s*(?:-|–|—|>|→|~|\/)\s*([A-Z]{3})\b/;
const warned = new Set();

function warnUnknown(dest, dateKey) {
  const k = String(dest || '(빈 목적지)');
  if (warned.has(k)) return;
  warned.add(k);
  console.warn(`[KLUVY] 시간대를 모르는 목적지 '${k}' (${dateKey}) — 한국시각을 계산하지 못해 '(KR ?)'로 표시합니다. app/js/places.js 에 추가하세요.`);
}

/** 테스트용: 경고 기록 초기화 */
export function _resetKstWarnings() { warned.clear(); }

/**
 * 체류 비행일의 한국시각 표시 정보 — 달력 칸(예진만 보기)·상세 카드·등록 미리보기가 모두 이 함수를 쓴다.
 *  - 출국(체류 출발일, isInbound 아님): '도착' 현지시각(end) → 한국시각. 출발(start)은 출발 공항 시각(편명 구간, 없으면 한국)으로 보고
 *    도착이 출발보다 앞서면 다음 날 도착으로 계산 (예: 21:40 인천 출발 → 시드니 10:00 = 다음 날 08:00 KST, '+1일')
 *  - 귀국(isInbound): '출발' 현지시각(start) → 한국시각 (그 날짜의 현지 출발)
 *  - 날짜 넘김(shift)은 그 근무 날짜(dateKey) 기준
 * @param {object} g 예진 근무 (gf)
 * @param {string} dateKey
 * @returns {null | {kind:'arrival'|'departure', status:'ok'|'same'|'unknown', time?:string, shift?:number, kstDate?:string, text:string, place?:object, dest:string}}
 *   null = 한국시각을 보일 대상이 아님 (퀵턴·L/O·도착일·시각 없음)
 */
export function stayKstInfo(g, dateKey) {
  if (!g || typeof g !== 'object' || !dateKey) return null;
  if (g.isQuickTurn || g.type !== '체류' || g.isPureStay || g.isArrivalOnly) return null;
  const inbound = Boolean(g.isInbound);
  const local = String((inbound ? g.start : g.end) || '').trim();
  const mm = HHMM.exec(local);
  if (!mm) return null;
  const kind = inbound ? 'departure' : 'arrival';
  const dest = String(g.destination || '');
  const route = ROUTE_RE.exec(String(g.flight || '').toUpperCase());
  // 장소: 목적지 이름 → 없으면 편명 구간의 해외 공항 (귀국편은 출발 공항, 출국편은 도착 공항)
  let place = findPlace(dest);
  if (!place && route) place = placeByIata(inbound ? route[1] : route[2]);
  if (!place) {
    warnUnknown(dest || g.flight, dateKey);
    return { kind, status: 'unknown', text: KST_UNKNOWN, dest };
  }
  try {
    const tz = placeZone(place, dateKey);
    const [y, mo, d] = dateKey.split('-').map(Number);
    const h = Number(mm[1]), mi = Number(mm[2]);
    let utc = localWallToUtc(tz, y, mo, d, h, mi);
    if (!inbound) {
      const s = HHMM.exec(String(g.start || '').trim());
      if (s) {
        const depPlace = route ? placeByIata(route[1]) : null;
        const depTz = depPlace ? placeZone(depPlace, dateKey) : KST_TZ;
        const depUtc = localWallToUtc(depTz, y, mo, d, Number(s[1]), Number(s[2]));
        for (let i = 1; i <= 2 && utc <= depUtc; i++) {
          const [y2, m2, d2] = addDays(dateKey, i).split('-').map(Number);
          utc = localWallToUtc(tz, y2, m2, d2, h, mi);
        }
      }
    }
    if (tzOffsetMinutes(tz, utc) === KST_OFFSET_MIN) return { kind, status: 'same', text: '', place, dest };
    const k = utcToKst(utc);
    const shift = keyDiff(dateKey, k.date);
    return { kind, status: 'ok', time: k.time, shift, kstDate: k.date, text: formatKst(k.time, shift), place, dest };
  } catch (e) {
    const t = convertWithFixedOffset(place.legacy, local);
    return t ? { kind, status: 'ok', text: t, place, dest } : { kind, status: 'unknown', text: KST_UNKNOWN, place, dest };
  }
}

/** '한국보다 2시간 빠름' / '7시간 느림' / '한국과 같은 시각' / null(미등록) — 상세 카드 체류일 안내 */
export function kstDiffText(dest, dateKey) {
  const h = getKstDiffHours(dest, dateKey);
  if (h === null) return null;
  if (h === 0) return '한국과 같은 시각';
  const abs = Math.abs(h);
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `한국보다 ${n}시간 ${h > 0 ? '빠름' : '느림'}`;
}
