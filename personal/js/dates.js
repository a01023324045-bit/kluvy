// 날짜 유틸

export function getKSTDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (9 * 3600000));
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** (2026, 7, 3) → "2026-07-03" */
export function makeDateKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** (2026, 7) → "2026-07" */
export function makeMonthKey(y, m) {
  return `${y}-${pad2(m)}`;
}

/**
 * "YYYY-MM-DD" → 그 날짜의 '현지 자정' Date.
 * new Date("YYYY-MM-DD") 는 UTC 자정이라, 폰 시간대가 한국보다 느린 곳(예: 예진이 밴쿠버 체류 중)에서는
 * 하루 전 날짜/요일이 나온다. 날짜 키를 Date 로 바꿀 때는 항상 이 함수를 쓴다.
 */
export function parseDateKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 시간대와 무관한 요일 (0=일 … 6=토) */
export function weekdayOfKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 시작~끝(포함) 날짜 키 목록. 시작 > 끝이면 빈 배열 */
export function dateKeysBetween(startKey, endKey) {
  const out = [];
  const [y1, m1, d1] = startKey.split('-').map(Number);
  const [y2, m2, d2] = endKey.split('-').map(Number);
  const end = Date.UTC(y2, m2 - 1, d2);
  for (let t = Date.UTC(y1, m1 - 1, d1); t <= end; t += 86400000) {
    const dt = new Date(t);
    out.push(makeDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
  }
  return out;
}

export function getDiffDays(date1, date2) {
  const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24)) + 1;
}
