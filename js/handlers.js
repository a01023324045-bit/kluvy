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
  onAirlabsKeyChanged, checkAirlabsConnection, checkForUpdate, previewUploadFiles
} from './ui/upload-modal.js';
import { undoLastUpload, dismissApplyBar, toggleApplyDetails } from './ui/apply-bar.js';
import { rereadFlightsFromBar, rereadFlightsFromModal } from './ui/reread-flights.js';
import { cancelRecognizePreview, applyRecognizePreview } from './ui/recognize-preview.js';
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
  onAirlabsKeyChanged, checkAirlabsConnection, checkForUpdate,
  // 인식 결과 미리보기 (v2.4.6: 선택 기능 — [결과 먼저 보기] 를 눌렀을 때만 열림)
  previewUploadFiles, cancelRecognizePreview, applyRecognizePreview,
  // 바로 반영 결과 바 · 되돌리기 (v2.4.6)
  undoLastUpload, dismissApplyBar, toggleApplyDetails,
  // 편명 다시 읽기 (v2.5.1): 요약 바 버튼(rereadFlights) · 등록 창 링크(rereadFlightsFromModal)
  rereadFlights: rereadFlightsFromBar, rereadFlightsFromModal,
  // 로그인
  fbLoginFromForm, fbLogout,
  // 백업 / 복원
  downloadBackup, openRestorePicker, onBackupFileSelected
};
