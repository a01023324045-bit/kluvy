// AirLabs Data API (https://airlabs.co/docs/) 응답 해석 — 순수 함수 (네트워크는 flight-times.js)
//
// 문서 확인(2026-11-13):
//  - 인증: 모든 요청에 api_key 쿼리 파라미터. 응답은 { request, response, … } (response = 객체 또는 배열)
//  - 오류: HTTP 200 이어도 { error: { message, code } } — unknown_api_key, expired_api_key, wrong_params, not_found,
//          minute_limit_exceeded, hour_limit_exceeded, month_limit_exceeded, internal_error
//  - Flight API  GET /api/v9/flight?flight_iata=TW405 : 가장 가까운 운항 1건(예정·운항 중·착륙). 시각은 공항 현지시각
//      dep_time / arr_time(예정, 무료 플랜 포함), dep_estimated / arr_estimated(예상), dep_actual / arr_actual(실제 — Schedules 문서),
//      dep_delayed / arr_delayed(분), status(scheduled, en-route, landed …)
//      ※ 무료 플랜은 일부 필드만 준다(문서의 'Available in the Free plan' = 예정 시각·공항·편명). 예상·실제·지연은 없을 수 있음.
//  - Routes API  GET /api/v9/routes?airline_iata=TW&flight_iata=TW405 : 정기 노선 DB(실시간 아님) — dep_time·arr_time(HH:MM 현지), days(요일)
//  - Schedules API 는 최대 10시간 앞까지만이라 쓰지 않음.
//  - Ping  GET /api/v9/ping?api_key=… : 키 확인용 ([N월 등록] → 「✈️ AirLabs」 → [연결 확인])
// 사용자 확인(2026-11-14): 모든 응답이 HTTP 200, 오류는 본문 {"error":{"message","code"}} —
//   키 없음 = wrong_params "Missing api_key", 틀린 키 = unknown_api_key "Unknown api_key". CORS 허용(access-control-allow-origin: *)
import { weekdayOfKey } from './dates.js';

export const AIRLABS_FREE_MONTHLY = 1000;     // 무료 플랜 월 요청 수 (cors.dev 2026-10 조사·사용자 조사 기준)
export const AIRLABS_LIVE_TTL_MIN = 30;       // 같은 편·같은 날짜 실시간 재조회 최소 간격
export const AIRLABS_ROUTE_TTL_DAYS = 7;      // 정기 노선 재조회 최소 간격

const ERR = {
  unknown_api_key: 'AirLabs API 키가 올바르지 않습니다. [N월 등록] → 「✈️ AirLabs」 칸의 키를 확인해 주세요.',
  expired_api_key: 'AirLabs API 키가 만료되었습니다. airlabs.co 대시보드에서 확인해 주세요.',
  wrong_params: '편명 형식을 AirLabs 가 이해하지 못했습니다.',
  not_found: 'AirLabs 에 이 편의 정보가 없습니다.',
  minute_limit_exceeded: 'AirLabs 분당 요청 한도를 넘었습니다. 잠시 뒤 다시 눌러 주세요.',
  hour_limit_exceeded: 'AirLabs 시간당 요청 한도를 넘었습니다. 나중에 다시 눌러 주세요.',
  month_limit_exceeded: `이번 달 AirLabs 무료 한도(${AIRLABS_FREE_MONTHLY.toLocaleString()}회)를 다 썼습니다. 다음 달에 다시 쓸 수 있어요.`,
  internal_error: 'AirLabs 서버 오류입니다. 나중에 다시 눌러 주세요.'
};

export function airlabsErrorMessage(err) {
  if (!err) return '';
  const code = typeof err === 'string' ? err : err.code;
  const msg = typeof err === 'object' ? String(err.message || '') : '';
  if (code === 'wrong_params' && /api_key/i.test(msg)) return 'AirLabs API 키가 비어 있습니다. [N월 등록] → 「✈️ AirLabs」 칸에 키를 넣어 주세요.';
  return ERR[code] || `AirLabs 오류: ${msg || code}`;
}

