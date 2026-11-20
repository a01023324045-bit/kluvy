// [편명 다시 읽기] 화면 쪽 (v2.5.1) — 같은 달 사진에 편명만 다시 묻고 기존 근무 칸에 합친다
//   진입점 2개: ① 반영 직후 요약 바의 버튼 (편명 없는 비행일이 있을 때) ② 등록 창의 '이 달 편명만 다시 읽기' 링크
//   - 사진: 방금 올린 압축본(메모리) → 없으면 이 폰·서버에 저장된 그 달 사진 (사진을 다시 고를 필요 없음)
//   - 호출 1회 (recognizeYejinFlights): 근무 종류·시각은 묻지 않는다. 합치기 규칙은 flight-reread.js 참고.
//   - 합친 칸은 되돌리기 기록(업로드 기록이 있으면 이어서)에 남아 [되돌리기] 가 된다. 서버에는 saveDB 가 칸 단위로 보낸다.
//   - 실패하면 이유를 요약 바와 등록 창 안의 한 줄에 그대로 보여 준다 (근무는 바뀌지 않음).
import { state } from '../state.js';
import { STORAGE_KEYS } from '../config.js';
import { makeDateKey, makeMonthKey } from '../dates.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar, updateDetailCard } from '../render/calendar.js';
import { loadPhotoForMonth } from './image-modal.js';
import { recognizeYejinFlights } from '../parsers/gemini-yejin.js';
import { getGeminiModel } from '../parsers/gemini-client.js';
import { flightsFromReread, mergeRereadFlights } from '../flight-reread.js';
import { flightStatsForMonth } from '../flight-stats.js';
import { buildRereadSummary, buildRereadFailure } from '../apply-summary.js';
import { captureBefore, diffEntries, saveUndo, loadUndo, mergeUndoEntries } from '../upload-undo.js';
import { learnFlightFromGf } from '../flight-times.js';
import { showApplyBar, setRereadBusy, rereadTargetFromBar } from './apply-bar.js';

const $ = id => document.getElementById(id);
const recentPhotos = new Map(); // 'YYYY-MM' → 방금 올린 압축 사진 dataURL
let running = false;

/** 반영할 때 올린 압축 사진을 기억해 둔다 (바로 [편명 다시 읽기] 를 누를 때 저장소를 다시 읽지 않도록) */
export function rememberUploadedPhoto(monthKey, dataUrl) {
  if (monthKey && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) recentPhotos.set(monthKey, dataUrl);
}

/** dataURL → { mime, b64 } (아니면 null) */
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s.exec(String(dataUrl || ''));
  return m ? { mime: m[1], b64: m[2] } : null;
}

function apiKeyNow() {
  const el = $('geminiApiKey');
  const typed = el && el.value ? el.value.trim() : '';
  if (typed) return typed;
  try { return (localStorage.getItem(STORAGE_KEYS.geminiKey) || '').trim(); } catch (e) { return ''; }
}

