// 근무표 등록 미리보기 (엑셀 · 규호 근무표 사진 · 예진 스케줄 사진 · 간편 텍스트 공용)
// 3단계: 모든 업로드가 여기를 거친다. 날짜·사람마다 '기존 값 → 새 값'과 상태를 보여 주고,
//        수동 입력과 다른 칸은 '✋ 수동 입력 유지'(기본, 체크하면 덮어쓰기), 근무표 빈칸은 '기존 값 유지'(체크하면 지우기),
//        내용이 같은 날은 '변경 없음'(기본 숨김). [캘린더에 반영]을 눌러야 저장된다.
// 데이터는 모두 textContent / input.value 로만 넣는다 (innerHTML 에 사진에서 읽은 글자를 넣지 않음).
import { weekdayOfKey } from '../dates.js';
import { mapGeminiItem } from '../parsers/gemini-yejin.js';
import { parseKyuhoShiftRule } from '../parsers/excel-kyuho.js';
import { STATUS_LABEL, CHECK_MEANING, describeDuty, summarizeRows, isBlankDuty } from '../upload-merge.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
let current = null; // { rows, onApply, onCancel, showSame }

/** 미리보기 행 + 사용자가 고친 값 → 저장할 값 (순수 함수, 테스트용) */
export function finalizePreviewRow(row, edits = {}) {
  const type = edits.type !== undefined ? String(edits.type).trim() : undefined;
  const start = edits.start !== undefined ? String(edits.start).trim() : undefined;
  const end = edits.end !== undefined ? String(edits.end).trim() : undefined;
  const dest = edits.destination !== undefined ? String(edits.destination).trim() : undefined;
  const typeChanged = type !== undefined && type !== String(row.value.type || '');
  if (row.who === 'my') {
    let v = typeChanged ? parseKyuhoShiftRule(type, row.dateKey) : { ...row.value };
    if (start !== undefined && start !== (row.value.start || '')) v = { ...v, start };
    if (end !== undefined && end !== (row.value.end || '')) v = { ...v, end };
    return v;
  }
  if (typeChanged) {
    return mapGeminiItem({ ...row.raw, type, start: start ?? row.value.start ?? '', end: end ?? row.value.end ?? '', destination: dest ?? row.value.destination ?? '' });
  }
  const v = { ...row.value };
  if (start !== undefined) v.start = start;
  if (end !== undefined) v.end = end;
  if (dest !== undefined && 'destination' in row.value) v.destination = dest;
  if ((start !== undefined || end !== undefined) && v.timesFrom) delete v.timesFrom; // 직접 고쳤으면 시간표 표시 해제
  return v;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function input(cls, value, attrs = {}) {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = cls;
  i.value = value || '';
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

const STATUS_CLASS = {
  new: 'pv-badge pv-badge--new',
  change: 'pv-badge pv-badge--change',
  same: 'pv-badge pv-badge--same',
  manual: 'pv-badge pv-badge--manual',
  'blank-keep': 'pv-badge pv-badge--blank',
  blank: 'pv-badge pv-badge--blank'
};

function updateCount() {
  const n = current ? current.rows.filter(r => r.include && (r.status !== 'blank' || (r.edits.type || '').trim())).length : 0;
  const c = document.getElementById('previewCount');
  if (c) c.textContent = String(n);
}

function applyVisibility() {
  if (!current) return;
  document.querySelectorAll('#previewTableBody tr[data-date]').forEach(tr => {
    const row = current.rows[Number(tr.dataset.idx)];
    const hide = row && (row.status === 'same' || row.status === 'blank') && !current.showSame && !row.include;
    tr.classList.toggle('hidden', Boolean(hide));
  });
}

function renderSummary() {
  const box = document.getElementById('previewSummary');
  if (!box || !current) return;
  const s = summarizeRows(current.rows);
  const parts = [
    s.new && `새로 ${s.new}`, s.change && `변경 ${s.change}`, s.manual && `✋ 수동 유지 ${s.manual}`,
    s['blank-keep'] && `빈칸(기존 유지) ${s['blank-keep']}`, (s.same + s.blank) && `변경 없음 ${s.same + s.blank}`
  ].filter(Boolean);
  box.textContent = parts.join(' · ') || '반영할 내용이 없습니다.';
  const same = document.getElementById('previewShowSameWrap');
  const sameCount = s.same + s.blank;
  if (same) {
    same.classList.toggle('hidden', sameCount === 0);
    const lbl = document.getElementById('previewShowSameText');
    if (lbl) lbl.textContent = `변경 없는 날 ${sameCount}개도 보기`;
  }
}

/**
 * @param {{title:string, subtitle?:string, modelInfo?:string, warn?:string, rows:object[], onApply:(rows:{who,dateKey,value}[])=>void, onCancel?:()=>void}} opts
 *  rows: { who, dateKey, value, raw?, prev?, status?, include?, note? } — planUploadRows 결과
 */
export function openRecognizePreview(opts) {
  current = {
    rows: opts.rows.map(r => ({ ...r, status: r.status || 'new', include: r.include !== false, edits: {} })),
    onApply: opts.onApply, onCancel: opts.onCancel, showSame: false
  };
  document.getElementById('previewTitle').textContent = opts.title || '등록 미리보기';
  document.getElementById('previewSubtitle').textContent = opts.subtitle || '';
  document.getElementById('previewModelInfo').textContent = opts.modelInfo || '';
  const warn = document.getElementById('previewWarn');
  warn.textContent = opts.warn || '';
  warn.classList.toggle('hidden', !opts.warn);
  const showSame = document.getElementById('previewShowSame');
  if (showSame) {
    showSame.checked = false;
    showSame.onchange = () => { current.showSame = showSame.checked; applyVisibility(); };
  }

  const body = document.getElementById('previewTableBody');
  body.innerHTML = '';
  current.rows.forEach((row, idx) => {
    const tr = el('tr', `pv-row pv-row--${row.status}`);
    tr.dataset.date = row.dateKey;
    tr.dataset.who = row.who;
    tr.dataset.idx = String(idx);
    tr.dataset.status = row.status;
    const td = el('td', 'pv-cell');
    tr.appendChild(td);

    // 1줄: [체크] 날짜 사람 상태
    const head = el('div', 'pv-head');
    const lab = el('label', 'pv-check');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'pv-include';
    chk.checked = row.include;
    chk.setAttribute('aria-label', `${row.dateKey} ${CHECK_MEANING[row.status] || '반영'}`);
    const chkText = el('span', 'pv-check-text', CHECK_MEANING[row.status] || '반영');
    lab.append(chk, chkText);
    const [, m, d] = row.dateKey.split('-').map(Number);
    const dow = weekdayOfKey(row.dateKey);
    const date = el('span', `pv-date ${dow === 0 ? 'is-sun' : dow === 6 ? 'is-sat' : ''}`, `${m}/${d}(${DOW[dow]})`);
    const who = el('span', `pv-who ${row.who === 'my' ? 'pv-who--k' : 'pv-who--y'}`, row.who === 'my' ? '규호' : '예진');
    const badge = el('span', STATUS_CLASS[row.status] || 'pv-badge', STATUS_LABEL[row.status] || '');
    head.append(lab, date, who, badge);
    td.appendChild(head);

    // 2줄: 근무 · 도시 · 시간 (바로 고치기)
    const edit = el('div', 'pv-edit');
    const typeIn = input('pv-type pv-input', row.value.type, { list: row.who === 'my' ? 'previewMyTypes' : 'previewGfTypes', 'aria-label': '근무' });
    const touch = () => { if (!row.include) { row.include = true; chk.checked = true; tr.classList.remove('is-off'); updateCount(); } };
    typeIn.addEventListener('input', () => { row.edits.type = typeIn.value; touch(); });
    edit.appendChild(typeIn);
    if (row.who === 'gf' && ('destination' in row.value)) {
      const destIn = input('pv-dest pv-input', row.value.destination, { placeholder: '도시', 'aria-label': '도시' });
      destIn.addEventListener('input', () => { row.edits.destination = destIn.value; touch(); });
      edit.appendChild(destIn);
    }
    const sIn = input('pv-start pv-input pv-time', row.value.start, { placeholder: '--:--', inputmode: 'numeric', 'aria-label': '시작' });
    const eIn = input('pv-end pv-input pv-time', row.value.end, { placeholder: '--:--', inputmode: 'numeric', 'aria-label': '끝' });
    sIn.addEventListener('input', () => { row.edits.start = sIn.value; touch(); });
    eIn.addEventListener('input', () => { row.edits.end = eIn.value; touch(); });
    const timeWrap = el('span', 'pv-times');
    timeWrap.append(sIn, el('span', 'pv-tilde', '~'), eIn);
    edit.appendChild(timeWrap);
    td.appendChild(edit);

    // 3줄: 기존 값 → 새 값 / 안내
    const diff = el('div', 'pv-diff');
    if (row.status === 'change' || row.status === 'manual' || row.status === 'blank-keep' || row.status === 'same') {
      diff.append(el('span', 'pv-prev-label', '기존 '), el('span', 'pv-prev', describeDuty(row.who, row.prev)));
      if (row.prev && row.prev.manual) diff.append(el('span', 'pv-manual-tag', '✋ 직접 입력'));
      if (row.status !== 'same') diff.append(el('span', 'pv-arrow', ' → '), el('span', 'pv-next', row.status === 'blank-keep' ? '(빈칸)' : describeDuty(row.who, row.value)));
    }
    if (row.status === 'manual') diff.append(el('div', 'pv-hint', '편집창으로 직접 넣은 값이라 그대로 둡니다. 근무표 값으로 바꾸려면 [덮어쓰기]를 체크하세요.'));
    if (row.status === 'blank-keep') diff.append(el('div', 'pv-hint', '근무표의 빈칸은 기존 값을 지우지 않습니다. 지우려면 [지우기]를 체크하세요.'));
    if (row.note) diff.append(el('div', 'pv-note', row.note));
    if (diff.childNodes.length) td.appendChild(diff);

    chk.addEventListener('change', () => { row.include = chk.checked; tr.classList.toggle('is-off', !chk.checked); updateCount(); });
    if (!row.include) tr.classList.add('is-off');
    body.appendChild(tr);
  });
  renderSummary();
  applyVisibility();
  updateCount();
  document.getElementById('recognizePreviewModal').classList.remove('hidden');
}

export function closeRecognizePreview() {
  document.getElementById('recognizePreviewModal').classList.add('hidden');
}

export function cancelRecognizePreview() {
  const c = current;
  current = null;
  closeRecognizePreview();
  if (c && c.onCancel) c.onCancel();
}

export async function applyRecognizePreview() {
  if (!current) return;
  const rows = current.rows.filter(r => r.include)
    .map(r => ({ who: r.who, dateKey: r.dateKey, status: r.status, value: finalizePreviewRow(r, r.edits) }))
    .filter(r => !(r.status === 'blank' && isBlankDuty(r.value))); // 빈칸 + 기존 값 없음 = 할 일 없음
  if (!rows.length && !confirm('반영할 날짜가 없습니다. 이대로 닫을까요? (근무표는 바뀌지 않습니다)')) return;
  const cb = current.onApply;
  current = null;
  closeRecognizePreview();
  await cb(rows);
}
