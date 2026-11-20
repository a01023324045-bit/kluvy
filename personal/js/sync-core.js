// 동기화 순수 로직 (DOM·네트워크 없음 → node 테스트 가능)
//  - RTDB 스트림(put/patch) 이벤트 → 로컬 근무표 병합 (미전송 날짜는 보호)
//  - 바뀐 날짜 찾기(그림자 사본과 비교), 미전송 큐, PATCH 본문 만들기
//
// RTDB REST 스트리밍 이벤트 의미 (https://firebase.google.com/docs/reference/rest/database#section-streaming)
//   put   {path, data}: path 위치의 값을 data 로 통째로 바꿈 (data=null 이면 삭제). path "/" 는 구독 위치 전체.
//                       → 구버전 폰의 schedules 전체 PUT 은 path "/" put 으로 온다.
//   patch {path, data}: data 의 각 키(…/로 더 깊을 수 있음)를 path 아래에서 바꿈. 키에 없는 형제는 그대로.

export const SV_TIMESTAMP = Object.freeze({ '.sv': 'timestamp' });

/** "/2026-11-24/gf" → ['2026-11-24','gf'] */
export function parsePath(path) {
  return String(path || '/').split('/').filter(Boolean);
}

/** 스트림 이벤트 → [{segs, value}] 쓰기 목록 (스트림 위치 기준 상대 경로) */
export function eventToOps(type, payload) {
  if (!payload || typeof payload !== 'object') return [];
  const base = parsePath(payload.path);
  if (type === 'put') return [{ segs: base, value: payload.data === undefined ? null : payload.data }];
  if (type === 'patch') {
    const d = payload.data && typeof payload.data === 'object' ? payload.data : {};
    return Object.entries(d).map(([k, v]) => ({ segs: [...base, ...parsePath(k)], value: v === undefined ? null : v }));
  }
  return [];
}

/** Firebase 처럼: 배열 → {"0":…}, null/빈 객체 제거. 빈 결과면 null */
export function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const n = normalizeValue(x); if (n !== null) o[String(i)] = n; });
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const n = normalizeValue(x); if (n !== null) o[k] = n; }
    return Object.keys(o).length ? o : null;
  }
  return v;
}

/** obj 의 segs 위치에 value 를 넣은 새 객체 (원본 불변). null 은 삭제, 빈 부모 정리. 결과가 비면 null */
export function deepSet(obj, segs, value) {
  if (segs.length === 0) return normalizeValue(value);
  const base = (obj && typeof obj === 'object') ? (Array.isArray(obj) ? { ...normalizeValue(obj) } : { ...obj }) : {};
  const [k, ...rest] = segs;
  const child = deepSet(base[k] === undefined ? null : base[k], rest, value);
  if (child === null) delete base[k]; else base[k] = child;
  return Object.keys(base).length ? base : null;
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
// 서버 메타(updatedAt/updatedBy)만 다른 값은 같은 내용 (= 내가 보낸 값의 메아리)
const sameContent = (a, b) => same(normalizeValue(stripMeta(a ?? null)), normalizeValue(stripMeta(b ?? null)));

/**
 * 근무표(schedules 스트림) 이벤트 반영.
 * @param {object} db 현재 로컬 근무표 (바꾸지 않음)
 * @param {{segs:string[], value:any}[]} ops eventToOps 결과
 * @param {(dateKey:string)=>boolean} isProtected 미전송 큐에 있는 날짜 → 서버 값으로 덮지 않음
 * @returns {{db:object, changed:string[], suppressed:string[], full:boolean}}
 */
export function applyScheduleOps(db, ops, isProtected = () => false) {
  const next = { ...(db || {}) };
  const changed = new Set();
  const suppressed = new Set();
  let full = false;
  for (const { segs, value } of ops) {
    if (segs.length === 0) {
      full = true;
      const incoming = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      const keys = new Set([...Object.keys(next), ...Object.keys(incoming)]);
      for (const k of keys) {
        const v = normalizeValue(incoming[k]);
        if (isProtected(k)) { if (!sameContent(next[k], v)) suppressed.add(k); continue; }
        if (v === null) { if (k in next) { delete next[k]; changed.add(k); } }
        else if (!same(next[k], v)) { next[k] = v; changed.add(k); }
      }
      continue;
    }
    const [k, ...rest] = segs;
    const cur = next[k] === undefined ? null : next[k];
    const nv = deepSet(cur, rest, value);
    if (isProtected(k)) { if (!sameContent(cur, nv)) suppressed.add(k); continue; }
    if (!same(cur, nv)) {
      if (nv === null) delete next[k]; else next[k] = nv;
      changed.add(k);
    }
  }
  return { db: next, changed: [...changed], suppressed: [...suppressed], full };
}

/** 서버 anniversaries 값(배열 또는 {"0":…} 객체 또는 null) → 기념일 배열 */
export function anniversariesFromServer(v) {
  if (v === null || v === undefined) return [];
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'object') arr = Object.keys(v).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map(k => v[k]);
  else return [];
  return arr.filter(a => a && typeof a === 'object' && typeof a.name === 'string' && typeof a.date === 'string')
    .map(a => ({ name: a.name, date: a.date, isRepeat: Boolean(a.isRepeat) }));
}

