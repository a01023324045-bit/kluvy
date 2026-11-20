// 규호 엑셀 근무표 파서 (운영본 규칙 그대로, 순수 함수화)
// 공휴일 판정은 holidays.js (2026·2027) 를 따른다 → 연도가 늘면 자동으로 '공휴일조근' 판정도 따라감.
// - parseKyuhoShiftRule(val, dateKey, holidays): 셀 값 하나 → { type, start, end }
// - parseKyuhoSheet(sheet, XLSX, year, month, holidays): 시트 → { 'YYYY-MM-DD': myObj }
// 브라우저에서는 window.XLSX, 테스트에서는 npm xlsx 를 넘긴다.
// 3단계: 석근·석5 도 휴일이면 공휴일석근·공휴일석5 (15:00~21:00). 석5 = 석근과 같은 시간, 사무실만 다름.
//        시간·휴일 기준은 schedule-model.js 의 KYUHO_SHIFTS / isKyuhoHoliday / HOLIDAY_SEOK_INCLUDES_WEEKEND.
import { HOLIDAYS } from '../holidays.js';
import { makeDateKey } from '../dates.js';
import { KYUHO_SHIFTS, isKyuhoHoliday, HOLIDAY_SEOK_INCLUDES_WEEKEND } from '../schedule-model.js';

const shift = type => ({ type, start: KYUHO_SHIFTS[type].start, end: KYUHO_SHIFTS[type].end });

export function parseKyuhoShiftRule(val, dateKey, holidays = HOLIDAYS, opts = {}) {
  val = String(val ?? '').replace(/\s+/g, '');
  if (!val) return { type: '-', start: '', end: '' };
  // 요일은 폰 시간대와 무관하게 계산 (운영본 new Date(dateKey).getDay() 는 한국보다 느린 시간대에서 하루 어긋남)
  const isHolidayOrWeekend = isKyuhoHoliday(dateKey, holidays, true);
  const seokWeekend = opts.seokIncludesWeekend ?? HOLIDAY_SEOK_INCLUDES_WEEKEND;
  const isSeokHoliday = isKyuhoHoliday(dateKey, holidays, seokWeekend);

  if (val.includes('석1')) return shift('석1');
  if (val.includes('석5')) return shift(isSeokHoliday ? '공휴일석5' : '석5');
  if (val.includes('석근') || val === '석') return shift(isSeokHoliday ? '공휴일석근' : '석근');
  if (val.includes('일근') || val === '일') return shift('일근');
  if (val.includes('TS-3')) return { type: 'TS-3', start: '', end: '' };
  if (val.includes('TS-1')) return { type: 'TS-1', start: '', end: '' };
  if (val.includes('연수')) return { type: '연수', start: '', end: '' };

  if (val.includes('조근') || val === '조') return shift(isHolidayOrWeekend ? '공휴일조근' : '조근');

  if (val === 'O' || val === 'o') return { type: 'O', start: '', end: '' };
  if (val.includes('대휴')) return { type: '대휴', start: '', end: '' };
  if (val.includes('휴가') || val.includes('연차')) return { type: '휴가', start: '', end: '' };

  return { type: val, start: '', end: '' };
}

/** 병합 셀을 펼쳐서 모든 칸에 시작 셀 값을 복사 (운영본과 동일하게 sheet 를 직접 수정) */
function unmergeSheet(sheet, XLSX) {
  if (sheet['!merges'] && Array.isArray(sheet['!merges'])) {
    sheet['!merges'].forEach(m => {
      const startAddr = XLSX.utils.encode_cell(m.s);
      const startCell = sheet[startAddr];
      if (startCell && startCell.v !== undefined) {
        for (let R = m.s.r; R <= m.e.r; R++) {
          for (let C = m.s.c; C <= m.e.c; C++) {
            const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
            sheet[cellAddr] = { t: startCell.t, v: startCell.v, w: startCell.w, s: startCell.s };
          }
        }
      }
    });
  }
}

export function parseKyuhoSheet(sheet, XLSX, year, month, holidays = HOLIDAYS) {
  const result = {};
  unmergeSheet(sheet, XLSX);

  const range = XLSX.utils.decode_range(sheet['!ref']);
  let targetRow = -1;
  let dateHeaderRow = -1;
  let maxCount = 0;

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell || cell.v === undefined) continue;
      if (String(cell.v).replace(/\s+/g, '') === '이규호') {
        targetRow = R;
        break;
      }
    }
    if (targetRow !== -1) break;
  }

  for (let R = range.s.r; R <= Math.min(range.e.r, 15); ++R) {
    let cnt = 0;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== undefined) {
        const num = parseInt(String(cell.v).trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= 31) cnt++;
      }
    }
    if (cnt > maxCount) { maxCount = cnt; dateHeaderRow = R; }
  }

  if (targetRow !== -1 && dateHeaderRow !== -1) {
    const colToDayMap = {};
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = sheet[XLSX.utils.encode_cell({ r: dateHeaderRow, c: C })];
      if (cell && cell.v !== undefined) {
        const d = parseInt(String(cell.v).trim(), 10);
        if (!isNaN(d) && d >= 1 && d <= 31) colToDayMap[C] = d;
      }
    }

    for (const [colIdx, dayNum] of Object.entries(colToDayMap)) {
      const cellAddr = XLSX.utils.encode_cell({ r: targetRow, c: parseInt(colIdx, 10) });
      const cell = sheet[cellAddr];
      const dKey = makeDateKey(year, month, dayNum);

      let rawVal = cell && cell.v !== undefined ? String(cell.v).trim() : '';

      if (!rawVal && cell && cell.s) {
        const fg = cell.s.fgColor || cell.s.bgColor;
        if (fg) {
          const rgb = String(fg.rgb || fg.theme || '').toUpperCase();
          if (rgb.includes('FFC') || rgb.includes('FFB') || rgb.includes('FFA') || rgb.includes('PINK') || rgb.includes('F4C')) {
            rawVal = '휴가';
          }
        }
      }

      result[dKey] = parseKyuhoShiftRule(rawVal, dKey, holidays);
    }
  }
  return result;
}

/** 파일(ArrayBuffer) → { dateKey: myObj } */
export function parseKyuhoWorkbookData(data, XLSX, year, month, holidays = HOLIDAYS) {
  const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseKyuhoSheet(sheet, XLSX, year, month, holidays);
}
