// 근무표 등록(업로드) 모달
// 2단계: 규호 칸은 엑셀 또는 사진(jpg/png → Gemini), 예진 사진도 Gemini. 사진 인식 결과는 '미리보기'에서 확인·수정 후
//        [캘린더에 반영]을 눌러야 저장. 예진 사진은 반영할 때 한 번만 업로드(1단계까지는 고를 때 + 반영할 때 두 번).
import { DEFAULT_FIREBASE_URL, STORAGE_KEYS, GEMINI_MODEL } from '../config.js';
import { state } from '../state.js';
import { makeDateKey, makeMonthKey } from '../dates.js';
import { safeSetStorage } from '../storage.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar } from '../render/calendar.js';
import { compressImageFile, savePhotoForMonth, deleteLocalPhoto } from './image-modal.js';
import { parseKyuhoWorkbookData } from '../parsers/excel-kyuho.js';
import { applyQuickTextInput } from '../parsers/quick-text.js';
import { recognizeYejinImage, buildYejinPreviewRows, readFileAsBase64 } from '../parsers/gemini-yejin.js';
import { recognizeKyuhoImage, buildKyuhoPreviewRows } from '../parsers/gemini-kyuho.js';
import { getGeminiModel, setGeminiModel } from '../parsers/gemini-client.js';
import { openRecognizePreview } from './recognize-preview.js';
import { fillRecoPrefsUI } from './reco-prefs.js';
import { planUploadRows, applyUploadRows, rowsFromMyMap, rowsFromGfDb, dedupeRows } from '../upload-merge.js';
import { normalizeFlight, sourceLabel } from '../flight.js';
import { refreshFlightTimes, fillFromFlightTable, getFlightTable, learnFlightFromGf, getAirlabsKey, setAirlabsKey, airlabsUsageText } from '../flight-times.js';

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

/** AirLabs API 키 (선택 기능 — 이 폰 localStorage 에만 저장) */
export function onAirlabsKeyChanged() {
  const inp = document.getElementById('airlabsApiKey');
  if (!inp) return;
  setAirlabsKey(inp.value);
  const u = document.getElementById('airlabsUsageText');
  if (u) u.textContent = airlabsUsageText();
}

/** 모델 이름 설정 (비우면 기본 gemini-3.6-flash) */
export function onGeminiModelChanged() {
  const inp = document.getElementById('geminiModel');
  if (!inp) return;
  setGeminiModel(inp.value.trim());
  inp.value = getGeminiModel();
}

export function onFileSelected(who) {
  if (who === 'kyuho') {
    const file = document.getElementById('kyuhoFile').files[0];
    if (file) document.getElementById('kyuhoAppliedFileName').innerText = `선택됨: ${file.name}${isImageFile(file) ? ' (사진 → AI 인식)' : ''}`;
  } else if (who === 'yejin') {
    // 사진은 [변경사항 캘린더 반영] 때 한 번만 압축·업로드한다 (1단계: 여기서도 업로드해서 두 번 올라갔음)
    const file = document.getElementById('yejinImageFile').files[0];
    if (file) document.getElementById('yejinAppliedFileName').innerText = `선택됨: ${file.name}`;
  }
}

export function openUploadModalForCurrentMonth() {
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
  const alUsage = document.getElementById('airlabsUsageText');
  if (alUsage) alUsage.textContent = airlabsUsageText();
  fillRecoPrefsUI();

  document.getElementById('uploadModal').classList.remove('hidden');
}

export function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
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

  const mKey = makeMonthKey(year, month);
  const hist = state.fileHistory[mKey] || {};
  document.getElementById('kyuhoAppliedFileName').innerText = hist.kyuho || '등록된 파일 없음';
  document.getElementById('yejinAppliedFileName').innerText = hist.yejin || '등록된 파일 없음';

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

