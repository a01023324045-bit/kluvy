// 일정 수동 편집 모달
import { state } from '../state.js';
import { dateKeysBetween } from '../dates.js';
import { applyEditToDates, defaultTimesFor, GF_DEFAULT_TIMES, KYUHO_SHIFTS, KYUHO_OFF_TYPES } from '../schedule-model.js';
import { saveDB } from '../firebase-sync.js';
import { renderCalendar } from '../render/calendar.js';
import { learnFlightFromGf } from '../flight-times.js';
import { gfFlights, flightLabel, flightFieldsFromInputs, MAX_LEGS } from '../flight.js';
import { LAYOUT, personName } from '../app-mode.js';

// v2.6.0 개인 모드: 규호(my) 근무·데이트 칸은 숨겨져 있고 저장하지 않는다 (한 사람 = gf 칸)
const HAS_MY = LAYOUT.personSlots.includes('my');

// v2.4.0: 레그(편)마다 편명·이륙·착륙 칸 (최대 4레그). 1레그 = inputGfFlight, N레그 = inputGfFlight{N}
// v2.4.1: [+ 레그 추가]·[삭제] 없음 — 칸 수는 (인식·저장된 레그 수, 최소 2). 빈 칸은 저장에서 빠진다(flightFieldsFromInputs).
const LEG_NUMS = Array.from({ length: MAX_LEGS }, (_, i) => i + 1);
const flightId = n => (n === 1 ? 'inputGfFlight' : `inputGfFlight${n}`);
const stdId = n => `inputGfFl${n}Std`;
const staId = n => `inputGfFl${n}Sta`;
const FLIGHT_INPUTS = [...LEG_NUMS.map(flightId), ...LEG_NUMS.flatMap(n => [stdId(n), staId(n)])];

/** 편집창 규호 근무 목록 (select 의 option 과 같게 유지) */
export const PREDEFINED_MY = ["조근", "공휴일조근", "석근", "공휴일석근", "석5", "공휴일석5", "석1", "일근", "O", "대휴", "휴가", "연차", "TS-3", "TS-1", "연수"];

// 3단계: 편집창을 열 때의 입력값. 저장할 때 '손댄 칸'만 저장한다 —
//  · 데이트 메모만 적고 저장해도 규호/예진 근무가 기본값(조근·퀵턴)으로 생기지 않음
//  · 창을 열어 둔 사이 상대 폰이 바꾼 상대 근무를, 창에 남아 있던 옛 값으로 되돌리지 않음 (운영본에서 실제로 덮이던 경로)
let openedSnapshot = null;

function readSection(name) {
  const v = id => (document.getElementById(id) || {}).value || '';
  if (name === 'my') return JSON.stringify([v('selectMyShiftType'), v('inputMyShiftCustom').trim(), v('inputMyTimeStart'), v('inputMyTimeEnd')]);
  if (name === 'gf') return JSON.stringify([v('selectGfShiftType'), v('inputGfShiftCustom').trim(), v('inputGfDestination').trim(), v('inputGfTimeStart'), v('inputGfTimeEnd'), ...FLIGHT_INPUTS.map(id => v(id).trim())]);
  return JSON.stringify([v('inputDateTimeStart'), v('inputDateTimeEnd'), v('inputDateMemo'), v('inputMyPromise').trim(), v('inputGfPromise').trim()]);
}
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function snapshotForm() { return { my: readSection('my'), gf: readSection('gf'), plan: readSection('plan') }; }

/** 단일 날짜 저장에서 실제로 바꾼 항목 (테스트·E2E 용으로 노출) */
export function touchedSections() {
  if (!openedSnapshot) return { kyuho: true, yejin: true, plan: true };
  return { kyuho: readSection('my') !== openedSnapshot.my, yejin: readSection('gf') !== openedSnapshot.gf, plan: readSection('plan') !== openedSnapshot.plan };
}

export function setEditMode(mode) {
  state.currentEditMode = mode;
  const tabSingle = document.getElementById('tabModeSingle');
  const tabRange = document.getElementById('tabModeRange');
  const rangeBox = document.getElementById('rangeDatePickerBox');

  if (mode === 'range') {
    tabRange.className = "flex-1 min-h-[40px] rounded-lg bg-white shadow-xs text-indigo-700 font-semibold transition";
    tabSingle.className = "flex-1 min-h-[40px] rounded-lg text-slate-600 font-semibold transition";
    rangeBox.classList.remove('hidden');
    document.getElementById('inputRangeStart').value = state.selectedDateKey;
    document.getElementById('inputRangeEnd').value = state.selectedDateKey;
    // 일괄 수정 대상: 매번 셋 다 체크된 상태로 시작 (운영본과 같은 동작), 필요 없는 항목을 끄면 그 항목은 안 건드림
    ['chkRangeKyuho', 'chkRangeYejin', 'chkRangePlan'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = id === 'chkRangeKyuho' ? HAS_MY : true;
    });
  } else {
    tabSingle.className = "flex-1 min-h-[40px] rounded-lg bg-white shadow-xs text-indigo-700 font-semibold transition";
    tabRange.className = "flex-1 min-h-[40px] rounded-lg text-slate-600 font-semibold transition";
    rangeBox.classList.add('hidden');
  }
}

