// 근무표 등록(업로드) 모달
// v2.4.6: 규호 칸은 엑셀 또는 사진(jpg/png → Gemini), 예진 사진도 Gemini. 인식이 끝나면 '미리보기 없이 바로 반영'하고
//         화면 아래에 결과 한 줄 요약 + [되돌리기](10분)를 보여 준다. 미리보기(체크박스·편명 수정)는 [결과 먼저 보기] 로만 연다.
//         업로드는 자기 칸(규호 my / 예진 gf)만 바꾸고, 직접 입력(✋)·빈칸·같은 값·date·약속·상대 칸은 건드리지 않는다.
//         예진 사진은 반영할 때 한 번만 업로드한다.
import { DEFAULT_FIREBASE_URL, STORAGE_KEYS, GEMINI_MODEL, APP_VERSION, APP_VERSION_NUMBER, APP_CACHE_PREFIX, APP_CACHE_NAME, IS_PERSONAL, isOwnAppCache } from '../config.js';
import { fillPersonalSettings } from './personal.js';

// v2.6.0: 사진 칸(gf) 이름 — 커플 '예진', 개인 '내 근무표'
const Y_PHOTO = IS_PERSONAL ? '근무표 사진' : '예진 사진';
const Y_SCHED = IS_PERSONAL ? '내 근무표' : '예진 스케줄';
import { state } from '../state.js';
import { makeDateKey, makeMonthKey } from '../dates.js';
import { safeSetStorage } from '../storage.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar, updateDetailCard } from '../render/calendar.js';
import { compressImageFile, savePhotoForMonth, deleteLocalPhoto, deleteServerPhoto, localPhotoKeys, syncPhotoForMonth, openYejinImageModal } from './image-modal.js';
import { getPhotoBackend } from '../photo-store.js';
import { isSafeImageDataUrl } from '../escape.js';
import { describeCurrentFile, pruneFileHistory } from '../file-history.js';
import { parseKyuhoWorkbookData } from '../parsers/excel-kyuho.js';
import { applyQuickTextInput } from '../parsers/quick-text.js';
import { recognizeYejinImage, buildYejinPreviewRows, readFileAsBase64 } from '../parsers/gemini-yejin.js';
import { recognizeKyuhoImage, buildKyuhoPreviewRows } from '../parsers/gemini-kyuho.js';
import { getGeminiModel, setGeminiModel } from '../parsers/gemini-client.js';
import { openRecognizePreview } from './recognize-preview.js';
import { showApplyBar } from './apply-bar.js';
import { captureBefore, diffEntries, saveUndo } from '../upload-undo.js';
import { buildApplySummary } from '../apply-summary.js';
import { flightStatsForMonth } from '../flight-stats.js';
import { rememberUploadedPhoto } from './reread-flights.js';
import { planUploadRows, applyUploadRows, rowsFromMyMap, rowsFromGfDb, dedupeRows } from '../upload-merge.js';
import { normalizeFlight, sourceLabel, findFlightEntry } from '../flight.js';
import { refreshFlightTimes, fillFromFlightTable, getFlightTable, learnFlightFromGf, getAirlabsKey, setAirlabsKey, airlabsUsageText, pingAirlabs } from '../flight-times.js';
import { maskKey, cleanAirlabsKey } from '../airlabs.js';