// ---------------- 바뀐 날짜 찾기 ----------------

/** 근무표 → Map(날짜 → JSON 문자열) */
export function snapshotDB(db) {
  const m = new Map();
  for (const [k, v] of Object.entries(db || {})) m.set(k, JSON.stringify(v));
  return m;
}

/** 그림자 사본(마지막으로 서버와 맞춘 상태)과 비교해 바뀐 날짜(추가·수정·삭제) */
export function diffKeys(shadow, db) {
  const out = [];
  const keys = new Set([...shadow.keys(), ...Object.keys(db || {})]);
  for (const k of keys) {
    const cur = db && Object.prototype.hasOwnProperty.call(db, k) ? JSON.stringify(db[k]) : undefined;
    if (shadow.get(k) !== cur) out.push(k);
  }
  return out;
}

/** 날짜 항목에서 '사람/항목' 단위로 보낼 수 있는 필드 (my, gf, date, myPromise, gfPromise 와 그 밖의 추가 필드) */
const META_FIELDS = new Set(['updatedAt', 'updatedBy']);

/**
 * 한 날짜에서 바뀐 필드 목록 (그림자 JSON ↔ 현재 값). 날짜가 지워졌으면 null(= 날짜 통째로 null).
 * 3단계: 업로드·편집이 '자기 칸'만 서버에 보내도록 — 상대 폰이 같은 날짜의 다른 칸을 동시에 고쳐도 덮지 않는다.
 */
export function changedFields(shadowJson, cur) {
  if (cur === undefined || cur === null || typeof cur !== 'object' || Array.isArray(cur)) return null; // 삭제 → 날짜 통째로 null
  let prev = {};
  if (shadowJson !== undefined) {
    try { prev = JSON.parse(shadowJson); } catch (e) { return null; }
    if (!prev || typeof prev !== 'object') prev = {};
  }
  // 새 날짜도 칸 단위로 보낸다 (상대 폰이 같은 날짜에 방금 만든 다른 칸을 지우지 않도록)
  const out = [];
  for (const f of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    if (META_FIELDS.has(f)) continue;
    if (JSON.stringify(prev[f] ?? null) !== JSON.stringify(cur[f] ?? null)) out.push(f);
  }
  return out;
}

// ---------------- 미전송 큐 ----------------
// { v:1, seq:n, dates:{ 'YYYY-MM-DD': 편집번호 }, fields:{ 'YYYY-MM-DD': ['my','gf'] }, aniv: 편집번호|0 }
// 전송이 끝났을 때 그 사이 다시 편집된 날짜(번호가 바뀐 것)는 큐에 남긴다.
// fields: 그 날짜에서 바뀐 칸 (3단계). 없으면(2단계 큐·새 날짜·삭제) 날짜 통째로 보낸다.

export function loadQueue(raw) {
  const q = { v: 1, seq: 0, dates: {}, fields: {}, aniv: 0 };
  if (raw && typeof raw === 'object') {
    if (raw.dates && typeof raw.dates === 'object') for (const [k, n] of Object.entries(raw.dates)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) q.dates[k] = Number(n) || 1;
    if (raw.fields && typeof raw.fields === 'object') {
      for (const [k, f] of Object.entries(raw.fields)) {
        if (q.dates[k] !== undefined && Array.isArray(f) && f.length && f.every(x => typeof x === 'string' && /^[A-Za-z0-9_]+$/.test(x))) q.fields[k] = [...new Set(f)];
      }
    }
    q.aniv = Number(raw.aniv) || 0;
    q.seq = Math.max(Number(raw.seq) || 0, q.aniv, ...Object.values(q.dates));
  }
  return q;
}

/**
 * 날짜를 큐에 넣는다. fieldsByKey[k] = 바뀐 칸 배열(칸 단위 전송) | null(날짜 통째로).
 * 이미 큐에 있는 날짜면 칸을 합친다 (한 번이라도 '통째로'였으면 계속 통째로).
 */
export function enqueueDates(q, keys, fieldsByKey = null) {
  if (!q.fields) q.fields = {};
  for (const k of keys) {
    const wasQueued = q.dates[k] !== undefined;
    q.dates[k] = ++q.seq;
    const f = fieldsByKey ? fieldsByKey[k] : null;
    if (Array.isArray(f) && f.length && (!wasQueued || q.fields[k])) {
      q.fields[k] = [...new Set([...(q.fields[k] || []), ...f])];
    } else {
      delete q.fields[k];
    }
  }
  return q;
}

