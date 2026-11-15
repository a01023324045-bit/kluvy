// 근무표 업로드(엑셀·규호 사진·예진 사진·간편 텍스트) → 미리보기 → 반영 규칙 (순수 함수, DOM 없음)
//
// 3단계 원칙 (사용자 제보: "수동으로 쓴 근무 위에 새 근무표를 등록하면 수동 내용이 가끔 사라진다")
//  1. 업로드는 '자기 사람 칸'(규호 → my, 예진 → gf)만 바꾼다. date·myPromise·gfPromise·상대 칸은 절대 안 건드림.
//  2. 편집창으로 넣은 값(manual:true)은 기본으로 유지 — 미리보기에서 '덮어쓰기'를 체크해야 바뀐다.
//  3. 근무표에서 빈칸인 날은 기존 값을 지우지 않는다 — 미리보기에서 체크하면 그 칸을 지운다.
//  4. 플래그 없는 옛 데이터는 수동 여부를 알 수 없으므로 '변경'(기존 → 새)으로만 보여 준다.
//  5. 내용이 같은 날은 '변경 없음'(반영 안 함, 기본 숨김).
import { sameDuty, isManual, stripManual } from './schedule-model.js';

/** 빈 근무 (값 없음 / type 없음 / '-') */
export function isBlankDuty(v) {
  if (!v || typeof v !== 'object') return true;
  const t = String(v.type ?? '').trim();
  return !t || t === '-';
}

/**
 * 한 칸의 상태
 *  new        : 기존 값 없음 → 새로 넣음 (기본 반영)
 *  change     : 기존 값(수동 표시 없음)과 다름 (기본 반영)
 *  same       : 기존 값과 같음 (반영 안 함)
 *  manual     : 기존 값이 수동 입력이고 다름 → ✋ 수동 입력 유지 (체크하면 덮어쓰기)
 *  blank-keep : 근무표 빈칸, 기존 값 있음 → 유지 (체크하면 기존 값 삭제)
 *  blank      : 근무표 빈칸, 기존 값도 없음 → 할 일 없음
 */
export function classifyUploadRow(prev, value) {
  const blank = isBlankDuty(value);
  const hasPrev = !isBlankDuty(prev);
  if (blank) return hasPrev ? 'blank-keep' : 'blank';
  if (!hasPrev) return 'new';
  if (sameDuty(prev, value)) return 'same';
  if (isManual(prev)) return 'manual';
  return 'change';
}

export const DEFAULT_INCLUDE = Object.freeze({ new: true, change: true, same: false, manual: false, 'blank-keep': false, blank: false });

export const STATUS_LABEL = Object.freeze({
  new: '새로 추가',
  change: '변경',
  same: '변경 없음',
  manual: '✋ 수동 입력 유지',
  'blank-keep': '빈칸 — 기존 값 유지',
  blank: '빈칸'
});

/** 체크했을 때의 뜻 (미리보기 체크박스 옆 글자) */
export const CHECK_MEANING = Object.freeze({
  new: '반영', change: '반영', same: '반영', manual: '덮어쓰기', 'blank-keep': '지우기', blank: '반영'
});

/**
 * 미리보기 행에 기존 값·상태·기본 체크를 붙인다.
 * @param {object} db scheduleDB
 * @param {{who:'my'|'gf', dateKey:string, value:object, include?:boolean}[]} rows
 */
export function planUploadRows(db, rows) {
  return rows.map(r => {
    const prev = (db && db[r.dateKey] && db[r.dateKey][r.who]) || null;
    const status = classifyUploadRow(prev, r.value);
    return { ...r, prev, status, include: DEFAULT_INCLUDE[status] };
  });
}

/** 같은 날짜·같은 사람 행이 여러 개면 뒤의 것(우선순위 높은 출처)만 남김 — 예: 간편 텍스트 다음 예진 사진 */
export function dedupeRows(rows) {
  const m = new Map();
  for (const r of rows) m.set(`${r.dateKey}|${r.who}`, r);
  return [...m.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : (a.who === 'my' ? -1 : 1)));
}

