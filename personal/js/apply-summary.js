// 업로드 '바로 반영' 결과 요약 (v2.4.6) — 순수 함수, DOM 없음
//   ✅ 11월 30일 반영했습니다 (수동 입력 3일은 그대로) · ⚠️ 시간대 미등록: 로마 (KR ?)
// 반영 직후 화면 아래 바에 한 줄로 보이고, '자세히'를 누르면 details 가 펼쳐진다.
import { stayKstInfo } from './timezone.js';
import { flightStatsText, flightStatsDetails, needsFlightReread } from './flight-stats.js';
import { NO_FLIGHT_WARN } from './parsers/gemini-yejin.js';

const md = key => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const uniq = a => [...new Set(a)];
const rowKey = r => `${r.dateKey}|${r.who}`;

/**
 * 반영한 행들에서 경고를 모은다.
 * @returns {{ truncated: string[], unknownCities: string[], other: {dateKey:string,text:string}[], noFlight: {dateKey:string,text:string}[] }}
 *   truncated: 편명이 많아 잘린 날짜 / unknownCities: 시간대 미등록(KR ?) 도시 / other: 그 밖의 행 경고
 *   noFlight (v2.5.1): '편명을 찾지 못함' 경고(이유 포함) — 요약의 편명 통계 줄과 [자세히]에서 따로 보여 준다
 */
export function collectApplyNotes(finalRows, planned = []) {
  const truncated = [];
  const unknownCities = [];
  const other = [];
  const noFlight = [];
  const byKey = new Map(planned.map(r => [rowKey(r), r]));
  for (const r of finalRows || []) {
    if (r.who !== 'gf') continue;
    const src = byKey.get(rowKey(r)) || r;
    for (const w of (src.warnings || [])) {
      if (/개 중 앞 \d+개만 저장/.test(w)) truncated.push(r.dateKey);
      else if (w.startsWith(NO_FLIGHT_WARN)) noFlight.push({ dateKey: r.dateKey, text: w });
      else other.push({ dateKey: r.dateKey, text: w });
    }
    let k = null;
    try { k = stayKstInfo(r.value, r.dateKey); } catch (e) { k = null; }
    if (k && k.status === 'unknown') unknownCities.push(String(k.dest || (r.value && r.value.flight) || '(도시 없음)'));
  }
  return { truncated: uniq(truncated), unknownCities: uniq(unknownCities), other, noFlight };
}

/**
 * 반영 요약.
 * @param {object} p
 * @param {{dateKey:string,who:string}[]} p.entries   실제로 바뀐 칸 (upload-undo.diffEntries)
 * @param {object[]} p.planned                         planUploadRows 결과 (상태 포함)
 * @param {object[]} p.finalRows                       실제로 반영한 행
 * @param {{short:string,long:string}[]} [p.warns]     인식 경고 (사진에서 못 찾음·달 다름 …)
 * @param {{short:string,long:string}[]} [p.fails]     인식 실패
 * @param {object|null} [p.flightStats]                flight-stats.flightStatsForMonth 결과 (예진 사진을 읽었을 때만) — v2.5.1
 * @returns {{ text:string, tone:'ok'|'warn'|'info', details:string[], days:number, needsReread:boolean }}
 *   needsReread: 편명 없는 비행일이 있어 [편명 다시 읽기] 를 보여야 함
 */
export function buildApplySummary({ entries = [], planned = [], finalRows = [], warns = [], fails = [], flightStats = null }) {
  const applied = new Set(finalRows.map(rowKey));
  const skipped = status => planned.filter(r => r.status === status && !applied.has(rowKey(r)));
  const manualDays = uniq(skipped('manual').map(r => r.dateKey)).sort();
  const blankDays = uniq(skipped('blank-keep').map(r => r.dateKey)).sort();
  const days = uniq(entries.map(e => e.dateKey)).sort();
  const months = uniq(days.map(k => Number(k.slice(5, 7))));
  const notes = collectApplyNotes(finalRows, planned);

  const keep = [];
  if (manualDays.length) keep.push(`수동 입력 ${manualDays.length}일은 그대로`);
  if (blankDays.length) keep.push(`빈칸 ${blankDays.length}일은 기존 값 유지`);

  const parts = [];
  let head;
  if (days.length) head = `✅ ${months.length === 1 ? `${months[0]}월 ` : ''}${days.length}일 반영했습니다${keep.length ? ` (${keep.join(', ')})` : ''}`;
  else if (fails.length || warns.length) head = `⚠️ 반영한 내용이 없습니다${keep.length ? ` (${keep.join(', ')})` : ''}`;
  else head = `ℹ️ 바뀐 날이 없습니다 — 이미 같은 내용${keep.length ? ` (${keep.join(', ')})` : ''}`;
  parts.push(head);

  // v2.5.1: 편명 통계 (편명이 비는 문제를 눈에 보이게)
  const statText = flightStatsText(flightStats);
  const reread = needsFlightReread(flightStats);
  if (statText) parts.push(statText);

  const tags = [];
  for (const f of fails) tags.push(f.short);
  for (const w of warns) tags.push(w.short);
  if (notes.truncated.length) tags.push(`편명 5개 초과로 앞 4개만 저장 ${notes.truncated.length}일`);
  if (notes.unknownCities.length) tags.push(`시간대 미등록: ${notes.unknownCities.join(', ')} (KR ?)`);
  if (notes.other.length) tags.push(`확인 필요 ${uniq(notes.other.map(o => o.dateKey)).length}일`);
  for (const t of tags) parts.push(`⚠️ ${t}`);

  const details = [];
  for (const f of fails) details.push(`⚠️ ${f.long}`);
  for (const w of warns) details.push(`⚠️ ${w.long}`);
  if (reread) details.push(`⚠️ 편명 없는 비행일이 ${flightStats.missingDays.length}일 있습니다 — [편명 다시 읽기]로 같은 사진에서 편명만 다시 읽거나, 날짜를 눌러 [수정]에서 직접 넣으세요. 시간·종류는 바뀌지 않습니다.`);
  for (const n of notes.noFlight) details.push(`⚠️ ${md(n.dateKey)} ${n.text}`);
  for (const d of notes.truncated) details.push(`⚠️ ${md(d)} 편명이 5개 이상이라 앞 4개만 저장했습니다 — 날짜를 눌러 [수정]에서 확인하세요.`);
  for (const c of notes.unknownCities) details.push(`⚠️ '${c}' 시간대가 등록되어 있지 않아 한국시각을 계산하지 못했습니다 (KR ?).`);
  for (const o of notes.other) details.push(`⚠️ ${md(o.dateKey)} ${o.text}`);
  if (manualDays.length) details.push(`✋ 수동 입력 유지: ${manualDays.map(md).join(', ')}`);
  if (blankDays.length) details.push(`빈칸이라 기존 값 유지: ${blankDays.map(md).join(', ')}`);
  details.push(...flightStatsDetails(flightStats)); // 날짜별 편명은 맨 끝 (31줄까지 길어질 수 있음)

  return { text: parts.join(' · '), tone: tags.length || reread ? 'warn' : (days.length ? 'ok' : 'info'), details, days: days.length, needsReread: reread };
}

