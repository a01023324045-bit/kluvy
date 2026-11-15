// 등록 창의 '현재 파일' 표시용 순수 함수 (v2.5.2) — DOM·네트워크 없음
//
// 배경: state.fileHistory = { 'YYYY-MM': { kyuho: 파일명, yejin: 파일명 } } 는 '그 폰에서 마지막으로 올린 파일의 이름'만 기억한다.
//   · 파일명(KakaoTalk_20261115_223403.jpg …)은 의미가 없고, 폰마다 따로라 상대 폰에선 비어 있다.
//   · 사진이 지워졌거나 다른 달에 쌓인 이름이 그대로 남을 수 있다 (v2.5.1 까지 API 키가 없는 경로는 '선택한 달', 반영 경로는 '사진에서 읽은 달' 에 저장).
//   → 이름은 보조 글자로만 쓰고, 주 표시는 '2026년 12월 예진 스케줄' + 실제 사진 썸네일. 사진(규호는 근무 데이터)이 실제로 없는 달에는 이름을 보이지 않는다.

const WHO = {
  kyuho: { name: '규호', title: '근무표' },
  yejin: { name: '예진', title: '스케줄' }
};

/** 예전 main.js 가 기본값으로 넣던 가짜 이름 — 아무도 올린 적 없는 이름이라 정리 대상 */
export const LEGACY_SEED_HISTORY = Object.freeze({
  '2026-10': Object.freeze({ kyuho: '교대근무표 10월.xlsx', yejin: '2610.png' }),
  '2026-09': Object.freeze({ kyuho: '교대근무표 9월.xlsx', yejin: '2609.png' }),
  '2026-08': Object.freeze({ kyuho: '교대근무표 8월.xlsx', yejin: '2608.jpg' }),
  '2026-07': Object.freeze({ kyuho: '교대근무표 7월.xlsx', yejin: '2607.jpg' })
});

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isMonthKey = k => /^\d{4}-(0[1-9]|1[0-2])$/.test(k);

/** 파일명이 엑셀/CSV 인가 */
export function isExcelName(name) { return /\.(xlsx?|csv)$/i.test(String(name || '')); }

/** 사람·달 라벨: '2026년 12월 예진 스케줄' / '2026년 12월 규호 근무표' */
export function personMonthLabel(who, year, month) {
  const w = WHO[who];
  return `${year}년 ${month}월 ${w.name} ${w.title}`;
}

/**
 * 예전에 저장된 가짜 기본 이름(2610.png 등)과 모양이 이상한 항목을 걷어낸다 — 시작할 때 한 번.
 * 가짜 이름과 '정확히 같은' 값만 지운다(같은 달·같은 사람에 사용자가 직접 올린 다른 이름은 그대로).
 * @returns 새 객체 (입력은 바꾸지 않음)
 */
export function removeLegacySeedHistory(history) {
  const out = {};
  if (!isObj(history)) return out;
  for (const [k, entry] of Object.entries(history)) {
    if (!isMonthKey(k) || !isObj(entry)) continue;
    const seed = LEGACY_SEED_HISTORY[k];
    const e = {};
    for (const who of ['kyuho', 'yejin']) {
      const v = entry[who];
      if (typeof v !== 'string' || !v.trim()) continue;
      if (seed && seed[who] === v) continue;
      e[who] = v;
    }
    if (e.kyuho || e.yejin) out[k] = e;
  }
  return out;
}

/**
 * 실제 데이터와 맞는 이름만 남긴다 (등록 창을 열 때 / 비운 뒤).
 *  · 예진: 그 달 사진이 실제로 있을 때만 (photoKeys = 이 폰 IndexedDB 의 달 키 목록, 서버에서 받은 사진 포함)
 *  · 규호: 그 달에 규호 근무 칸이 하나라도 있을 때만 (monthHasKyuho(monthKey) → boolean)
 * @returns {{history:object, removed:Array<{monthKey,who,name}>}} 새 객체 (입력은 바꾸지 않음)
 */
export function pruneFileHistory(history, { photoKeys = [], monthHasKyuho = () => true } = {}) {
  const photos = new Set(photoKeys);
  const out = {};
  const removed = [];
  for (const [k, entry] of Object.entries(removeLegacySeedHistory(history))) {
    const e = {};
    if (entry.kyuho) { if (monthHasKyuho(k)) e.kyuho = entry.kyuho; else removed.push({ monthKey: k, who: 'kyuho', name: entry.kyuho }); }
    if (entry.yejin) { if (photos.has(k)) e.yejin = entry.yejin; else removed.push({ monthKey: k, who: 'yejin', name: entry.yejin }); }
    if (e.kyuho || e.yejin) out[k] = e;
  }
  return { history: out, removed };
}

/**
 * 등록 창의 한 칸(사람·달)에 보여 줄 내용.
 * @param {object} p
 * @param {'kyuho'|'yejin'} p.who
 * @param {number} p.year  @param {number} p.month
 * @param {string} [p.fileName]   fileHistory 에 기억된 이름 (없을 수 있음)
 * @param {boolean} p.hasPhoto    (예진) 그 달 사진이 실제로 있음
 * @param {boolean} p.hasData     (규호) 그 달에 규호 근무 칸이 있음
 * @returns {{empty:boolean, label:string, sub:string, kind:'photo'|'excel'|'image'|'data'|'none', emptyText:string}}
 *   sub = 파일명 (보조 글자, 없으면 ''), kind = 아이콘 종류 (photo: 썸네일 사용)
 */
export function describeCurrentFile({ who, year, month, fileName = '', hasPhoto = false, hasData = false }) {
  const label = personMonthLabel(who, year, month);
  if (who === 'yejin') {
    if (!hasPhoto) return { empty: true, label, sub: '', kind: 'none', emptyText: '등록된 사진 없음' };
    return { empty: false, label, sub: fileName || '', kind: 'photo', emptyText: '' };
  }
  // 규호: 엑셀이면 엑셀 아이콘, 사진으로 올렸으면 사진 아이콘 (규호 사진은 보관하지 않아 썸네일 없음).
  // 파일 이름을 모르는 달(다른 폰에서 올림·캐시 삭제)이면 종류를 알 수 없어 일반 '근무표' 아이콘 + 이름 줄 없음.
  const imageName = fileName && !isExcelName(fileName);
  if (!hasData) return { empty: true, label, sub: '', kind: 'none', emptyText: imageName ? '등록된 사진 없음' : '등록된 엑셀 없음' };
  return { empty: false, label, sub: fileName || '', kind: !fileName ? 'data' : imageName ? 'image' : 'excel', emptyText: '' };
}
