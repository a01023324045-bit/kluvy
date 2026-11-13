// 달력·추천·상세카드 렌더링
// ⚠️ innerHTML 에 데이터(근무명·도시·시간·기념일명 등)를 넣을 때는 반드시 escapeHtml() 을 거칠 것.
//    3단계부터 달력 칸·추천·상세카드는 textContent 로만 만든다.
// 3단계 디자인('가독성 우선'): 색·글자 크기는 css/app.css 의 :root 변수. 칸 구조는
//   .cal-cell > .cal-top(날짜 숫자 span · 아이콘) > .cal-sub(공휴일·기념일) > .cal-duties(.duty 규호 / .duty 예진 / 시간)
//   data-kind(근무 계열)·data-reco(데이트 가능 종류) 를 달아 두어 비교 도구가 클래스명이 아니라 내용으로 비교한다.
import { BASE_LOVE_DATE } from '../config.js';
import { state } from '../state.js';
import { getKSTDate, getDiffDays, makeDateKey, parseDateKey, weekdayOfKey } from '../dates.js';
import { HOLIDAYS } from '../holidays.js';
import { convertLocalToKST } from '../timezone.js';
import { calculateBarPosition, kyuhoKind, gfKind } from '../schedule-model.js';
import { getAnniversaryInfo } from '../anniversary.js';
import { computeAvailableDays, recoIcon } from '../recommend.js';
import { getRecoPrefs } from '../ui/reco-prefs.js';
import { renderFlightBox } from '../ui/flight-card.js';