/** 규호 칸에 고른 파일이 사진인가 (jpg/png 등) */
export function isImageFile(file) {
  return Boolean(file) && (/^image\//.test(file.type || '') || /\.(jpe?g|png|webp|heic)$/i.test(file.name || ''));
}

export function initYearSelector() {
  const select = document.getElementById('selectUploadYear');
  if (!select) return;
  select.innerHTML = '';
  for (let y = 2025; y <= 2040; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.innerText = `${y}년`;
    if (y === state.currentYear) opt.selected = true;
    select.appendChild(opt);
  }
}

export function toggleCloudSyncInput() {
  const box = document.getElementById('cloudSyncInputBox');
  if (box) box.classList.toggle('hidden');
}

export function toggleApiKeyInput() {
  const box = document.getElementById('apiKeyInputBox');
  if (box) box.classList.toggle('hidden');
}

export function onApiKeyChanged() {
  const key = document.getElementById('geminiApiKey').value.trim();
  safeSetStorage(STORAGE_KEYS.geminiKey, key);
}

/**
 * AirLabs API 키 (선택 기능 — 이 폰 localStorage 에만 저장).
 * v2.3.0: oninput(붙여넣는 즉시) + onchange + 창 닫을 때 한 번 더 저장 — 포커스를 옮기지 않고 창을 닫아도 저장된다.
 * 앞뒤 공백·줄바꿈·따옴표는 지우고 저장, 입력칸 아래에 '저장됨 (끝 4자 …XXXX)' 로 확인.
 * @param {Event} [ev] change 이벤트면 입력칸 글자도 정리된 값으로 바꿔 줌 (입력 중에는 커서가 튀지 않게 그대로)
 */
export function onAirlabsKeyChanged(ev) {
  const inp = document.getElementById('airlabsApiKey');
  if (!inp) return;
  const saved = setAirlabsKey(inp.value);
  if (ev && ev.type === 'change' && saved !== null && inp.value !== saved) inp.value = saved;
  showAirlabsKeyStatus(inp.value, saved);
  const u = document.getElementById('airlabsUsageText');
  if (u) u.textContent = airlabsUsageText();
}

function showAirlabsKeyStatus(raw, saved) {
  const st = document.getElementById('airlabsKeyStatus');
  if (!st) return;
  const k = saved === undefined ? getAirlabsKey() : saved;
  st.classList.remove('text-emerald-700', 'text-rose-700', 'text-slate-500');
  if (k === null) { st.textContent = '⚠️ 저장하지 못했습니다 (브라우저 저장소 오류 — 사생활 보호 모드·저장공간 부족). 앱을 다시 열어 보세요.'; st.classList.add('text-rose-700'); showAirlabsKeyWarn(''); return; }
  if (!k) { st.textContent = '키 없음 — 붙여 넣으면 바로 저장됩니다.'; st.classList.add('text-slate-500'); showAirlabsKeyWarn(''); return; }
  const cleaned = String(raw || '').length && cleanAirlabsKey(raw) !== String(raw || '') ? ' · 공백·줄바꿈·따옴표 지움' : '';
  st.textContent = `✓ 저장됨 (끝 4자 ${maskKey(k)}, ${k.length}자${cleaned})`;
  st.classList.add('text-emerald-700');
  showAirlabsKeyWarn(airlabsKeyWarning(raw, k));
}

/** 키 형식 경고 (저장은 그대로 하되 눈에 띄게): 너무 짧음 / 이상한 글자 / 공백·줄바꿈이 섞여 있었음 */
export function airlabsKeyWarning(raw, k) {
  const w = [];
  if (k && k.length < 12) w.push(`키가 너무 짧습니다(${k.length}자) — 복사가 덜 됐는지 확인하세요. AirLabs 키는 보통 30자 이상입니다.`);
  if (k && /[^A-Za-z0-9_-]/.test(k)) w.push('키에 영문·숫자·- 가 아닌 글자가 있습니다 — 다른 글(설명 문장 등)까지 함께 복사된 것 같습니다.');
  if (/\S\s+\S/.test(String(raw || '').trim())) w.push('붙여 넣은 글 가운데에 공백·줄바꿈이 있어 지우고 저장했습니다. 키가 맞는지 [연결 확인]으로 확인하세요.');
  return w.join(' ');
}

function showAirlabsKeyWarn(text) {
  const el = document.getElementById('airlabsKeyWarn');
  if (!el) return;
  el.textContent = text ? `⚠️ ${text}` : '';
  el.classList.toggle('hidden', !text);
}

/** [연결 확인] — AirLabs /ping 결과를 화면에 그대로 */
export async function checkAirlabsConnection() {
  const inp = document.getElementById('airlabsApiKey');
  if (inp) onAirlabsKeyChanged();
  const out = document.getElementById('airlabsPingResult');
  const btn = document.getElementById('btnAirlabsPing');
  if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }
  if (out) { out.textContent = 'AirLabs 에 묻는 중...'; out.className = 'help'; }
  let r;
  try { r = await pingAirlabs(); } catch (e) { r = { ok: false, text: `확인 중 오류: ${e && e.message ? e.message : e}` }; }
  if (out) {
    out.textContent = r.text;
    out.className = `text-[13px] font-semibold ${r.ok ? 'text-emerald-700' : 'text-rose-700'}`;
    out.dataset.ok = r.ok ? '1' : '0';
  }
  if (btn) { btn.disabled = false; btn.textContent = '연결 확인'; }
  const u = document.getElementById('airlabsUsageText');
  if (u) u.textContent = airlabsUsageText();
  return r;
}

/** 모델 이름 설정 (비우면 기본 gemini-3.6-flash) */
export function onGeminiModelChanged() {
  const inp = document.getElementById('geminiModel');
  if (!inp) return;
  setGeminiModel(inp.value.trim());
  inp.value = getGeminiModel();
}

/** 고른(아직 반영 전) 파일 이름 한 줄 — '현재 파일' 카드는 그대로 두고 그 아래에 따로 보여 준다 (v2.5.2) */
function showSelectedFile(id, text) {
  const e = document.getElementById(id);
  if (!e) return;
  e.textContent = text;
  e.classList.toggle('hidden', !text);
}

export function onFileSelected(who) {
  if (who === 'kyuho') {
    const file = document.getElementById('kyuhoFile').files[0];
    showSelectedFile('kyuhoSelectedFileName', file ? `선택됨: ${file.name}${isImageFile(file) ? ' (사진 → AI 인식)' : ''}` : '');
  } else if (who === 'yejin') {
    // 사진은 [변경사항 캘린더 반영] 때 한 번만 압축·업로드한다 (1단계: 여기서도 업로드해서 두 번 올라갔음)
    const file = document.getElementById('yejinImageFile').files[0];
    showSelectedFile('yejinSelectedFileName', file ? `선택됨: ${file.name}` : '');
  }
}

