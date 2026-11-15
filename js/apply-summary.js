// 업로드 '바로 반영' 결과 요약 (v2.4.6) — 순수 함수, DOM 없음
//   ✅ 11월 30일 반영했습니다 (수동 입력 3일은 그대로) · ⚠️ 시간대 미등록: 로마 (KR ?)
// 반영 직후 화면 아래 바에 한 줄로 보이고, '자세히'를 누르면 details 가 펼쳐진다.
import { stayKstInfo } from './timezone.js';

const md = key => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const uniq = a => [...new Set(a)];
const rowKey = r => `${r.dateKey}|${r.who}`;

/**
 * 반영한 행들에서 경고를 모은다.
 * @returns {{ truncated: string[], unknownCities: string[], other: {dateKey:string,text:string}[] }}
 *   truncated: 편명이 많아 잘린 날짜 / unknownCities: 시간대 미등록(KR ?) 도시 / other: 그 밖의 행 경고
 */
export function collectApplyNotes(finalRows, planned = []) {
  const truncated = [];
  const unknownCities = [];
  const other = [];
  const byKey = new Map(planned.map(r => [rowKey(r), r]));
  for (const r of finalRows || []) {
    if (r.who !== 'gf') continue;
    const src = byKey.get(rowKey(r)) || r;
    for (const w of (src.warnings || [])) {
      if (/개 중 앞 \d+개만 저장/.test(w)) truncated.push(r.dateKey);
      else other.push({ dateKey: r.dateKey, text: w });
    }
    let k = null;
    try { k = stayKstInfo(r.value, r.dateKey); } catch (e) { k = null; }
    if (k && k.status === 'unknown') unknownCities.push(String(k.dest || (r.value && r.value.flight) || '(도시 없음)'));
  }
  return { truncated: uniq(truncated), unknownCities: uniq(unknownCities), other };
}

/**
 * 반영 요약.
 * @param {object} p
 * @param {{dateKey:string,who:string}[]} p.entries   실제로 바뀐 칸 (upload-undo.diffEntries)
 * @param {object[]} p.planned                         planUploadRows 결과 (상태 포함)
 * @param {object[]} p.finalRows                       실제로 반영한 행
 * @param {{short:string,long:string}[]} [p.warns]     인식 경고 (사진에서 못 찾음·달 다름 …)
 * @param {{short:string,long:string}[]} [p.fails]     인식 실패
 * @returns {{ text:string, tone:'ok'|'warn'|'info', details:string[], days:number }}
 */
export function buildApplySummary({ entries = [], planned = [], finalRows = [], warns = [], fails = [] }) {
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
  for (const d of notes.truncated) details.push(`⚠️ ${md(d)} 편명이 5개 이상이라 앞 4개만 저장했습니다 — 날짜를 눌러 [수정]에서 확인하세요.`);
  for (const c of notes.unknownCities) details.push(`⚠️ '${c}' 시간대가 등록되어 있지 않아 한국시각을 계산하지 못했습니다 (KR ?).`);
  for (const o of notes.other) details.push(`⚠️ ${md(o.dateKey)} ${o.text}`);
  if (manualDays.length) details.push(`✋ 수동 입력 유지: ${manualDays.map(md).join(', ')}`);
  if (blankDays.length) details.push(`빈칸이라 기존 값 유지: ${blankDays.map(md).join(', ')}`);

  return { text: parts.join(' · '), tone: tags.length ? 'warn' : (days.length ? 'ok' : 'info'), details, days: days.length };
}
