// 간편 텍스트 빠른 등록 ("3 오사카, 4-7 다낭, 8 OFF, 9 GSD")
import { isStayFlight, extractStandbyCode, defaultTimesFor } from '../schedule-model.js';
import { makeDateKey } from '../dates.js';

export function applyDayDuty(scheduleDB, year, month, d, val) {
  const dKey = makeDateKey(year, month, d);
  if (!scheduleDB[dKey]) scheduleDB[dKey] = {};

  if (val.includes('OFF')) {
    scheduleDB[dKey].gf = { type: 'OFF', destination: '', isQuickTurn: false };
  } else if (extractStandbyCode(val)) {
    // SBY / 공항 대기(ISA·ISB·ISC·ISD·GSA·GSB·GSC·GSD …) → 자기 코드로 저장, 기본시간은 아는 코드만
    const code = extractStandbyCode(val);
    const [start, end] = defaultTimesFor(code);
    scheduleDB[dKey].gf = { type: code, destination: '', start, end, isQuickTurn: false };
  } else if (val.includes('TR')) {
    const [start, end] = defaultTimesFor('TR');
    scheduleDB[dKey].gf = { type: 'TR', destination: '', start, end, isQuickTurn: false };
  } else {
    const isStay = isStayFlight(val) || val.includes('체류') || val.includes('L/O');
    const cleanDest = val.replace('퀵턴','').replace('체류','').replace('L/O','').trim();
    scheduleDB[dKey].gf = {
      type: isStay ? '체류' : '퀵턴',
      destination: cleanDest,
      start: isStay ? '' : '06:00',
      end: isStay ? '' : '13:30',
      isQuickTurn: !isStay,
      isPureStay: isStay
    };
  }
}

export function applyQuickTextInput(text, scheduleDB, year, month) {
  const items = text.split(/[\n,]+/);
  items.forEach(item => {
    const trimmed = item.trim();
    if (!trimmed) return;

    const rangeMatch = trimmed.match(/^(\d{1,2})\s*[-~]\s*(\d{1,2})\s+(.+)$/);
    if (rangeMatch) {
      const s = parseInt(rangeMatch[1], 10);
      const e = parseInt(rangeMatch[2], 10);
      const val = rangeMatch[3].trim();
      for (let d = s; d <= e; d++) applyDayDuty(scheduleDB, year, month, d, val);
      return;
    }

    const singleMatch = trimmed.match(/^(\d{1,2})\s+(.+)$/);
    if (singleMatch) {
      const d = parseInt(singleMatch[1], 10);
      const val = singleMatch[2].trim();
      applyDayDuty(scheduleDB, year, month, d, val);
    }
  });
}