export function openUploadModalForCurrentMonth() {
  // v2.4.2: 앱 버전·저장된 화면(캐시) 표시
  renderAppVersion();
  setUploadTargetMonth(state.currentYear, state.currentMonth);
  const savedKey = localStorage.getItem(STORAGE_KEYS.geminiKey) || '';
  const keyInput = document.getElementById('geminiApiKey');
  if (keyInput) keyInput.value = savedKey;

  const savedDb = localStorage.getItem(STORAGE_KEYS.dbUrl) || DEFAULT_FIREBASE_URL;
  const dbInput = document.getElementById('firebaseDbUrl');
  if (dbInput) dbInput.value = savedDb;

  const modelInput = document.getElementById('geminiModel');
  if (modelInput) { modelInput.value = getGeminiModel(); modelInput.placeholder = GEMINI_MODEL; }
  const alInput = document.getElementById('airlabsApiKey');
  if (alInput) alInput.value = getAirlabsKey();
  showAirlabsKeyStatus(alInput ? alInput.value : '');
  const ping = document.getElementById('airlabsPingResult');
  if (ping) { ping.textContent = ''; ping.className = 'help'; delete ping.dataset.ok; }
  const alUsage = document.getElementById('airlabsUsageText');
  if (alUsage) alUsage.textContent = airlabsUsageText();
  fillPersonalSettings(); // v2.6.0 개인 모드: 내 이름·웹 API 키 칸 (커플 모드는 아무것도 안 함)

  document.getElementById('uploadModal').classList.remove('hidden');
}

export function closeUploadModal() {
  // 창을 닫는 순간에도 키를 한 번 더 저장 (입력칸에서 포커스를 옮기지 않고 바로 닫아도 저장되게)
  if (document.getElementById('airlabsApiKey')) onAirlabsKeyChanged();
  if (document.getElementById('geminiApiKey')) onApiKeyChanged();
  document.getElementById('uploadModal').classList.add('hidden');
  // 키가 바뀌었을 수 있으니 상세 카드(비행 상자의 버튼·안내)를 다시 그림
  try { if (state.selectedDateKey) updateDetailCard(); } catch (e) { console.warn('상세 카드 갱신 실패', e); }
}

export function setUploadTargetMonth(year, month) {
  state.uploadTargetYear = year;
  state.uploadTargetMonth = month;

  document.getElementById('modalTargetMonthTitle').innerText = `${year}년 ${month}월`;
  document.querySelectorAll('.uploadTargetMonthText').forEach(el => el.innerText = `${month}월`);
  document.getElementById('selectUploadYear').value = year;
  document.getElementById('selectUploadMonth').value = month;

  document.getElementById('kyuhoFile').value = '';
  document.getElementById('yejinImageFile').value = '';

  showSelectedFile('kyuhoSelectedFileName', '');
  showSelectedFile('yejinSelectedFileName', '');
  renderCurrentFiles();
  const rs = document.getElementById('rereadFlightsStatus'); // v2.5.1: 달을 바꾸면 이전 [편명 다시 읽기] 결과 줄은 지움
  if (rs) { rs.textContent = ''; rs.classList.add('hidden'); }

  updateUploadModalStatus();
}

export function onMonthSelectorChange() {
  const y = parseInt(document.getElementById('selectUploadYear').value, 10);
  const m = parseInt(document.getElementById('selectUploadMonth').value, 10);
  setUploadTargetMonth(y, m);
}

export function updateUploadModalStatus() {
  const { uploadTargetYear, uploadTargetMonth, scheduleDB } = state;
  const totalDays = new Date(uploadTargetYear, uploadTargetMonth, 0).getDate();
  let kCount = 0;
  let yCount = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dKey = makeDateKey(uploadTargetYear, uploadTargetMonth, d);
    if (scheduleDB[dKey]?.my?.type && scheduleDB[dKey]?.my?.type !== '-') kCount++;
    if (scheduleDB[dKey]?.gf?.type) yCount++;
  }

  document.getElementById('statusKyuhoMonthCount').innerText = kCount > 0 ? `${kCount}일 등록됨` : '미등록';
  document.getElementById('statusYejinMonthCount').innerText = yCount > 0 ? `${yCount}일 등록됨` : '미등록';
}

// ---------------- 현재 파일 카드 (v2.5.2) ----------------
// 주 글자 = '2026년 12월 예진 스케줄', 보조 글자 = 올린 파일 이름, 예진은 실제 사진 썸네일. 예전에는 파일 이름만 보였다.
// 사진(예진)·근무 데이터(규호)가 그 달에 실제로 없으면 파일 이름이 남아 있어도 '등록된 사진 없음' — 다른 달에 쌓인 이름이 보이지 않게.
let currentFilesToken = 0;

/** 그 달에 규호 근무 칸이 있는 날 수 */
function kyuhoDaysInMonth(year, month) {
  const total = new Date(year, month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= total; d++) {
    const t = state.scheduleDB[makeDateKey(year, month, d)]?.my?.type;
    if (t && t !== '-') n++;
  }
  return n;
}

