// 앱 전역 상수와 (로컬 개발 전용) 엔드포인트 override.
// ⚠️ localStorage 키 이름은 운영 중인 폰과의 호환을 위해 절대 바꾸지 말 것.

export const STORAGE_KEYS = Object.freeze({
  schedule: 'coupleScheduleDB_v28',
  anniversaries: 'coupleCustomAniv_v28',
  fileHistory: 'coupleFileHistory_v28',
  dbUrl: 'firebase_db_url',
  refreshToken: 'fb_refresh_token',
  loginEmail: 'fb_login_email',
  geminiKey: 'gemini_api_key'
});

export const DEFAULT_FIREBASE_URL = "https://yktable-f14fe-default-rtdb.asia-southeast1.firebasedatabase.app/";

// Firebase 콘솔 > 프로젝트 설정 > 일반 > "웹 API 키" (공개돼도 되는 식별자, 비밀 아님)
export const FIREBASE_WEB_API_KEY = "AIzaSyB3AlyaRjHoEdnPt9L1BUjj5ML7EtonVp0";

// 만난 날 2025-12-23 (현지 자정 기준. new Date("2025-12-23") 은 UTC 라 해외 시간대에서 하루 어긋남)
export const BASE_LOVE_DATE = new Date(2025, 11, 23);

/** 기본 Gemini 모델 (설정에서 바꿀 수 있음 → localStorage 'gemini_model'. 404 면 사용 가능한 flash 모델로 자동 전환) */
export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_MODEL_KEY = 'gemini_model';

// ===== 로컬 개발/테스트 전용 override =====
// location.hostname 이 localhost / 127.0.0.1 일 때만 동작한다. (GitHub Pages 에서는 항상 무시)
// 사용법: index.html?devDbUrl=http://127.0.0.1:8790/&devAuthBase=http://127.0.0.1:8790/__auth&devGeminiBase=http://127.0.0.1:8790/__gemini
// 한 번 쿼리로 주면 localStorage(kluvy_dev_*)에 기억된다. 지우려면 값으로 'off' 를 준다.
export const IS_LOCAL_DEV = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

function devOverride(name) {
  if (!IS_LOCAL_DEV) return null;
  try {
    const storeKey = `kluvy_dev_${name}`;
    const q = new URLSearchParams(location.search).get(name);
    if (q === 'off') { localStorage.removeItem(storeKey); return null; }
    if (q) { localStorage.setItem(storeKey, q); return q; }
    return localStorage.getItem(storeKey);
  } catch (e) {
    return null;
  }
}

/** 실제로 사용할 Realtime DB 주소 (끝 슬래시 제거 전 원본). 로컬 개발 override 가 우선. */
export function getConfiguredDbUrl() {
  const dev = devOverride('devDbUrl');
  if (dev) return dev;
  return localStorage.getItem(STORAGE_KEYS.dbUrl);
}

export function getAuthEndpoints() {
  const base = devOverride('devAuthBase');
  if (base) {
    const b = base.replace(/\/+$/, '');
    return {
      signIn: `${b}/identitytoolkit/v1/accounts:signInWithPassword`,
      refresh: `${b}/securetoken/v1/token`
    };
  }
  return {
    signIn: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
    refresh: 'https://securetoken.googleapis.com/v1/token'
  };
}

export function getGeminiBase() {
  const base = devOverride('devGeminiBase');
  return base ? base.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com';
}

export function getGeminiEndpoint(apiKey, model = GEMINI_MODEL) {
  return `${getGeminiBase()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

/** AirLabs (선택 기능: 편명 예정/실제 시각 조회). 키는 각 폰 localStorage 에만 — 코드·서버에 저장하지 않음 */
export const AIRLABS_KEY_STORAGE = 'airlabs_api_key';
export const AIRLABS_USAGE_STORAGE = 'kluvy_airlabs_usage';
export const FLIGHT_TIMES_CACHE = 'kluvy_flight_times_v1';
export function getAirlabsBase() {
  const base = devOverride('devAirlabsBase');
  return base ? base.replace(/\/+$/, '') : 'https://airlabs.co';
}

/** ListModels (모델 404 일 때 대체 모델 찾기) */
export function getGeminiModelsEndpoint(apiKey) {
  return `${getGeminiBase()}/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`;
}

/** 화면에 보여 줄 앱 버전 (sw.js CACHE_VERSION 과 함께 표시) */
export const APP_VERSION = '2.4.6';
