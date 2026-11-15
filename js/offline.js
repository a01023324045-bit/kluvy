// 오프라인(비행기모드) 열람 도우미 (v2.5.0)
//
//  - 마지막 동기화 시각: 서버와 마지막으로 주고받은(성공) 시각을 localStorage 'kluvy_last_sync_at'(밀리초)에 저장 →
//    앱을 다시 열어도, 오프라인이어도 「오프라인 · 마지막 동기화 11/15 17:42」 로 보여 준다.
//  - 첫 진입 안내: 이 폰에 근무표가 하나도 없고 서버에 닿지 못하면 빈 달력 대신 안내 문구.
//  - 미리 받기: 온라인으로 열 때 이번 달 + 다음 달 근무표 사진을 IndexedDB 에 받아 둔다 (근무 데이터는 원래 전체를 받음).
//    10분에 한 번까지만, 사진은 서버 값이 바뀐 달만(최대 2장). 실패는 조용히 무시.
// 이 파일의 앞부분은 DOM 없이 테스트할 수 있는 순수 함수, 뒷부분은 화면 갱신.
import { getKSTDate, makeMonthKey } from './dates.js';

export const LAST_SYNC_KEY = 'kluvy_last_sync_at';
export const PREFETCH_KEY = 'kluvy_prefetch_v1';
export const PREFETCH_MIN_GAP_MS = 10 * 60 * 1000;
export const FIRST_RUN_OFFLINE_TEXT = '인터넷에 연결한 뒤 한 번 열어야 근무표를 내려받습니다.';

const ls = () => (typeof localStorage !== 'undefined' ? localStorage : null);
const pad2 = n => String(n).padStart(2, '0');

// ---------------- 마지막 동기화 시각 ----------------
/** 성공한 동기화 시각 저장 (밀리초). 저장 실패는 무시 */
export function saveLastSyncAt(ms, storage = ls()) {
  const v = Number(ms);
  if (!storage || !Number.isFinite(v) || v <= 0) return false;
  try { storage.setItem(LAST_SYNC_KEY, String(Math.round(v))); return true; } catch (e) { return false; }
}

/** 저장된 마지막 동기화 시각 (없거나 이상하면 null) */
export function loadLastSyncAt(storage = ls()) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(LAST_SYNC_KEY); } catch (e) { return null; }
  const v = Number(raw);
  return raw && Number.isFinite(v) && v > 0 ? v : null;
}

