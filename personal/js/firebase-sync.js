// Firebase Realtime DB 동기화 (2단계: 날짜별 PATCH + 미전송 큐 + 실시간 스트림)
//
// 저장  : 바뀐 날짜만 루트 다중 경로 PATCH 한 번 (schedules/{날짜} = 항목+updatedAt/updatedBy, 삭제 = null)
//         기념일은 배열 스키마라 통째로(바뀌었을 때만). kluvyMeta/{schedules,anniversaries} 에 마지막 변경 기록.
// 큐    : 편집한 날짜를 localStorage 'kluvySyncQueue_v2' 에 쌓고, 온라인·화면 복귀·로그인 때 전송.
//         큐에 있는 날짜는 서버에서 온 값으로 덮지 않는다(전송 성공 후 해제).
// 수신  : RTDB REST 스트리밍(EventSource) — schedules·anniversaries 두 개. put/patch 의 path 의미대로 병합.
//         keep-alive 감시(75초), auth_revoked → 토큰 새로 받아 재연결, cancel → '로그인 필요',
//         토큰 만료(1시간) 전에 미리 새 토큰으로 재연결. 스트림이 안 되면 30초 폴링으로 대체.
//         화면이 꺼지면(백그라운드) 연결·폴링을 멈추고, 돌아오면 다시 연결(처음 오는 put 이 전체 재동기화).
// 빈 폰 보호: 이 폰에 근무표가 없던 채 시작하면 서버를 한 번 받기 전에는 아무것도 보내지 않는다(편집은 큐에 보관).
//         서버 schedules 가 null 이면: v2 가 지운 기록(kluvyMeta/schedules)이 있을 때만 로컬도 비우고,
//         없으면(서버가 처음부터 빔) v1 처럼 이 폰 데이터를 올린다. 빈 근무표를 통째로 올리는 일은 없다.
// 오프라인(v2.5.0): 비행기모드·서버에 못 닿음이면 이 폰 저장분(localStorage·IndexedDB)을 그대로 보여 주고 아무것도 덮지 않는다.
//         배지는 '오프라인'(툴팁 「오프라인 · 마지막 동기화 11/15 17:42」) — 토큰 문제인 '로그인 필요'와 구분.
//         마지막 동기화 시각은 localStorage 'kluvy_last_sync_at' 에 저장해 다음 실행·오프라인에서도 보여 준다.
import { DEFAULT_FIREBASE_URL, STORAGE_KEYS, getConfiguredDbUrl, modeKey } from './config.js';
import { getFbAuthQuery, getIdTokenExpiry, invalidateIdToken, fbIsLoggedIn } from './auth.js';
import { safeGetStorage, safeSetStorage } from './storage.js';
import { state } from './state.js';
import { renderSyncBadge } from './ui/sync-badge.js';
import { renderCalendar } from './render/calendar.js';
import { getDbBaseUrl, buildDbUrl, dbFetch, dbGetJson } from './db-rest.js';
import * as core from './sync-core.js';
import { clearUndo } from './upload-undo.js';
import { saveLastSyncAt, loadLastSyncAt, renderLastSyncText, renderFirstRunNotice, isFirstRunOffline, formatSyncStamp } from './offline.js';

export { getDbBaseUrl };

export const SYNC_QUEUE_KEY = modeKey('kluvySyncQueue_v2'); // v2.6.0: 개인 모드는 kluvy_personal_SyncQueue_v2
export const POLL_INTERVAL_MS = 30000;
const WATCHDOG_MS = 75000;        // RTDB keep-alive 는 약 30초 간격 → 75초 동안 아무것도 없으면 끊긴 것으로 봄
const FLUSH_RETRY_MS = 15000;

