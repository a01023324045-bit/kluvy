// 앱 전역 상수와 (로컬 개발 전용) 엔드포인트 override.
// ⚠️ localStorage 키 이름은 운영 중인 폰과의 호환을 위해 절대 바꾸지 말 것. (커플 모드 기준 — 개인 모드는 아래 접두어 키)

// ===== 앱 모드 (v2.6.0) =====
// 'couple'  : 규호♥예진 두 사람용 (저장소 app/ = 배포 주소 /kluvy/). 기본값 — 여기서는 절대 바꾸지 말 것.
// 'personal': 혼자 쓰는 티웨이 승무원용 (npm run build:personal 이 personal/ 사본에서만 이 줄을 'personal' 로 바꾼다 → /kluvy/personal/)
// 화면·저장 키·기념일 등 모드에 따라 달라지는 곳은 모두 이 값(또는 IS_PERSONAL)을 참조한다 — 다른 파일에 'couple'/'personal' 글자를 직접 쓰지 말 것.
export const APP_MODE = 'personal'; // ← build:personal 이 바꿈 (원본 app/js/config.js 는 'couple')
export const IS_PERSONAL = APP_MODE === 'personal';

/** 개인 모드 저장 키 접두어 — 같은 폰·같은 주소(github.io)의 커플 앱(/kluvy/)과 localStorage·IndexedDB 를 나눠 쓰므로 섞이지 않게 */
export const PERSONAL_KEY_PREFIX = 'kluvy_personal_';

/**
 * 모드별 저장 키 이름. 커플 모드는 원래 이름 그대로(운영 폰 호환), 개인 모드는 'kluvy_personal_' + (앞의 'kluvy_'/'kluvy' 뗀 이름).
 *   modeKey('kluvy_last_sync_at') → 커플 'kluvy_last_sync_at' / 개인 'kluvy_personal_last_sync_at'
 *   modeKey('gemini_model')       → 커플 'gemini_model'       / 개인 'kluvy_personal_gemini_model'
 */
export function modeKey(name) {
  if (!IS_PERSONAL) return name;
  const rest = String(name).replace(/^kluvy_?/, '');
  return PERSONAL_KEY_PREFIX + rest;
}

const COUPLE_STORAGE_KEYS = {
  schedule: 'coupleScheduleDB_v28',
  anniversaries: 'coupleCustomAniv_v28',
  fileHistory: 'coupleFileHistory_v28',
  dbUrl: 'firebase_db_url',
  refreshToken: 'fb_refresh_token',
  loginEmail: 'fb_login_email',
  geminiKey: 'gemini_api_key'
};
// 개인 모드: 이름만 다르고 담는 내용(형식)은 커플과 같다 — 백업 파일·서버 경로(schedules·anniversaries·images…)도 같은 형식
const PERSONAL_STORAGE_KEYS = {
  schedule: modeKey('schedule_v1'),
  anniversaries: modeKey('anniversaries_v1'),
  fileHistory: modeKey('file_history_v1'),
  dbUrl: modeKey('db_url'),
  refreshToken: modeKey('fb_refresh_token'),
  loginEmail: modeKey('fb_login_email'),
  geminiKey: modeKey('gemini_api_key')
};

export const STORAGE_KEYS = Object.freeze(IS_PERSONAL ? PERSONAL_STORAGE_KEYS : COUPLE_STORAGE_KEYS);

// v2.5.2: 이 폰에만 저장하는 화면 설정 (서버·백업으로 가지 않음). STORAGE_KEYS(운영 폰 호환 고정) 와 따로 둔다.
export const PREF_KEYS = Object.freeze({
  showAnniversary: modeKey('kluvy_show_anniversary') // 'true' | 'false' — 달력·상세 카드·캡처에 기념일을 보일지 (기본 true)
});

/** 개인 모드에서만 쓰는 이 기기 설정 (서버·백업으로 가지 않음) */
export const PERSONAL_KEYS = Object.freeze({
  ownerName: modeKey('owner_name'),       // 달력·상세 카드에 보일 이름 (기본 '나')
  onboarded: modeKey('onboarded_v1'),     // 첫 실행 안내를 마쳤는지
  fbApiKey: modeKey('fb_web_api_key')     // 내 Firebase 프로젝트의 웹 API 키 (이메일 로그인에 필요)
});

