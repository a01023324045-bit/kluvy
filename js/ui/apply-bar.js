// 반영 결과 바 + 되돌리기 (v2.4.6)
//   화면 아래에 한 줄: "✅ 11월 30일 반영했습니다 (수동 입력 3일은 그대로) · [되돌리기]"
//   - 되돌리기: 직후 1회·10분 이내 (upload-undo.js). 새로고침해도 10분 안이면 다시 보인다.
//   - 다른 작업(saveDB)이 있으면 기록이 지워지고 바도 사라진다 (onUndoCleared).
//   - 글자는 모두 textContent 로 (사진에서 읽은 글자·서버 값이 HTML 로 들어가지 않게).
import { state } from '../state.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar, updateDetailCard } from '../render/calendar.js';
import { loadUndo, clearUndo, undoUploadRows, onUndoCleared, undoRemainingMs } from '../upload-undo.js';

let expireTimer = null;
let infoTimer = null;
let showingUndo = false;

const $ = id => document.getElementById(id);
const TONE_CLASS = { ok: 'is-ok', warn: 'is-warn', info: 'is-info' };

function stopTimers() {
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
  if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
}

/**
 * 바를 보여 준다.
 * @param {{text:string, tone?:'ok'|'warn'|'info', details?:string[]}} s
 * @param {{undoable?:boolean, autoHideMs?:number}} [opt]
 */
export function showApplyBar(s, opt = {}) {
  const bar = $('applyBar');
  if (!bar) return;
  stopTimers();
  showingUndo = Boolean(opt.undoable);
  bar.classList.remove('hidden', 'is-ok', 'is-warn', 'is-info');
  bar.classList.add(TONE_CLASS[s.tone] || 'is-ok');
  $('applyBarText').textContent = s.text;
  const details = Array.isArray(s.details) ? s.details : [];
  const list = $('applyBarDetails');
  list.textContent = '';
  for (const d of details) { const li = document.createElement('li'); li.textContent = d; list.appendChild(li); }
  list.classList.add('hidden');
  $('btnApplyDetail').classList.toggle('hidden', !details.length);
  $('btnApplyDetail').textContent = '자세히';
  $('btnUndoUpload').classList.toggle('hidden', !opt.undoable);
  setRereadButton(opt.reread);
  if (opt.undoable) {
    // 10분이 지나면 스스로 사라진다 (다른 화면에서 오래 켜 둬도)
    const left = undoRemainingMs();
    expireTimer = setTimeout(() => { clearUndo(); hideApplyBar(); }, Math.max(1000, left));
  }
  if (opt.autoHideMs) infoTimer = setTimeout(hideApplyBar, opt.autoHideMs);
}

/**
 * v2.5.1: [편명 다시 읽기] 버튼 — 편명 없는 비행일이 있을 때만 보인다.
 * @param {{year:number, month:number}|null|undefined} target 다시 읽을 달 (없으면 숨김)
 */
export function setRereadButton(target) {
  const b = $('btnRereadFlights');
  if (!b) return;
  const on = Boolean(target && target.year && target.month);
  b.classList.toggle('hidden', !on);
  b.disabled = false;
  b.textContent = '편명 다시 읽기';
  if (on) { b.dataset.year = String(target.year); b.dataset.month = String(target.month); } else { delete b.dataset.year; delete b.dataset.month; }
}

/** 읽는 동안 버튼을 잠근다 */
export function setRereadBusy(busy) {
  const b = $('btnRereadFlights');
  if (!b) return;
  b.disabled = Boolean(busy);
  b.textContent = busy ? '읽는 중…' : '편명 다시 읽기';
}

/** 바에 붙은 [편명 다시 읽기] 의 대상 달 (없으면 null) */
export function rereadTargetFromBar() {
  const b = $('btnRereadFlights');
  if (!b || !b.dataset.year) return null;
  return { year: Number(b.dataset.year), month: Number(b.dataset.month) };
}

export function hideApplyBar() {
  stopTimers();
  showingUndo = false;
  const bar = $('applyBar');
  if (bar) bar.classList.add('hidden');
}

/** [✕] — 바를 닫으면 되돌리기도 포기한 것으로 본다 */
export function dismissApplyBar() {
  clearUndo();
  hideApplyBar();
}

export function toggleApplyDetails() {
  const list = $('applyBarDetails');
  if (!list) return;
  const open = list.classList.toggle('hidden') === false;
  $('btnApplyDetail').textContent = open ? '접기' : '자세히';
}

/** [되돌리기] — 반영 직전 값으로 복구하고 서버에도 칸 단위로 보낸다 */
export function undoLastUpload() {
  const rec = loadUndo();
  if (!rec) {
    showApplyBar({ text: 'ℹ️ 되돌릴 수 있는 시간(10분)이 지났거나 그 사이 다른 작업이 있었습니다.', tone: 'info' }, { autoHideMs: 6000 });
    return { ok: false };
  }
  const { restored, skipped } = undoUploadRows(state.scheduleDB, rec.entries);
  if (Array.isArray(rec.aniv) && JSON.stringify(rec.aniv) !== JSON.stringify(state.customAnniversaries)) state.customAnniversaries = rec.aniv;
  clearUndo();
  saveDB(); // 바뀐 칸만 PATCH (기록은 이미 지워짐)
  try { renderCalendar(); updateDetailCard(); } catch (e) { console.warn('되돌린 뒤 화면 갱신 실패', e); }
  // v2.5.3: 건너뛴 날짜를 함께 보여 준다(무엇이 남았는지 알 수 있게)
  const dayLabel = (k) => {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(k || ''));
    return m ? `${Number(m[1])}/${Number(m[2])}` : String(k || '');
  };
  const skippedText = skipped.length
    ? ` · 그 사이 바뀐 ${skipped.length}일(${skipped.slice(0, 4).map(dayLabel).join('·')}${skipped.length > 4 ? ' 외' : ''})은 그대로 둠`
    : '';
  const text = `↩️ 되돌렸습니다 (${restored.length}일)${skippedText}`;
  showApplyBar({ text, tone: skipped.length ? 'warn' : 'info' }, { autoHideMs: 8000 });
  return { ok: true, restored, skipped };
}

/** 앱 시작: 10분 안의 되돌리기 기록이 있으면 바를 다시 보인다 + 기록이 지워지면 바도 닫기 */
export function initApplyBar() {
  onUndoCleared(() => { if (showingUndo) hideApplyBar(); });
  const rec = loadUndo();
  if (rec) showApplyBar({ text: rec.text || '✅ 반영했습니다', tone: rec.tone, details: rec.details }, { undoable: true, reread: rec.reread });
}