function paintKyuhoCurrent(year, month) {
  const mKey = makeMonthKey(year, month);
  const info = describeCurrentFile({ who: 'kyuho', year, month, fileName: (state.fileHistory[mKey] || {}).kyuho || '', hasData: kyuhoDaysInMonth(year, month) > 0 });
  const box = document.getElementById('kyuhoCurrentFile');
  if (!box) return;
  box.dataset.state = info.empty ? 'empty' : info.kind;
  document.getElementById('kyuhoCurLabel').textContent = info.empty ? info.emptyText : info.label;
  document.getElementById('kyuhoAppliedFileName').textContent = info.sub; // 비면 CSS 로 숨김 (:empty)
  const icon = document.querySelector('#kyuhoCurThumb i');
  if (icon) icon.className = `fa-solid ${info.kind === 'image' ? 'fa-file-image' : info.kind === 'excel' ? 'fa-file-excel' : info.kind === 'data' ? 'fa-calendar-days' : 'fa-file'}`;
}

function paintYejinCurrent(year, month, photoData) {
  const mKey = makeMonthKey(year, month);
  const has = typeof photoData === 'string' && isSafeImageDataUrl(photoData);
  const info = describeCurrentFile({ who: 'yejin', year, month, fileName: (state.fileHistory[mKey] || {}).yejin || '', hasPhoto: has });
  const box = document.getElementById('yejinCurrentFile');
  if (!box) return;
  box.dataset.state = info.empty ? 'empty' : 'photo';
  document.getElementById('yejinCurLabel').textContent = info.empty ? info.emptyText : info.label;
  document.getElementById('yejinAppliedFileName').textContent = info.sub;
  const img = document.getElementById('yejinCurThumbImg');
  const icon = document.getElementById('yejinCurThumbIcon');
  const btn = document.getElementById('yejinCurThumb');
  if (has) { img.src = photoData; img.alt = `${info.label} 사진`; } else { img.removeAttribute('src'); img.alt = ''; }
  img.classList.toggle('hidden', !has);
  icon.classList.toggle('hidden', has);
  btn.disabled = !has;
  btn.setAttribute('aria-label', has ? `${info.label} 사진 크게 보기` : '등록된 사진 없음');
  document.getElementById('yejinCurViewBtn').classList.toggle('hidden', !has);
}

/**
 * 예전에 잘못 쌓였거나 가짜인 파일 이름을 정리한다 (사진·근무 데이터가 실제로 없는 달·사람의 이름).
 * 지금 막 바뀐 값을 덮지 않도록 '정리 대상으로 찍힌 이름이 아직 그대로인 것'만 지운다. 저장만 하고 서버·되돌리기 기록은 건드리지 않는다.
 */
export async function pruneStaleFileHistory() {
  const photoKeys = await localPhotoKeys();
  const { removed } = pruneFileHistory(state.fileHistory, {
    photoKeys,
    monthHasKyuho: k => kyuhoDaysInMonth(Number(k.slice(0, 4)), Number(k.slice(5, 7))) > 0
  });
  let changed = false;
  for (const r of removed) {
    const e = state.fileHistory[r.monthKey];
    if (e && e[r.who] === r.name) { delete e[r.who]; changed = true; if (!e.kyuho && !e.yejin) delete state.fileHistory[r.monthKey]; }
  }
  if (changed) safeSetStorage(STORAGE_KEYS.fileHistory, state.fileHistory);
  return removed;
}

/**
 * 고른 달(state.uploadTargetYear/Month)의 두 '현재 파일' 카드를 그린다.
 * 규호는 바로, 예진은 ① 이 폰 캐시 → ② 서버 확인(상대 폰이 올린 사진·더 새 사진) 순으로 그린다. 달을 바꾸면 늦게 온 결과는 버린다.
 * 마지막에 사진·근무 데이터가 없는 달의 낡은 파일 이름을 정리한다.
 */
export function renderCurrentFiles() {
  const year = state.uploadTargetYear;
  const month = state.uploadTargetMonth;
  const mKey = makeMonthKey(year, month);
  const token = ++currentFilesToken;
  paintKyuhoCurrent(year, month);
  const box = document.getElementById('yejinCurrentFile');
  if (box) box.dataset.state = 'loading';
  document.getElementById('yejinCurLabel').textContent = '사진 확인 중…';
  document.getElementById('yejinAppliedFileName').textContent = '';
  document.getElementById('yejinCurThumb').disabled = true;
  return (async () => {
    let data = null;
    try { data = (await getPhotoBackend().get(mKey))?.data ?? null; } catch (e) { data = null; }
    if (token !== currentFilesToken) return;
    paintYejinCurrent(year, month, data);
    try {
      data = (await syncPhotoForMonth(mKey)).data; // 오프라인이면 요청 없이 캐시만
      if (token !== currentFilesToken) return;
      paintYejinCurrent(year, month, data);
    } catch (e) { console.warn('사진 확인 실패:', e); }
    await pruneStaleFileHistory();
    if (token !== currentFilesToken) return;
    paintKyuhoCurrent(year, month);
    paintYejinCurrent(year, month, data);
  })();
}

/** 등록 창에서 고른 달의 사진을 사진 뷰어로 크게 보기 (달력에서 보는 달이 아니라 이 창의 대상 달) */
export function openUploadTargetPhoto() {
  return openYejinImageModal(state.uploadTargetYear, state.uploadTargetMonth);
}

