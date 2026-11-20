// 개인 모드 전용 화면 (v2.6.0): 첫 실행 안내(이름 입력) · 설정의 '내 이름' · '내 Firebase 웹 API 키'
// 커플 모드에서는 이 함수들이 불려도 아무것도 하지 않는다 (요소가 숨겨져 있고, IS_PERSONAL 이 false).
import { IS_PERSONAL, PERSONAL_KEYS } from '../config.js';
import { applyAppMode, getOwnerName, setOwnerName, isOnboarded, markOnboarded, DEFAULT_OWNER_NAME } from '../app-mode.js';
import { renderCalendar } from '../render/calendar.js';

const $ = id => document.getElementById(id);

/** 앱 시작 때: 개인 모드이고 아직 안내를 안 마쳤으면 이름 입력 창을 연다 */
export function maybeShowOnboarding() {
  if (!IS_PERSONAL || isOnboarded()) return false;
  const modal = $('onboardingModal');
  if (!modal) return false;
  const inp = $('onboardingName');
  if (inp) inp.value = '';
  modal.classList.remove('hidden');
  return true;
}

/** [시작하기] — 이름 저장(비우면 '나') → 화면 글자 갱신 */
export function finishOnboarding() {
  if (!IS_PERSONAL) return;
  const inp = $('onboardingName');
  setOwnerName(inp ? inp.value : DEFAULT_OWNER_NAME);
  markOnboarded();
  const modal = $('onboardingModal');
  if (modal) modal.classList.add('hidden');
  refreshNames();
}

/** 설정 창의 '내 이름' 칸 */
export function onOwnerNameChanged() {
  if (!IS_PERSONAL) return;
  const inp = $('ownerNameInput');
  if (!inp) return;
  const saved = setOwnerName(inp.value);
  if (document.activeElement !== inp) inp.value = saved;
  refreshNames();
}

/** '내 Firebase 웹 API 키' 칸 (공개 식별자 — 비밀번호 아님. 이 기기에만 저장) */
export function onFbApiKeyChanged() {
  if (!IS_PERSONAL) return;
  const inp = $('fbApiKey');
  if (!inp) return;
  const v = String(inp.value || '').replace(/["'\s]/g, '');
  try { localStorage.setItem(PERSONAL_KEYS.fbApiKey, v); } catch (e) { /* */ }
  const st = $('fbApiKeyStatus');
  if (st) st.textContent = v ? `저장됨 (끝 4자 …${v.slice(-4)})` : '키 없음 — 로그인하려면 필요합니다';
}

/** 설정(등록) 창을 열 때 개인 칸 채우기 */
export function fillPersonalSettings() {
  if (!IS_PERSONAL) return;
  const name = $('ownerNameInput');
  if (name) name.value = getOwnerName();
  const key = $('fbApiKey');
  if (key) {
    let v = '';
    try { v = localStorage.getItem(PERSONAL_KEYS.fbApiKey) || ''; } catch (e) { v = ''; }
    key.value = v;
    const st = $('fbApiKeyStatus');
    if (st) st.textContent = v ? `저장됨 (끝 4자 …${v.slice(-4)})` : '키 없음 — 로그인하려면 필요합니다';
  }
}

function refreshNames() {
  applyAppMode(document);
  try { renderCalendar(); } catch (e) { console.warn('달력 다시 그리기 실패', e); }
}