function setModalStatus(text, tone = 'info') {
  const el = $('rereadFlightsStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.classList.remove('text-rose-700', 'text-emerald-700', 'text-slate-600');
  el.classList.add(tone === 'fail' ? 'text-rose-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-600');
}

function setModalBusy(busy) {
  const b = $('btnRereadFromModal');
  if (b) { b.disabled = Boolean(busy); b.textContent = busy ? '편명 읽는 중…' : '이 달 편명만 다시 읽기'; }
}

const md = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;

/** 이 달 사진 → { mime, b64 } (없으면 이유를 담은 Error) */
async function photoForMonth(year, month) {
  const mKey = makeMonthKey(year, month);
  let data = recentPhotos.get(mKey) || null;
  if (!data) { try { data = await loadPhotoForMonth(mKey); } catch (e) { console.warn('사진 불러오기 실패:', e); data = null; } }
  const p = splitDataUrl(data);
  if (!p) throw new Error(`${year}년 ${month}월 스케줄 사진이 이 폰에 없습니다. 등록 창에서 사진을 다시 올려 [반영]을 눌러 주세요.`);
  return p;
}

/**
 * 편명 다시 읽기 실행.
 * @param {{year:number, month:number}} [target] 없으면 바 버튼의 달 → 없으면 지금 보는 달
 * @param {{fromModal?:boolean}} [opt]
 */
export async function rereadFlights(target, opt = {}) {
  if (running) return { ok: false, busy: true };
  const t = (target && target.year && target.month) ? target : (rereadTargetFromBar() || { year: state.currentYear, month: state.currentMonth });
  running = true;
  const fromModal = Boolean(opt.fromModal);
  const fail = reason => {
    console.warn('편명 다시 읽기 실패:', reason);
    showApplyBar(buildRereadFailure(t.month, reason), { undoable: Boolean(loadUndo()), reread: t });
    setModalStatus(`⚠️ ${reason}`, 'fail');
    return { ok: false, reason };
  };
  try {
    showApplyBar({ text: `✈️ ${t.month}월 편명만 다시 읽는 중… (같은 사진으로 AI 1회 호출)`, tone: 'info' }, { reread: t });
    setRereadBusy(true);
    setModalBusy(true);
    setModalStatus(`${t.month}월 사진에서 편명만 다시 읽는 중…`, 'info');

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return fail('오프라인이라 AI 에 물어볼 수 없습니다. 인터넷에 연결한 뒤 다시 눌러 주세요.');
    const apiKey = apiKeyNow();
    if (!apiKey) return fail('Gemini API 키가 없습니다. 등록 창의 [설정]에서 키를 입력해 주세요.');
    let photo;
    try { photo = await photoForMonth(t.year, t.month); } catch (e) { return fail(e.message); }

    let r;
    try { r = await recognizeYejinFlights(photo.b64, photo.mime, apiKey, { onStatus: s => setModalStatus(s, 'info') }); } catch (e) { return fail(e && e.message ? e.message : String(e)); }

    const read = flightsFromReread(r.parsed, t.year, t.month);
    if (read.mismatch) return fail(`${read.mismatch} — 다른 달 사진이 저장되어 있는 것 같습니다. 사진을 다시 올려 주세요.`);

    // 합치기 (편명만) + 되돌리기 기록용 전후 비교
    const rows = read.days.map(d => ({ dateKey: d.dateKey, who: 'gf' }));
    const oldRec = loadUndo(); // saveDB 가 지우기 전에 읽어 둔다
    const before = captureBefore(state.scheduleDB, rows);
    const merge = mergeRereadFlights(state.scheduleDB, read.days);
    const entries = diffEntries(before, state.scheduleDB, rows);
    for (const k of merge.filled) learnFlightFromGf(state.scheduleDB[k].gf, 'schedule'); // 업로드와 같이 편명 시간표 학습

    const stats = flightStatsForMonth(state.scheduleDB, t.year, t.month);
    const readText = Object.fromEntries(read.days.map(d => [d.dateKey, d.legs.join('/')]));
    const modelInfo = r.fallbackFrom ? `인식 모델: ${r.model} (설정된 '${r.fallbackFrom}' 사용 불가 → 자동 전환)` : `인식 모델: ${r.model || getGeminiModel()}`;
    const summary = buildRereadSummary({ month: t.month, merge, readDays: read.days.length, flightStats: stats, readText, modelInfo });
    const reread = summary.needsReread ? t : null;

    let undoable = Boolean(oldRec);
    if (entries.length) {
      const aniv = oldRec && Array.isArray(oldRec.aniv) ? oldRec.aniv : JSON.parse(JSON.stringify(state.customAnniversaries || []));
      saveDB(); // 바뀐 칸만 PATCH (이전 되돌리기 기록은 여기서 지워짐 → 이어서 다시 저장)
      undoable = saveUndo({ entries: mergeUndoEntries(oldRec && oldRec.entries, entries), aniv, text: summary.text, tone: summary.tone, details: summary.details, reread });
      state.currentYear = t.year;
      state.currentMonth = t.month;
      state.uploadTargetYear = t.year;
      state.uploadTargetMonth = t.month;
      if (!state.selectedDateKey || !state.selectedDateKey.startsWith(`${t.year}-${String(t.month).padStart(2, '0')}`)) state.selectedDateKey = makeDateKey(t.year, t.month, 1);
      try { renderCalendar(); updateDetailCard(); } catch (e) { console.warn('편명 반영 뒤 화면 갱신 실패', e); }
    }
    showApplyBar(summary, { undoable, reread });
    setModalStatus(entries.length ? `✅ ${merge.filled.length}일 편명을 채웠습니다 (${merge.filled.map(md).join(', ')})` : '채울 편명이 없었습니다 — 요약 바의 [자세히]를 확인하세요.', entries.length ? 'ok' : 'fail');
    if (fromModal && entries.length) { const m = $('uploadModal'); if (m) m.classList.add('hidden'); }
    return { ok: true, filled: merge.filled, summary };
  } catch (e) {
    return fail(e && e.message ? e.message : String(e));
  } finally {
    running = false;
    setRereadBusy(false);
    setModalBusy(false);
  }
}

/** 요약 바의 [편명 다시 읽기] */
export function rereadFlightsFromBar() { return rereadFlights(rereadTargetFromBar() || undefined); }

/** 등록 창의 [이 달 편명만 다시 읽기] — 창에서 고른 연·월의 저장된 사진을 쓴다 */
export function rereadFlightsFromModal() {
  return rereadFlights({ year: state.uploadTargetYear, month: state.uploadTargetMonth }, { fromModal: true });
}
