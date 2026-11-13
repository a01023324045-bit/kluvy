// 편명 시간표 (두 폰 공유) + AirLabs 조회 (선택 기능)
//
// Firebase 새 경로 flightTimes/{편명}   (예: flightTimes/TW405)
//   { dep:'ICN', arr:'FCO', std:'09:00'(출발지 현지), sta:'17:00'(도착지 현지),
//     source:'schedule'|'manual'|'airlabs', updatedAt(서버시각), updatedBy,
//     airlabs?: { dep, arr, std, sta, days[], fetchedAt }          ← 정기 노선(Routes) 조회 결과
//     days?: { 'YYYY-MM-DD': { std, sta, etd, eta, atd, ata, status, depDelay, arrDelay, fetchedAt } } } ← 실시간(Flight) 조회
// 루트 규칙(두 UID 만 read/write)에 그대로 포함되므로 규칙 변경 불필요.
// 쓰기는 칸 단위 루트 PATCH (근무표 동기화 대기열과 별개 — 실패하면 다음에 같은 편을 저장할 때 다시 보냄).
// 폰 캐시: localStorage 'kluvy_flight_times_v1'.
import { AIRLABS_KEY_STORAGE, AIRLABS_USAGE_STORAGE, FLIGHT_TIMES_CACHE, STORAGE_KEYS, getAirlabsBase } from './config.js';
import { safeGetStorage, safeSetStorage } from './storage.js';
import { dbFetch, dbGetJson, getDbBaseUrl } from './db-rest.js';
import { SV_TIMESTAMP } from './sync-core.js';
import { learnableFromGf, normalizeFlight, fillGfFromTimetable } from './flight.js';
import {
  airlabsUrl, chooseEndpoint, parseAirlabsFlight, parseAirlabsRoutes, airlabsErrorDetail, cleanAirlabsKey,
  AIRLABS_LIVE_TTL_MIN, AIRLABS_ROUTE_TTL_DAYS, AIRLABS_FREE_MONTHLY
} from './airlabs.js';
import { getKSTDate, makeDateKey } from './dates.js';

const PENDING_KEY = 'kluvy_flight_times_pending';
let table = null;
const listeners = new Set();

export function getFlightTable() {
  if (!table) {
    const t = safeGetStorage(FLIGHT_TIMES_CACHE, {});
    table = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  }
  return table;
}
function persist() { safeSetStorage(FLIGHT_TIMES_CACHE, table); }
function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.warn(e); } } }
export function onFlightTimesChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const email = () => localStorage.getItem(STORAGE_KEYS.loginEmail) || '';

/** 서버의 flightTimes 를 받아 캐시 갱신 (실패해도 캐시 유지). 아직 못 보낸 학습값은 다시 보냄 */
export async function refreshFlightTimes() {
  if (!getDbBaseUrl()) return false;
  const r = await dbGetJson('flightTimes');
  if (!r.ok) return false;
  const server = r.data && typeof r.data === 'object' ? r.data : {};
  const pending = safeGetStorage(PENDING_KEY, {}) || {};
  table = { ...server };
  for (const [code, e] of Object.entries(pending)) table[code] = { ...(table[code] || {}), ...e };
  persist();
  notify();
  if (Object.keys(pending).length) pushPending();
  return true;
}

