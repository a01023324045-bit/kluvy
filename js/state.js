// 앱의 가변 상태 한 곳 모음. (운영본의 전역 let 변수들)
import { getKSTDate, makeDateKey } from './dates.js';

const kstNow = getKSTDate();

export const state = {
  currentYear: kstNow.getFullYear(),
  currentMonth: kstNow.getMonth() + 1,
  selectedDateKey: makeDateKey(kstNow.getFullYear(), kstNow.getMonth() + 1, kstNow.getDate()),

  uploadTargetYear: kstNow.getFullYear(),
  uploadTargetMonth: kstNow.getMonth() + 1,

  showKyuho: true,
  showYejin: true,
  currentEditMode: 'single',
  currentImgScale: 1.0,

  /** { 'YYYY-MM-DD': { my, gf, date, myPromise, gfPromise } } */
  scheduleDB: {},
  /** { 'YYYY-MM': { kyuho, yejin } } */
  fileHistory: {},
  /** [{ name, date, isRepeat }] */
  customAnniversaries: []
};
