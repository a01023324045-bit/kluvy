// Firebase Auth REST (signInWithPassword + securetoken refresh). 운영본 로직 그대로.
// 모든 DB 요청 URL 끝에 getFbAuthQuery() 결과(?auth=idToken)를 붙인다.
import { getFirebaseWebApiKey, IS_PERSONAL, STORAGE_KEYS, getAuthEndpoints } from './config.js';
// v2.6.0: 웹 API 키는 getFirebaseWebApiKey() — 커플 = 코드에 박힌 키(그대로), 개인 = 설정에서 넣은 '내 Firebase 웹 API 키'

let fbIdToken = null;
let fbIdTokenExp = 0;
let fbRefreshPromise = null;

/** 토큰이 폐기돼 재로그인이 필요해졌을 때 UI 갱신용 콜백 (ui/login.js 가 등록) */
let onAuthInvalidated = () => {};
export function setOnAuthInvalidated(fn) { onAuthInvalidated = fn; }

export function fbIsLoggedIn() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.refreshToken));
}

/** 현재 idToken 만료 시각(ms). 토큰이 없으면 0 — 실시간 스트림이 만료 전에 미리 다시 연결할 때 쓴다. */
export function getIdTokenExpiry() { return fbIdToken ? fbIdTokenExp : 0; }

/** 서버가 토큰을 거부했을 때(401·auth_revoked) 캐시된 idToken 을 버려 다음 요청에서 새로 받게 한다. */
export function invalidateIdToken() { fbIdToken = null; fbIdTokenExp = 0; }

/** securetoken 400 응답의 오류 코드가 'refresh 토큰을 더는 못 씀'을 뜻하나 (그때만 토큰 삭제 → 로그인 필요) */
export function isRefreshTokenRejected(code) {
  return /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|MISSING_REFRESH_TOKEN|INVALID_GRANT_TYPE|PROJECT_NUMBER_MISMATCH/.test(String(code || ''));
}

// REST 요청 URL 끝에 붙일 인증 쿼리. 로그인 전이면 빈 문자열.
// opts.forceRefresh: 남은 시간과 관계없이 새 idToken 을 받는다 (스트림 선제 재연결용)
export async function getFbAuthQuery(opts = {}) {
  const refresh = localStorage.getItem(STORAGE_KEYS.refreshToken);
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey || !refresh) return '';
  if (!opts.forceRefresh && fbIdToken && Date.now() < fbIdTokenExp - 60000) return `?auth=${encodeURIComponent(fbIdToken)}`;
  // v2.5.0: 오프라인이면 토큰 서버에 묻지 않는다 (refresh 토큰은 그대로 → 온라인이 되면 이어서 동기화, '로그인 필요'로 오해하지 않게)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fbIdToken ? `?auth=${encodeURIComponent(fbIdToken)}` : '';
  if (!fbRefreshPromise) {
    fbRefreshPromise = (async () => {
      const res = await fetch(`${getAuthEndpoints().refresh}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`
      });
      if (!res.ok) {
        // 토큰 만료/폐기(400 + Firebase 오류 코드)일 때만 재로그인 필요로 본다.
        // v2.5.0: 기내 와이파이 로그인 페이지처럼 Firebase 가 아닌 곳이 400 을 돌려준 경우엔 토큰을 지우지 않는다.
        let code = '';
        try { const j = await res.json(); code = String((j && j.error && (j.error.message || j.error)) || ''); } catch (e) { code = ''; }
        if (res.status === 400 && isRefreshTokenRejected(code)) {
          localStorage.removeItem(STORAGE_KEYS.refreshToken);
          onAuthInvalidated();
        }
        throw new Error('토큰 갱신 실패: ' + res.status + (code ? ' ' + code : ''));
      }
      const d = await res.json();
      fbIdToken = d.id_token;
      fbIdTokenExp = Date.now() + Number(d.expires_in || 3600) * 1000;
      localStorage.setItem(STORAGE_KEYS.refreshToken, d.refresh_token);
    })().finally(() => { fbRefreshPromise = null; });
  }
  try { await fbRefreshPromise; } catch (e) { console.warn(e); return ''; }
  return fbIdToken ? `?auth=${encodeURIComponent(fbIdToken)}` : '';
}

export async function fbLogin(email, password) {
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) throw new Error(IS_PERSONAL ? '내 Firebase 웹 API 키를 먼저 넣어 주세요. (Firebase 콘솔 > 프로젝트 설정 > 일반 > 웹 API 키)' : '앱에 Firebase 웹 API 키가 설정되지 않았습니다.');
  const res = await fetch(`${getAuthEndpoints().signIn}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await res.json();
  if (!res.ok) {
    const code = (d.error && d.error.message) || '';
    const msgMap = {
      INVALID_LOGIN_CREDENTIALS: '이메일 또는 비밀번호가 틀렸습니다.',
      INVALID_PASSWORD: '비밀번호가 틀렸습니다.',
      EMAIL_NOT_FOUND: '등록되지 않은 이메일입니다.',
      INVALID_EMAIL: '이메일 형식이 올바르지 않습니다.',
      USER_DISABLED: '사용 중지된 계정입니다.'
    };
    // v2.6.0: 웹 API 키가 틀림 (개인 모드에서 키를 잘못 붙여 넣었을 때 — 실제 응답 'API key not valid. Please pass a valid API key.')
    if (/API key not valid|API_KEY_INVALID/i.test(code)) throw new Error('웹 API 키가 올바르지 않습니다. Firebase 콘솔 > 프로젝트 설정 > 일반 > 웹 API 키를 다시 복사해 넣어 주세요.');
    if (/CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(code)) throw new Error('이 Firebase 프로젝트에서 이메일/비밀번호 로그인이 꺼져 있습니다. Authentication > 로그인 방법에서 「이메일/비밀번호」를 사용 설정해 주세요.');
    const key = Object.keys(msgMap).find(k => code.startsWith(k));
    throw new Error(key ? msgMap[key] : (code.startsWith('TOO_MANY_ATTEMPTS') ? '시도가 너무 많습니다. 잠시 후 다시 해 주세요.' : (code || '로그인 실패')));
  }
  fbIdToken = d.idToken;
  fbIdTokenExp = Date.now() + Number(d.expiresIn || 3600) * 1000;
  localStorage.setItem(STORAGE_KEYS.refreshToken, d.refreshToken);
  localStorage.setItem(STORAGE_KEYS.loginEmail, d.email || email);
}

export function fbClearSession() {
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.loginEmail);
  fbIdToken = null;
  fbIdTokenExp = 0;
}
