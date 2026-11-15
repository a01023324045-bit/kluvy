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
  /** v2.5.2: 기념일 표시 (끄면 달력 칸·상세 카드·캡처에서 숨김, 기념일 데이터는 그대로). 이 폰 localStorage 에 저장 */
  showAnniversary: true,
  currentEditMode: 'single',
  currentImgScale: 1.0,

  /** { 'YYYY-MM-DD': { my, gf, date, myPromise, gfPromise } } */
  scheduleDB: {},
  /** { 'YYYY-MM': { kyuho, yejin } } */
  fileHistory: {},
  /** [{ name, date, isRepeat }] */
  customAnniversaries: []
};