const S = {
  ready: true,
  started: false,
  queue: core.loadQueue(null),
  shadow: new Map(),
  anivShadow: '[]',
  anivMirror: null,
  es: {},
  gen: 0,
  mode: 'idle',              // idle | stream | poll | offline | login | paused
  lastError: '',             // '' | network | login | server
  netDown: false,            // navigator.onLine 은 true 지만 서버에 전혀 닿지 않음(기내 와이파이 등) → 오프라인과 같게 표시
  lastEventAt: 0,
  failures: 0,
  authRetry: 0,
  flushing: null,
  flushAgain: false,
  inFlight: null,            // 전송 중인 묶음
  suppressed: new Set(),     // 보낼 편집이 있어 반영을 미룬 서버 변경(날짜) → 전송 후 그 날짜만 다시 받아 수렴
  afterFullSync: [],         // 서버 전체를 처음 받은 뒤 1회 실행할 작업 (마이그레이션 등)
  anivSuppressedInFlight: false,
  timers: {},
  renderQueued: false
};

// ---------------- 빈 폰 보호 (1단계 API 유지) ----------------
/** main.js 가 시작할 때 호출: 로컬에 근무표가 없었으면 서버를 먼저 받아오기 전까지 업로드 금지 */
export function initSyncGuard(hadLocalSchedule) { S.ready = Boolean(hadLocalSchedule); }

/** 서버 근무표 전체를 (이번 실행에서) 처음 받은 직후 한 번 실행할 작업 등록. 이미 받았으면 다음 전체 수신 때 실행 */
export function runAfterFirstFullSync(fn) { S.afterFullSync.push(fn); }
export function markSyncReady() { S.ready = true; }
export function isSyncReady() { return S.ready; }

/** 테스트·디버그용 상태 */
export function getSyncDebug() {
  return { ready: S.ready, mode: S.mode, lastError: S.lastError, netDown: S.netDown, offline: isOfflineNow(), lastSyncAt: lastSyncAt ? lastSyncAt.getTime() : null, pending: core.queueCount(S.queue), queue: JSON.parse(JSON.stringify(S.queue)), streams: Object.keys(S.es).filter(k => S.es[k]).length, failures: S.failures };
}

// ---------------- 마지막 동기화 시각 ----------------
// v2.5.0: 성공할 때마다 localStorage 에도 저장 → 앱을 새로 열어도(오프라인이어도) 마지막 동기화 시각을 보여 준다.
let lastSyncAt = (() => { const v = loadLastSyncAt(); return v ? new Date(v) : null; })();
export function getLastSyncAt() { return lastSyncAt; }
function markSynced() {
  lastSyncAt = new Date();
  S.netDown = false;
  saveLastSyncAt(lastSyncAt.getTime());
  renderLastSyncText(lastSyncAt.getTime(), { offline: false });
}

/** 지금 오프라인으로 봐야 하나: 브라우저 오프라인 · 오프라인 모드 · 서버에 전혀 닿지 않음 */
function isOfflineNow() {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || S.mode === 'offline' || S.netDown;
}

// ---------------- 배지 ----------------
function refreshBadge() {
  const pending = core.queueCount(S.queue);
  const offline = isOfflineNow();
  const last = lastSyncAt ? lastSyncAt.getTime() : null;
  // 첫 진입 안내: 이 폰에 근무표가 하나도 없고 서버에 닿지 못할 때
  renderFirstRunNotice(isFirstRunOffline({ hasLocalSchedule: Object.keys(state.scheduleDB || {}).length > 0, offline, hasDbUrl: Boolean(getConfiguredDbUrl()) }));
  if (!getConfiguredDbUrl()) return renderSyncBadge({ status: 'local' });
  renderLastSyncText(last, { offline });
  // v2.5.0: 오프라인이 먼저 — 비행기모드에서 '로그인 필요'(토큰 문제)로 보이지 않게. 로그인이 안 된 폰이면 툴팁에만 알림.
  if (offline) return renderSyncBadge({ status: 'offline', pending, lastSyncAt: last, needLogin: !fbIsLoggedIn() || S.lastError === 'login' });
  // 로그인 전에는 서버 응답(401)을 기다리지 않고 바로 '로그인 필요'를 보여 준다
  if (!fbIsLoggedIn()) return renderSyncBadge({ status: 'login', pending });
  if (S.mode === 'login' || S.lastError === 'login') return renderSyncBadge({ status: 'login', pending });
  if (pending > 0 && (S.lastError === 'network' || !S.ready || (S.mode !== 'stream' && S.mode !== 'poll'))) {
    return renderSyncBadge({ status: 'pending', pending });
  }
  if (S.lastError === 'server' || S.lastError === 'network') return renderSyncBadge({ status: 'error', pending });
  if (S.mode === 'stream' || S.mode === 'poll') return renderSyncBadge({ status: 'live', pending, mode: S.mode });
}

