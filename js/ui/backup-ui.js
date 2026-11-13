// 설정 영역(업로드 모달)의 '데이터 백업 다운로드 / 백업에서 복원'
import { state } from '../state.js';
import { buildBackup, backupFileName, parseBackup } from '../backup.js';
import { overwriteServerWithLocal } from '../firebase-sync.js';
import { renderCalendar } from '../render/calendar.js';
import { updateUploadModalStatus } from './upload-modal.js';

export function downloadBackup() {
  const now = new Date();
  const backup = buildBackup(state, now);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(now);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function openRestorePicker() {
  const input = document.getElementById('backupFileInput');
  if (!input) return;
  input.value = '';
  input.click();
}

export async function onBackupFileSelected() {
  const input = document.getElementById('backupFileInput');
  const file = input && input.files && input.files[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch (e) {
    alert('백업 파일을 읽지 못했습니다: ' + e.message);
    return;
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    alert('복원할 수 없습니다: ' + parsed.error);
    input.value = '';
    return;
  }
  const { days, anniversaries, exportedAt } = parsed.summary;
  const when = exportedAt ? new Date(exportedAt).toLocaleString('ko-KR') : '알 수 없음';
  const ok = confirm(
    `백업에서 복원할까요?\n\n` +
    `· 백업 시각: ${when}\n· 근무표 ${days}일, 기념일 ${anniversaries}개\n\n` +
    `⚠️ 지금 이 폰과 서버(상대방 폰 포함)의 근무표·기념일이 모두 이 백업 내용으로 바뀝니다.\n` +
    `필요하면 먼저 '백업 다운로드'로 현재 상태를 저장해 두세요.`
  );
  input.value = '';
  if (!ok) return;

  state.scheduleDB = parsed.data.schedules;
  state.customAnniversaries = parsed.data.anniversaries;
  state.fileHistory = parsed.data.fileHistory;
  // 사용자가 확인창에서 고른 의도적 전체 덮어쓰기 → 서버 schedules·anniversaries 를 통째로 교체
  const sent = await overwriteServerWithLocal();
  renderCalendar();
  try { updateUploadModalStatus(); } catch (e) { /* 모달 닫혀 있으면 무시 */ }
  alert(`복원 완료! (근무표 ${days}일, 기념일 ${anniversaries}개)` + (sent ? '' : '\n※ 지금은 서버에 못 보냈습니다. 연결되면 자동으로 보냅니다.'));
}
