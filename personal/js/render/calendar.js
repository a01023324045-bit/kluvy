// 달력·상세카드 렌더링
// ⚠️ innerHTML 에 데이터(근무명·도시·시간·기념일명 등)를 넣을 때는 반드시 escapeHtml() 을 거칠 것.
//    3단계부터 달력 칸·상세카드는 textContent 로만 만든다.
// 디자인: 색·글자 크기는 css/app.css 의 :root 변수. 칸 구조는
//   .cal-cell > .cal-top(날짜 숫자 span · 아이콘) > .cal-sub(공휴일·기념일) > .cal-duties(.duty 규호(윗줄) / .duty 예진(아랫줄) / 시간)
//   v2.3.0: 사람 구분은 운영본처럼 위치(규호 윗줄·예진 아랫줄), 근무 형태 색은 운영본 그대로 (app.css).
//   data-kind(근무 계열)를 달아 두어 비교 도구가 클래스명이 아니라 내용으로 비교한다.
// 캡처: captureCalendar() — 브라우저가 그린 그대로 찍는 modern-screenshot(SVG foreignObject, vendor/ 에 고정 버전 내장)
import { BASE_LOVE_DATE, PREF_KEYS } from '../config.js';
import { safeSetStorage } from '../storage.js';
import { state } from '../state.js';
import { getKSTDate, getDiffDays, makeDateKey, parseDateKey } from '../dates.js';
import { HOLIDAYS } from '../holidays.js';
import { stayKstInfo } from '../timezone.js';
import { calculateBarPosition, kyuhoKind, gfKind } from '../schedule-model.js';
import { getAnniversaryInfo } from '../anniversary.js';
import { renderFlightBox } from '../ui/flight-card.js';
import { flightsText } from '../flight.js';
import { detailTitleParts, cellTooltip, dutyExtrasLines, cellExtraMark } from '../title-format.js';
import { LAYOUT, personName, captureFileName } from '../app-mode.js';

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

/**
 * v2.5.2: 그 날의 기념일 표시 정보. 기념일 스위치가 꺼져 있으면 null → 달력 칸(★·이름)·상세 카드 태그가 한꺼번에 사라진다.
 * 캡처는 화면(#calendarCaptureArea)을 그대로 찍으므로 별도 처리 없이 같이 빠진다. 기념일 데이터(state.customAnniversaries)는 건드리지 않는다.
 */