// 4글자 이상(예: 비슈케크·타이베이)은 좁은 칸에서 '…'으로 잘리지 않게 자간·여백을 줄인다 (app.css .duty--long)
function longLabelClass(label) {
  return String(label || '').length >= 4 ? ' duty--long' : '';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function todayKey() {
  const t = getKSTDate();
  return makeDateKey(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** 달력 칸에 쓸 규호 근무 이름 ('공휴일·평일' 접두어는 칸에서 생략 — 시간은 규칙대로 반영됨) */
export function kyuhoCellLabel(type) {
  return String(type || '').replace('평일', '').replace('공휴일', '');
}

/** 달력 칸에 쓸 예진 근무 이름 */
export function gfCellLabel(g) {
  if (!g || !g.type) return '-';
  const kind = gfKind(g);
  if (kind === 'off') return 'OFF';
  if (kind === 'quick' || kind === 'stay') return g.destination || '비행';
  return g.type;
}

/** "(KR+1일 01:00)" → { time:'01:00', shift:1 } */
function parseKst(s) {
  const m = /KR([+-]\d+)?일?\s*(\d{2}:\d{2})/.exec(String(s || ''));
  return m ? { time: m[2], shift: m[1] ? Number(m[1]) : 0 } : null;
}

export function updateDDayHeader() {
  const dDayEl = document.getElementById('dDayBadge');
  if (!dDayEl) return;
  const today = getKSTDate();
  const diff = getDiffDays(BASE_LOVE_DATE, today);
  dDayEl.innerHTML = '';
  const icon = el('i', 'fa-solid fa-heart mr-1 text-rose-500');
  const strong = el('strong', '', `D+${diff}일`);
  dDayEl.append(icon, document.createTextNode('만난 지 '), strong);
  dDayEl.title = `${BASE_LOVE_DATE.getFullYear()}.${BASE_LOVE_DATE.getMonth() + 1}.${BASE_LOVE_DATE.getDate()}~`;
  const modalDDayEl = document.getElementById('modalDDayText');
  if (modalDDayEl) modalDDayEl.innerText = `오늘 기준 함께한 지 ${diff}일째입니다 💕 (${BASE_LOVE_DATE.getFullYear()}.${BASE_LOVE_DATE.getMonth() + 1}.${BASE_LOVE_DATE.getDate()}~)`;
}

/** 추천 카드 두 줄째 글 */
function recoLines(item) {
  const m = state.currentMonth;
  const dow = ['일', '월', '화', '수', '목', '금', '토'][weekdayOfKey(makeDateKey(state.currentYear, m, item.day))];
  if (item.type === '여행') {
    const range = String(item.text).replace(/\s*\(?여행 가능\)?\s*$/, '');
    return { date: range, time: '여행 가능 (연속 휴무)' };
  }
  const paren = /\((.*)\)\s*$/.exec(item.text);
  const time = item.type === '종일' ? '종일 가능' : (paren ? paren[1].replace(/,\s*/g, ' · ') : '');
  return { date: `${m}/${item.day} (${dow})`, time };
}

export function renderAvailableDates(precomputed) {
  const { currentYear, currentMonth } = state;
  const monthTitle = document.getElementById('availableDateMonthTitle');
  if (monthTitle) monthTitle.innerText = `${currentMonth}월`;
  const container = document.getElementById('availableDatesList');
  if (!container) return;
  container.innerHTML = '';

  const availableDays = precomputed || computeAvailableDays(state.scheduleDB, currentYear, currentMonth, getRecoPrefs());
  const count = document.getElementById('availableDatesCount');
  if (count) count.textContent = availableDays.length ? `${availableDays.length}일` : '';

  if (availableDays.length === 0) {
    container.appendChild(el('p', 'col-span-3 text-[13px] text-slate-500 py-2', '근무표를 등록하면 데이트 가능한 날이 자동 계산됩니다.'));
    return;
  }

  availableDays.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const kind = item.type === '종일' ? 'is-allday' : item.type === '여행' ? 'is-trip' : '';
    btn.className = `reco-card ${kind}`;
    const lines = recoLines(item);
    btn.append(el('span', 'reco-date', `${recoIcon(item.type)} ${lines.date}`), el('span', 'reco-time', lines.time));
    btn.dataset.chip = `${recoIcon(item.type)} ${item.text}`; // 2단계와 같은 글 (테스트·비교용)
    btn.dataset.recoType = item.type;
    btn.dataset.recoDay = String(item.day);
    btn.setAttribute('aria-label', `${lines.date} ${lines.time}`);
    if (item.reasons && item.reasons.length) btn.title = item.reasons.join(' / ');
    btn.onclick = () => {
      selectDate(makeDateKey(currentYear, currentMonth, item.day));
      const card = document.getElementById('selectedDateTitle');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    container.appendChild(btn);
  });
}

function setBar(bar, start, end, label, color) {
  const { left, width } = calculateBarPosition(start, end);
  bar.style.left = `${left}%`;
  bar.style.width = `${width}%`;
  bar.textContent = label;
  bar.className = 'timeline-bar';
  bar.style.background = color;
}
function clearBar(bar) {
  bar.style.width = '0%';
  bar.textContent = '';
}

export function updateDetailCard() {
  const selectedDateKey = state.selectedDateKey;
  const dayData = state.scheduleDB[selectedDateKey] || { my: null, gf: null, date: null, myPromise: "", gfPromise: "" };
  const dateObj = parseDateKey(selectedDateKey);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const titleEl = document.getElementById('selectedDateTitle');
  if (titleEl) titleEl.innerText = `${dateObj.getFullYear()}년 ${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 (${days[dateObj.getDay()]})`;

  const tagsBox = document.getElementById('selectedDateTags');
  if (tagsBox) {
    tagsBox.innerHTML = '';
    const holiday = HOLIDAYS[selectedDateKey];
    if (holiday) {
      const t = el('span', 'text-[12px] bg-red-50 text-red-700 border border-red-200 font-bold px-2 py-0.5 rounded-md');
      t.append(el('i', 'fa-solid fa-flag mr-1'), document.createTextNode(holiday));
      tagsBox.appendChild(t);
    }
    const aniv = getAnniversaryInfo(selectedDateKey, state.customAnniversaries);
    if (aniv) {
      const t = el('span', 'text-[12px] bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2 py-0.5 rounded-md');
      t.append(el('i', 'fa-solid fa-star mr-1'), document.createTextNode(aniv.name));
      tagsBox.appendChild(t);
    }
    if (selectedDateKey === todayKey()) tagsBox.appendChild(el('span', 'text-[12px] bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold px-2 py-0.5 rounded-md', '오늘'));
  }

  const wrapKyuho = document.getElementById('timelineWrapKyuho');
  if (wrapKyuho) {
    wrapKyuho.classList.remove('hidden');
    const myBar = document.getElementById('detailMyBar');
    const myText = document.getElementById('detailMyShiftText');
    const my = dayData.my;
    if (my && my.type && my.type !== '-') {
      if (my.start && my.end) {
        setBar(myBar, my.start, my.end, my.type, 'var(--kv-kyuho)');
        myText.innerText = `${my.type} (${my.start} ~ ${my.end})`;
      } else {
        clearBar(myBar);
        myText.innerText = my.type;
      }
      if (my.manual) myText.appendChild(el('span', 'manual-tag', '✋ 직접 입력'));
    } else {
      clearBar(myBar);
      myText.innerText = '근무 없음';
    }
  }

  const wrapYejin = document.getElementById('timelineWrapYejin');
  if (wrapYejin) {
    wrapYejin.classList.remove('hidden');
    const gfBar = document.getElementById('detailGfBar');
    const gfText = document.getElementById('detailGfShiftText');
    const g = dayData.gf;
    const dest = g ? (g.destination || "") : "";

    if (g && g.start && g.end) {
      setBar(gfBar, g.start, g.end, dest || g.type, g.isQuickTurn ? '#0e7490' : 'var(--kv-yejin)');
      let desc = `${dest ? '✈️ ' + dest + ' ' : ''}${!dest ? g.type + ' ' : ''}(${g.start} ~ ${g.end})`;
      if (!g.isQuickTurn && g.type === '체류') {
        if (g.isInbound) {
          const kstStart = convertLocalToKST(dest, g.start, selectedDateKey);
          if (kstStart) desc += ` [출발 KST: ${kstStart}]`;
        } else {
          const kstEnd = convertLocalToKST(dest, g.end, selectedDateKey);
          if (kstEnd) desc += ` [도착 KST: ${kstEnd}]`;
        }
      }
      if (g.flight) desc += ` [${g.flight}]`;
      gfText.innerText = desc;
    } else {
      clearBar(gfBar);
      gfText.innerText = g ? (g.isArrivalOnly ? `${dest} (도착일/체류)` : (g.isPureStay ? `${dest} (L/O 체류)` : (dest ? `${dest} (${g.type})` : `${g.type}`))) : '근무 없음';
    }
    if (g && g.manual) gfText.appendChild(el('span', 'manual-tag', '✋ 직접 입력'));
    if (g && g.timesFrom === 'flightTimes') gfText.appendChild(el('span', 'manual-tag', '🕒 편명 시간표'));
  }

  const flightBox = document.getElementById('detailFlightBox');
  if (flightBox) renderFlightBox(flightBox, selectedDateKey, dayData.gf);

  const planBox = document.getElementById('datePlanBox');
  const planTime = document.getElementById('datePlanTime');
  const planNote = document.getElementById('datePlanNote');
  if (planBox && planTime && planNote) {
    if (dayData.date) {
      planBox.className = 'p-3 bg-rose-50 rounded-xl border border-rose-300 text-[14px] space-y-1';
      planTime.innerText = dayData.date.time || '시간 미지정';
      planNote.innerText = dayData.date.memo || '약속 내용 없음';
    } else {
      planBox.className = 'p-3 bg-slate-50 rounded-xl border border-slate-200 text-[14px] space-y-1';
      planTime.innerText = '미정';
      planNote.innerText = '등록된 데이트가 없습니다. [일정/데이트 기입] 버튼을 눌러 데이트를 계획해 보세요!';
    }
  }

  const pMy = document.getElementById('detailMyPromise');
  const pGf = document.getElementById('detailGfPromise');
  if (pMy) pMy.innerText = dayData.myPromise || '없음';
  if (pGf) pGf.innerText = dayData.gfPromise || '없음';
}

function kyuhoDuty(my) {
  if (!my || !my.type || my.type === '-') {
    const d = el('div', 'duty duty--none', '-');
    d.dataset.kind = 'k-none';
    return d;
  }
  const kind = kyuhoKind(my.type);
  const kLabel = kind === 'off' ? my.type : kyuhoCellLabel(my.type);
  const d = el('div', `duty duty--k duty--${kind === 'none' ? 'other' : kind}${longLabelClass(kLabel)}`, kLabel);
  d.dataset.kind = `k-${kind}`;
  d.title = `규호 ${my.type}${my.start ? ` ${my.start}~${my.end}` : ''}${my.manual ? ' (직접 입력)' : ''}`;
  return d;
}

function yejinDuty(g) {
  if (!g || !g.type) {
    const d = el('div', 'duty duty--none', '-');
    d.dataset.kind = 'y-none';
    return d;
  }
  const kind = gfKind(g);
  const yLabel = gfCellLabel(g);
  const d = el('div', `duty duty--y duty--${kind}${longLabelClass(yLabel)}`, yLabel);
  d.dataset.kind = `y-${kind}`;
  d.title = `예진 ${g.destination ? g.destination + ' ' : ''}${g.type}${g.start ? ` ${g.start}~${g.end}` : ''}${g.flight ? ` ${g.flight}` : ''}`;
  return d;
}

function timeLines(start, end) {
  const w = el('div', 'duty-time');
  w.append(el('div', '', start), el('div', '', `~${end}`));
  return w;
}

export function renderCalendar() {
  updateDDayHeader();
  const { currentYear, currentMonth, selectedDateKey, showKyuho, showYejin } = state;

  const myTitle = document.getElementById('currentMonthYear');
  if (myTitle) myTitle.innerText = `${currentYear}. ${String(currentMonth).padStart(2, '0')}`;

  const upBtnTxt = document.getElementById('headerUploadBtnText');
  if (upBtnTxt) upBtnTxt.innerText = `${currentMonth}월 등록`;

  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const totalDays = new Date(currentYear, currentMonth, 0).getDate();
  const tKey = todayKey();
  const reco = computeAvailableDays(state.scheduleDB, currentYear, currentMonth, getRecoPrefs());
  const recoByDay = new Map();
  for (const r of reco) {
    if (r.type === '여행' && Array.isArray(r.days)) { for (const d of r.days) recoByDay.set(d, r.type); }
    else recoByDay.set(r.day, r.type);
  }

  for (let i = 0; i < firstDay; i++) grid.appendChild(el('div', 'calendar-cell cal-cell is-empty'));

  for (let day = 1; day <= totalDays; day++) {
    const dateKey = makeDateKey(currentYear, currentMonth, day);
    const dayData = state.scheduleDB[dateKey] || { my: null, gf: null, date: null };
    const holidayName = HOLIDAYS[dateKey];
    const aniv = getAnniversaryInfo(dateKey, state.customAnniversaries);
    const recoType = recoByDay.get(day) || '';
    const allDay = recoType === '종일' || recoType === '여행';

    const cell = el('div', `calendar-cell cal-cell${allDay ? ' is-dateday' : ''}${selectedDateKey === dateKey ? ' is-selected' : ''}`);
    cell.dataset.date = dateKey;
    if (recoType) cell.dataset.reco = recoType;
    cell.onclick = () => selectDate(dateKey);

    // 1줄: 날짜 숫자(첫 span) + 아이콘
    const top = el('div', 'cal-top');
    const dow = new Date(currentYear, currentMonth - 1, day).getDay();
    const isRed = dow === 0 || Boolean(holidayName);
    const daySpan = el('span', `cal-day${isRed ? ' is-sun' : dow === 6 ? ' is-sat' : ''}${dateKey === tKey ? ' is-today' : ''}`, String(day));
    if (dateKey === tKey) daySpan.title = '오늘';
    top.appendChild(daySpan);
    const icons = el('div', 'cal-icons');
    if (recoType) { const r = el('b', '', recoType === '여행' ? '💖' : recoIcon(recoType)); r.title = `데이트 가능: ${recoType}`; r.style.fontWeight = '400'; icons.appendChild(r); }
    if (aniv) icons.appendChild(el('i', 'fa-solid fa-star text-amber-500'));
    if (dayData.date) icons.appendChild(el('i', 'fa-solid fa-heart text-rose-600'));
    if (dayData.myPromise) { const d = el('i', 'dot dot--k'); d.title = '규호 일정'; icons.appendChild(d); }
    if (dayData.gfPromise) { const d = el('i', 'dot dot--y'); d.title = '예진 일정'; icons.appendChild(d); }
    top.appendChild(icons);
    cell.appendChild(top);

    // 공휴일·기념일 이름
    if (holidayName) cell.appendChild(el('div', 'cal-sub cal-sub--holiday', holidayName));
    if (aniv) cell.appendChild(el('div', 'cal-sub cal-sub--aniv', aniv.name));

    const duties = el('div', 'cal-duties');
    if (showKyuho) {
      duties.appendChild(kyuhoDuty(dayData.my));
      if (!showYejin && dayData.my && dayData.my.start && dayData.my.end) duties.appendChild(timeLines(dayData.my.start, dayData.my.end));
    }
    if (showYejin) {
      const g = dayData.gf;
      duties.appendChild(yejinDuty(g));
      if (!showKyuho && g) {
        if (g.isArrivalOnly) {
          // 도착일: 추가 표시 없음
        } else if (g.isPureStay || (g.type === '체류' && !g.start && !g.end)) {
          duties.appendChild(el('div', 'duty-lo', 'L/O'));
        } else if (g.start && g.end) {
          const t = timeLines(g.start, g.end);
          const isStay = g.type === '체류' && !g.isQuickTurn;
          if (isStay) {
            const k = parseKst(convertLocalToKST(g.destination, g.isInbound ? g.start : g.end, dateKey));
            if (k) {
              const line = el('div', 'kst', `KR${k.time}`);
              line.title = g.isInbound ? '출발 한국시각' : '도착 한국시각';
              if (g.isInbound) t.insertBefore(line, t.children[1]); else t.appendChild(line);
              if (k.shift) t.appendChild(el('div', 'kst', `(${k.shift > 0 ? '+' : ''}${k.shift}일)`));
            }
          }
          duties.appendChild(t);
        }
      }
    }
    cell.appendChild(duties);
    grid.appendChild(cell);
  }

  renderAvailableDates(reco);
  updateDetailCard();
}

export function selectDate(dateKey) {
  state.selectedDateKey = dateKey;
  renderCalendar();
}

export function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear += 1; }
  if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear -= 1; }
  state.selectedDateKey = makeDateKey(state.currentYear, state.currentMonth, 1);
  renderCalendar();
}