/** 오류를 화면에 보일 글: 한글 설명 + AirLabs 원문(message · code) + HTTP 상태 */
export function airlabsErrorDetail(err, httpStatus) {
  if (!err) return '';
  const code = typeof err === 'string' ? err : String(err.code || '');
  const msg = typeof err === 'object' ? String(err.message || '') : '';
  const raw = [msg && `"${msg}"`, code && `code ${code}`, httpStatus && `HTTP ${httpStatus}`].filter(Boolean).join(' · ');
  return raw ? `${airlabsErrorMessage(err)} (AirLabs 원문: ${raw})` : airlabsErrorMessage(err);
}

/**
 * 붙여넣은 키 정리: 앞뒤 공백·줄바꿈·따옴표 제거, 중간 공백/줄바꿈 제거, 'api_key=' 접두어 제거.
 * 예) '  "abcd-1234"\n' → 'abcd-1234'
 */
export function cleanAirlabsKey(raw) {
  let s = String(raw ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/^["'`“”‘’\s]+|["'`“”‘’\s]+$/g, '').replace(/^api_key\s*[=:]\s*/i, '');
  return s.replace(/\s+/g, '');
}

/** 저장 확인용 가림: '…AB12' (4자 이하면 전부 가림) */
export function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  return s.length <= 4 ? '•'.repeat(s.length) : `…${s.slice(-4)}`;
}

/** 'YYYY-MM-DD HH:MM' → { date, time } (아니면 null) */
export function splitStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? { date: m[1], time: m[2] } : null;
}

/** 요청 URL (키는 URL 쿼리 — AirLabs 방식) */
export function airlabsUrl(base, endpoint, params, apiKey) {
  const q = new URLSearchParams({ ...params, api_key: apiKey });
  return `${base}/api/v9/${endpoint}?${q.toString()}`;
}

/** 실시간 조회는 KST 기준 어제~내일 사이 날짜만 (그 밖은 정기 노선) */
export function chooseEndpoint(dateKey, todayKey) {
  const d = (k) => { const [y, m, dd] = k.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400000; };
  const diff = d(dateKey) - d(todayKey);
  return diff >= -1 && diff <= 1 ? 'flight' : 'routes';
}

/**
 * Flight API 응답 → 우리 형식. dateKey(출발지 현지 날짜)와 운항일이 다르면 match:false
 *  - std/sta = dep_time/arr_time (그 편의 '정기(예정)' 시각 — 지연과 무관한 시간표 값)
 *  - etd/eta = *_estimated (예상), atd/ata = *_actual (실제), depDelay/arrDelay = *_delayed (분)
 *  - v2.3.1: depDate(운항 날짜 = dep_time 의 날짜) 저장, 지연(분)이 없으면 예상/실제 − 정기로 계산(delayFrom:'calc')
 * @returns {{error?:object, match?:boolean, dep, arr, std, sta, staDate, etd, eta, atd, ata, status, depDelay, arrDelay, depDate, delayCalc?:boolean}}
 */
export function parseAirlabsFlight(json, dateKey) {
  if (!json || typeof json !== 'object') return { error: { code: 'internal_error' } };
  if (json.error) return { error: json.error };
  let r = json.response !== undefined ? json.response : json;
  if (Array.isArray(r)) r = r.find(x => x && splitStamp(x.dep_time) && splitStamp(x.dep_time).date === dateKey) || r[0];
  const dep = splitStamp(r && r.dep_time);
  if (!r || !dep) return { error: { code: 'not_found' } };
  const t = (k) => { const x = splitStamp(r[k]); return x ? x.time : ''; };
  const arr = splitStamp(r.arr_time);
  const num = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  let depDelay = num(r.dep_delayed), arrDelay = num(r.arr_delayed), delayCalc = false;
  if (depDelay === null) { const d = stampDiffMin(r.dep_actual || r.dep_estimated, r.dep_time); if (d !== null) { depDelay = d; delayCalc = true; } }
  if (arrDelay === null) { const d = stampDiffMin(r.arr_actual || r.arr_estimated, r.arr_time); if (d !== null) { arrDelay = d; delayCalc = true; } }
  return {
    match: dep.date === dateKey,
    depDate: dep.date,
    dep: r.dep_iata || '', arr: r.arr_iata || '',
    std: dep.time, sta: arr ? arr.time : '', staDate: arr ? arr.date : '',
    etd: t('dep_estimated'), eta: t('arr_estimated'),
    atd: t('dep_actual'), ata: t('arr_actual'),
    status: r.status || '',
    depDelay, arrDelay, delayCalc
  };
}