export function anniversaryFor(dateKey) {
  if (state.showAnniversary === false) return null;
  return getAnniversaryInfo(dateKey, state.customAnniversaries);
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

export function updateDDayHeader() {
  if (!LAYOUT.showDday) return; // v2.6.0 개인 모드: 만난 날 D-Day 없음 (배지는 data-couple-only 로 숨김)
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
      const t = el('span', 'text-[12px] bg-red-50 text-red-700 border border-red-200 font-semibold px-2 py-0.5 rounded-md');
      t.append(el('i', 'fa-solid fa-flag mr-1'), document.createTextNode(holiday));
      tagsBox.appendChild(t);
    }
    const aniv = anniversaryFor(selectedDateKey);
    if (aniv) {
      const t = el('span', 'text-[12px] bg-amber-50 text-amber-800 border border-amber-200 font-semibold px-2 py-0.5 rounded-md');
      t.append(el('i', 'fa-solid fa-star mr-1'), document.createTextNode(aniv.name));
      tagsBox.appendChild(t);
    }
    if (selectedDateKey === todayKey()) tagsBox.appendChild(el('span', 'text-[12px] bg-indigo-50 text-indigo-800 border border-indigo-200 font-semibold px-2 py-0.5 rounded-md', '오늘'));
  }

  // v2.6.0 개인 모드: 한 사람(gf 칸) 카드만 — 규호 카드는 그리지 않음 (data-couple-only 로 숨김)
  const wrapKyuho = LAYOUT.personSlots.includes('my') ? document.getElementById('timelineWrapKyuho') : null;
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

    // v2.4.0 제목 압축: 큰 글씨 1줄(✈️ 시드니 19:40→09:15 (+1일)) + 작은 글씨 1줄(TW501 · 현지 +2시간 · KR 07:15 도착)
    if (g && g.start && g.end) setBar(gfBar, g.start, g.end, dest || g.type, g.isQuickTurn ? '#0e7490' : 'var(--kv-yejin)');
    else clearBar(gfBar);
    const tp = detailTitleParts(g, selectedDateKey);
    gfText.textContent = '';
    gfText.classList.toggle('detail-shift--title', tp.kind === 'times');
    gfText.appendChild(el('div', 'dt-main', tp.main));
    if (tp.sub) {
      const sub = el('div', 'dt-sub', tp.sub);
      if (tp.tip) sub.title = `현지는 ${tp.tip}`;
      gfText.appendChild(sub);
    }
    const tags = [];
    if (g && g.manual) tags.push(el('span', 'manual-tag', '✋ 직접 입력'));
    if (g && g.timesFrom === 'flightTimes') tags.push(el('span', 'manual-tag', '🕒 편명 시간표'));
    if (tags.length) { const tg = el('div', 'dt-tags'); tg.append(...tags); gfText.appendChild(tg); }
    // v2.4.4: L/O·TRAIN·전날 출발 비행은 비행 상자가 아니라 제목 아래 별도 줄
    const exBox = document.getElementById('detailGfExtras');
    if (exBox) {
      exBox.textContent = '';
      const lines = dutyExtrasLines(g);
      for (const l of lines) exBox.appendChild(el('div', `dt-extra dt-extra--${l.kind}`, l.text));
      exBox.classList.toggle('hidden', !lines.length);
    }
  }

  const flightBox = document.getElementById('detailFlightBox');
  if (flightBox) renderFlightBox(flightBox, selectedDateKey, dayData.gf);

  const planBox = LAYOUT.showDatePlan ? document.getElementById('datePlanBox') : null;
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
  d.title = cellTooltip(g, g.flight ? flightsText(g) : '');
  return d;
}

function timeLines(start, end) {
  const w = el('div', 'duty-time');
  w.append(el('div', '', start), el('div', '', `~${end}`));
  return w;
}

