// 편명 다시 읽기 (v2.5.1) — 순수 함수, DOM·네트워크 없음
//   같은 사진에 '편명만' 다시 물어(parsers/gemini-yejin.js recognizeYejinFlights) 받은 결과를
//   이미 등록된 근무 칸에 합친다. 근무 종류·시각·장소·L/O·TRAIN 은 건드리지 않고 gf.flight / gf.flights 만 채운다.
//
//  합치기 규칙
//   - 편명이 비어 있는 비행 근무(퀵턴·체류)만 채운다. 이미 편명이 있는 날은 그대로(덮어쓰지 않음).
//   - 시각이 비어 있는 칸(예: 사진에서 '청주 (체류)'로만 읽힌 12/10)은 같은 칸 글자에서 읽은 시각도 함께 채운다. 이미 있는 시각·종류·장소는 그대로.
//   - ✋ 수동 입력(manual) 칸은 편명이 비어 있어도 건드리지 않는다.
//   - 근무 칸이 없는 날, OFF·대기·TR·L/O 만 있는 날·도착일은 건드리지 않는다.
import { annotateYejinMonth, mapGeminiItemDetailed, pruneAdjacentMonthItems } from './parsers/gemini-yejin.js';
import { gfFlights } from './flight.js';
import { isManual } from './schedule-model.js';
import { makeDateKey } from './dates.js';
import { isFlightDuty, isThinStay } from './flight-stats.js';

/**
 * 편명 전용 인식 결과 → 날짜별 편명
 *  칸 글자(cellText)가 있으면 본 인식과 같은 파서(날짜 넘김·L/O·TRAIN 구분 포함)로 다시 뽑고, 없으면 flights·flight 를 쓴다.
 * @param {object} parsed  { year, month, schedule:[{day, cellText?, flights?, flight?, flightCount?}] }
 * @returns {{ year:number, month:number, mismatch:string, days:{dateKey:string, day:number, flight:string, flights:object[]|null, legs:string[], warnings:string[]}[] }}
 *   mismatch: 사진에서 읽은 연·월이 요청한 달과 다르면 그 설명(이때는 합치면 안 됨), 아니면 ''
 */
export function flightsFromReread(parsed, year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  // 본 인식과 같은 파서·같은 정리: 흐린 이전·다음 달 칸 버림, 한 칸 여러 쌍·L/O·날짜 넘김 처리
  const arr = pruneAdjacentMonthItems(Array.isArray(parsed && parsed.schedule) ? parsed.schedule : (Array.isArray(parsed && parsed.days) ? parsed.days : []), lastDay);
  const py = Number(parsed && parsed.year);
  const pm = Number(parsed && parsed.month);
  let mismatch = '';
  if (pm >= 1 && pm <= 12 && pm !== month) mismatch = `사진에서 읽은 달(${Number.isFinite(py) && py ? `${py}년 ` : ''}${pm}월)이 ${month}월과 다릅니다`;
  else if (py >= 2025 && py <= 2040 && py !== year) mismatch = `사진에서 읽은 해(${py}년)가 ${year}년과 다릅니다`;
  const ann = annotateYejinMonth(arr);
  const byDay = new Map();
  for (const item of arr) {
    const d = Number(item && item.day);
    if (!d || d < 1 || d > lastDay) continue;
    // 종류는 묻지 않은 호출이라 편명 추출용으로 퀵턴으로 본다 (cellText 가 OFF·대기면 편명 없음으로 나옴)
    const r = mapGeminiItemDetailed({ ...item, type: '퀵턴' }, ann.has(d) ? { blocks: ann.get(d) } : undefined);
    const v = r && r.value;
    const legs = v ? gfFlights(v).map(l => l.iata) : [];
    if (!legs.length) continue;
    byDay.set(d, { dateKey: makeDateKey(year, month, d), day: d, flight: v.flight, flights: v.flights || null, legs, start: v.start || '', end: v.end || '', warnings: r.warnings || [] });
  }
  return { year, month, mismatch, days: [...byDay.values()].sort((a, b) => a.day - b.day) };
}

/**
 * 읽은 편명을 db(scheduleDB)의 예진 칸(gf)에 합친다 (db 를 직접 바꿈 — 되돌리기 기록은 호출하는 쪽이 captureBefore/diffEntries 로).
 * @returns {{ filled:string[], keptExisting:string[], manual:string[], noCell:string[], notFlightDay:string[] }} 날짜(dateKey) 목록
 */
export function mergeRereadFlights(db, days) {
  const out = { filled: [], keptExisting: [], manual: [], noCell: [], notFlightDay: [] };
  for (const x of days || []) {
    const day = db && db[x.dateKey];
    const gf = day && day.gf;
    if (!gf || typeof gf !== 'object' || !String(gf.type || '').trim() || gf.type === '-') { out.noCell.push(x.dateKey); continue; }
    if (isManual(gf)) { out.manual.push(x.dateKey); continue; }
    if (!isFlightDuty(gf)) { out.notFlightDay.push(x.dateKey); continue; }
    if (gfFlights(gf).length) { out.keptExisting.push(x.dateKey); continue; }
    const thin = isThinStay(gf);
    gf.flight = x.flight;
    if (x.flights) gf.flights = x.flights; else delete gf.flights;
    // 시각이 비어 있으면(사진에서 '체류'로만 읽힌 칸 등) 같은 칸 글자에서 읽은 시각으로 채운다 — 이미 있는 시각은 건드리지 않음
    if (!gf.start && !gf.end && x.start && x.end) { gf.start = x.start; gf.end = x.end; }
    if (thin) gf.isPureStay = false; // 편명이 생겼으니 L/O 만 있는 날이 아님
    out.filled.push(x.dateKey);
  }
  return out;
}
