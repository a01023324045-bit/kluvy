// 데이터 백업(JSON) 만들기 / 검사 — 순수 함수 (UI 는 ui/backup-ui.js)

export const BACKUP_FORMAT = 'kluvy-backup';
export const BACKUP_VERSION = 1;

/** 현재 상태 → 백업 객체 */
export function buildBackup({ scheduleDB, customAnniversaries, fileHistory }, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    schedules: scheduleDB || {},
    anniversaries: Array.isArray(customAnniversaries) ? customAnniversaries : [],
    fileHistory: fileHistory || {}
  };
}

/** 파일명: KLUVY_백업_20261113_1405.json (폰 현지 시각) */
export function backupFileName(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `KLUVY_백업_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.json`;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 백업 파일 텍스트 검사.
 * @returns {{ok:true, data:{schedules, anniversaries, fileHistory}, summary:{days:number, anniversaries:number, exportedAt:string}} | {ok:false, error:string}}
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'JSON 파일이 아닙니다.' };
  }
  if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'KLUVY 백업 파일이 아닙니다.' };
  }
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    return { ok: false, error: '이 앱보다 새 버전에서 만든 백업이라 복원할 수 없습니다. 앱을 먼저 업데이트하세요.' };
  }
  const schedules = obj.schedules;
  if (!schedules || typeof schedules !== 'object' || Array.isArray(schedules)) {
    return { ok: false, error: '백업에 근무표(schedules)가 없습니다.' };
  }
  const badKey = Object.keys(schedules).find(k => !DATE_KEY_RE.test(k) || typeof schedules[k] !== 'object' || schedules[k] === null);
  if (badKey !== undefined) {
    return { ok: false, error: `근무표 형식이 올바르지 않습니다: ${badKey}` };
  }
  const anniversaries = Array.isArray(obj.anniversaries) ? obj.anniversaries.filter(a => a && typeof a.name === 'string' && typeof a.date === 'string') : [];
  const fileHistory = (obj.fileHistory && typeof obj.fileHistory === 'object' && !Array.isArray(obj.fileHistory)) ? obj.fileHistory : {};
  return {
    ok: true,
    data: { schedules, anniversaries, fileHistory },
    summary: { days: Object.keys(schedules).length, anniversaries: anniversaries.length, exportedAt: String(obj.exportedAt || '') }
  };
}