export function renderCalendar() {
  updateDDayHeader();
  paintAnnivButton();
  const { currentYear, currentMonth, selectedDateKey, showKyuho, showYejin } = state;

  const myTitle = document.getElementById('currentMonthYear');
  if (myTitle) myTitle.innerText = `${currentYear}. ${String(currentMonth).padStart(2, '0')}`;

  const upBtnTxt = document.getElementById('headerUploadBtnText');
  if (upBtnTxt) upBtnTxt.innerText = `${currentMonth}월 등록`;

  const grid = document.getElementById('calendarGrid');
  // 예진만 보기: 칸에 시간·한국시각·(+1일)까지 4줄이 들어가므로 칸을 조금 높인다 (기념일 줄이 있어도 잘리지 않게)
  if (grid) grid.classList.toggle('cal-grid--tall', Boolean(showYejin && !showKyuho));
  if (!grid) return;
  grid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const totalDays = new Date(currentYear, currentMonth, 0).getDate();
  const tKey = todayKey();

  for (let i = 0; i < firstDay; i++) grid.appendChild(el('div', 'calendar-cell cal-cell is-empty'));

  for (let day = 1; day <= totalDays; day++) {
    const dateKey = makeDateKey(currentYear, currentMonth, day);
    const dayData = state.scheduleDB[dateKey] || { my: null, gf: null, date: null };
    const holidayName = HOLIDAYS[dateKey];
    const aniv = anniversaryFor(dateKey);

    const cell = el('div', `calendar-cell cal-cell${selectedDateKey === dateKey ? ' is-selected' : ''}`);
    cell.dataset.date = dateKey;
    cell.onclick = () => selectDate(dateKey);

    // 1줄: 날짜 숫자(첫 span) + 아이콘
    const top = el('div', 'cal-top');
    const dow = new Date(currentYear, currentMonth - 1, day).getDay();
    const isRed = dow === 0 || Boolean(holidayName);
    const daySpan = el('span', `cal-day${isRed ? ' is-sun' : dow === 6 ? ' is-sat' : ''}${dateKey === tKey ? ' is-today' : ''}`, String(day));
    if (dateKey === tKey) daySpan.title = '오늘';
    top.appendChild(daySpan);
    const icons = el('div', 'cal-icons');
    if (aniv) icons.appendChild(el('i', 'fa-solid fa-star text-amber-500'));
    if (dayData.date && LAYOUT.showDatePlan) icons.appendChild(el('i', 'fa-solid fa-heart text-rose-600'));
    if (dayData.myPromise && LAYOUT.personSlots.includes('my')) { const d = el('i', 'dot dot--k'); d.title = `${personName('my')} 일정`; icons.appendChild(d); }
    if (dayData.gfPromise) { const d = el('i', 'dot dot--y'); d.title = `${personName('gf')} 일정`; icons.appendChild(d); }
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
        const pureLo = !g.isArrivalOnly && (g.isPureStay || (g.type === '체류' && !g.start && !g.end));
        if (g.isArrivalOnly) {
          // 도착일: v2.4.4 전날 출발한 비행의 착륙 시각만 (예: 11/3 '착 00:58')
          if (g.carryIn && g.carryIn.end) duties.appendChild(el('div', 'duty-time duty-arr', `착 ${g.carryIn.end}`));
        } else if (pureLo) {
          duties.appendChild(el('div', 'duty-lo', 'L/O'));
        } else if (g.start && g.end) {
          const t = timeLines(g.start, g.end);
          const isStay = g.type === '체류' && !g.isQuickTurn;
          if (isStay) {
            const k = stayKstInfo(g, dateKey); // 상세 카드·미리보기와 같은 함수
            if (k && k.status === 'ok') {
              const line = el('div', 'kst', `KR${k.time}`);
              line.title = `${k.kind === 'departure' ? '출발' : '도착'} 한국시각 ${k.text}`;
              if (g.isInbound) t.insertBefore(line, t.children[1]); else t.appendChild(line);
              if (k.shift) t.appendChild(el('div', 'kst', `(${k.shift > 0 ? '+' : ''}${k.shift}일)`));
            } else if (k && k.status === 'unknown') {
              const line = el('div', 'kst kst--unknown', 'KR ?');
              line.title = `'${g.destination || ''}' 시간대 미등록 — 한국시각을 계산하지 못함`;
              if (g.isInbound) t.insertBefore(line, t.children[1]); else t.appendChild(line);
            }
          }
          duties.appendChild(t);
        }
        // v2.4.4: L/O(오늘 시작)·TRAIN 은 비행과 따로 짧게 (이미 'L/O' 를 보인 체류 중간일은 TRAIN 만)
        const mark = cellExtraMark(g);
        const markText = pureLo ? mark.replace('L/O', '').trim() : mark;
        if (markText) duties.appendChild(el('div', 'duty-extra', markText));
      }
    }
    cell.appendChild(duties);
    grid.appendChild(cell);
  }

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

/** v2.5.2: 기념일 스위치 버튼 모양(켜짐/꺼짐)을 state 에 맞춘다 — 화면을 그릴 때마다 호출 (새로고침 뒤 저장된 설정 반영) */
function paintAnnivButton() {
  const a = document.getElementById('filterBtnAniv');
  if (a) a.setAttribute('aria-pressed', String(state.showAnniversary !== false));
}

/** v2.5.2: [기념일] 스위치 — 달력 칸·상세 카드·캡처의 기념일 표시만 켜고 끈다 (데이터는 그대로). 설정은 이 폰에 저장 */
export function toggleAnniversaryDisplay() {
  state.showAnniversary = state.showAnniversary === false;
  safeSetStorage(PREF_KEYS.showAnniversary, state.showAnniversary);
  renderCalendar();
}

export function toggleScheduleFilter(target) {
  if (!LAYOUT.showPersonFilters) return; // v2.6.0 개인 모드: 한 사람뿐이라 보기 토글 없음
  if (target === 'kyuho') state.showKyuho = !state.showKyuho;
  else if (target === 'yejin') state.showYejin = !state.showYejin;
  paintFilterButtons();
  renderCalendar();
}

