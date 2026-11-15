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
// v2.5.3: 칸을 저장(saveDB)하면 updatedAt/updatedBy 가 새로 찍힌다.
// 되돌리기 기록의 '반영 직후 값'은 저장 전에 뜬 값이라 그 두 필드가 달라,
// 실제 내용은 그대로인데도 '그 사이 바뀐 날'로 잘못 건너뛰는 문제가 있었다.
const stripMeta = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v ?? null;
  const { updatedAt, updatedBy, ...rest } = v;
  return rest;
};
// JSON.stringify 는 키 순서에 민감하다. 서버에서 되돌아온 칸은 같은 내용이어도 키 순서가 달라져
// '바뀐 날'로 오판되므로, 키를 정렬한 표준형으로 비교한다.
const canon = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (k === 'updatedAt' || k === 'updatedBy') continue;
    out[k] = canon(v[k]);
  }
  return out;
};
const sameContent = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

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
    const okCur = sameContent(cur, e.after) || (Array.isArray(e.afters) && e.afters.some(a => sameContent(cur, a)));
    if (!okCur) { skipped.add(e.dateKey); continue; }
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

/**
 * v2.5.1: 이미 있는 되돌리기 기록(업로드)에 이어서 [편명 다시 읽기] 가 바꾼 칸을 합친다.
 *  - 같은 칸이면 '반영 직전 값(before)'은 맨 처음 것, '반영 직후 값(after)'은 최신 것 → [되돌리기] 한 번에 업로드 전으로 돌아간다.
 */
export function mergeUndoEntries(oldEntries, newEntries) {
  const out = (oldEntries || []).map(e => ({ ...e }));
  for (const n of newEntries || []) {
    const hit = out.find(e => e.dateKey === n.dateKey && e.who === n.who);
    if (hit) {
      // 같은 칸이 여러 번 바뀌면(업로드 → 편명 다시 읽기) 중간 상태도 '우리가 만든 값'으로 인정한다.
      // 그래야 그 사이 저장·동기화로 필드가 살짝 달라져도 되돌리기가 그 날을 건너뛰지 않는다.
      const prev = Array.isArray(hit.afters) ? hit.afters : [hit.after];
      hit.afters = prev.concat([n.after]);
      hit.after = n.after;
    } else out.push({ ...(Array.isArray(n.afters) ? n : { ...n, afters: [n.after] }) });
  }
  return out;
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