function renderSoon() {
  if (S.renderQueued) return;
  S.renderQueued = true;
  setTimeout(() => {
    S.renderQueued = false;
    try { renderCalendar(); } catch (e) { console.warn('렌더 실패:', e); }
  }, 0);
}

function persistQueue() { safeSetStorage(SYNC_QUEUE_KEY, S.queue); }
function loginEmail() { return localStorage.getItem(STORAGE_KEYS.loginEmail) || ''; }
const isProtected = k => S.queue.dates[k] !== undefined;
const normAniv = arr => (Array.isArray(arr) ? arr : []).map(a => ({ name: a.name, date: a.date, isRepeat: Boolean(a.isRepeat) }));

// ---------------- 저장 (로컬 + 큐 + 전송) ----------------
/** 로컬 저장 + 바뀐 날짜를 큐에 넣고 서버로 전송 (운영본 saveDB 자리) */
export function saveDB() {
  clearUndo(); // v2.4.6: 다른 저장(편집·기념일·비우기·복원·되돌리기 …)이 있으면 '업로드 되돌리기'는 사라진다 (업로드는 저장 뒤에 새로 기록)
  safeSetStorage(STORAGE_KEYS.schedule, state.scheduleDB);
  safeSetStorage(STORAGE_KEYS.anniversaries, state.customAnniversaries);
  safeSetStorage(STORAGE_KEYS.fileHistory, state.fileHistory);
  const changed = core.diffKeys(S.shadow, state.scheduleDB);
  if (changed.length) {
    // 3단계: 날짜마다 바뀐 칸만 보낸다 (업로드는 자기 칸만, 상대가 같은 날 다른 칸을 고쳐도 안 덮음)
    const fields = {};
    const keys = [];
    for (const k of changed) {
      const f = core.changedFields(S.shadow.get(k), state.scheduleDB[k]);
      if (Array.isArray(f) && f.length === 0) continue; // 내용 같음 (메타만 다름)
      fields[k] = f;
      keys.push(k);
    }
    core.enqueueDates(S.queue, keys, fields);
    for (const k of changed) {
      if (Object.prototype.hasOwnProperty.call(state.scheduleDB, k)) S.shadow.set(k, JSON.stringify(state.scheduleDB[k]));
      else S.shadow.delete(k);
    }
  }
  const anivNow = JSON.stringify(state.customAnniversaries);
  if (anivNow !== S.anivShadow) {
    core.enqueueAnniversaries(S.queue);
    S.anivShadow = anivNow;
  }
  persistQueue();
  refreshBadge();
  flush();
}

/** (1단계 이름 호환) */
export function syncToFirebase() { return flush(); }

async function patchRoot(body) {
  return dbFetch('', { method: 'PATCH', body });
}

/** 큐 전송. 이미 전송 중이면 끝난 뒤 한 번 더. */
export function flush() {
  if (S.flushing) { S.flushAgain = true; return S.flushing; }
  S.flushing = (async () => {
    try {
      do {
        S.flushAgain = false;
        await flushOnce();
      } while (S.flushAgain && core.queueCount(S.queue) > 0 && S.lastError === '');
    } finally {
      S.flushing = null;
    }
  })();
  return S.flushing;
}