// ---------------- 달력 캡처 ----------------
// 원인(v2.2.0 까지): html2canvas 1.4.1 은 화면을 자기 방식으로 다시 그려서
//   ① inset box-shadow(사람 막대·선택 칸 테두리)를 두꺼운 테두리로 그리고 ② 고정 높이+overflow:hidden 칸의 글자 기준선을
//   아래로 밀어 근무 글자가 잘렸다(웹폰트·음수 자간에서 더 심함).
// 해결(v2.3.0): modern-screenshot(SVG foreignObject) — 브라우저가 화면과 똑같이 그린 결과를 이미지로 받는다.
//   웹폰트(Pretendard)가 다 받아진 뒤(document.fonts) 찍고, 폰트 파일은 이미지 안에 넣어 같은 글꼴로 나온다.
//   실패하면(아주 옛 브라우저 등) html2canvas 를 그때 불러 캡처 전용 보정(.cap-h2c)으로 찍는다.
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
let msPromise = null;
function loadModernScreenshot() {
  if (!msPromise) msPromise = import('../../vendor/modern-screenshot.js').catch(e => { msPromise = null; throw e; });
  return msPromise;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('html2canvas 를 불러오지 못했습니다 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
}

/** 글꼴(Pretendard 500·600·700)이 실제로 받아질 때까지 기다림 — 받기 전에 찍으면 대체 글꼴로 찍힘 */
async function waitFonts() {
  const f = document.fonts;
  if (!f) return;
  try {
    await Promise.race([
      Promise.all(['500', '600', '700'].map(w => f.load(`${w} 12px "Pretendard Variable"`, '가A1'))).then(() => f.ready),
      new Promise(r => setTimeout(r, 4000))
    ]);
  } catch { /* 글꼴을 못 받아도 캡처는 진행 */ }
}

/**
 * SVG(foreignObject) → PNG.
 * 크롬은 SVG 이미지 안의 웹폰트(데이터 URL)를 비동기로 적용해서, 바로 그리면 가끔(폰이 바쁠 때) 대체 글꼴·빈 아이콘으로 찍힌다
 * (2026-11 확인: 글자 폭이 달라 '2026. 11' 이 두 줄로 넘어감, 아이콘이 다른 모양).
 * 그래서 이미지 아래에 '확인용 글자(가A1)·아이콘' 줄을 덧붙여 그려 보고, 그 줄의 글자 폭이 화면(이미 글꼴이 적용된 문서)에서
 * 같은 글꼴로 그린 폭과 같아질 때까지 다시 그린다 (최대 약 6초). 확인 줄은 결과 이미지에서 잘라 낸다.
 */
const PROBE_H = 60;
const PROBE_TEXT = '가A1';
const PROBE_ICON = '\uf053'; // fa-chevron-left (Font Awesome 6 Free Solid)

function inkWidth(ctx, x0, y0, w, h) {
  const d = ctx.getImageData(x0, y0, w, h).data;
  let min = w, max = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 384) { if (x < min) min = x; if (x > max) max = x; }
    }
  }
  return max < 0 ? 0 : max - min + 1;
}

/** 문서(글꼴 적용됨)에서 그린 확인 줄의 글자·아이콘 폭 = 기대값 */
function expectedProbe(scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(260 * scale); c.height = Math.round(PROBE_H * scale);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#000'; x.textBaseline = 'middle';
  x.font = `600 ${40 * scale}px "Pretendard Variable"`;
  x.fillText(PROBE_TEXT, 0, c.height / 2);
  x.font = `900 ${40 * scale}px "Font Awesome 6 Free"`;
  x.fillText(PROBE_ICON, 200 * scale, c.height / 2);
  return { text: inkWidth(x, 0, 0, Math.round(190 * scale), c.height), icon: inkWidth(x, Math.round(200 * scale), 0, Math.round(60 * scale), c.height) };
}