// 개인 모드는 기본 주소가 없다 — 본인이 만든 Firebase 주소를 설정에서 넣어야 동기화된다 (커플 DB 로 절대 가지 않게)
export const DEFAULT_FIREBASE_URL = IS_PERSONAL ? '' : "https://yktable-f14fe-default-rtdb.asia-southeast1.firebasedatabase.app/";

// Firebase 콘솔 > 프로젝트 설정 > 일반 > "웹 API 키" (공개돼도 되는 식별자, 비밀 아님)
export const FIREBASE_WEB_API_KEY = "AIzaSyB3AlyaRjHoEdnPt9L1BUjj5ML7EtonVp0";

/** 로그인에 쓸 웹 API 키: 커플 = 위 상수, 개인 = 설정에서 넣은 '내 Firebase 웹 API 키' (없으면 '') */
export function getFirebaseWebApiKey() {
  if (!IS_PERSONAL) return FIREBASE_WEB_API_KEY;
  try { return (localStorage.getItem(PERSONAL_KEYS.fbApiKey) || '').trim(); } catch (e) { return ''; }
}

// 만난 날 2025-12-23 (현지 자정 기준. new Date("2025-12-23") 은 UTC 라 해외 시간대에서 하루 어긋남)
export const BASE_LOVE_DATE = new Date(2025, 11, 23);

/** 기본 Gemini 모델 (설정에서 바꿀 수 있음 → localStorage 'gemini_model'. 404 면 사용 가능한 flash 모델로 자동 전환) */
export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_MODEL_KEY = modeKey('gemini_model');

// ===== 로컬 개발/테스트 전용 override =====
// location.hostname 이 localhost / 127.0.0.1 일 때만 동작한다. (GitHub Pages 에서는 항상 무시)
// 사용법: index.html?devDbUrl=http://127.0.0.1:8790/&devAuthBase=http://127.0.0.1:8790/__auth&devGeminiBase=http://127.0.0.1:8790/__gemini
// 한 번 쿼리로 주면 localStorage(kluvy_dev_*)에 기억된다. 지우려면 값으로 'off' 를 준다.
export const IS_LOCAL_DEV = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

function devOverride(name) {
  if (!IS_LOCAL_DEV) return null;
  try {
    const storeKey = modeKey(`kluvy_dev_${name}`);
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
export const AIRLABS_KEY_STORAGE = modeKey('airlabs_api_key');
export const AIRLABS_USAGE_STORAGE = modeKey('kluvy_airlabs_usage');
export const FLIGHT_TIMES_CACHE = modeKey('kluvy_flight_times_v1');
export function getAirlabsBase() {
  const base = devOverride('devAirlabsBase');
  return base ? base.replace(/\/+$/, '') : 'https://airlabs.co';
}

/** ListModels (모델 404 일 때 대체 모델 찾기) */
export function getGeminiModelsEndpoint(apiKey) {
  return `${getGeminiBase()}/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`;
}

/** 화면에 보여 줄 앱 버전 (sw.js CACHE_VERSION 과 함께 표시). 개인 모드 사본은 build:personal 이 'kluvy-personal-v2.6.0' 형식으로 바꾼다 */
export const APP_VERSION = 'kluvy-personal-v2.6.1';
/** 숫자만 (2.6.0) — 화면 표시용 */
export const APP_VERSION_NUMBER = APP_VERSION.replace(/^kluvy-personal-v/, '');
/** 이 모드의 앱 파일 캐시 이름 (sw.js CACHE_VERSION 과 같아야 함): 커플 'kluvy-v2.6.0' / 개인 'kluvy-personal-v2.6.0' */
export const APP_CACHE_PREFIX = IS_PERSONAL ? 'kluvy-personal-v' : 'kluvy-v';
export const APP_CACHE_NAME = APP_CACHE_PREFIX + APP_VERSION_NUMBER;
/** 이 앱(모드)의 캐시인가 — 같은 주소의 다른 모드 앱 캐시는 건드리지 않는다 */
export function isOwnAppCache(name) {
  const n = String(name || '');
  return IS_PERSONAL ? n.startsWith('kluvy-personal-') : !n.startsWith('kluvy-personal-');
}