export function enqueueAnniversaries(q) {
  q.aniv = ++q.seq;
  return q;
}

export function queueCount(q) {
  return Object.keys(q.dates).length + (q.aniv ? 1 : 0);
}

/** 지금 큐 내용을 복사 (전송 묶음) */
export function takeBatch(q) {
  const fields = {};
  for (const [k, f] of Object.entries(q.fields || {})) fields[k] = [...f];
  return { dates: { ...q.dates }, fields, aniv: q.aniv };
}

/** 전송 성공: 묶음과 번호가 같은 항목만 큐에서 지움 */
export function ackBatch(q, batch) {
  for (const [k, n] of Object.entries(batch.dates)) if (q.dates[k] === n) { delete q.dates[k]; if (q.fields) delete q.fields[k]; }
  if (batch.aniv && q.aniv === batch.aniv) q.aniv = 0;
  return q;
}

/** 날짜 항목에서 서버가 붙인 메타(updatedAt/updatedBy)를 뺀 값 */
export function stripMeta(day) {
  if (!day || typeof day !== 'object') return day;
  const { updatedAt, updatedBy, ...rest } = day; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * 루트 다중 경로 PATCH 본문 (한 번의 요청으로 원자적으로 반영됨)
 *   schedules/{날짜}/{칸}: 바뀐 칸만 (batch.fields 가 있을 때, 3단계) + schedules/{날짜}/updatedAt·updatedBy
 *   schedules/{날짜}: 날짜 항목 통째로 + updatedAt(서버시각)·updatedBy   (칸 정보가 없을 때 / 삭제는 null)
 *   anniversaries: 배열 전체 (빈 배열이면 null)                    — 기념일은 배열 스키마라 항목 단위 대신 통째로
 *   kluvyMeta/schedules · kluvyMeta/anniversaries: 마지막 변경 시각·사람 (구버전은 읽지 않는 새 경로)
 */
export function buildPatchBody(db, batch, { email = '', anniversaries = [] } = {}) {
  const body = {};
  const by = email || '';
  const keys = Object.keys(batch.dates || {});
  for (const k of keys) {
    const v = db[k];
    const exists = v && typeof v === 'object' && Object.keys(stripMeta(v)).length;
    const fields = batch.fields && Array.isArray(batch.fields[k]) ? batch.fields[k].filter(f => !META_FIELDS.has(f)) : null;
    if (exists && fields && fields.length) {
      for (const f of fields) body[`schedules/${k}/${f}`] = v[f] === undefined ? null : v[f];
      body[`schedules/${k}/updatedAt`] = SV_TIMESTAMP;
      body[`schedules/${k}/updatedBy`] = by;
    } else {
      body[`schedules/${k}`] = exists ? { ...stripMeta(v), updatedAt: SV_TIMESTAMP, updatedBy: by } : null;
    }
  }
  if (keys.length) body['kluvyMeta/schedules'] = { updatedAt: SV_TIMESTAMP, updatedBy: by };
  if (batch.aniv) {
    body.anniversaries = anniversaries.length ? anniversaries.map(a => ({ name: a.name, date: a.date, isRepeat: Boolean(a.isRepeat) })) : null;
    body['kluvyMeta/anniversaries'] = { updatedAt: SV_TIMESTAMP, updatedBy: by };
  }
  return body;
}

/** 백업 복원(의도적 전체 덮어쓰기)용 PATCH 본문: schedules·anniversaries 를 통째로 바꾼다 */
export function buildOverwriteBody(db, anniversaries, email = '') {
  const schedules = {};
  for (const [k, v] of Object.entries(db || {})) {
    if (v && typeof v === 'object') schedules[k] = { ...stripMeta(v), updatedAt: SV_TIMESTAMP, updatedBy: email };
  }
  return {
    schedules: Object.keys(schedules).length ? schedules : null,
    anniversaries: anniversaries && anniversaries.length ? anniversaries.map(a => ({ name: a.name, date: a.date, isRepeat: Boolean(a.isRepeat) })) : null,
    'kluvyMeta/schedules': { updatedAt: SV_TIMESTAMP, updatedBy: email, restoredFromBackup: true },
    'kluvyMeta/anniversaries': { updatedAt: SV_TIMESTAMP, updatedBy: email }
  };
}

/** 토큰 만료 전 스트림을 새 토큰으로 다시 여는 시각까지 남은 ms (만료 5분 전, 수명이 짧으면 남은 시간의 1/4 전) */
export function preemptiveReconnectDelay(expMs, nowMs) {
  const left = expMs - nowMs;
  if (!(left > 0)) return 0;
  const lead = Math.min(5 * 60 * 1000, left / 4);
  return Math.max(1000, left - lead);
}