function addProbe(svg, w, h) {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  svg.setAttribute('height', String(h + PROBE_H));
  svg.setAttribute('viewBox', `0 0 ${w} ${h + PROBE_H}`);
  const fo = svg.querySelector('foreignObject');
  const probe = document.createElementNS(XHTML, 'div');
  probe.setAttribute('style', `position:absolute;left:0;top:${h}px;width:${w}px;height:${PROBE_H}px;background:#fff;color:#000;white-space:nowrap;margin:0;padding:0;letter-spacing:0`);
  const t = document.createElementNS(XHTML, 'span');
  t.setAttribute('style', `position:absolute;left:0;top:0;height:${PROBE_H}px;line-height:${PROBE_H}px;font:600 40px "Pretendard Variable";letter-spacing:0`);
  t.textContent = PROBE_TEXT;
  const i = document.createElementNS(XHTML, 'span');
  i.setAttribute('style', `position:absolute;left:200px;top:0;height:${PROBE_H}px;line-height:${PROBE_H}px;font:900 40px "Font Awesome 6 Free";letter-spacing:0`);
  i.textContent = PROBE_ICON;
  probe.append(t, i);
  // foreignObject 안 첫 요소(캡처 대상) 기준 절대 위치가 되도록 감싸지 않고 foreignObject 에 바로 붙임
  fo.setAttribute('style', `${fo.getAttribute('style') || ''};position:relative`);
  fo.appendChild(probe);
}

// 캡처 이미지에 넣을 글꼴 (한 번 받아 메모리에 보관): Pretendard(앱 내장) + Font Awesome Solid(아이콘, cdnjs — CORS 허용).
// modern-screenshot 의 자동 수집은 가끔 아이콘 글꼴을 빠뜨려(외부 CDN 받기 실패·경합) 아이콘이 네모로 찍혀서 직접 넣는다.
let fontCssCache = null;
async function toDataUrl(url) {
  const r = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const b = await r.blob();
  return await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => bad(fr.error); fr.readAsDataURL(b); });
}
async function captureFontCss() {
  if (fontCssCache) return fontCssCache;
  const parts = [];
  let icon = false, pret = false;
  try {
    const u = await toDataUrl(new URL('../../fonts/PretendardVariable.woff2', import.meta.url).href);
    parts.push(`@font-face { font-family: "Pretendard Variable"; font-weight: 45 920; font-style: normal; font-display: block; src: url("${u}") format("woff2"); }`);
    pret = true;
  } catch (e) { console.warn('달력 캡처: Pretendard 글꼴을 읽지 못함', e); }
  const fa = document.querySelector('link[href*="font-awesome"]');
  if (fa) {
    try {
      const u = await toDataUrl(new URL('../webfonts/fa-solid-900.woff2', fa.href).href);
      parts.push(`@font-face { font-family: "Font Awesome 6 Free"; font-weight: 900; font-style: normal; font-display: block; src: url("${u}") format("woff2"); }`);
      icon = true;
    } catch (e) { console.warn('달력 캡처: 아이콘 글꼴을 받지 못함(인터넷 확인) — 아이콘 없이 찍힐 수 있음', e); }
  }
  const out = { css: parts.join('\n'), icon };
  if (pret && (icon || !fa)) fontCssCache = out; // 다 받았을 때만 보관 (실패면 다음에 다시 시도)
  return out;
}

async function rasterizeSvg(svg, scale, { icon = true } = {}) {
  const w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
  addProbe(svg, w, h);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  const want = expectedProbe(scale);
  const W = Math.round(w * scale), H = Math.round(h * scale), PH = Math.round(PROBE_H * scale);
  const full = document.createElement('canvas');
  full.width = W; full.height = H + PH;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  const img = new Image();
  img.src = url;
  if (img.decode) await img.decode(); else await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; });
  const t0 = Date.now();
  let ok = false, got = null;
  for (let i = 0; i < 40; i++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, full.width, full.height);
    ctx.drawImage(img, 0, 0, full.width, full.height);
    got = { text: inkWidth(ctx, 0, H, Math.round(190 * scale), PH), icon: inkWidth(ctx, Math.round(200 * scale), H, Math.round(60 * scale), PH) };
    const tol = 2 * scale + 1;
    if (got.text > 0 && Math.abs(got.text - want.text) <= tol && (!icon || Math.abs(got.icon - want.icon) <= tol)) { ok = true; break; }
    if (Date.now() - t0 > 6000) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ok) console.warn('달력 캡처: 글꼴 적용 확인 실패 — 대체 글꼴로 찍혔을 수 있음', JSON.stringify({ want, got }));
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(full, 0, 0, W, H, 0, 0, W, H);
  return out.toDataURL('image/png');
}