async function flushOnce() {
  if (!core.queueCount(S.queue) || !getDbBaseUrl()) return;
  if (!S.ready) { console.info('서버 업로드 보류: 서버 데이터를 아직 받지 못함 (편집은 대기열에 보관)'); refreshBadge(); return; }
  if (!navigator.onLine) { refreshBadge(); return; }
  const batch = core.takeBatch(S.queue);
  const body = core.buildPatchBody(state.scheduleDB, batch, { email: loginEmail(), anniversaries: normAniv(state.customAnniversaries) });
  S.inFlight = batch;
  S.anivSuppressedInFlight = false;
  let res;
  try {
    res = await patchRoot(body);
  } catch (e) {
    S.inFlight = null;
    S.lastError = 'network';
    console.info('전송 실패(네트워크) — 대기열에 보관:', e && e.message);
    refreshBadge();
    scheduleFlushRetry();
    return;
  }
  S.inFlight = null;
  if (res.status === 401) { S.lastError = 'login'; refreshBadge(); return; }
  if (!res.ok) { S.lastError = 'server'; console.warn('전송 실패:', res.status); refreshBadge(); scheduleFlushRetry(); return; }
  core.ackBatch(S.queue, batch);
  persistQueue();
  S.lastError = '';
  markSynced();
  // 보낼 편집이 있는 동안 같은 날짜의 다른 값이 도착했으면(동시 편집·오프라인 중 상대 편집) 서버 최종값을
  // 다시 받아 두 폰이 같은 값으로 수렴하게 한다 (칸 단위 전송이라 상대가 고친 다른 칸도 여기서 받아 옴)
  const refetch = [...S.suppressed].filter(k => batch.dates[k] !== undefined && !isProtected(k));
  for (const k of refetch) {
    S.suppressed.delete(k);
    const r = await dbGetJson(`schedules/${k}`);
    if (r.ok && !isProtected(k)) applyScheduleOps([{ segs: [k], value: r.data }]);
  }
  if (batch.aniv && S.anivSuppressedInFlight && !S.queue.aniv) {
    const r = await dbGetJson('anniversaries');
    if (r.ok) applyAnivOps([{ segs: [], value: r.data }]);
  }
  refreshBadge();
}

function scheduleFlushRetry() {
  clearTimeout(S.timers.flushRetry);
  S.timers.flushRetry = setTimeout(() => { if (navigator.onLine && !document.hidden) flush(); }, FLUSH_RETRY_MS);
}

// ---------------- 수신 반영 ----------------
function applyScheduleOps(ops) {
  const res = core.applyScheduleOps(state.scheduleDB, ops, isProtected);
  if (res.changed.length) {
    state.scheduleDB = res.db;
    for (const k of res.changed) {
      if (Object.prototype.hasOwnProperty.call(res.db, k)) S.shadow.set(k, JSON.stringify(res.db[k]));
      else S.shadow.delete(k);
    }
    safeSetStorage(STORAGE_KEYS.schedule, state.scheduleDB);
    renderSoon();
  }
  if (res.suppressed.length) res.suppressed.forEach(k => S.suppressed.add(k));
  return res;
}

function onSchedulesIncoming(ops) {
  const root = ops.length === 1 && ops[0].segs.length === 0 ? ops[0] : null;
  const rootEmpty = root && (root.value === null || (typeof root.value === 'object' && Object.keys(root.value || {}).length === 0));
  if (rootEmpty && Object.keys(state.scheduleDB).some(k => !isProtected(k))) {
    handleServerSchedulesEmpty();
    return;
  }
  const res = applyScheduleOps(ops);
  if (res.full && !S.ready) {
    S.ready = true;
    console.info('서버 근무표 수신 완료 → 대기열 전송 허용');
  }
  if (res.full) {
    flush();
    if (S.afterFullSync.length) {
      const jobs = S.afterFullSync.splice(0);
      setTimeout(() => { for (const fn of jobs) { try { fn(); } catch (e) { console.warn('동기화 후 작업 실패:', e); } } }, 0);
    }
  }
  return res;
}