/** '11/15 17:42' (폰 시계 기준) */
export function formatSyncStamp(ms) {
  const d = new Date(Number(ms));
  if (!ms || Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 배지 툴팁·안내: '오프라인 · 마지막 동기화 11/15 17:42' (기록 없으면 '아직 동기화한 적 없음') */
export function offlineStatusText(lastSyncAt) {
  const s = formatSyncStamp(lastSyncAt);
  return s ? `오프라인 · 마지막 동기화 ${s}` : '오프라인 · 아직 동기화한 적 없음';
}

/**
 * 상단 오른쪽 글: 온라인 — 오늘이면 '마지막 동기화 17:42', 다른 날이면 '마지막 동기화 11/14 17:42'.
 * 오프라인 — '오프라인 · 마지막 동기화 11/15 17:42' (폰에서는 툴팁이 안 보이므로 화면에 그대로 씀)
 */
export function lastSyncLabel(lastSyncAt, { offline = false, now = Date.now() } = {}) {
  if (offline) return offlineStatusText(lastSyncAt);
  if (!lastSyncAt) return '';
  const d = new Date(Number(lastSyncAt));
  const n = new Date(Number(now));
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return `마지막 동기화 ${sameDay ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : formatSyncStamp(lastSyncAt)}`;
}

// ---------------- 첫 진입 오프라인 판정 ----------------
/**
 * 빈 달력 대신 '인터넷에 연결한 뒤 한 번 열어야…' 안내를 보여야 하나?
 * @param {{hasLocalSchedule:boolean, offline:boolean, hasDbUrl?:boolean}} s
 */
export function isFirstRunOffline({ hasLocalSchedule, offline, hasDbUrl = true }) {
  return Boolean(hasDbUrl) && !hasLocalSchedule && Boolean(offline);
}

// ---------------- 미리 받기 ----------------
/**
 * 미리 받을 달: 이번 달(KST) + 다음 달. 12월이면 다음 해 1월.
 * @param {Date} kstNow getKSTDate() 처럼 KST 벽시계 값을 가진 Date
 * @returns {string[]} ['2026-11', '2026-12']
 */
export function prefetchMonthKeys(kstNow = getKSTDate()) {
  const y = kstNow.getFullYear();
  const m = kstNow.getMonth() + 1;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return [makeMonthKey(y, m), makeMonthKey(ny, nm)];
}

/** 지난 미리 받기 기록을 보고 지금 다시 해도 되나 (10분 간격, 달이 바뀌었으면 바로) */
export function shouldPrefetch(record, months, now = Date.now(), minGap = PREFETCH_MIN_GAP_MS) {
  if (!record || !record.at) return true;
  const prev = Array.isArray(record.months) ? record.months.join(',') : '';
  if (prev !== months.join(',')) return true;
  return now - Number(record.at) >= minGap;
}

/** 그 달 근무 데이터가 이 폰에 몇 일 있나 (미리 받기 기록용) */
export function countMonthDays(db, monthKey) {
  return Object.keys(db || {}).filter(k => k.startsWith(monthKey + '-')).length;
}

export function loadPrefetchRecord(storage = ls()) {
  try { const r = JSON.parse((storage && storage.getItem(PREFETCH_KEY)) || 'null'); return r && typeof r === 'object' ? r : null; } catch (e) { return null; }
}

/**
 * 이번 달 + 다음 달 사진 미리 받기 (근무 데이터는 동기화가 schedules 전체를 받으므로 이미 들어 있음)
 * @param {{db:object, syncPhoto:(m:string)=>Promise<{action:string}>, online?:()=>boolean, storage?:Storage, now?:number, kstNow?:Date, force?:boolean}} o
 * @returns {Promise<object|null>} 기록 { at, months, result:{ '2026-11': { days, photo } } } — 건너뛰면 null
 */
export async function runPrefetch({ db, syncPhoto, online = () => true, storage = ls(), now = Date.now(), kstNow = getKSTDate(), force = false }) {
  const months = prefetchMonthKeys(kstNow);
  if (!online()) return null;
  if (!force && !shouldPrefetch(loadPrefetchRecord(storage), months, now)) return null;
  const result = {};
  for (const m of months) {
    let photo = 'skip';
    if (online()) {
      try { photo = (await syncPhoto(m)).action; } catch (e) { photo = 'error'; }
    }
    result[m] = { days: countMonthDays(db, m), photo };
  }
  const rec = { at: now, months, result };
  try { storage && storage.setItem(PREFETCH_KEY, JSON.stringify(rec)); } catch (e) { /* 저장 실패는 무시 */ }
  return rec;
}

// ---------------- 화면 ----------------
/** 상단 오른쪽 '마지막 동기화' 글 갱신 */
export function renderLastSyncText(lastSyncAt, { offline = false } = {}) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('lastSyncText');
  if (!el) return;
  const text = lastSyncLabel(lastSyncAt, { offline });
  if (!text) return; // 기록이 없으면 원래 문구(트리니티항공 & 교대근무 캘린더) 유지
  el.textContent = text;
  el.title = offline ? `${text} — 이 폰에 저장된 근무표를 보여 주는 중` : '서버와 마지막으로 주고받은 시각';
  el.dataset.offline = offline ? '1' : '';
  // 오프라인 문구는 잘리면 안 되므로(…로 끝나면 시각이 안 보임) 좁은 폰에서는 다음 줄로 내려 오른쪽 정렬
  if (el.classList) el.classList.toggle('truncate', !offline);
  el.style && (el.style.marginLeft = offline ? 'auto' : '');
  if (el.parentElement && el.parentElement.style) el.parentElement.style.flexWrap = offline ? 'wrap' : '';
}

/** 첫 진입 안내 표시/숨김 */
export function renderFirstRunNotice(show) {
  if (typeof document === 'undefined') return;
  const box = document.getElementById('offlineFirstRunNotice');
  if (!box) return;
  box.classList.toggle('hidden', !show);
}