// v2.3.1: 캡처 복제본에서 글줄이 늘어나지 않게 —
//  modern-screenshot 은 각 요소의 계산된 폭(px)을 복제본에 그대로 박는다. 폰에서 복제본 글자가 화면보다 조금 넓게 그려지면
//  (대체 글꼴·텍스트 배율·반올림) 고정 폭을 넘은 글이 공백에서 줄바꿈된다 → 헤더 '2026. 11' 이 '2026.' / '11' 두 줄이 되고
//  헤더 높이·화살표 위치가 달라졌다(사용자 제보). 화면에서 한 줄인 글은 복제본에서도 줄바꿈 금지, 헤더 제목(data-cap-fit)은 폭 고정 해제.
const CAP_1LINE = 'data-cap-1line';
export function markSingleLineTexts(root) {
  const marked = [];
  for (const e of root.querySelectorAll('*')) {
    if (!Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || /^(nowrap|pre)$/.test(cs.whiteSpace)) continue;
    const r = document.createRange();
    r.selectNodeContents(e);
    const tops = Array.from(r.getClientRects()).filter(x => x.width > 0 && x.height > 0).map(x => x.top).sort((a, b) => a - b);
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 14;
    const lines = tops.reduce((n, t, i) => (i && t - tops[i - 1] > lineH / 2 ? n + 1 : n), tops.length ? 1 : 0);
    if (lines === 1) { e.setAttribute(CAP_1LINE, ''); marked.push(e); }
  }
  return marked;
}
export function fixCloneLines(clone) {
  if (!clone || !clone.querySelectorAll) return;
  const all = [clone, ...clone.querySelectorAll(`[${CAP_1LINE}], [data-cap-fit]`)];
  for (const n of all) {
    if (!n.style || !n.hasAttribute) continue;
    if (n.hasAttribute(CAP_1LINE) || n.hasAttribute('data-cap-fit')) n.style.setProperty('white-space', 'nowrap', 'important');
    if (n.hasAttribute('data-cap-fit')) {
      n.style.setProperty('width', 'auto', 'important');
      n.style.setProperty('min-width', 'max-content', 'important');
      n.style.setProperty('flex-shrink', '0', 'important');
    }
  }
}

/** 캡처 대상 → PNG data URL (테스트에서도 사용) */
export async function renderCalendarImage(target) {
  await waitFonts();
  const scale = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 2)));
  const marked = markSingleLineTexts(target);
  try {
    const ms = await loadModernScreenshot();
    const fonts = await captureFontCss();
    const svg = await ms.domToForeignObjectSvg(target, { backgroundColor: '#ffffff', timeout: 20000, font: fonts.css ? { cssText: fonts.css } : { preferredFormat: 'woff2' }, onCloneNode: fixCloneLines });
    return await rasterizeSvg(svg, scale, { icon: fonts.icon });
  } catch (err) {
    console.warn('달력 캡처: modern-screenshot 실패 → html2canvas 로 대체', err);
    await loadScript(HTML2CANVAS_URL);
    const canvas = await window.html2canvas(target, {
      scale, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollY: 0, scrollX: 0,
      onclone: doc => { doc.documentElement.classList.add('cap-h2c'); fixCloneLines(doc.getElementById(target.id) || doc.body); }
    });
    return canvas.toDataURL('image/png');
  } finally {
    for (const e of marked) e.removeAttribute(CAP_1LINE);
  }
}

export async function captureCalendar() {
  const target = document.getElementById('calendarCaptureArea');
  const btn = document.getElementById('btnCaptureCalendar');
  if (!target) return;
  if (btn && btn.dataset.busy === '1') return;

  const originalBtnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.dataset.busy = '1'; btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin text-indigo-500"></i><span>캡처</span>'; }

  try {
    const imageURL = await renderCalendarImage(target);
    const downloadLink = document.createElement('a');
    downloadLink.download = captureFileName(state.currentYear, state.currentMonth);
    downloadLink.href = imageURL;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  } catch (err) {
    console.error("캘린더 캡처 오류:", err);
    alert("캘린더 캡처 중 문제가 발생했습니다: " + (err && err.message ? err.message : err));
  } finally {
    if (btn) { btn.innerHTML = originalBtnHtml; delete btn.dataset.busy; }
  }
}