/**
 * [해당 월 비우기]: 그 달 근무 칸 + 파일 이름 + 예진 사진(이 폰 캐시 + 서버)을 함께 지운다.
 * 서버 사진을 남기면 등록 창·사진 보기가 서버에서 다시 받아 와 '비웠는데 사진이 되살아나는' 일이 생긴다.
 */
export async function clearTargetMonthData() {
  const { uploadTargetYear, uploadTargetMonth } = state;
  if (confirm(`${uploadTargetYear}년 ${uploadTargetMonth}월의 근무 데이터와 등록된 사진을 비우시겠습니까?`)) {
    const totalDays = new Date(uploadTargetYear, uploadTargetMonth, 0).getDate();
    for (let d = 1; d <= totalDays; d++) {
      delete state.scheduleDB[makeDateKey(uploadTargetYear, uploadTargetMonth, d)];
    }
    const mKey = makeMonthKey(uploadTargetYear, uploadTargetMonth);
    delete state.fileHistory[mKey];

    saveDB();
    renderCalendar();
    await deleteLocalPhoto(mKey);
    const serverOk = await deleteServerPhoto(mKey); // true 삭제 · false 실패 · null 서버 안 씀
    // 비운 직후 같은 달을 보고 있다면 (confirm·await 사이에 달을 바꿨을 수 있어 현재 대상 달로) 카드를 다시 그린다
    updateUploadModalStatus();
    setUploadTargetMonth(state.uploadTargetYear, state.uploadTargetMonth);
    alert(`${uploadTargetYear}년 ${uploadTargetMonth}월 데이터가 초기화되었습니다.` + (serverOk === false ? '\n※ 서버의 사진은 지우지 못했습니다(인터넷 연결 확인). 연결된 뒤 [해당 월 비우기]를 한 번 더 눌러 주세요.' : ''));
  }
}


/** 엑셀 파일 → { 날짜: my } (반영은 하지 않음). 오류는 콘솔에만 남기고 빈 결과 (운영본 동작) */
export function readKyuhoExcel(file, year, month) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        resolve(parseKyuhoWorkbookData(new Uint8Array(e.target.result), window.XLSX, year, month));
      } catch (err) {
        console.error(err);
        resolve({});
      }
    };
    reader.onerror = () => resolve({});
    reader.readAsArrayBuffer(file);
  });
}

/** (1단계 호환) 엑셀을 읽어 업로드 대상 월의 규호 근무(my)에 반영 — 3단계: 미리보기 기본값과 같은 규칙(수동 값·빈칸 보호) */
export async function parseKyuhoExcelForTargetMonth(file) {
  const parsed = await readKyuhoExcel(file, state.uploadTargetYear, state.uploadTargetMonth);
  const planned = planUploadRows(state.scheduleDB, rowsFromMyMap(parsed));
  applyUploadRows(state.scheduleDB, planned.filter(r => r.include));
}

function setProgress(p, msg) {
  const box = document.getElementById('ocrProgressBox');
  if (!box) return;
  box.classList.remove('hidden');
  document.getElementById('ocrProgressBar').style.width = `${p}%`;
  document.getElementById('ocrPercent').innerText = `${p}%`;
  document.getElementById('ocrStatusText').innerText = msg;
}

function modelInfoText(results) {
  const used = results.filter(Boolean);
  if (!used.length) return '';
  const r = used[used.length - 1];
  if (r.fallbackFrom) return `인식 모델: ${r.model} (설정된 '${r.fallbackFrom}' 사용 불가 → 자동 전환, 다음부터 이 모델 사용)`;
  return `인식 모델: ${r.model}`;
}

/** 시각이 빠진 예진 비행을 편명 시간표로 채우고 미리보기에 출처를 적는다 */
function fillFlightTimes(rows) {
  for (const r of rows) {
    if (r.who !== 'gf') continue;
    const filled = fillFromFlightTable(r.value);
    if (!filled) continue;
    const f = normalizeFlight(filled.flight);
    const e = findFlightEntry(getFlightTable(), f.iata) || {};
    r.value = filled;
    r.note = `🕒 ${f.iata} 편명 시간표로 시각을 채웠습니다 (${filled.start || '?'}~${filled.end || '?'}, 출처: ${sourceLabel(e.source)}). 다르면 칸을 고쳐 주세요.`;
  }
  return rows;
}

/** [결과 먼저 보기] — 같은 인식을 하되 미리보기 창을 열어 확인·수정한 뒤 [반영] 을 누르게 한다 */
export function previewUploadFiles() {
  return processUploadFiles({ preview: true });
}

