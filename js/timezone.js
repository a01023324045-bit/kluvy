// 체류지 현지시각 → 한국시각(KST) 변환
// 도시별 IANA 타임존 + Intl 로 '그 날짜'의 실제 시차를 계산한다 (서머타임 반영).
//   예) 로마: 2026-10-24 까지 KST-7 (서머타임), 2026-10-25 부터 KST-8
//       밴쿠버: 2026-03-08 이전 KST-17, 이후 KST-16. BC주는 2026-11-01부터 서머타임을 영구화(UTC-7 고정)해서
//              11월에도 KST-16 유지 (https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time)
//              → 폰의 시간대 DB가 옛날 것이어도 맞도록 2026-11-01부터는 고정 UTC-7(Etc/GMT+7)로 계산한다.
// 목록에 없는 도시는 운영본과 똑같이 변환하지 않는다(빈 문자열).
// 날짜를 모르면(dateKey 없음) 운영본의 고정 시차표를 쓴다.

// [도시, IANA 타임존, 운영본 고정 시차(시간), (선택) {from: 'YYYY-MM-DD', tz: 그 날부터 쓸 타임존}] — 순서 중요: 운영본처럼 앞에서부터 dest.includes(city) 로 찾는다.
export const CITY_TIMEZONES = [
  ["비슈케크", "Asia/Bishkek", -3],
  ["자카르타", "Asia/Jakarta", -2],
  ["방콕", "Asia/Bangkok", -2],
  ["치앙마이", "Asia/Bangkok", -2],
  ["다낭", "Asia/Ho_Chi_Minh", -2],
  ["나트랑", "Asia/Ho_Chi_Minh", -2],
  ["푸꾸옥", "Asia/Ho_Chi_Minh", -2],
  ["싱가포르", "Asia/Singapore", -1],
  ["홍콩", "Asia/Hong_Kong", -1],
  ["타이베이", "Asia/Taipei", -1],
  ["타이중", "Asia/Taipei", -1],
  ["가오슝", "Asia/Taipei", -1],
  ["울란바토르", "Asia/Ulaanbaatar", -1],
  ["선양", "Asia/Shanghai", -1],
  ["우한", "Asia/Shanghai", -1],
  ["로마", "Europe/Rome", -7],
  ["파리", "Europe/Paris", -7],
  ["바르셀로나", "Europe/Madrid", -7],
  ["프랑크푸르트", "Europe/Berlin", -7],
  ["밴쿠버", "America/Vancouver", -16, { from: "2026-11-01", tz: "Etc/GMT+7" }],
  ["사이판", "Pacific/Saipan", +1]
];

/** 운영본 고정 시차표 (하위 호환·폴백용) */
export const TIMEZONE_OFFSET_HOURS = Object.fromEntries(CITY_TIMEZONES.map(([c, , h]) => [c, h]));

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

/** 그 날짜에 쓸 타임존 (도시별 예외 규칙 반영) */
function zoneFor(found, dateKey) {
  const rule = found[3];
  if (rule && dateKey && dateKey >= rule.from) return rule.tz;
  return found[1];
}

export function findCity(dest) {
  if (!dest) return null;
  return CITY_TIMEZONES.find(([city]) => dest.includes(city)) || null;
}

/**
 * 그 날짜에 '현지시각 - 한국시각' (시간 단위, 예: 로마 여름 -7, 겨울 -8). 미등록 도시는 null.
 * dateKey 가 없으면 운영본 고정값.
 */
export function getKstDiffHours(dest, dateKey) {
  const found = findCity(dest);
  if (!found) return null;
  const legacy = found[2];
  if (!dateKey) return legacy;
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const off = tzOffsetMinutes(zoneFor(found, dateKey), Date.UTC(y, m - 1, d, 12, 0));
    return (off - KST_OFFSET_MIN) / 60;
  } catch (e) {
    return legacy;
  }
}

function formatKst(hh, mm, dayDiff) {
  const timePart = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  if (!dayDiff) return `(KR ${timePart})`;
  return `(KR${dayDiff > 0 ? '+' : ''}${dayDiff}일 ${timePart})`;
}

/** 운영본 방식(고정 시차) 변환 — dateKey 가 없을 때 / Intl 실패 시 */
function convertWithFixedOffset(offset, localTimeStr) {
  if (offset === null || offset === 0) return "";
  const [h, m] = localTimeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  let kstH = h - offset;
  let dayDiff = 0;
  if (kstH >= 24) { kstH -= 24; dayDiff = 1; }
  else if (kstH < 0) { kstH += 24; dayDiff = -1; }
  return formatKst(kstH, m, dayDiff);
}

/**
 * 체류지 현지시각(HH:MM) → "(KR 01:50)" / "(KR+1일 02:15)" 형식. 변환 불가면 "".
 * @param {string} dest 도착지/도시명 (예: "로마")
 * @param {string} localTimeStr 현지 시각 "HH:MM"
 * @param {string} [dateKey] 그 일정의 날짜 "YYYY-MM-DD" (서머타임 계산용)
 */
export function convertLocalToKST(dest, localTimeStr, dateKey) {
  if (!localTimeStr || !dest) return "";
  const found = findCity(dest);
  if (!found) return "";
  const legacy = found[2];
  if (!dateKey) return convertWithFixedOffset(legacy, localTimeStr);
  const tz = zoneFor(found, dateKey);

  const [h, m] = localTimeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return "";
  try {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const utc = localWallToUtc(tz, y, mo, d, h, m);
    if (tzOffsetMinutes(tz, utc) === KST_OFFSET_MIN) return "";
    const kst = new Date(utc + KST_OFFSET_MIN * 60000);
    const dayDiff = Math.round((Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - Date.UTC(y, mo - 1, d)) / 86400000);
    return formatKst(kst.getUTCHours(), kst.getUTCMinutes(), dayDiff);
  } catch (e) {
    return convertWithFixedOffset(legacy, localTimeStr);
  }
}