async function handleServerSchedulesEmpty() {
  const meta = await dbGetJson('kluvyMeta/schedules');
  if (!meta.ok) return;
  if (meta.data) {
    // 다른 폰(v2)이 근무표를 모두 지운 기록이 있음 → 이 폰도 비운다 (보낼 편집이 있는 날짜는 유지)
    applyScheduleOps([{ segs: [], value: null }]);
  } else {
    // 서버가 처음부터 비어 있음 → v1 과 같이 이 폰 근무표를 올린다 (빈 근무표는 올리지 않음)
    const keys = Object.keys(state.scheduleDB);
    if (keys.length) { core.enqueueDates(S.queue, keys); persistQueue(); }
  }
  S.ready = true;
  refreshBadge();
  flush();
}

function applyAnivOps(ops) {
  for (const { segs, value } of ops) S.anivMirror = core.deepSet(S.anivMirror, segs, value);
  if (S.queue.aniv) { if (S.inFlight) S.anivSuppressedInFlight = true; return; }
  const arr = core.anniversariesFromServer(S.anivMirror);
  if (S.anivMirror === null && state.customAnniversaries.length > 0) {
    handleServerAnivEmpty();
    return;
  }
  if (JSON.stringify(arr) !== JSON.stringify(normAniv(state.customAnniversaries))) {
    state.customAnniversaries = arr;
    S.anivShadow = JSON.stringify(arr);
    safeSetStorage(STORAGE_KEYS.anniversaries, arr);
    renderSoon();
  }
}

async function handleServerAnivEmpty() {
  const meta = await dbGetJson('kluvyMeta/anniversaries');
  if (!meta.ok || S.queue.aniv) return;
  if (meta.data) {
    // v2 에서 마지막 기념일까지 지운 기록 → 받아들임 (1단계까지는 빈 배열을 무시해서 상대 폰에 반영 안 되던 문제)
    state.customAnniversaries = [];
    S.anivShadow = '[]';
    safeSetStorage(STORAGE_KEYS.anniversaries, []);
    renderSoon();
  } else if (S.ready) {
    core.enqueueAnniversaries(S.queue);
    persistQueue();
    flush();
  }
}

function onStreamEvent(gen, which, type, raw) {
  if (gen !== S.gen) return;
  let payload;
  try { payload = JSON.parse(raw); } catch (e) { console.warn('스트림 데이터 해석 실패', e); return; }
  S.lastEventAt = Date.now();
  markSynced();
  const ops = core.eventToOps(type, payload);
  if (which === 'schedules') {
    onSchedulesIncoming(ops);
    if (S.mode !== 'stream') {
      S.mode = 'stream';
      S.failures = 0;
      S.authRetry = 0;
      if (S.lastError === 'login') S.lastError = '';
      stopPolling();
    }
  } else {
    applyAnivOps(ops);
  }
  refreshBadge();
}

// ---------------- 실시간 스트림 ----------------
function closeStreams() {
  S.gen++;
  for (const k of Object.keys(S.es)) { try { S.es[k] && S.es[k].close(); } catch (e) { /* */ } S.es[k] = null; }
  clearTimeout(S.timers.token);
  clearInterval(S.timers.watchdog);
  clearTimeout(S.timers.retry);
}

