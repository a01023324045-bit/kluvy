// 동기화 계정 로그인/로그아웃 UI
import { STORAGE_KEYS } from '../config.js';
import { fbIsLoggedIn, fbLogin, fbClearSession } from '../auth.js';
import { restartSync, stopSync } from '../firebase-sync.js';

export async function fbLoginFromForm() {
  const email = (document.getElementById('fbLoginEmail').value || '').trim();
  const pwInput = document.getElementById('fbLoginPw');
  if (!email || !pwInput.value) { alert('이메일과 비밀번호를 입력해 주세요.'); return; }
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
    status.textContent = `동기화 계정: ${localStorage.getItem(STORAGE_KEYS.loginEmail) || '로그인됨'}`;
    status.className = 'text-[13px] font-semibold text-emerald-800';
    form && form.classList.add('hidden');
    logoutBtn && logoutBtn.classList.remove('hidden');
  } else {
    status.textContent = '동기화 계정: 로그인 안 됨';
    status.className = 'text-[13px] font-semibold text-slate-600';
    form && form.classList.remove('hidden');
    logoutBtn && logoutBtn.classList.add('hidden');
  }
}