/** 반영 확정: 칸 쓰기 → 파일 이름·사진 → 저장(서버 칸 단위 PATCH) → 해당 달로 이동 → 요약 바 + 되돌리기 기록 */
async function commitUpload(ctx, finalRows) {
  const { planned, kFile, yFile, kyuhoMonth, yejinMonth, compressedYejin, shown, warns, fails } = ctx;
  const before = captureBefore(state.scheduleDB, finalRows);
  applyUploadRows(state.scheduleDB, finalRows);
  const entries = diffEntries(before, state.scheduleDB, finalRows);
  if (kFile && kyuhoMonth) {
    const k = makeMonthKey(kyuhoMonth.year, kyuhoMonth.month);
    if (!state.fileHistory[k]) state.fileHistory[k] = {};
    state.fileHistory[k].kyuho = kFile.name;
  }
  if (yFile && yejinMonth) {
    const k = makeMonthKey(yejinMonth.year, yejinMonth.month);
    if (!state.fileHistory[k]) state.fileHistory[k] = {};
    state.fileHistory[k].yejin = yFile.name;
    await savePhotoForMonth(k, compressedYejin); // 사진 업로드는 여기서 한 번만
    rememberUploadedPhoto(k, compressedYejin); // v2.5.1: [편명 다시 읽기] 가 같은 압축 사진을 다시 쓴다
  }
  // 확정된 비행 근무에서 편명 시각을 배운다 (두 폰 공유 시간표)
  for (const r of finalRows) if (r.who === 'gf') learnFlightFromGf(r.value, 'schedule');

  // v2.5.1: 예진 사진을 읽었으면 그 달 편명 통계 (편명이 비는 문제를 요약에 드러냄) — 달력에 실제 들어 있는 값 기준
  const flightStats = yFile && yejinMonth ? flightStatsForMonth(state.scheduleDB, yejinMonth.year, yejinMonth.month) : null;
  const summary = buildApplySummary({ entries, planned, finalRows, warns, fails, flightStats });
  const reread = summary.needsReread && yejinMonth ? { year: yejinMonth.year, month: yejinMonth.month } : null;
  const aniv = JSON.parse(JSON.stringify(state.customAnniversaries || []));
  saveDB(); // 이전 되돌리기 기록은 여기서 지워진다 → 이번 기록을 그 다음에 저장
  const undoable = saveUndo({ entries, aniv, text: summary.text, tone: summary.tone, details: summary.details, reread });
  state.uploadTargetYear = shown.year;
  state.uploadTargetMonth = shown.month;
  state.currentYear = shown.year;
  state.currentMonth = shown.month;
  state.selectedDateKey = makeDateKey(shown.year, shown.month, 1);
  renderCalendar();
  closeUploadModal();
  showApplyBar(summary, { undoable, reread });
  return summary;
}

/**
 * [반영] (v2.4.6: 바로 반영) / [결과 먼저 보기] ({ preview: true })
 * 엑셀·사진·간편 텍스트를 읽어 기존 값과 비교(planUploadRows)한 뒤 —
 *  · 기본: 새로 추가·변경 칸을 곧바로 반영. ✋ 수동 입력·근무표 빈칸·같은 값은 그대로 두고, 건너뛴 수를 요약에 알린다.
 *  · 미리보기: 체크박스·편명 수정 창을 열고, 거기서 [반영] 을 눌렀을 때 같은 경로로 저장한다.
 * 일부만 실패(예: 예진 사진 인식 오류)해도 나머지는 반영하고 요약에 실패를 함께 보여 준다. 전부 실패하면 반영하지 않고 알린다.
 */