async function startStreams({ forceToken = false } = {}) {
  closeStreams();
  const base = getDbBaseUrl();
  if (!base) { S.mode = 'idle'; refreshBadge(); return; }
  if (document.hidden) { S.mode = 'paused'; return; }
  if (!navigator.onLine) { S.mode = 'offline'; refreshBadge(); return; }
  if (typeof EventSource === 'undefined') { startPolling(); return; }
  const gen = S.gen;
  let authQ = '';
  try {
    authQ = await getFbAuthQuery({ forceRefresh: forceToken });
  } catch (e) {
    // 토큰 서버에 못 닿음(오프라인 등) → 스트림 실패와 같이 처리 (폴링 대체 + 나중에 재시도)
    if (gen === S.gen) onStreamFailure(gen);
    return;
  }
  if (gen !== S.gen) return;
  S.lastEventAt = Date.now();
  for (const which of ['schedules', 'anniversaries']) {
    const es = new EventSource(buildDbUrl(base, which, authQ));
    S.es[which] = es;
    es.addEventListener('put', e => onStreamEvent(gen, which, 'put', e.data));
    es.addEventListener('patch', e => onStreamEvent(gen, which, 'patch', e.data));
    es.addEventListener('keep-alive', () => { if (gen === S.gen) { S.lastEventAt = Date.now(); markSynced(); } });
    es.addEventListener('cancel', () => {
      if (gen !== S.gen) return;
      console.info('스트림 cancel: 읽기 권한 없음 → 로그인 필요');
      closeStreams(); stopPolling();
      S.mode = 'login'; S.lastError = 'login';
      refreshBadge();
    });
    es.addEventListener('auth_revoked', () => {
      if (gen !== S.gen) return;
      console.info('스트림 auth_revoked → 토큰 새로 받아 재연결');
      closeStreams();
      invalidateIdToken();
      S.timers.retry = setTimeout(() => startStreams({ forceToken: true }), 300);
    });
    es.onerror = () => {
      if (gen !== S.gen) return;
      if (es.readyState === 2 /* CLOSED */) onStreamFailure(gen);
      // CONNECTING: 브라우저가 알아서 다시 연결 (다시 연결되면 처음 put 이 전체를 다시 보냄)
    };
  }
  // 토큰 만료 전에 새 토큰으로 미리 다시 연결
  const exp = getIdTokenExpiry();
  if (exp) S.timers.token = setTimeout(() => { if (gen === S.gen) startStreams({ forceToken: true }); }, core.preemptiveReconnectDelay(exp, Date.now()));
  S.timers.watchdog = setInterval(() => {
    if (gen !== S.gen) return;
    if (Date.now() - S.lastEventAt > WATCHDOG_MS) { console.info('keep-alive 끊김 → 재연결'); startStreams(); }
  }, 15000);
}

async function onStreamFailure(gen) {
  closeStreams();
  if (!navigator.onLine) { S.mode = 'offline'; refreshBadge(); return; }
  // EventSource 는 HTTP 상태를 알려 주지 않으므로 가벼운 요청으로 원인 확인
  let status = 0;
  try {
    const res = await fetch(buildDbUrl(getDbBaseUrl(), 'schedules', await getFbAuthQuery(), 'shallow=true'));
    status = res.status;
  } catch (e) { status = 0; }
  S.netDown = status === 0; // 서버에 전혀 닿지 않음 → 배지는 '오프라인' (폴링·재시도는 계속)
  if (status === 401) {
    invalidateIdToken();
    if (S.authRetry < 1) {
      S.authRetry++;
      const q = await getFbAuthQuery({ forceRefresh: true });
      if (q) { startStreams(); return; }
    }
    S.mode = 'login'; S.lastError = 'login';
    refreshBadge();
    return;
  }
  // 스트림만 안 되는 환경 → 30초 폴링으로 대체하고, 스트림은 점점 길게 간격을 두고 다시 시도
  S.failures++;
  startPolling();
  const wait = Math.min(5 * 60000, 30000 * 2 ** Math.min(S.failures - 1, 4));
  S.timers.retry = setTimeout(() => { if (!document.hidden && navigator.onLine) startStreams(); }, wait);
}

