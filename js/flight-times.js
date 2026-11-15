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
import { learnableLegs, normalizeFlight, fillGfFromTimetable, flightNoVariants, splitFlightNo, findFlightEntry } from './flight.js';
import {
  airlabsUrl, chooseEndpoint, parseAirlabsFlight, parseAirlabsRoutes, airlabsErrorDetail, cleanAirlabsKey, dateWithDow,
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
 * 확정된 근무(미리보기 반영·수동 편집)에서 편명 시각을 편별로 배운다 (v2.3.1: 왕복이면 편마다).
 *  - 체류 비행 1편의 근무표 시각 → 그 편 시간표를 갱신 (기존과 같음)
 *  - 편집창에서 편마다 직접 넣은 시각(source 'manual') → 그날의 지연 시각일 수 있어 서버 시간표에 그 편 시각이 없을 때만 채움
 * @param {object} gf
 * @param {'schedule'|'manual'} source
 * @returns {string|null} 배운 편명(여러 개면 쉼표로)
 */
export function learnFlightFromGf(gf, source = 'schedule') {
  const items = learnableLegs(gf, source);
  if (!items.length) return null;
  const t = getFlightTable();
  const pending = safeGetStorage(PENDING_KEY, {}) || {};
  const learned = [];
  for (const L of items) {
    const cur = t[L.code] || {};
    const seen = findFlightEntry(t, L.code) || {}; // 0 유무만 다른 같은 편(TW33/TW033)에 이미 같은 값이면 새로 만들지 않음
    if (seen.std === L.std && seen.sta === L.sta && seen.dep === L.dep && seen.arr === L.arr) continue;
    if (L.perDay && (seen.std || seen.sta)) continue; // 하루치 직접 입력(지연 시각일 수 있음)은 기존 시간표(정기 포함)를 덮지 않음
    const entry = { dep: L.dep, arr: L.arr, std: L.std, sta: L.sta, source: L.source, updatedBy: email() };
    t[L.code] = { ...cur, ...entry, updatedAt: Date.now() };
    pending[L.code] = entry;
    learned.push(L.code);
  }
  if (!learned.length) return null;
  persist();
  safeSetStorage(PENDING_KEY, pending);
  pushPending();
  notify();
  return learned.join(',');
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

/** v2.4.5: 다시 조회한 편명 안내 — '0 뺀 편명으로 다시 조회 (TW33)' (첫째는 원래 표기라 안내 없음) */
export function retryNoteText(original, tried) {
  const orig = splitFlightNo(original);
  const parts = (tried || []).filter(v => v !== original).map(v => {
    const p = splitFlightNo(v);
    const stripped = orig && p && p.digits.length < orig.digits.length;
    return `${stripped ? '0 뺀' : '0 붙인'} 편명으로 다시 조회 (${v})`;
  });
  return parts.join(', ');
}

/**
 * 편명 변형(flightNoVariants)을 차례로 물어 본다 — not_found 일 때만 다음 변형으로 (다른 오류·성공이면 바로 멈춤).
 * @returns {Promise<{json, p, used:string, tried:string[], missed:boolean}>}  missed = 모든 변형이 not_found
 */
async function askVariants(variants, ask, parse) {
  const tried = [];
  let last = null;
  for (const v of variants) {
    const json = await ask(v);
    tried.push(v);
    const p = parse(json, v);
    last = { json, p, used: v, tried };
    if (!(p.error && p.error.code === 'not_found')) return { ...last, missed: false };
  }
  return { ...last, missed: true };
}

/**
 * 버튼을 눌렀을 때만 호출 (자동 대량 호출 없음). 같은 편·날짜는 30분, 정기 노선은 7일 안에 다시 묻지 않고 캐시를 쓴다.
 * v2.4.5: AirLabs 가 not_found 이면 0 유무를 바꾼 편명으로 다시 조회한다 (TW033 → TW033, TW33 순서 / TW33 → TW33, TW033).
 *   - 결과 캐시 키는 항상 '처음 적힌 편명' 기준 (flightTimes/TW033/…)
 *   - 변형 모두 not_found 면 flightTimes/{편명}/airlabsNoMatch 에 기록 → 7일 안에는 (force 가 아니면) 다시 묻지 않음 (무료 한도 보호)
 * @returns {Promise<{ok:boolean, cached?:boolean, noMatch?:boolean, kind?:'flight'|'routes', message:string, tried?:string[]}>}
 */
export async function lookupFlightOnAirlabs(flightStr, dateKey, { force = false, now = Date.now() } = {}) {
  const key = getAirlabsKey();
  if (!key) return { ok: false, message: 'AirLabs API 키가 없습니다. [N월 등록] → 「✈️ AirLabs (비행 시각 조회, 선택)」 칸에 넣어 주세요.' };
  const f = normalizeFlight(flightStr);
  if (!f) return { ok: false, message: '편명을 알아볼 수 없습니다.' };
  if (!navigator.onLine) return { ok: false, message: '인터넷 연결이 없습니다.' };
  const t = getFlightTable();
  const cur = t[f.iata] || {};                    // 저장·갱신은 원래 편명 칸
  const seen = findFlightEntry(t, f.iata) || {};  // 읽기(캐시 확인)는 0 유무만 다른 같은 편 칸도 함께
  const variants = flightNoVariants(f.iata);
  const k = getKSTDate();
  const todayKey = makeDateKey(k.getFullYear(), k.getMonth() + 1, k.getDate());
  let kind = chooseEndpoint(dateKey, todayKey);
  let liveMsg = '';
  let liveOk = false;
  let note = '';
  let liveSeen = false; // 실시간 조회에서 이 편(다른 날짜 운항)이 실제로 있었는가
  const allTried = [];

  const nm = seen.airlabsNoMatch;
  if (!force && nm && nm.at && !seen.airlabs && !(seen.days && seen.days[dateKey]) && now - nm.at < AIRLABS_ROUTE_TTL_DAYS * 86400000) {
    const days = Math.floor((now - nm.at) / 86400000);
    return { ok: false, cached: true, noMatch: true, kind, tried: nm.tried || variants, message: `AirLabs 에 이 편이 없습니다 (${days < 1 ? '오늘' : `${days}일 전`} ${(nm.tried || variants).join('·')} 모두 조회했지만 없음). 무료 한도를 아끼려고 ${AIRLABS_ROUTE_TTL_DAYS}일 안에는 다시 묻지 않습니다.` };
  }

  if (kind === 'flight') {
    const c = seen.days && seen.days[dateKey];
    if (!force && c && c.fetchedAt && now - c.fetchedAt < AIRLABS_LIVE_TTL_MIN * 60000) {
      return { ok: true, cached: true, kind, message: `${Math.round((now - c.fetchedAt) / 60000)}분 전에 받은 정보입니다 (${AIRLABS_LIVE_TTL_MIN}분 안에는 다시 묻지 않음).` };
    }
    let r;
    try { r = await askVariants(variants, v => callAirlabs('flight', { flight_iata: v }, key), json => parseAirlabsFlight(json, dateKey)); } catch (e) { return { ok: false, message: netError(e) }; }
    allTried.push(...r.tried);
    const { json, p } = r;
    note = retryNoteText(f.iata, r.tried);
    if (p.error && p.error.code !== 'not_found') return { ok: false, message: airlabsErrorDetail(p.error, json._http) };
    if (!p.error && p.match) {
      const day = { std: p.std, sta: p.sta, staDate: p.staDate, depDate: p.depDate, etd: p.etd, eta: p.eta, atd: p.atd, ata: p.ata, status: p.status, depDelay: p.depDelay, arrDelay: p.arrDelay, delayCalc: p.delayCalc || false, dep: p.dep, arr: p.arr, fetchedAt: now };
      const fillTop = !seen.std && !seen.sta;
      t[f.iata] = { ...cur, days: { ...(cur.days || {}), [dateKey]: day } };
      if (t[f.iata].airlabsNoMatch) delete t[f.iata].airlabsNoMatch;
      if (fillTop) Object.assign(t[f.iata], { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, source: 'airlabs' });
      persist(); notify();
      const body = { [`flightTimes/${f.iata}/days/${dateKey}`]: { ...day, fetchedAt: SV_TIMESTAMP } };
      if (seen.airlabsNoMatch) body[`flightTimes/${f.iata}/airlabsNoMatch`] = null;
      if (fillTop) Object.assign(body, { [`flightTimes/${f.iata}/dep`]: p.dep, [`flightTimes/${f.iata}/arr`]: p.arr, [`flightTimes/${f.iata}/std`]: p.std, [`flightTimes/${f.iata}/sta`]: p.sta, [`flightTimes/${f.iata}/source`]: 'airlabs', [`flightTimes/${f.iata}/updatedAt`]: SV_TIMESTAMP });
      patchFlight(body);
      liveOk = true;
      liveMsg = `실시간 정보를 받았습니다.${note ? ` · ${note}` : ''}`; // 운항 날짜·구간은 상자에 표시
      // 운항 요일을 같이 보여 주려고 정기 노선도 (7일 캐시가 없을 때만) 한 번 더 묻는다
      const a0 = (t[f.iata] || {}).airlabs || seen.airlabs;
      if (!force && a0 && a0.fetchedAt && now - a0.fetchedAt < AIRLABS_ROUTE_TTL_DAYS * 86400000) return { ok: true, kind, message: liveMsg, tried: r.tried };
    } else {
      liveMsg = p.error ? `AirLabs 실시간 정보에 이 편이 없어 정기 노선으로 봅니다${note ? ` (${note})` : ''}. ` : `AirLabs 의 가장 가까운 운항이 ${dateWithDow(p.depDate)} 이라 정기 노선으로 봅니다. `;
      liveSeen = !p.error;
      kind = 'routes'; // 가장 가까운 운항이 다른 날짜 → 정기 노선으로
    }
  }

  const base = t[f.iata] || cur;
  const a = base.airlabs || seen.airlabs;
  if (!liveOk && !force && a && a.fetchedAt && now - a.fetchedAt < AIRLABS_ROUTE_TTL_DAYS * 86400000) {
    return { ok: true, cached: true, kind, message: `${liveMsg}정기 노선 정보는 ${AIRLABS_ROUTE_TTL_DAYS}일 안에 다시 묻지 않습니다 (캐시 사용).` };
  }
  let r2;
  try { r2 = await askVariants(variants, v => callAirlabs('routes', { airline_iata: f.airline, flight_iata: v }, key), (json, v) => parseAirlabsRoutes(json, v, dateKey)); } catch (e) {
    return liveOk ? { ok: true, kind: 'flight', message: liveMsg, tried: allTried } : { ok: false, message: netError(e) };
  }
  for (const v of r2.tried) if (!allTried.includes(v)) allTried.push(v);
  const json = r2.json, p = r2.p;
  const note2 = retryNoteText(f.iata, r2.tried);
  if (p.error) {
    if (liveOk) return { ok: true, kind: 'flight', message: `${liveMsg} (정기 노선: ${airlabsErrorDetail(p.error, json._http)})`, tried: allTried };
    if (r2.missed && !liveSeen) {
      // 실시간(해당 날짜면)·정기 노선 모두, 모든 변형이 not_found → 같은 조회를 되풀이하지 않게 기록
      const rec = { at: now, tried: allTried.slice() };
      const cur2 = t[f.iata] || {};
      t[f.iata] = { ...cur2, airlabsNoMatch: rec };
      persist(); notify();
      patchFlight({ [`flightTimes/${f.iata}/airlabsNoMatch`]: { at: SV_TIMESTAMP, tried: rec.tried } });
      return { ok: false, noMatch: true, kind, tried: allTried, message: `${liveMsg}${airlabsErrorDetail(p.error, json._http)}${note2 ? ` · ${note2}` : ''} — ${allTried.join('·')} 모두 없어서 ${AIRLABS_ROUTE_TTL_DAYS}일 동안 다시 묻지 않습니다.` };
    }
    return { ok: false, message: `${liveMsg}${airlabsErrorDetail(p.error, json._http)}` };
  }
  const route = { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, days: p.days, variants: p.variants, fetchedAt: now };
  const now2 = t[f.iata] || {};
  t[f.iata] = { ...now2, airlabs: route };
  if (now2.airlabsNoMatch) delete t[f.iata].airlabsNoMatch;
  const fillTop = !now2.std && !now2.sta && !seen.std && !seen.sta;
  if (fillTop) Object.assign(t[f.iata], { dep: p.dep, arr: p.arr, std: p.std, sta: p.sta, source: 'airlabs' });
  persist(); notify();
  const body = { [`flightTimes/${f.iata}/airlabs`]: { ...route, fetchedAt: SV_TIMESTAMP } };
  if (now2.airlabsNoMatch || seen.airlabsNoMatch) body[`flightTimes/${f.iata}/airlabsNoMatch`] = null;
  if (fillTop) Object.assign(body, { [`flightTimes/${f.iata}/dep`]: p.dep, [`flightTimes/${f.iata}/arr`]: p.arr, [`flightTimes/${f.iata}/std`]: p.std, [`flightTimes/${f.iata}/sta`]: p.sta, [`flightTimes/${f.iata}/source`]: 'airlabs', [`flightTimes/${f.iata}/updatedAt`]: SV_TIMESTAMP });
  patchFlight(body);
  if (liveOk) return { ok: true, kind: 'flight', message: liveMsg, tried: allTried };
  return { ok: true, kind, tried: allTried, message: `${liveMsg}${p.operatesThatDay ? '정기 노선 시각을 받았습니다.' : '정기 노선 시각을 받았습니다 (이 날짜 요일은 정기 운항 요일이 아님 — 아래 ⚠️ 확인).'}${note2 ? ` · ${note2}` : ''}` };
}
