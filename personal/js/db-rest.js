// Realtime DB REST 요청 공통 (주소 + ?auth= 붙이기 + 401 이면 토큰 새로 받아 한 번 더)
import { getConfiguredDbUrl, IS_PERSONAL } from './config.js';
import { getFbAuthQuery, invalidateIdToken } from './auth.js';

/** 브라우저가 오프라인이라고 알려 주는가 (navigator 가 없으면 온라인으로 봄) */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function getDbBaseUrl() {
  const dbUrl = getConfiguredDbUrl();
  return dbUrl ? dbUrl.replace(/\/+$/, '') : '';
}

/** path("schedules", "images/2026-11", "" = 루트) + auth + 추가 쿼리 → URL */
export function buildDbUrl(base, path, authQ, extraQuery = '') {
  const q = [authQ ? authQ.replace(/^\?/, '') : '', extraQuery].filter(Boolean).join('&');
  return `${base}/${path || ''}.json${q ? `?${q}` : ''}`;
}

/**
 * DB 요청. 401 이면 idToken 을 버리고 새로 받아 한 번 더 시도한다.
 * @returns {Promise<Response>} (네트워크 오류는 throw)
 */
export async function dbFetch(path, { method = 'GET', body, query = '' } = {}) {
  const base = getDbBaseUrl();
  if (!base) throw new Error('DB 주소 없음');
  // v2.5.0: 오프라인(비행기모드)이면 요청 자체를 보내지 않는다 — 실패 로그·토큰 갱신 시도 없이 바로 '네트워크 오류'로 처리
  if (isOffline()) throw new Error('오프라인');
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const authQ = await getFbAuthQuery();
  // v2.6.0 개인 모드: 로그인 전(토큰 없음)이면 보내지 않고 바로 401 — 내 Firebase 규칙은 로그인한 본인만 허용하므로 결과는 같고,
  //   주소를 먼저 넣고 로그인하는 순서에서 브라우저 콘솔에 '거부' 로그가 남지 않는다. (커플 모드는 그대로 보냄)
  if (IS_PERSONAL && !authQ) return new Response(null, { status: 401, statusText: 'login required' });
  let res = await fetch(buildDbUrl(base, path, authQ, query), init);
  if (res.status === 401) {
    invalidateIdToken();
    const q2 = await getFbAuthQuery({ forceRefresh: true });
    if (q2) res = await fetch(buildDbUrl(base, path, q2, query), init);
  }
  return res;
}

/** GET → {ok, status, data} (네트워크 오류는 status 0) */
export async function dbGetJson(path, query = '') {
  try {
    const res = await dbFetch(path, { query });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e };
  }
}