// ---------------- 폴링 (스트림 대체) ----------------
function startPolling() {
  if (S.timers.poll) return;
  if (S.mode !== 'stream') S.mode = 'poll';
  fullFetch();
  S.timers.poll = setInterval(() => {
    if (navigator.onLine && !document.hidden) fullFetch();
  }, POLL_INTERVAL_MS);
}
function stopPolling() {
  clearInterval(S.timers.poll);
  S.timers.poll = null;
}

/** schedules·anniversaries 를 한 번 통째로 받아 반영 → {status:'ok'|'login'|'error', updated} */
async function fullFetch() {
  if (!getDbBaseUrl()) return { status: 'error', updated: false };
  // 오프라인: 요청하지 않고 이 폰 저장분을 그대로 둔다 (덮어쓰기 없음)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { refreshBadge(); return { status: 'offline', updated: false }; }
  const before = JSON.stringify([state.scheduleDB, state.customAnniversaries]);
  const [rs, ra] = await Promise.all([dbGetJson('schedules'), dbGetJson('anniversaries')]);
  if (rs.status === 401 || ra.status === 401) { S.lastError = 'login'; S.mode = S.mode === 'stream' ? 'stream' : 'login'; refreshBadge(); return { status: 'login', updated: false }; }
  if (rs.status === 0 && ra.status === 0) { S.netDown = true; refreshBadge(); return { status: 'offline', updated: false }; }
  if (!rs.ok || !ra.ok) { refreshBadge(); return { status: 'error', updated: false }; }
  onSchedulesIncoming([{ segs: [], value: rs.data }]);
  applyAnivOps([{ segs: [], value: ra.data }]);
  if (S.lastError === 'login') S.lastError = '';
  markSynced();
  refreshBadge();
  return { status: 'ok', updated: before !== JSON.stringify([state.scheduleDB, state.customAnniversaries]) };
}

// ---------------- 시작 / 멈춤 / 재개 ----------------
function pause() {
  closeStreams();
  stopPolling();
  if (S.mode !== 'login') S.mode = 'paused';
}

function resume() {
  if (!getConfiguredDbUrl()) { S.mode = 'idle'; refreshBadge(); return; }
  if (document.hidden) return;
  if (!navigator.onLine) { S.mode = 'offline'; refreshBadge(); return; }
  if (S.mode === 'offline' || S.mode === 'paused') S.mode = 'idle';
  if (S.lastError === 'network') S.lastError = '';
  refreshBadge();
  flush();
  startStreams();
}

