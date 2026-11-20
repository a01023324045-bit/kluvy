// 앱 모드별 화면 차이 (v2.6.0) — config.js 의 APP_MODE 하나만 보고 정한다. (DOM 은 applyAppMode 에서만 만짐)
//
// 커플 모드(기본): 규호(my 칸)·예진(gf 칸) 두 사람. 이 파일은 커플 모드에서 아무것도 바꾸지 않는다.
// 개인 모드      : 혼자 쓰는 티웨이 승무원 — 근무표를 gf 칸에 담는다(예진과 같은 티웨이 코드표·사진 인식·편명·레그·AirLabs 를 그대로 쓰기 위해).
//                  my 칸(규호 교대근무)·데이트·상대 약속·만난 날 D-Day·자동 100일 기념일은 쓰지 않는다.
//
// index.html 표시 규칙 (css/app.css):
//   data-couple-only            → 개인 모드에서 숨김 (html[data-app-mode="personal"])
//   data-personal-only          → 커플 모드에서 숨김
//   data-personal-text="…"      → 개인 모드에서 글자를 이 값으로 ({name} = 내 이름)
//   data-personal-placeholder / data-personal-aria / data-personal-title → 같은 방식으로 placeholder·aria-label·title
import { APP_MODE, IS_PERSONAL, PERSONAL_KEYS } from './config.js';

export const DEFAULT_OWNER_NAME = '나';
export const OWNER_NAME_MAX = 12;
/** 개인 모드에서 근무를 담는 칸 — 티웨이 승무원 근무표(예진 파서·코드표)를 그대로 쓰므로 gf */
export const PERSONAL_SLOT = 'gf';

/** 화면 배치 (모드별) */
export const LAYOUT = Object.freeze({
  mode: APP_MODE,
  personSlots: Object.freeze(IS_PERSONAL ? [PERSONAL_SLOT] : ['my', 'gf']),
  showPersonFilters: !IS_PERSONAL,   // [이규호] [이예진] 보기 토글
  showDday: !IS_PERSONAL,            // 만난 지 D+N
  showDatePlan: !IS_PERSONAL,        // 우리의 데이트 약속
  autoAnniversaries: !IS_PERSONAL    // 100일·주년 자동 기념일 (개인 모드는 사용자가 추가한 기념일만)
});

const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };

/** 이름 정리: 앞뒤 공백 제거, 12자까지. 비면 '' */
export function cleanOwnerName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, OWNER_NAME_MAX);
}

/** 개인 모드 '내 이름' (없으면 '나') */
export function getOwnerName(storage = ls()) {
  let v = '';
  try { v = storage ? storage.getItem(PERSONAL_KEYS.ownerName) || '' : ''; } catch (e) { v = ''; }
  return cleanOwnerName(v) || DEFAULT_OWNER_NAME;
}

/** 이름 저장 → 저장된 이름 (비우면 기본 '나') */
export function setOwnerName(name, storage = ls()) {
  const v = cleanOwnerName(name) || DEFAULT_OWNER_NAME;
  try { if (storage) storage.setItem(PERSONAL_KEYS.ownerName, v); } catch (e) { /* 저장 실패 → 기본 이름 */ }
  return v;
}

export function isOnboarded(storage = ls()) {
  try { return Boolean(storage && storage.getItem(PERSONAL_KEYS.onboarded)); } catch (e) { return true; }
}
export function markOnboarded(storage = ls()) {
  try { if (storage) storage.setItem(PERSONAL_KEYS.onboarded, String(Date.now())); } catch (e) { /* */ }
}

/** 화면에 쓸 사람 이름: 커플 my→'규호' gf→'예진' / 개인 → 내 이름 */
export function personName(who) {
  if (IS_PERSONAL) return getOwnerName();
  return who === 'my' ? '규호' : '예진';
}

/** 처음 보기 필터 (state.showKyuho / showYejin) */
export function initialFilters() {
  return { showKyuho: LAYOUT.personSlots.includes('my'), showYejin: LAYOUT.personSlots.includes('gf') };
}

/** '{name}' 자리에 이름 */
export function fillName(template, name = getOwnerName()) {
  return String(template ?? '').replace(/\{name\}/g, name);
}

/** 달력 캡처 파일 이름 */
export function captureFileName(year, month) {
  const mm = String(month).padStart(2, '0');
  if (!IS_PERSONAL) return `규호♥예진_근무표_${year}년_${mm}월.png`;
  const n = getOwnerName();
  return `${n === DEFAULT_OWNER_NAME ? '내' : n}_근무표_${year}년_${mm}월.png`;
}

/**
 * 문서에 모드 적용 (앱 시작 때·이름을 바꾼 뒤). 커플 모드는 <html data-app-mode="couple"> 만 달고 끝.
 * @returns {number} 바꾼 요소 수
 */
export function applyAppMode(doc = document) {
  doc.documentElement.dataset.appMode = APP_MODE;
  if (!IS_PERSONAL) return 0;
  const name = getOwnerName();
  let n = 0;
  const each = (sel, fn) => { for (const e of doc.querySelectorAll(sel)) { fn(e); n++; } };
  each('[data-personal-text]', e => { e.textContent = fillName(e.dataset.personalText, name); });
  each('[data-personal-placeholder]', e => { e.setAttribute('placeholder', fillName(e.dataset.personalPlaceholder, name)); });
  each('[data-personal-aria]', e => { e.setAttribute('aria-label', fillName(e.dataset.personalAria, name)); });
  each('[data-personal-title]', e => { e.setAttribute('title', fillName(e.dataset.personalTitle, name)); });
  return n;
}