async function patchFlight(body) {
  if (!getDbBaseUrl() || !navigator.onLine) return false;
  try {
    const res = await dbFetch('', { method: 'PATCH', body });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function pushPending() {
  const pending = safeGetStorage(PENDING_KEY, {}) || {};
  const codes = Object.keys(pending);
  if (!codes.length) return true;
  const body = {};
  for (const code of codes) {
    for (const f of ['dep', 'arr', 'std', 'sta', 'source', 'updatedBy']) body[`flightTimes/${code}/${f}`] = pending[code][f] ?? null;
    body[`flightTimes/${code}/updatedAt`] = SV_TIMESTAMP;
  }
  const ok = await patchFlight(body);
  if (ok) {
    const now = safeGetStorage(PENDING_KEY, {}) || {};
    for (const code of codes) if (JSON.stringify(now[code]) === JSON.stringify(pending[code])) delete now[code];
    safeSetStorage(PENDING_KEY, now);
  }
  return ok;
}

/**
 * 확정된 근무(미리보기 반영·수동 편집)에서 편명 시각을 배운다.
 * @param {object} gf
 * @param {'schedule'|'manual'} source
 * @returns {string|null} 배운 편명
 */
export function learnFlightFromGf(gf, source = 'schedule') {
  const L = learnableFromGf(gf);
  if (!L) return null;
  const t = getFlightTable();
  const cur = t[L.code] || {};
  if (cur.std === L.std && cur.sta === L.sta && cur.dep === L.dep && cur.arr === L.arr) return null;
  const entry = { dep: L.dep, arr: L.arr, std: L.std, sta: L.sta, source, updatedBy: email() };
  t[L.code] = { ...cur, ...entry, updatedAt: Date.now() };
  persist();
  const pending = safeGetStorage(PENDING_KEY, {}) || {};
  pending[L.code] = entry;
  safeSetStorage(PENDING_KEY, pending);
  pushPending();
  notify();
  return L.code;
}

/** 시각이 빠진 비행 근무 → 시간표로 채운 gf (못 채우면 null) */
export function fillFromFlightTable(gf) {
  return fillGfFromTimetable(gf, getFlightTable());
}

// ---------------- AirLabs (선택) ----------------
// 키는 이 폰 localStorage 'airlabs_api_key' 에 문자열 그대로 (v2.2.0 과 같은 형식 — 섞여 써도 안전)
export function getAirlabsKey() {
  let v = '';
  try { v = localStorage.getItem(AIRLABS_KEY_STORAGE) || ''; } catch (e) { v = ''; }
  return cleanAirlabsKey(v);
}
/** 정리(공백·줄바꿈·따옴표 제거)해서 저장하고 저장된 값을 돌려줌. 저장 실패면 null */
export function setAirlabsKey(k) {
  const clean = cleanAirlabsKey(k);
  safeSetStorage(AIRLABS_KEY_STORAGE, clean);
  return getAirlabsKey() === clean ? clean : null;
}

/** 이번 달 이 폰에서 보낸 AirLabs 요청 수 */
export function getAirlabsUsage() {
  const now = getKSTDate();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const u = safeGetStorage(AIRLABS_USAGE_STORAGE, null);
  return u && u.month === month ? { month, count: Number(u.count) || 0 } : { month, count: 0 };
}
function countUsage() {
  const u = getAirlabsUsage();
  u.count++;
  safeSetStorage(AIRLABS_USAGE_STORAGE, u);
  return u;
}
export function airlabsUsageText() {
  const u = getAirlabsUsage();
  return `이 폰 이번 달 ${u.count}회 사용 (무료 한도 월 ${AIRLABS_FREE_MONTHLY.toLocaleString()}회 — 두 폰 합산)`;
}

/** AirLabs 호출. 응답 JSON 에 _http(상태 코드)를 붙여 돌려줌. 네트워크 오류는 throw */
async function callAirlabs(endpoint, params, key) {
  countUsage();
  const res = await fetch(airlabsUrl(getAirlabsBase(), endpoint, params, key));
  let json = null;
  let text = '';
  try { text = await res.text(); json = JSON.parse(text); } catch (e) { json = null; }
  if (!json || typeof json !== 'object') {
    return { _http: res.status, error: { code: res.ok ? 'internal_error' : `http_${res.status}`, message: `HTTP ${res.status}${text ? ' ' + text.slice(0, 120) : ''}` } };
  }
  json._http = res.status;
  return json;
}

function netError(e) {
  return `AirLabs 에 연결하지 못했습니다 (네트워크·차단: ${e && e.message ? e.message : e}). 인터넷 연결을 확인해 주세요.`;
}

/**
 * [N월 등록] → 「✈️ AirLabs」 → [연결 확인]: /api/v9/ping 으로 키 확인. 결과는 화면에 그대로 보여 줄 글.
 * @returns {Promise<{ok:boolean, text:string, http?:number, code?:string, raw?:string}>}
 */
export async function pingAirlabs(rawKey) {
  const key = cleanAirlabsKey(rawKey !== undefined ? rawKey : getAirlabsKey());
  if (!key) return { ok: false, text: 'AirLabs API 키가 비어 있습니다. 키를 붙여 넣은 뒤 다시 눌러 주세요.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, text: '인터넷 연결이 없습니다.' };
  let json;
  try { json = await callAirlabs('ping', {}, key); } catch (e) { return { ok: false, text: netError(e) }; }
  const http = json._http;
  if (json.error) return { ok: false, http, code: String(json.error.code || ''), raw: String(json.error.message || ''), text: `실패 · ${airlabsErrorDetail(json.error, http)}` };
  const resp = json.response !== undefined ? json.response : json;
  let short = typeof resp === 'string' ? resp : JSON.stringify(resp);
  if (short.length > 80) short = short.slice(0, 80) + '…';
  return { ok: true, http, text: `정상 · 응답 ${short} (HTTP ${http})` };
}

/**
 * 버튼을 눌렀을 때만 호출 (자동 대량 호출 없음). 같은 편·날짜는 30분, 정기 노선은 7일 안에 다시 묻지 않고 캐시를 쓴다.
 * @returns {Promise<{ok:boolean, cached?:boolean, kind?:'flight'|'routes', message:string}>}
 */
export async function lookupFlightOnAirlabs(flightStr, dateKey, { force = false, now = Date.now() } = {}) {
  const key = getAirlabsKey();
  if (!key) return { ok: false, message: 'AirLabs API 키가 없습니다. [N월 등록] → 「✈️ AirLabs (비행 시각 조회, 선택)」 칸에 넣어 주세요.' };
  const f = normalizeFlight(flightStr);
  if (!f) return { ok: false, message: '편명을 알아볼 수 없습니다.' };
  if (!navigator.onLine) return { ok: false, message: '인터넷 연결이 없습니다.' };
  const t = getFlightTable();
  const cur = t[f.iata] || {};
  const k = getKSTDate();
  const todayKey = makeDateKey(k.getFullYear(), k.getMonth() + 1, k.getDate());
  let kind = chooseEndpoint(dateKey, todayKey);

  if (kind === 'flight') {
    const c = cur.days && cur.days[dateKey];
    if (!force && c && c.fetchedAt && now - c.fetchedAt < AIRLABS_LIVE_TTL_MIN * 60000) {
      return { ok: true, cached: true, kind, message: `${Math.round((now - c.fetchedAt) / 60000)}분 전에 받은 정보입니다 (${AIRLABS_LIVE_TTL_MIN}분 안에는 다시 묻지 않음).` };
    }
    let json;
    try { json = await callAirlabs('flight', { flight_iata: f.iata }, key); } catch (e) { return { ok: false, message: netError(e) }; }
    const p = parseAirlabsFlight(json, dateKey);
    if (p.error && p.error.code !== 'not_found') return { ok: false, message: airlabsErrorDetail(p.error, json._http) };
    if (!p.error && p.match) {
      const day = { std: p.std, sta: p.sta, staDate: p.staDate, etd: p.etd, eta: p.eta, atd: p.atd, ata: p.ata, status: p.status, depDelay: p.depDelay, arrDelay: p.arrDelay, dep: p.dep, arr: p.arr, fetchedAt: now };
      t[f.iata] = { ...cur, days: { ...(cur.days || {}), [dateKey]: day } };
      if (!cur.std && !cur.sta) Object.assign(t[f.iata], { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, source: 'airlabs' });
      persist(); notify();
      const body = { [`flightTimes/${f.iata}/days/${dateKey}`]: { ...day, fetchedAt: SV_TIMESTAMP } };
      if (!cur.std && !cur.sta) Object.assign(body, { [`flightTimes/${f.iata}/dep`]: p.dep, [`flightTimes/${f.iata}/arr`]: p.arr, [`flightTimes/${f.iata}/std`]: p.std, [`flightTimes/${f.iata}/sta`]: p.sta, [`flightTimes/${f.iata}/source`]: 'airlabs', [`flightTimes/${f.iata}/updatedAt`]: SV_TIMESTAMP });
      patchFlight(body);
      return { ok: true, kind, message: '실시간 정보를 받았습니다.' };
    }
    kind = 'routes'; // 가장 가까운 운항이 다른 날짜 → 정기 노선으로
  }

  const a = cur.airlabs;
  if (!force && a && a.fetchedAt && now - a.fetchedAt < AIRLABS_ROUTE_TTL_DAYS * 86400000) {
    return { ok: true, cached: true, kind, message: `정기 노선 정보는 ${AIRLABS_ROUTE_TTL_DAYS}일 안에 다시 묻지 않습니다 (캐시 사용).` };
  }
  let json;
  try { json = await callAirlabs('routes', { airline_iata: f.airline, flight_iata: f.iata }, key); } catch (e) { return { ok: false, message: netError(e) }; }
  const p = parseAirlabsRoutes(json, f.iata, dateKey);
  if (p.error) return { ok: false, message: airlabsErrorDetail(p.error, json._http) };
  const route = { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, days: p.days, fetchedAt: now };
  t[f.iata] = { ...cur, airlabs: route };
  if (!cur.std && !cur.sta) Object.assign(t[f.iata], { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, source: 'airlabs' });
  persist(); notify();
  const body = { [`flightTimes/${f.iata}/airlabs`]: { ...route, fetchedAt: SV_TIMESTAMP } };
  if (!cur.std && !cur.sta) Object.assign(body, { [`flightTimes/${f.iata}/dep`]: p.dep, [`flightTimes/${f.iata}/arr`]: p.arr, [`flightTimes/${f.iata}/std`]: p.std, [`flightTimes/${f.iata}/sta`]: p.sta, [`flightTimes/${f.iata}/source`]: 'airlabs', [`flightTimes/${f.iata}/updatedAt`]: SV_TIMESTAMP });
  patchFlight(body);
  return { ok: true, kind, message: p.operatesThatDay ? '정기 노선 시각을 받았습니다.' : '정기 노선 시각을 받았습니다 (이 요일 운항 여부는 확인되지 않음).' };
}
