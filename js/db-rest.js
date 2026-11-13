// Realtime DB REST 요청 공통 (주소 + ?auth= 붙이기 + 401 이면 토큰 새로 받아 한 번 더)
import { getConfiguredDbUrl } from './config.js';
import { getFbAuthQuery, invalidateIdToken } from './auth.js';

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
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let res = await fetch(buildDbUrl(base, path, await getFbAuthQuery(), query), init);
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
