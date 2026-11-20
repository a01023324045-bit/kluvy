// 기념일·D-Day 계산
import { BASE_LOVE_DATE } from './config.js';
import { LAYOUT } from './app-mode.js';
import { getDiffDays, parseDateKey } from './dates.js';

export function getAnniversaryInfo(dateStr, customAnniversaries) {
  const targetDate = parseDateKey(dateStr);
  // 만난 날 기준 100일·주년 자동 기념일은 커플 모드만 (v2.6.0 개인 모드는 사용자가 추가한 기념일만)
  if (LAYOUT.autoAnniversaries) {
    const diff = getDiffDays(BASE_LOVE_DATE, targetDate);
    if (diff > 0 && diff % 100 === 0) return { type: "100일", name: `💖 ${diff}일` };
    if (targetDate.getMonth() === BASE_LOVE_DATE.getMonth() && targetDate.getDate() === BASE_LOVE_DATE.getDate()) {
      const years = targetDate.getFullYear() - BASE_LOVE_DATE.getFullYear();
      if (years > 0) return { type: "주년", name: `💍 ${years}주년` };
    }
  }

  const tM = String(targetDate.getMonth() + 1).padStart(2, '0');
  const tD = String(targetDate.getDate()).padStart(2, '0');
  const mmdd = `${tM}-${tD}`;

  for (const aniv of customAnniversaries) {
    if (aniv.isRepeat && aniv.date.endsWith(mmdd)) return { type: "생일/반복", name: `🎂 ${aniv.name}` };
    if (!aniv.isRepeat && aniv.date === dateStr) return { type: "지정", name: `⭐ ${aniv.name}` };
  }
  return null;
}