export function onMyShiftTypeChange() {
  const type = document.getElementById('selectMyShiftType').value;
  const wrapCustom = document.getElementById('wrapMyCustomShift');
  if (type === '기타') {
    wrapCustom.classList.remove('hidden');
  } else {
    wrapCustom.classList.add('hidden');
    autoFillMyTime();
  }
}

export function onGfShiftTypeChange() {
  const type = document.getElementById('selectGfShiftType').value;
  const wrapCustom = document.getElementById('wrapGfCustomShift');
  if (type === '기타') {
    wrapCustom.classList.remove('hidden');
  } else {
    wrapCustom.classList.add('hidden');
    autoFillGfTime();
  }
}

export function openEditModal(dateKey = state.selectedDateKey) {
  state.selectedDateKey = dateKey;
  const dayData = state.scheduleDB[dateKey] || { my: null, gf: null, date: null, myPromise: "", gfPromise: "" };
  const title = document.getElementById('modalDateTitle');
  if (title) title.innerText = `${dateKey} 근무 및 일정 편집`;

  setEditMode('single');

  if (dayData.date) {
    const times = (dayData.date.time || '').split('~');
    document.getElementById('inputDateTimeStart').value = times[0] ? times[0].trim() : '';
    document.getElementById('inputDateTimeEnd').value = times[1] ? times[1].trim() : '';
    document.getElementById('inputDateMemo').value = dayData.date.memo || '';
  } else {
    document.getElementById('inputDateTimeStart').value = '';
    document.getElementById('inputDateTimeEnd').value = '';
    document.getElementById('inputDateMemo').value = '';
  }

  document.getElementById('inputMyPromise').value = dayData.myPromise || '';
  document.getElementById('inputGfPromise').value = dayData.gfPromise || '';

  const mySelect = document.getElementById('selectMyShiftType');
  const wrapMyCustom = document.getElementById('wrapMyCustomShift');
  const inputMyCustom = document.getElementById('inputMyShiftCustom');
  if (dayData.my && dayData.my.type && dayData.my.type !== '-') {
    if (PREDEFINED_MY.includes(dayData.my.type)) {
      mySelect.value = dayData.my.type;
      wrapMyCustom.classList.add('hidden');
      inputMyCustom.value = '';
    } else {
      mySelect.value = "기타";
      wrapMyCustom.classList.remove('hidden');
      inputMyCustom.value = dayData.my.type;
    }
    document.getElementById('inputMyTimeStart').value = dayData.my.start || '';
    document.getElementById('inputMyTimeEnd').value = dayData.my.end || '';
  } else {
    mySelect.value = "조근";
    wrapMyCustom.classList.add('hidden');
    inputMyCustom.value = '';
    autoFillMyTime();
  }

  const gfSelect = document.getElementById('selectGfShiftType');
  const wrapGfCustom = document.getElementById('wrapGfCustomShift');
  const inputGfCustom = document.getElementById('inputGfShiftCustom');
  const predefinedGf = ["퀵턴", "체류", "OFF", "SBY", "ISA", "ISB", "ISC", "ISD", "GSA", "GSB", "GSC", "GSD", "TR"];

  if (dayData.gf && dayData.gf.type) {
    if (predefinedGf.includes(dayData.gf.type)) {
      gfSelect.value = dayData.gf.type;
      wrapGfCustom.classList.add('hidden');
      inputGfCustom.value = '';
    } else {
      gfSelect.value = "기타";
      wrapGfCustom.classList.remove('hidden'); // (운영본은 여기서 규호 입력칸을 열던 버그가 있었음)
      inputGfCustom.value = dayData.gf.type;
    }
    document.getElementById('inputGfDestination').value = dayData.gf.destination || '';
    fillFlightInputs(dayData.gf);
    document.getElementById('inputGfTimeStart').value = dayData.gf.start || '';
    document.getElementById('inputGfTimeEnd').value = dayData.gf.end || '';
  } else {
    gfSelect.value = "퀵턴";
    wrapGfCustom.classList.add('hidden');
    inputGfCustom.value = '';
    fillFlightInputs(null);
    autoFillGfTime();
  }

  const manualNote = document.getElementById('editManualNote');
  if (manualNote) {
    const who = [HAS_MY && dayData.my && dayData.my.manual && personName('my'), dayData.gf && dayData.gf.manual && personName('gf')].filter(Boolean);
    manualNote.textContent = who.length ? `✋ ${who.join('·')} 근무는 직접 입력한 값입니다 (근무표 등록으로 덮이지 않음).` : '';
    manualNote.classList.toggle('hidden', !who.length);
  }

  openedSnapshot = snapshotForm();
  document.getElementById('editModal').classList.remove('hidden');
}

