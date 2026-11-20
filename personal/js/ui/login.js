// 동기화 계정 로그인/로그아웃 UI
import { STORAGE_KEYS, IS_PERSONAL, getConfiguredDbUrl } from '../config.js';
import { onFbApiKeyChanged } from './personal.js';

// v2.6.0 개인 모드 문구: '내 계정' (커플: '동기화 계정')
const ACCOUNT_LABEL = IS_PERSONAL ? '내 계정' : '동기화 계정';
import { fbIsLoggedIn, fbLogin, fbClearSession } from '../auth.js';
import { restartSync, stopSync } from '../firebase-sync.js';

export async function fbLoginFromForm() {
  const email = (document.getElementById('fbLoginEmail').value || '').trim();
  const pwInput = document.getElementById('fbLoginPw');
  if (!email || !pwInput.value) { alert('이메일과 비밀번호를 입력해 주세요.'); return; }
  if (IS_PERSONAL) {
    onFbApiKeyChanged(); // 입력칸의 웹 API 키를 먼저 저장
    if (!getConfiguredDbUrl()) { alert('먼저 위 칸에 내 Firebase 주소(https://…firebasedatabase.app/)를 넣어 주세요.'); return; }
  }
  try {
    await fbLogin(email, pwInput.value);
    pwInput.value = '';
    updateFbLoginUI();
    alert('로그인 완료! 이제 동기화가 다시 동작합니다.');
    restartSync(); // 대기열 전송 + 실시간 연결 다시 시작
  } catch (e) {
    alert('로그인 실패: ' + e.message);
  }
}

export function fbLogout() {
  fbClearSession();
  updateFbLoginUI();
  stopSync();
}

export function updateFbLoginUI() {
  const status = document.getElementById('fbLoginStatus');
  const form = document.getElementById('fbLoginForm');
  const logoutBtn = document.getElementById('fbLogoutBtn');
  if (!status) return;
  if (fbIsLoggedIn()) {
    status.textContent = `${ACCOUNT_LABEL}: ${localStorage.getItem(STORAGE_KEYS.loginEmail) || '로그인됨'}`;
    status.className = 'text-[13px] font-semibold text-emerald-800';
    form && form.classList.add('hidden');
    logoutBtn && logoutBtn.classList.remove('hidden');
  } else {
    status.textContent = `${ACCOUNT_LABEL}: 로그인 안 됨`;
    status.className = 'text-[13px] font-semibold text-slate-600';
    form && form.classList.remove('hidden');
    logoutBtn && logoutBtn.classList.add('hidden');
  }
}
