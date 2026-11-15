// 업로드 '바로 반영' 되돌리기 (v2.4.6) — 순수 함수 + localStorage 한 칸 (DOM 없음)
//
// 규칙
//  - 직후 1회, 10분 이내만. 새로고침해도 10분 안이면 남는다 (localStorage 'kluvy_upload_undo_v1').
//  - 다른 작업(편집·기념일·월 비우기·복원·다른 업로드)으로 saveDB() 가 불리면 사라진다 (firebase-sync.saveDB 가 clearUndo 호출).
//  - '칸 단위'로 되돌린다: 업로드가 바꾼 칸(규호 my / 예진 gf)만 직전 값으로 — date·약속·상대 칸은 건드리지 않는다.
//    그 사이 다른 폰(동기화)이 같은 칸을 또 바꿨으면 그 칸은 그대로 두고 건너뛴 수로 알려 준다.
//  - 되돌리면 saveDB() 가 칸 단위 PATCH 로 서버에도 보낸다 (이 파일은 저장만 담당, 전송은 하지 않음).
// ⚠️ STORAGE_KEYS(운영 폰 호환 고정 목록)에는 넣지 않는다 — 임시 기록이라 없어도 무방.
export const UNDO_KEY = 'kluvy_upload_undo_v1';
export const UNDO_TTL_MS = 10 * 60 * 1000;

const listeners = new Set();
/** 되돌리기 기록이 지워질 때 알림 받기 (화면의 반영 바가 같이 사라지도록) */
export function onUndoCleared(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 반영 직전: 바뀔 칸들의 현재 값 { 'YYYY-MM-DD|my': 값|null } */
export function captureBefore(db, rows) {
  const out = {};
  for (const r of rows) out[`${r.dateKey}|${r.who}`] = clone(db && db[r.dateKey] && db[r.dateKey][r.who]);
  return out;
}

/** 반영 직후: 실제로 바뀐 칸 [{ dateKey, who, before, after }] (같은 값으로 덮은 칸은 제외) */
export function diffEntries(before, db, rows) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.dateKey}|${r.who}`;
    if (seen.has(k) || !(k in before)) continue;
    seen.add(k);
    const after = clone(db && db[r.dateKey] && db[r.dateKey][r.who]);
    if (!same(before[k], after)) out.push({ dateKey: r.dateKey, who: r.who, before: before[k], after });
  }
  return out;
}

/**
 * 되돌리기 실행: 칸이 '반영 직후 값' 그대로일 때만 직전 값으로 복구.
 * @returns {{ restored: string[], skipped: string[] }} 되돌린 날짜 / 그 사이 바뀌어 그대로 둔 날짜
 */
export function undoUploadRows(db, entries) {
  const restored = new Set();
  const skipped = new Set();
  for (const e of entries || []) {
    const day = db[e.dateKey] && typeof db[e.dateKey] === 'object' ? db[e.dateKey] : null;
    const cur = day ? day[e.who] : null;
    if (!same(cur, e.after)) { skipped.add(e.dateKey); continue; }
    const d = day || {};
    if (e.before === null || e.before === undefined) delete d[e.who];
    else d[e.who] = clone(e.before);
    const rest = Object.entries(d).filter(([k, v]) => !['updatedAt', 'updatedBy'].includes(k) && v !== null && v !== undefined && v !== '');
    if (rest.length === 0) delete db[e.dateKey];
    else db[e.dateKey] = d;
    restored.add(e.dateKey);
  }
  for (const k of restored) skipped.delete(k);
  return { restored: [...restored].sort(), skipped: [...skipped].sort() };
}

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

/** 기록 저장. entries 가 없으면(바뀐 칸 없음) 저장하지 않고 기존 기록도 지운다 */
export function saveUndo(rec, now = Date.now()) {
  const ls = store();
  if (!rec || !Array.isArray(rec.entries) || !rec.entries.length) { clearUndo(); return false; }
  const full = { v: 1, at: now, ...rec };
  try { if (ls) ls.setItem(UNDO_KEY, JSON.stringify(full)); } catch (e) { console.warn('되돌리기 기록 저장 실패:', e); return false; }
  return true;
}

/** 유효한 기록 (10분 안, 형식 맞음) 또는 null. 만료·깨진 기록은 지운다 */
export function loadUndo(now = Date.now()) {
  const ls = store();
  if (!ls) return null;
  let raw = null;
  try { raw = ls.getItem(UNDO_KEY); } catch (e) { return null; }
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { rec = null; }
  if (!rec || rec.v !== 1 || !Array.isArray(rec.entries) || !rec.entries.length || !Number.isFinite(rec.at) || now - rec.at >= UNDO_TTL_MS || now < rec.at - 60000) {
    clearUndo();
    return null;
  }
  return rec;
}

/** 남은 시간(밀리초). 기록이 없거나 만료면 0 */
export function undoRemainingMs(now = Date.now()) {
  const rec = loadUndo(now);
  return rec ? Math.max(0, rec.at + UNDO_TTL_MS - now) : 0;
}

export function clearUndo() {
  const ls = store();
  let had = false;
  try { if (ls) { had = ls.getItem(UNDO_KEY) !== null; ls.removeItem(UNDO_KEY); } } catch (e) { /* 저장소 오류 무시 */ }
  if (had) for (const fn of [...listeners]) { try { fn(); } catch (e) { console.warn(e); } }
}
