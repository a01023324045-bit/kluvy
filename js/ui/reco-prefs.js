// 데이트 추천 설정 (활동 시간대·최소 길이) — 업로드 창 '데이트 추천 기준'
import { RECO_PREFS_KEY, RECO_DEFAULTS } from '../recommend-rules.js';
import { normalizePrefs } from '../recommend.js';
import { safeGetStorage, safeSetStorage } from '../storage.js';
import { renderAvailableDates } from '../render/calendar.js';

export function getRecoPrefs() {
  const p = normalizePrefs({ ...RECO_DEFAULTS, ...(safeGetStorage(RECO_PREFS_KEY, {}) || {}) });
  return { activeStart: p.activeStart, activeEnd: p.activeEnd, minHours: p.minHours };
}

export function fillRecoPrefsUI() {
  const p = getRecoPrefs();
  const s = document.getElementById('recoActiveStart');
  const e = document.getElementById('recoActiveEnd');
  const h = document.getElementById('recoMinHours');
  if (s) s.value = p.activeStart;
  if (e) e.value = p.activeEnd;
  if (h) h.value = String(p.minHours);
}

export function onRecoPrefsChanged() {
  const s = document.getElementById('recoActiveStart');
  const e = document.getElementById('recoActiveEnd');
  const h = document.getElementById('recoMinHours');
  const p = normalizePrefs({ activeStart: s && s.value, activeEnd: e && e.value, minHours: h && h.value });
  safeSetStorage(RECO_PREFS_KEY, { activeStart: p.activeStart, activeEnd: p.activeEnd, minHours: p.minHours });
  fillRecoPrefsUI();
  renderAvailableDates();
}
