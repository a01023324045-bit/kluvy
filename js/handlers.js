// HTML 의 inline 핸들러(onclick/onchange/oninput)에서 부르는 함수 목록.
// ES 모듈 안의 함수는 전역에서 안 보이므로 main.js 가 이 객체를 window 에 붙인다.
// ⚠️ index.html 에 onclick="새함수()" 를 추가하면 반드시 여기에도 추가할 것.
//    (npm test 의 handlers 테스트 / npm run check:handlers 가 빠진 것을 잡아낸다)
import { manualSyncNow, onFirebaseUrlChanged } from './firebase-sync.js';
import { captureCalendar, toggleScheduleFilter, changeMonth, selectDate } from './render/calendar.js';
import {
  openYejinImageModal, closeYejinImageModal, zoomImage, resetZoomImage, openOriginalImageInNewTab
} from './ui/image-modal.js';
import {
  openAnniversaryModal, closeAnniversaryModal, addCustomAnniversary, deleteCustomAniv
} from './ui/anniversary-modal.js';
import {
  openEditModal, closeEditModal, setEditMode, onMyShiftTypeChange, onGfShiftTypeChange, saveModalChanges
} from './ui/edit-modal.js';
import {
  openUploadModalForCurrentMonth, closeUploadModal, onMonthSelectorChange, onFileSelected,
  toggleApiKeyInput, onApiKeyChanged, onGeminiModelChanged, toggleCloudSyncInput, clearTargetMonthData, processUploadFiles,
  onAirlabsKeyChanged
} from './ui/upload-modal.js';
import { cancelRecognizePreview, applyRecognizePreview } from './ui/recognize-preview.js';
import { onRecoPrefsChanged } from './ui/reco-prefs.js';
import { fbLoginFromForm, fbLogout } from './ui/login.js';
import { downloadBackup, openRestorePicker, onBackupFileSelected } from './ui/backup-ui.js';

export const handlers = {
  // 헤더 / 달력
  manualSyncNow, captureCalendar, toggleScheduleFilter, changeMonth, selectDate,
  // 사진 뷰어
  openYejinImageModal, closeYejinImageModal, zoomImage, resetZoomImage, openOriginalImageInNewTab,
  // 기념일
  openAnniversaryModal, closeAnniversaryModal, addCustomAnniversary, deleteCustomAniv,
  // 편집
  openEditModal, closeEditModal, setEditMode, onMyShiftTypeChange, onGfShiftTypeChange, saveModalChanges,
  // 업로드 / 설정
  openUploadModalForCurrentMonth, closeUploadModal, onMonthSelectorChange, onFileSelected,
  toggleApiKeyInput, onApiKeyChanged, onGeminiModelChanged, toggleCloudSyncInput, onFirebaseUrlChanged, clearTargetMonthData, processUploadFiles,
  onAirlabsKeyChanged,
  // 인식 결과 미리보기 / 데이트 추천 기준
  cancelRecognizePreview, applyRecognizePreview, onRecoPrefsChanged,
  // 로그인
  fbLoginFromForm, fbLogout,
  // 백업 / 복원
  downloadBackup, openRestorePicker, onBackupFileSelected
};