/**
 * 확정된 행(사용자가 체크한 것)을 반영. 자기 칸(who)만 바꾼다.
 *  - 값이 빈칸이면 그 칸을 지운다(미리보기에서 '지우기'를 체크한 경우만 여기 옴)
 *  - 업로드 값에는 수동 표시를 붙이지 않는다 (덮어쓰면 더는 수동 값이 아님)
 *  - 칸이 모두 없어진 날짜는 날짜째 지운다
 * @returns {string[]} 바뀐 날짜
 */
export function applyUploadRows(db, finalRows) {
  const changed = new Set();
  for (const r of finalRows) {
    if (r.who !== 'my' && r.who !== 'gf') continue;
    const day = db[r.dateKey] && typeof db[r.dateKey] === 'object' ? db[r.dateKey] : {};
    const before = JSON.stringify(day[r.who] ?? null);
    if (isBlankDuty(r.value)) delete day[r.who];
    else day[r.who] = stripManual({ ...r.value });
    if (JSON.stringify(day[r.who] ?? null) !== before) changed.add(r.dateKey);
    const rest = Object.entries(day).filter(([k, v]) => !['updatedAt', 'updatedBy'].includes(k) && v !== null && v !== undefined && v !== '');
    if (rest.length === 0) delete db[r.dateKey];
    else db[r.dateKey] = day;
  }
  return [...changed];
}

/** { dateKey: myObj } (엑셀 파서 결과) → 미리보기 행 */
export function rowsFromMyMap(map, source = 'excel') {
  return Object.entries(map || {}).map(([dateKey, value]) => ({
    who: 'my', dateKey, day: Number(dateKey.slice(8)), raw: { code: String(value && value.type || '') }, value: { ...value }, source
  }));
}

/** { dateKey: { gf } } (간편 텍스트를 빈 DB 에 적용한 결과) → 미리보기 행 */
export function rowsFromGfDb(tmpDb, source = 'text') {
  return Object.entries(tmpDb || {}).filter(([, d]) => d && d.gf).map(([dateKey, d]) => ({
    who: 'gf', dateKey, day: Number(dateKey.slice(8)), raw: { ...d.gf }, value: { ...d.gf }, source
  }));
}

/** 근무 한 칸을 짧은 글로 ("석근 13:00~21:00", "로마 체류 09:00~17:00", "OFF") */
export function describeDuty(who, v) {
  if (isBlankDuty(v)) return '없음';
  const time = v.start || v.end ? ` ${v.start || '?'}~${v.end || '?'}` : '';
  if (who === 'gf') {
    const dest = v.destination && !['체류', '비행'].includes(v.destination) ? `${v.destination} ` : '';
    const extra = v.isPureStay ? ' (L/O)' : v.isArrivalOnly ? ' (도착일)' : '';
    // v2.4.4: L/O·TRAIN 이 따로 있으면 꼬리표 ('제주 체류 06:35~13:32 +L/O', '제주 퀵턴 14:30~18:50 +TRAIN')
    const n = x => (Array.isArray(x) ? x.length : (x && typeof x === 'object' ? Object.keys(x).length : 0));
    const tags = [n(v.layovers) && !v.isPureStay ? 'L/O' : '', n(v.trains) ? 'TRAIN' : ''].filter(Boolean);
    return `${dest}${v.type}${time}${extra}${tags.length ? ` +${tags.join('·')}` : ''}`;
  }
  return `${v.type}${time}`;
}

/** 상태별 개수 (미리보기 요약) */
export function summarizeRows(rows) {
  const out = { new: 0, change: 0, same: 0, manual: 0, 'blank-keep': 0, blank: 0 };
  for (const r of rows) if (out[r.status] !== undefined) out[r.status]++;
  return out;
}