/** 'YYYY-MM-DD HH:MM' 두 개의 차이(분) a − b (둘 중 하나라도 없으면 null) */
export function stampDiffMin(a, b) {
  const A = splitStamp(a), B = splitStamp(b);
  if (!A || !B) return null;
  const ms = s => { const [y, m, d] = s.date.split('-').map(Number); const [h, mi] = s.time.split(':').map(Number); return Date.UTC(y, m - 1, d, h, mi); };
  return Math.round((ms(A) - ms(B)) / 60000);
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DOW_KO = { sun: '일', mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토' };
const DOW_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** ['tue','thu','sat'] → '화·목·토' (월요일부터) */
export function daysKo(days) {
  if (!Array.isArray(days) || !days.length) return '';
  const set = new Set(days.map(d => String(d).toLowerCase().slice(0, 3)));
  if (set.size === 7) return '매일';
  return DOW_ORDER.filter(d => set.has(d)).map(d => DOW_KO[d]).join('·');
}

/** '2026-11-14' → '2026-11-14(토)' */
export function dateWithDow(dateKey) {
  return dateKey ? `${dateKey}(${DOW_KO[DOW[weekdayOfKey(dateKey)]]})` : '';
}

/**
 * Routes API 응답 → 그 편의 정기 시각. 그 날짜 요일에 운항하는 항목을 우선.
 *  v2.3.1: 같은 편의 다른 요일 시각표(variants)도 함께 — 다른 날짜를 볼 때 요일에 맞는 것을 고르기 위해
 * @returns {{error?:object, dep, arr, std, sta, days:string[], operatesThatDay:boolean, variants:{dep,arr,std,sta,days}[]}}
 */
export function parseAirlabsRoutes(json, iata, dateKey) {
  if (!json || typeof json !== 'object') return { error: { code: 'internal_error' } };
  if (json.error) return { error: json.error };
  const list = Array.isArray(json.response) ? json.response : (Array.isArray(json) ? json : []);
  const mine = list.filter(x => x && String(x.flight_iata || '').toUpperCase() === String(iata).toUpperCase());
  if (!mine.length) return { error: { code: 'not_found' } };
  const hhmm = v => (/^\d{2}:\d{2}$/.test(v || '') ? v : '');
  const variants = mine.slice(0, 6).map(x => ({ dep: x.dep_iata || '', arr: x.arr_iata || '', std: hhmm(x.dep_time), sta: hhmm(x.arr_time), days: Array.isArray(x.days) ? x.days : [] }));
  const v = pickRouteVariant({ ...variants[0], variants }, dateKey);
  return { ...v, variants, operatesThatDay: v.operatesThatDay };
}

/** 캐시된 정기 노선(airlabs) 중 그 날짜 요일에 맞는 것 → { dep, arr, std, sta, days, operatesThatDay, dow } */
export function pickRouteVariant(route, dateKey) {
  if (!route) return null;
  const list = Array.isArray(route.variants) && route.variants.length ? route.variants : [route];
  const dow = dateKey ? DOW[weekdayOfKey(dateKey)] : '';
  const best = list.find(x => Array.isArray(x.days) && x.days.includes(dow)) || list[0];
  const allDays = [...new Set(list.flatMap(x => (Array.isArray(x.days) ? x.days : [])))];
  return {
    dep: best.dep || '', arr: best.arr || '', std: best.std || '', sta: best.sta || '',
    days: Array.isArray(best.days) ? best.days : [], allDays,
    operatesThatDay: Boolean(dow && Array.isArray(best.days) && best.days.includes(dow)),
    knownDays: allDays.length > 0, dow
  };
}

/** 상태 영어 → 한글 */
export function statusKo(s) {
  return ({ scheduled: '예정', 'en-route': '운항 중', active: '운항 중', landed: '착륙', cancelled: '결항', diverted: '회항', incident: '이상' })[s] || s || '';
}