export function clearTargetMonthData() {
  const { uploadTargetYear, uploadTargetMonth } = state;
  if (confirm(`${uploadTargetYear}년 ${uploadTargetMonth}월의 근무 데이터를 비우시겠습니까?`)) {
    const totalDays = new Date(uploadTargetYear, uploadTargetMonth, 0).getDate();
    for (let d = 1; d <= totalDays; d++) {
      delete state.scheduleDB[makeDateKey(uploadTargetYear, uploadTargetMonth, d)];
    }
    const mKey = makeMonthKey(uploadTargetYear, uploadTargetMonth);
    delete state.fileHistory[mKey];
    deleteLocalPhoto(mKey);

    saveDB();
    renderCalendar();
    updateUploadModalStatus();
    setUploadTargetMonth(uploadTargetYear, uploadTargetMonth);
    alert(`${uploadTargetYear}년 ${uploadTargetMonth}월 데이터가 초기화되었습니다.`);
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

/** 저장 + 해당 달로 이동 + 알림 + 창 닫기 */
function finishUpload(year, month, info = '') {
  saveDB();
  state.uploadTargetYear = year;
  state.uploadTargetMonth = month;
  state.currentYear = year;
  state.currentMonth = month;
  state.selectedDateKey = makeDateKey(year, month, 1);
  renderCalendar();
  alert(`${year}년 ${month}월 근무표가 성공적으로 캘린더에 반영되었습니다!${info ? `\n${info}` : ''}`);
  closeUploadModal();
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
    const e = getFlightTable()[f.iata] || {};
    r.value = filled;
    r.note = `🕒 ${f.iata} 편명 시간표로 시각을 채웠습니다 (${filled.start || '?'}~${filled.end || '?'}, 출처: ${sourceLabel(e.source)}). 다르면 칸을 고쳐 주세요.`;
  }
  return rows;
}

/**
 * [변경사항 캘린더 반영]
 * 3단계: 엑셀·간편 텍스트도 사진과 같이 항상 미리보기를 거친다 (기존 값 → 새 값, 수동 입력 보호, 빈칸 보호).
 * 업로드는 자기 칸(규호 my / 예진 gf)만 바꾸고 데이트·약속·상대 칸은 건드리지 않는다.
 */
export async function processUploadFiles() {
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
    if ((kIsImage || yFile) && !apiKey) {
      if (yFile && !kIsImage) {
        const compressed = await compressImageFile(yFile);
        await savePhotoForMonth(mKey, compressed);
        if (!state.fileHistory[mKey]) state.fileHistory[mKey] = {};
        state.fileHistory[mKey].yejin = yFile.name;
        safeSetStorage(STORAGE_KEYS.fileHistory, state.fileHistory);
        alert("사진 자동인식을 위해 Gemini API 키를 입력해 주세요. (사진은 원본급으로 보관되었습니다)");
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
    const warns = [];
    let kyuhoMonth = null;
    let yejinMonth = null;
    let compressedYejin = null;
    const onStatus = msg => setProgress(45, msg);
    const sources = [];

    // 1) 규호 엑셀
    if (kFile && !kIsImage) {
      const excelMap = await readKyuhoExcel(kFile, targetY, targetM);
      const r = rowsFromMyMap(excelMap, 'excel');
      if (!r.length) warns.push(`엑셀에서 '이규호' 행이나 날짜 머리글을 찾지 못했습니다 (${kFile.name}).`);
      rows.push(...r);
      kyuhoMonth = { year: targetY, month: targetM };
      sources.push(`규호 엑셀: ${kFile.name}`);
    }
    // 2) 간편 텍스트 (예진) — 같은 날짜는 아래 예진 사진이 우선
    if (quickText) {
      const tmp = {};
      applyQuickTextInput(quickText, tmp, targetY, targetM);
      const r = rowsFromGfDb(tmp, 'text');
      if (!r.length) warns.push('간편 텍스트에서 날짜를 찾지 못했습니다. (예: "3 오사카, 4-7 다낭, 8 OFF")');
      rows.push(...r);
      sources.push('간편 텍스트');
    }
    // 3) 규호 근무표 사진
    if (kIsImage) {
      setProgress(20, `${getGeminiModel()} 규호 근무표 사진 판독 중...`);
      const b64 = await readFileAsBase64(kFile);
      const r = await recognizeKyuhoImage(b64, kFile.type || 'image/jpeg', apiKey, { onStatus });
      results.push(r);
      const built = buildKyuhoPreviewRows(r.parsed, targetY, targetM);
      kyuhoMonth = { year: built.year, month: built.month };
      if (!built.rows.length) warns.push('규호 근무표 사진에서 이규호 행을 찾지 못했습니다.');
      rows.push(...built.rows.map(x => ({ ...x, source: 'photo' })));
      sources.push(`규호 사진: ${kFile.name}`);
    }
    // 4) 예진 스케줄 사진
    if (yFile) {
      setProgress(55, `${getGeminiModel()} 예진 스케줄 출퇴근 정밀 판독 중...`);
      compressedYejin = await compressImageFile(yFile);
      const b64 = await readFileAsBase64(yFile);
      const r = await recognizeYejinImage(b64, yFile.type || 'image/jpeg', apiKey, { onStatus });
      results.push(r);
      const built = buildYejinPreviewRows(r.parsed, targetY, targetM);
      yejinMonth = { year: built.year, month: built.month };
      if (!built.rows.length) warns.push('예진 스케줄 사진에서 일정을 찾지 못했습니다.');
      rows.push(...built.rows.map(x => ({ ...x, source: 'photo' })));
      sources.push(`예진 사진: ${yFile.name}`);
    }
    if (kIsImage || yFile) setProgress(100, '분석 완료! 미리보기에서 확인해 주세요.');
    for (const [who, mm] of [['규호 근무표', kIsImage ? kyuhoMonth : null], ['예진 스케줄', yejinMonth]]) {
      if (mm && (mm.year !== targetY || mm.month !== targetM)) warns.push(`${who} 사진에서 읽은 달(${mm.year}년 ${mm.month}월)이 선택한 달(${targetM}월)과 달라 사진의 달로 반영합니다.`);
    }
    const modelInput = document.getElementById('geminiModel');
    if (modelInput) modelInput.value = getGeminiModel();

    // 편명 시간표(두 폰 공유)를 최신으로 받아 두고, 시각이 빠진 비행을 채운다 (오래 걸리면 캐시 사용)
    if (rows.some(r => r.who === 'gf' && r.value && r.value.flight)) {
      await Promise.race([refreshFlightTimes().catch(() => false), new Promise(r => setTimeout(r, 1500))]);
    }
    const planned = planUploadRows(state.scheduleDB, fillFlightTimes(dedupeRows(rows)));
    const shown = yejinMonth || kyuhoMonth || { year: targetY, month: targetM };

    openRecognizePreview({
      title: `등록 미리보기 — ${shown.year}년 ${shown.month}월`,
      subtitle: sources.join(' · '),
      modelInfo: modelInfoText(results),
      warn: warns.join(' '),
      rows: planned,
      onApply: async (finalRows) => {
        applyUploadRows(state.scheduleDB, finalRows);
        if (kFile) {
          const k = makeMonthKey(kyuhoMonth.year, kyuhoMonth.month);
          if (!state.fileHistory[k]) state.fileHistory[k] = {};
          state.fileHistory[k].kyuho = kFile.name;
        }
        if (yFile) {
          const k = makeMonthKey(yejinMonth.year, yejinMonth.month);
          if (!state.fileHistory[k]) state.fileHistory[k] = {};
          state.fileHistory[k].yejin = yFile.name;
          await savePhotoForMonth(k, compressedYejin); // 사진 업로드는 여기서 한 번만
        }
        // 확정된 비행 근무에서 편명 시각을 배운다 (두 폰 공유 시간표)
        for (const r of finalRows) if (r.who === 'gf') learnFlightFromGf(r.value, 'schedule');
        const kept = planned.filter(r => r.status === 'manual').length - finalRows.filter(r => r.status === 'manual').length;
        const info = [`${finalRows.length}칸 반영`, kept > 0 ? `✋ 직접 입력한 ${kept}칸은 그대로 두었습니다` : ''].filter(Boolean).join(', ');
        finishUpload(shown.year, shown.month, `(${info})`);
      }
    });
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