/**
 * 보이는 레그 칸 수 = (인식·저장된 레그 수, 최소 2) — v2.4.1: 늘리거나 줄이는 버튼은 없다.
 * 1·2칸 = 기존 v2.3.x 의 '가는 편/오는 편'(오인식 수정용), 3·4칸은 3~4레그 데이터가 있을 때만 보인다.
 */
function showLegBlocks(count) {
  const n = Math.min(MAX_LEGS, Math.max(2, count));
  for (const k of LEG_NUMS) {
    const b = document.getElementById(`gfLeg${k}`);
    if (b) b.classList.toggle('hidden', k > n);
  }
}

/** v2.4.0: 레그별 편명 칸과 편별 이륙·착륙(직접 입력) 칸 채우기 (v2.3.1 의 가는 편·오는 편 = 1·2레그) */
function fillFlightInputs(gf) {
  const legs = gfFlights(gf);
  for (const id of FLIGHT_INPUTS) setVal(id, '');
  if (!legs.length) {
    // 알아볼 수 없는 편명 글자는 그대로 보여 줌 (지우지 않게)
    setVal('inputGfFlight', gf && gf.flight ? gf.flight : '');
    showLegBlocks(2);
    return;
  }
  legs.slice(0, MAX_LEGS).forEach((L, i) => {
    const n = i + 1;
    setVal(flightId(n), flightLabel(L));
    setVal(stdId(n), L.source === 'manual' ? L.std : '');
    setVal(staId(n), L.source === 'manual' ? L.sta : '');
  });
  showLegBlocks(legs.length);
}

export function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

export function autoFillMyTime() {
  const type = document.getElementById('selectMyShiftType').value;
  const s = document.getElementById('inputMyTimeStart');
  const e = document.getElementById('inputMyTimeEnd');
  // 근무 사전(schedule-model.js KYUHO_SHIFTS): 조근 05~13, 공휴일조근 05~09, 석근·석5 13~21, 공휴일석근·공휴일석5 15~21, 석1 12~20, 일근 09~18
  if (KYUHO_SHIFTS[type]) { s.value = KYUHO_SHIFTS[type].start; e.value = KYUHO_SHIFTS[type].end; }
  else if (KYUHO_OFF_TYPES.includes(type)) { s.value = ''; e.value = ''; }
}

export function autoFillGfTime() {
  const type = document.getElementById('selectGfShiftType').value;
  const s = document.getElementById('inputGfTimeStart');
  const e = document.getElementById('inputGfTimeEnd');
  // 기본시간: SBY 06~19, ISA 06:30~11:30, ISD 18:30~21:30, GSA 05~10, TR 08~17 (schedule-model.js GF_DEFAULT_TIMES)
  // ISB·ISC·GSB·GSC·GSD 는 정해진 시간이 없어 입력값을 그대로 둔다 (사진의 시간을 직접 입력)
  if (GF_DEFAULT_TIMES[type]) { [s.value, e.value] = defaultTimesFor(type); }
  else if (type === 'OFF') { s.value = ''; e.value = ''; }
}

