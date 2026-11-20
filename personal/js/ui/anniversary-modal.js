// 기념일 모달
import { state } from '../state.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar } from '../render/calendar.js';

export function openAnniversaryModal() {
  renderCustomAnivList();
  document.getElementById('anniversaryModal').classList.remove('hidden');
}

export function closeAnniversaryModal() {
  document.getElementById('anniversaryModal').classList.add('hidden');
}

export function renderCustomAnivList() {
  const cBox = document.getElementById('customList');
  if (!cBox) return;
  cBox.innerHTML = '';
  // 기념일 이름·날짜는 사용자/서버 문자열 → textContent 로만 넣는다 (XSS 방지). 삭제 버튼도 inline onclick 대신 addEventListener.
  state.customAnniversaries.forEach((aniv, idx) => {
    const row = document.createElement('div');
    row.className = 'flex justify-between items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 text-[14px]';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-semibold text-amber-800 break-all';
    nameSpan.textContent = `🎂 ${aniv.name} `;
    if (aniv.isRepeat) {
      const rep = document.createElement('span');
      rep.className = 'text-[11px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-semibold';
      rep.textContent = '매년 반복';
      nameSpan.appendChild(rep);
    }

    const right = document.createElement('div');
    right.className = 'flex items-center space-x-2';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'tabular-nums text-slate-700';
    dateSpan.textContent = aniv.date;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'w-10 h-10 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-red-600';
    delBtn.setAttribute('aria-label', '기념일 삭제');
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.addEventListener('click', () => deleteCustomAniv(idx));
    right.append(dateSpan, delBtn);

    row.append(nameSpan, right);
    cBox.appendChild(row);
  });
}

export function addCustomAnniversary() {
  const name = document.getElementById('customAnivName').value.trim();
  const date = document.getElementById('customAnivDate').value;
  const isRepeat = document.getElementById('customAnivRepeat').checked;
  if (!name || !date) {
    alert('기념일 이름과 날짜를 입력하세요.');
    return;
  }
  state.customAnniversaries.push({ name, date, isRepeat });
  saveDB();
  renderCustomAnivList();
  renderCalendar();
  document.getElementById('customAnivName').value = '';
}

export function deleteCustomAniv(idx) {
  state.customAnniversaries.splice(idx, 1);
  saveDB();
  renderCustomAnivList();
  renderCalendar();
}