export async function processUploadFiles(opts) {
  const preview = Boolean(opts && opts.preview === true);
  const btn = document.getElementById('btnStartScan');
  const originalBtnHtml = btn ? btn.innerHTML : '';

  try {
    const kFile = document.getElementById('kyuhoFile').files[0];
    const yFile = document.getElementById('yejinImageFile').files[0];
    const quickText = document.getElementById('quickScheduleInput').value.trim();
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    const dbUrl = document.getElementById('firebaseDbUrl').value.trim();

    if (apiKey) safeSetStorage(STORAGE_KEYS.geminiKey, apiKey);
    if (dbUrl) safeSetStorage(STORAGE_KEYS.dbUrl, dbUrl);

    const targetY = state.uploadTargetYear;
    const targetM = state.uploadTargetMonth;
    const mKey = makeMonthKey(targetY, targetM);
    const kIsImage = isImageFile(kFile);

    if (!kFile && !yFile && !quickText) {
      alert('등록할 근무표 파일(엑셀·사진)이나 간편 텍스트가 없습니다.');
      return;
    }

    // ---- 사진이 있는데 API 키가 없음 ----
    // v2.5.2: 키가 없으면 사진이 몇 월 것인지 읽을 수 없다. 예전에는 '선택한 달'(mKey)에 사진·파일 이름을 저장했는데,
    //   키가 있는 반영 경로(commitUpload)는 '사진에서 읽은 달'에 저장해서 같은 사진이 서로 다른 달에 쌓이고, 선택한 달의 진짜 사진을 덮어쓰기도 했다.
    //   → 달을 확인할 수 없는 경우에는 사진도 이름도 저장하지 않는다 (저장은 항상 사진에서 읽은 달 한 곳, commitUpload).
    if ((kIsImage || yFile) && !apiKey) {
      if (yFile && !kIsImage) {
        alert('사진 속 달을 읽으려면 Gemini API 키가 필요합니다. [설정]에서 키를 입력한 뒤 다시 [반영]을 눌러 주세요.\n(키 없이는 사진을 저장하지 않습니다 — 엉뚱한 달에 저장되는 것을 막기 위해서입니다.)');
      } else {
        alert('규호 근무표 사진을 읽으려면 Gemini API 키가 필요합니다. [설정]에서 키를 입력해 주세요.');
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = (kIsImage || yFile) ? '<i class="fa-solid fa-spinner animate-spin"></i> AI 분석 중...' : '<i class="fa-solid fa-spinner animate-spin"></i> 읽는 중...';
    }

    const rows = [];
    const results = [];
    const warns = []; // { short: 요약 바에 보일 짧은 글, long: 자세히·미리보기에 보일 글 }
    const fails = []; // 인식 실패 (같은 형식)
    const warn = (short, long = short) => warns.push({ short, long });
    let kyuhoMonth = null;
    let yejinMonth = null;
    let compressedYejin = null;
    const onStatus = msg => setProgress(45, msg);
    const sources = [];
    // 한 자료의 인식이 실패해도 다른 자료는 계속 처리 (실패는 요약에 표시)
    const guard = async (label, fn) => {
      try { await fn(); } catch (err) {
        console.warn(`${label} 처리 실패:`, err);
        fails.push({ short: `${label} 인식 실패`, long: `${label} 처리 중 문제가 발생했습니다: ${err && err.message ? err.message : err}` });
      }
    };

    // 1) 규호 엑셀
    if (kFile && !kIsImage) {
      const excelMap = await readKyuhoExcel(kFile, targetY, targetM);
      const r = rowsFromMyMap(excelMap, 'excel');
      if (!r.length) warn('엑셀에서 이규호 행을 못 찾음', `엑셀에서 '이규호' 행이나 날짜 머리글을 찾지 못했습니다 (${kFile.name}).`);
      rows.push(...r);
      kyuhoMonth = { year: targetY, month: targetM };
      sources.push(`규호 엑셀: ${kFile.name}`);
    }
    // 2) 간편 텍스트 (예진) — 같은 날짜는 아래 예진 사진이 우선
    if (quickText) {
      const tmp = {};
      applyQuickTextInput(quickText, tmp, targetY, targetM);
      const r = rowsFromGfDb(tmp, 'text');
      if (!r.length) warn('간편 텍스트에서 날짜를 못 찾음', '간편 텍스트에서 날짜를 찾지 못했습니다. (예: "3 오사카, 4-7 다낭, 8 OFF")');
      rows.push(...r);
      sources.push('간편 텍스트');
    }
    // 3) 규호 근무표 사진
    if (kIsImage) {
      await guard('규호 사진', async () => {
        setProgress(20, `${getGeminiModel()} 규호 근무표 사진 판독 중...`);
        const b64 = await readFileAsBase64(kFile);
        const r = await recognizeKyuhoImage(b64, kFile.type || 'image/jpeg', apiKey, { onStatus });
        results.push(r);
        const built = buildKyuhoPreviewRows(r.parsed, targetY, targetM);
        kyuhoMonth = { year: built.year, month: built.month };
        if (!built.rows.length) warn('규호 사진에서 이규호 행을 못 찾음', '규호 근무표 사진에서 이규호 행을 찾지 못했습니다.');
        rows.push(...built.rows.map(x => ({ ...x, source: 'photo' })));
        sources.push(`규호 사진: ${kFile.name}`);
      });
    }
    // 4) 예진 스케줄 사진
    if (yFile) {
      await guard(Y_PHOTO, async () => {
        setProgress(55, IS_PERSONAL ? `${getGeminiModel()} 내 근무표 출퇴근 정밀 판독 중...` : `${getGeminiModel()} 예진 스케줄 출퇴근 정밀 판독 중...`);
        const compressed = await compressImageFile(yFile);
        const b64 = await readFileAsBase64(yFile);
        const r = await recognizeYejinImage(b64, yFile.type || 'image/jpeg', apiKey, { onStatus });
        results.push(r);
        const built = buildYejinPreviewRows(r.parsed, targetY, targetM);
        compressedYejin = compressed;
        yejinMonth = { year: built.year, month: built.month };
        if (!built.rows.length) warn(`${Y_PHOTO}에서 일정을 못 찾음`, `${Y_SCHED} 사진에서 일정을 찾지 못했습니다.`);
        rows.push(...built.rows.map(x => ({ ...x, source: 'photo' })));
        sources.push(`${Y_PHOTO}: ${yFile.name}`);
      });
    }
    if (kIsImage || yFile) setProgress(100, preview ? '분석 완료! 미리보기를 엽니다.' : '분석 완료! 반영합니다.');
    for (const [who, mm] of [['규호 근무표', kIsImage ? kyuhoMonth : null], [Y_SCHED, yejinMonth]]) {
      if (mm && (mm.year !== targetY || mm.month !== targetM)) warn(`${who} 사진의 달(${mm.month}월)로 반영`, `${who} 사진에서 읽은 달(${mm.year}년 ${mm.month}월)이 선택한 달(${targetM}월)과 달라 사진의 달로 반영합니다.`);
    }
    const modelInput = document.getElementById('geminiModel');
    if (modelInput) modelInput.value = getGeminiModel();

    // 모두 실패: 아무것도 반영하지 않고 알린다 (창은 열어 둠 → 다시 시도)
    if (!rows.length && fails.length) {
      alert(`업로드 중 문제가 발생했습니다:\n${fails.map(f => f.long).join('\n')}`);
      showApplyBar(buildApplySummary({ warns, fails }), {});
      return;
    }

    // 편명 시간표(두 폰 공유)를 최신으로 받아 두고, 시각이 빠진 비행을 채운다 (오래 걸리면 캐시 사용)
    if (rows.some(r => r.who === 'gf' && r.value && r.value.flight)) {
      await Promise.race([refreshFlightTimes().catch(() => false), new Promise(r => setTimeout(r, 1500))]);
    }
    const planned = planUploadRows(state.scheduleDB, fillFlightTimes(dedupeRows(rows)));
    const shown = yejinMonth || kyuhoMonth || { year: targetY, month: targetM };
    const ctx = { planned, kFile, yFile, kyuhoMonth, yejinMonth, compressedYejin, shown, warns, fails };

    if (preview) {
      openRecognizePreview({
        title: `등록 미리보기 — ${shown.year}년 ${shown.month}월`,
        subtitle: sources.join(' · '),
        modelInfo: modelInfoText(results),
        warn: [...fails, ...warns].map(w => w.long).join(' '),
        rows: planned,
        onApply: finalRows => commitUpload(ctx, finalRows)
      });
      return;
    }

    // 바로 반영: 기본 체크 상태(새로 추가·변경)인 행을 그대로 적용. 수동·빈칸 보호는 planUploadRows 의 기본값이 그대로 지킨다.
    const finalRows = planned.filter(r => r.include).map(r => ({ who: r.who, dateKey: r.dateKey, status: r.status, value: { ...r.value } }));
    if (!planned.length) {
      // 읽은 것이 하나도 없음 (인식 경고뿐) — 저장할 것도, 되돌릴 것도 없음
      showApplyBar(buildApplySummary({ planned, finalRows, warns, fails }), {});
      return;
    }
    await commitUpload(ctx, finalRows);
  } catch (err) {
    console.warn("업로드 오류:", err);
    alert("업로드 중 문제가 발생했습니다:\n" + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
    }
    const progressBox = document.getElementById('ocrProgressBox');
    if (progressBox) progressBox.classList.add('hidden');
  }
}

/** 앱 버전 표시: 모달을 열 때 현재 버전과 저장된 화면(캐시) 이름을 보여 준다 */
export async function renderAppVersion() {
  const el0 = document.getElementById('appVersionText');
  // 캐시 조회(비동기) 전에 버전을 먼저 보여 줘 '확인 중…'에 멈춰 보이지 않게 한다
  const el = el0;
  if (!el) return;
  const label = IS_PERSONAL ? `내 스케줄 앱 v${APP_VERSION_NUMBER}` : `앱 버전 v${APP_VERSION_NUMBER}`;
  el.textContent = label;
  el.className = 'help !mt-0';
  let cacheName = '';
  try {
    const keys = await caches.keys();
    // 이 모드의 앱 파일 캐시(커플 kluvy-v2.6.0 / 개인 kluvy-personal-v2.6.0)만 본다 — CDN 캐시(kluvy-cdn-…)·다른 모드 캐시는 버전과 무관
    cacheName = keys.find(k => k.startsWith(APP_CACHE_PREFIX) && /^\d/.test(k.slice(APP_CACHE_PREFIX.length))) || '';
  } catch (e) { /* caches 없음 */ }
  // index.html 에 적힌 버전과 이 파일(config.js)의 버전이 다르면 일부 파일만 올라간 상태다.
  const metaVer = (document.querySelector('meta[name="kluvy-version"]') || {}).content || '';
  const problems = [];
  if (metaVer && metaVer !== APP_VERSION) problems.push(`화면 파일 v${metaVer}`);
  if (cacheName && cacheName !== APP_CACHE_NAME) problems.push(`저장된 화면 ${cacheName.replace('kluvy-', '')}`);
  el.textContent = label + (problems.length ? ` · 예전 파일 있음(${problems.join(', ')}) → [업데이트 확인]` : '');
  el.className = problems.length ? 'help !mt-0 !text-amber-700 font-bold' : 'help !mt-0';
}

/** 서비스워커·캐시를 새로 받고 최신 파일로 다시 불러온다 */
export async function checkForUpdate() {
  // v2.5.0: 오프라인에서 캐시를 지우면 앱이 아예 안 열리므로 막는다
  if (navigator.onLine === false) { alert('지금은 오프라인이라 업데이트를 확인할 수 없습니다. 인터넷에 연결한 뒤 다시 눌러 주세요.'); return; }
  const btn = document.getElementById('btnCheckUpdate');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i>확인 중'; }
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
    const keys = await caches.keys();
    // v2.6.0: 같은 주소의 다른 모드 앱(커플 /kluvy/ ↔ 개인 /kluvy/personal/) 캐시는 지우지 않는다
    await Promise.all(keys.filter(isOwnAppCache).map(k => caches.delete(k)));
  } catch (e) { console.warn('업데이트 확인 실패:', e); }
  location.reload();
}