export function saveModalChanges() {
  const dStart = document.getElementById('inputDateTimeStart').value;
  const dEnd = document.getElementById('inputDateTimeEnd').value;
  const dMemo = document.getElementById('inputDateMemo').value;
  const myPromiseVal = document.getElementById('inputMyPromise').value.trim();
  const gfPromiseVal = document.getElementById('inputGfPromise').value.trim();

  const mySelectVal = document.getElementById('selectMyShiftType').value;
  const myFinalType = (mySelectVal === '기타')
    ? (document.getElementById('inputMyShiftCustom').value.trim() || '기타')
    : mySelectVal;

  const myObj = {
    type: myFinalType,
    start: document.getElementById('inputMyTimeStart').value,
    end: document.getElementById('inputMyTimeEnd').value
  };

  const gfSelectVal = document.getElementById('selectGfShiftType').value;
  const gfFinalType = (gfSelectVal === '기타')
    ? (document.getElementById('inputGfShiftCustom').value.trim() || '기타')
    : gfSelectVal;

  const gStart = document.getElementById('inputGfTimeStart').value;
  const gEnd = document.getElementById('inputGfTimeEnd').value;

  const gfObj = {
    type: gfFinalType,
    destination: document.getElementById('inputGfDestination').value.trim(),
    start: gStart,
    end: gEnd,
    isQuickTurn: (gfFinalType === '퀵턴'),
    isPureStay: (gfFinalType === '체류' && !gStart && !gEnd)
  };
  // 편명 (v2.3.0): 적었으면 저장. 단일 수정에서 원래 있던 편명을 지웠으면 '' 로 지움.
  // 비워 둔 일괄 수정은 키를 안 넣어 기존 편명(같은 근무 형태일 때)을 그대로 둠 (mergeGf)
  // v2.3.1: 가는 편·오는 편 + 편별 이륙/착륙 직접 입력 → gf.flight(가는 편, v2.3.0 호환) + gf.flights([가는 편, 오는 편])
  // v2.4.0: 레그 최대 4개 → gf.flights 배열 길이 4까지
  const val = id => ((document.getElementById(id) || {}).value || '').trim();
  const legVals = {};
  for (const n of LEG_NUMS) Object.assign(legVals, { [`f${n}`]: val(flightId(n)), [`s${n}`]: val(stdId(n)), [`a${n}`]: val(staId(n)) });
  const fl = flightFieldsFromInputs(legVals);
  const prevGf = (state.scheduleDB[state.selectedDateKey] || {}).gf;
  const noFlightType = gfFinalType === 'OFF' || /^(SBY|IS[A-D]|GS[A-D])$/.test(gfFinalType);
  if (noFlightType) { /* 비행 아닌 근무: 편명 없음 */ }
  else if (fl.flight) { gfObj.flight = fl.flight; gfObj.flights = fl.flights; }
  else if (state.currentEditMode !== 'range' && prevGf && (prevGf.flight || prevGf.flights)) { gfObj.flight = ''; gfObj.flights = null; }

  const dateObj = (dStart || dEnd || dMemo) ? {
    time: dStart && dEnd ? `${dStart}~${dEnd}` : (dStart || dEnd || ''),
    memo: dMemo
  } : null;

  let targetDates = [];
  let targets = touchedSections();
  if (state.currentEditMode === 'range') {
    const rStartStr = document.getElementById('inputRangeStart').value;
    const rEndStr = document.getElementById('inputRangeEnd').value;
    if (!rStartStr || !rEndStr) {
      alert("시작일과 종료일을 선택해 주세요.");
      return;
    }
    if (rStartStr > rEndStr) {
      alert("종료일은 시작일보다 이후여야 합니다.");
      return;
    }
    targets = {
      kyuho: HAS_MY && document.getElementById('chkRangeKyuho').checked,
      yejin: document.getElementById('chkRangeYejin').checked,
      plan: document.getElementById('chkRangePlan').checked
    };
    if (!targets.kyuho && !targets.yejin && !targets.plan) {
      alert(HAS_MY ? "일괄 적용할 항목(규호 근무 / 예진 근무 / 데이트·약속)을 하나 이상 선택해 주세요." : "일괄 적용할 항목(근무 / 약속·메모)을 하나 이상 선택해 주세요.");
      return;
    }
    targetDates = dateKeysBetween(rStartStr, rEndStr);
  } else {
    targetDates = [state.selectedDateKey];
    if (!HAS_MY) targets.kyuho = false;
    if (!targets.kyuho && !targets.yejin && !targets.plan) { closeEditModal(); return; } // 바꾼 것 없음
  }

  // 근무(규호·예진)는 '직접 입력' 표시 → 근무표 등록이 기본으로 덮지 않음
  applyEditToDates(state.scheduleDB, targetDates, {
    my: myObj,
    gf: gfObj,
    date: dateObj,
    myPromise: myPromiseVal,
    gfPromise: gfPromiseVal
  }, targets, { manualAt: Date.now() });
  if (targets.yejin) {
    const day = state.scheduleDB[targetDates[0]];
    if (day && day.gf) learnFlightFromGf(day.gf, 'manual');
  }
  openedSnapshot = null;

  saveDB();
  closeEditModal();
  renderCalendar();

  if (state.currentEditMode === 'range') {
    const names = (HAS_MY
      ? [targets.kyuho && '규호 근무', targets.yejin && '예진 근무', targets.plan && '데이트·약속']
      : [targets.yejin && '근무', targets.plan && '약속·메모']).filter(Boolean).join(', ');
    alert(`${targetDates.length}일 동안의 일정이 일괄 변경되었습니다! (${names})`);
  }
}