function paintFilterButtons() {
  const k = document.getElementById('filterBtnKyuho');
  if (k) {
    k.setAttribute('aria-pressed', String(state.showKyuho));
    k.innerHTML = '';
    k.append(el('i', `fa-solid ${state.showKyuho ? 'fa-user-check' : 'fa-user-xmark'}`), document.createTextNode(' 이규호'));
  }
  const y = document.getElementById('filterBtnYejin');
  if (y) {
    y.setAttribute('aria-pressed', String(state.showYejin));
    y.innerHTML = '';
    y.append(el('i', `fa-solid ${state.showYejin ? 'fa-plane' : 'fa-plane-slash'}`), document.createTextNode(' 이예진'));
  }
}

export function toggleScheduleFilter(target) {
  if (target === 'kyuho') state.showKyuho = !state.showKyuho;
  else if (target === 'yejin') state.showYejin = !state.showYejin;
  paintFilterButtons();
  renderCalendar();
}

export async function captureCalendar() {
  const target = document.getElementById('calendarCaptureArea');
  const btn = document.getElementById('btnCaptureCalendar');
  if (!target) return;

  const originalBtnHtml = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-indigo-500"></i><span>캡처</span>';

  try {
    const canvas = await window.html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollY: 0,
      scrollX: 0
    });

    const imageURL = canvas.toDataURL("image/png");
    const downloadLink = document.createElement('a');
    downloadLink.download = `규호♥예진_근무표_${state.currentYear}년_${String(state.currentMonth).padStart(2, '0')}월.png`;
    downloadLink.href = imageURL;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  } catch (err) {
    console.error("캘린더 캡처 오류:", err);
    alert("캘린더 캡처 중 문제가 발생했습니다: " + err.message);
  } finally {
    if (btn) btn.innerHTML = originalBtnHtml;
  }
}