/**
 * v2.5.1: [편명 다시 읽기] 결과 요약.
 * @param {object} p
 * @param {number} p.month                                       대상 달
 * @param {{filled:string[], keptExisting:string[], manual:string[], noCell:string[], notFlightDay:string[]}} p.merge  mergeRereadFlights 결과
 * @param {number} p.readDays                                    AI 가 편명을 돌려준 날 수
 * @param {object|null} p.flightStats                            합친 뒤의 이 달 통계
 * @param {Record<string,string>} [p.readText]                   날짜 → 읽은 편명 글 (자세히용)
 * @param {string} [p.modelInfo]
 */
export function buildRereadSummary({ month, merge, readDays, flightStats, readText = {}, modelInfo = '' }) {
  const filled = merge.filled;
  const reread = needsFlightReread(flightStats);
  const statText = flightStatsText(flightStats);
  const keep = [];
  if (merge.manual.length) keep.push(`수동 입력 ${merge.manual.length}일은 그대로`);
  let head;
  let tone;
  if (!readDays) { head = `⚠️ ${month}월 사진에서 편명을 읽지 못했습니다 (AI 가 편명이 있는 날을 하나도 돌려주지 않음)`; tone = 'warn'; }
  else if (!filled.length) { head = `⚠️ ${month}월 빈 편명을 채우지 못했습니다 (읽은 ${readDays}일은 이미 편명이 있거나 수동 입력·근무 칸 없음)`; tone = 'warn'; }
  else { head = `✅ ${month}월 편명 ${filled.length}일을 채웠습니다${keep.length ? ` (${keep.join(', ')})` : ''}`; tone = reread ? 'warn' : 'ok'; }
  const parts = [head];
  if (statText) parts.push(statText);

  const details = [];
  if (modelInfo) details.push(modelInfo);
  for (const k of filled) details.push(`✈️ ${md(k)} ${readText[k] || ''} 채움`.trim());
  if (merge.manual.length) details.push(`✋ 수동 입력이라 건드리지 않음: ${merge.manual.map(md).join(', ')}`);
  if (merge.keptExisting.length) details.push(`이미 편명이 있어 그대로: ${merge.keptExisting.map(md).join(', ')}`);
  if (merge.noCell.length) details.push(`근무 칸이 없어 건너뜀: ${merge.noCell.map(md).join(', ')}`);
  if (merge.notFlightDay.length) details.push(`비행 근무가 아니라 건너뜀(OFF·대기·L/O 등): ${merge.notFlightDay.map(md).join(', ')}`);
  if (reread && flightStats) details.push(`⚠️ 아직 편명이 없는 비행일: ${flightStats.missingDays.map(md).join(', ')} — 날짜를 눌러 [수정]에서 직접 넣을 수 있습니다.`);
  details.push(...flightStatsDetails(flightStats));
  return { text: parts.join(' · '), tone, details, needsReread: reread };
}

/** [편명 다시 읽기] 실패 요약 — 이유를 그대로 보여 준다 */
export function buildRereadFailure(month, reason) {
  return { text: `⚠️ ${month}월 편명 다시 읽기 실패 — ${reason}`, tone: 'warn', details: [`이유: ${reason}`, '반영된 근무는 바뀌지 않았습니다. 원인을 해결한 뒤 [편명 다시 읽기]를 다시 누르세요.'] };
}
