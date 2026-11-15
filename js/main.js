// 앱 시작점
import { DEFAULT_FIREBASE_URL, STORAGE_KEYS } from './config.js';
import { safeGetStorage, safeSetStorage } from './storage.js';
import { state } from './state.js';
import { setOnAuthInvalidated } from './auth.js';
import { initSync, initSyncGuard, runAfterFirstFullSync, saveDB } from './firebase-sync.js';
import { migrateKyuhoSeokRules } from './schedule-model.js';
import { refreshFlightTimes } from './flight-times.js';
import { getConfiguredDbUrl } from './config.js';
import { renderCalendar, updateDetailCard } from './render/calendar.js';
import { initYearSelector } from './ui/upload-modal.js';
import { updateFbLoginUI } from './ui/login.js';
import { handlers } from './handlers.js';
import { getPhotoBackend, migrateLocalStoragePhotos } from './photo-store.js';
import { isSafeImageDataUrl } from './escape.js';

// inline onclick 등에서 쓸 수 있도록 전역 노출
Object.assign(window, handlers);

// 새 버전이 활성화되면(서비스워커 교체) 한 번 자동 새로고침 — 탭이 옛 JS로 계속 도는 것을 막는다.
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadedForUpdate) return;
    reloadedForUpdate = true;
    location.reload();
  });
}

setOnAuthInvalidated(updateFbLoginUI);

function loadLocalData() {
  if (!localStorage.getItem(STORAGE_KEYS.dbUrl)) {
    safeSetStorage(STORAGE_KEYS.dbUrl, DEFAULT_FIREBASE_URL);
  }

  // 운영본은 여기서 내장 데이터(MASTER_SCHEDULE_DB, 2026-07~10)를 매번 다시 섞고 7/1·7/2 를 '휴가'로 고정했다.
  // → 삭제. 내장 데이터는 tools/seed-2026-07-10.json 에 보관만 한다. 근무표는 이 폰 저장분 + 서버에서만 온다.
  const scheduleDB = safeGetStorage(STORAGE_KEYS.schedule, {});
  state.scheduleDB = (scheduleDB && typeof scheduleDB === 'object' && !Array.isArray(scheduleDB)) ? scheduleDB : {};
  // 이 폰에 근무표가 없던 상태(새 폰·캐시 삭제)라면 서버에서 한 번 받기 전에는 아무것도 업로드하지 않는다.
  initSyncGuard(Object.keys(state.scheduleDB).length > 0);

  state.fileHistory = safeGetStorage(STORAGE_KEYS.fileHistory, {
    "2026-10": { kyuho: "교대근무표 10월.xlsx", yejin: "2610.png" },
    "2026-09": { kyuho: "교대근무표 9월.xlsx", yejin: "2609.png" },
    "2026-08": { kyuho: "교대근무표 8월.xlsx", yejin: "2608.jpg" },
    "2026-07": { kyuho: "교대근무표 7월.xlsx", yejin: "2607.jpg" }
  });

  state.customAnniversaries = safeGetStorage(STORAGE_KEYS.anniversaries, [
    { name: "규호 생일", date: "2026-05-18", isRepeat: true },
    { name: "예진 생일", date: "2026-09-12", isRepeat: true }
  ]);
}

// 3단계 1회성 보정: 휴일의 '석근 13~21' → 공휴일석근 15~21, 시간 없는 '석5' → 석5/공휴일석5.
// 서버 근무표를 받은 뒤에 돌린다(옛 사본을 고치지 않도록). 수동 입력 값은 제외. 바뀐 날짜만 칸 단위 PATCH(멱등).
// 이 폰에서 한 번 끝나면 다시 돌지 않는다(MIGRATION_KEY). 다른 폰과 동시에 돌아도 같은 값을 쓰므로 안전.
const MIGRATION_KEY = 'kluvy_migration_seok_v1';
function runSeokMigration() {
  if (localStorage.getItem(MIGRATION_KEY)) return;
  const changed = migrateKyuhoSeokRules(state.scheduleDB);
  if (changed.length) {
    console.info(`석근·석5 휴일 규칙 보정: ${changed.length}일 (${changed.join(', ')})`);
    saveDB();
    renderCalendar();
  }
  safeSetStorage(MIGRATION_KEY, { at: Date.now(), count: changed.length, dates: changed });
}

function initApp() {
  try {
    initYearSelector();
    updateFbLoginUI();
    renderCalendar();
    updateDetailCard();
  } catch (err) {
    console.error("초기화 예외 발생:", err);
  }
  // 서버 동기화: 미전송 대기열 전송 + 실시간 스트림 (화면이 보이고 온라인일 때)
  runAfterFirstFullSync(() => { runSeokMigration(); refreshFlightTimes().catch(() => {}); });
  if (!getConfiguredDbUrl()) runSeokMigration(); // 서버를 안 쓰는 폰은 이 폰 사본만 보정
  initSync();
  // v1 이 localStorage 에 넣어 둔 사진(base64)을 IndexedDB 로 옮기고 localStorage 에서 지운다 (한도 초과 방지)
  migrateLocalStoragePhotos(localStorage, getPhotoBackend(), isSafeImageDataUrl)
    .then(r => { if (r.moved.length) console.info('사진을 IndexedDB 로 옮김:', r.moved.join(', ')); })
    .catch(e => console.warn('사진 옮기기 실패:', e));
}

loadLocalData();
// 모듈 스크립트는 HTML 파싱이 끝난 뒤 실행되므로 바로 초기화한다.
// (운영본은 즉시 1회 + DOMContentLoaded 1회, 총 2번 초기화했음 — 결과는 같아서 1번으로 정리)
initApp();