/** 앱 시작 시 1회 (main.js) */
export function initSync() {
  if (S.started) return;
  S.started = true;
  S.queue = core.loadQueue(safeGetStorage(SYNC_QUEUE_KEY, null));
  S.shadow = core.snapshotDB(state.scheduleDB);
  S.anivShadow = JSON.stringify(state.customAnniversaries);
  window.addEventListener('online', () => { S.netDown = false; resume(); });
  window.addEventListener('offline', () => { closeStreams(); stopPolling(); clearTimeout(S.timers.flushRetry); S.mode = 'offline'; refreshBadge(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
  refreshBadge();
  resume();
}

/** 로그인 직후·DB 주소 변경 후: 오류 상태를 지우고 전송 + 스트림 다시 시작 */
export function restartSync() {
  S.lastError = '';
  S.authRetry = 0;
  S.failures = 0;
  if (S.mode === 'login') S.mode = 'idle';
  stopPolling();
  resume();
}

/** 로그아웃: 연결 끊기 */
export function stopSync() {
  closeStreams();
  stopPolling();
  S.mode = 'login';
  refreshBadge();
}

/** 오프라인일 때 배지를 누르면 보여 줄 안내 */
export function offlineManualSyncMessage(lastSyncAtMs, pending = 0) {
  const when = lastSyncAtMs ? `마지막 동기화 ${formatSyncStamp(lastSyncAtMs)}` : '아직 동기화한 적 없음';
  return `지금은 오프라인입니다 (${when}).\n이 폰에 저장된 근무표·사진을 보여 주고 있어요.` +
    (pending > 0 ? `\n보낼 편집 ${pending}건은 인터넷이 연결되면 자동으로 보냅니다.` : '\n편집하면 인터넷이 연결될 때 자동으로 보냅니다.');
}

/**
 * 한 번 통째로 받아오기 (수동 동기화·로그인 직후). isManual 이면 결과 알림
 * 실패(오프라인·서버 오류·로그인)면 이 폰 근무표·기념일은 그대로 둔다(덮어쓰기 없음).
 * @returns {Promise<'ok'|'offline'|'login'|'error'|'local'>}
 */
export async function loadFromFirebase(isManual = false) {
  if (!getConfiguredDbUrl()) return 'local';
  await flush();
  const r = await fullFetch();
  if (r.status === 'offline') {
    if (isManual) alert(offlineManualSyncMessage(lastSyncAt ? lastSyncAt.getTime() : null, core.queueCount(S.queue)));
    return 'offline';
  }
  if (r.status === 'login') {
    if (isManual) alert("동기화하려면 로그인이 필요합니다. 업로드 화면 > 동기화 '설정'에서 로그인해 주세요.");
    return 'login';
  }
  if (r.status === 'error') {
    if (isManual) alert('동기화 연결 실패: Firebase 규칙 및 네트워크를 확인해 주세요.');
    return 'error';
  }
  if (isManual) alert(r.updated ? '클라우드에서 최신 근무표와 기념일을 동기화했습니다!' : '이미 최신 동기화 상태입니다!');
  if (S.mode !== 'stream') startStreams();
  return 'ok';
}

export function manualSyncNow() {
  const dbInput = document.getElementById('firebaseDbUrl');
  const dbUrl = dbInput && dbInput.value.trim() ? dbInput.value.trim() : (localStorage.getItem(STORAGE_KEYS.dbUrl) || DEFAULT_FIREBASE_URL);
  safeSetStorage(STORAGE_KEYS.dbUrl, dbUrl);
  S.lastError = '';
  loadFromFirebase(true);
}

/** DB 주소 입력칸: 글자마다 업로드하던 v1 과 달리 저장만 하고, 입력이 멈추면 연결을 다시 시작 */
export function onFirebaseUrlChanged() {
  const url = document.getElementById('firebaseDbUrl').value.trim();
  safeSetStorage(STORAGE_KEYS.dbUrl, url);
  refreshBadge();
  clearTimeout(S.timers.url);
  S.timers.url = setTimeout(() => restartSync(), 1500);
}

/**
 * 백업 복원: 의도적인 전체 덮어쓰기 (확인창을 거친 뒤에만 호출).
 * 서버의 schedules·anniversaries 를 지금 로컬 내용으로 통째로 바꾼다. 실패하면 바뀐 날짜를 대기열로.
 * @returns {Promise<boolean>} 서버 반영 성공 여부
 */
export async function overwriteServerWithLocal() {
  S.ready = true;
  safeSetStorage(STORAGE_KEYS.schedule, state.scheduleDB);
  safeSetStorage(STORAGE_KEYS.anniversaries, state.customAnniversaries);
  safeSetStorage(STORAGE_KEYS.fileHistory, state.fileHistory);
  if (getDbBaseUrl() && navigator.onLine) {
    try {
      const res = await patchRoot(core.buildOverwriteBody(state.scheduleDB, normAniv(state.customAnniversaries), loginEmail()));
      if (res.ok) {
        S.queue = core.loadQueue(null);
        persistQueue();
        S.shadow = core.snapshotDB(state.scheduleDB);
        S.anivShadow = JSON.stringify(state.customAnniversaries);
        markSynced();
        refreshBadge();
        return true;
      }
      if (res.status === 401) S.lastError = 'login';
    } catch (e) {
      console.info('복원 전송 실패 — 대기열로:', e && e.message);
    }
  }
  saveDB();
  return false;
}
