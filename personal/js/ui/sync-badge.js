// 상단 동기화 상태 배지
//   실시간 공유됨 (초록)   : 서버와 연결됨, 보낼 것 없음 (스트림, 또는 스트림이 안 될 때 30초 확인)
//   오프라인 대기 N건 (주황): 인터넷이 없거나 서버에 못 보낸 편집 N건 — 연결되면 자동 전송
//   오프라인 (주황)        : 비행기모드·서버에 못 닿음. 툴팁/읽기 글 「오프라인 · 마지막 동기화 11/15 17:42」 (v2.5.0)
//                            로그인 필요보다 먼저 판단 — 비행기모드에서 토큰 문제처럼 보이지 않게
//   로그인 필요 (빨강)     : 토큰 없음/거부 (cancel·401)
//   동기화 확인필요 (주황) : 그 밖의 오류
//   로컬 저장됨 (회색)     : DB 주소 없음
import { getConfiguredDbUrl } from '../config.js';
import { offlineStatusText } from '../offline.js';

// 3단계 디자인: 글자 11px 이상, 글자색 700~800(배경 50 대비 AA), 누르기 쉬운 높이
const BASE = 'sync-badge text-[11px] leading-none px-2 py-1.5 rounded-full font-semibold border cursor-pointer inline-flex items-center whitespace-nowrap';

/**
 * @param {{status:'live'|'pending'|'offline'|'login'|'error'|'local', pending?:number, mode?:string, lastSyncAt?:number|null, needLogin?:boolean}} s
 */
export function renderSyncBadge(s) {
  const badge = document.getElementById('syncStatusBadge');
  if (!badge) return;
  const pending = Number(s.pending) || 0;
  badge.dataset.syncStatus = s.status;
  badge.dataset.syncMode = s.mode || '';
  badge.dataset.pending = String(pending);
  badge.title = '';
  badge.removeAttribute('aria-label');
  if (s.status === 'login') {
    badge.className = `${BASE} bg-rose-50 text-rose-700 border-rose-300`;
    badge.innerHTML = '<i class="fa-solid fa-lock text-[10px] mr-1"></i>로그인 필요';
    if (pending > 0) badge.title = `서버에 못 보낸 편집 ${pending}건 — 로그인하면 전송됩니다`;
    return;
  }
  if (s.status === 'local' || !getConfiguredDbUrl()) {
    badge.className = `${BASE} bg-slate-100 text-slate-700 border-slate-300`;
    badge.innerText = '로컬 저장됨';
    return;
  }
  if (s.status === 'offline') {
    // 비행기모드·서버에 못 닿음: 이 폰에 저장된 근무표를 보여 주는 중. 시각은 마지막으로 성공한 동기화.
    const head = offlineStatusText(s.lastSyncAt);
    badge.className = `${BASE} bg-amber-50 text-amber-800 border-amber-300`;
    badge.innerHTML = '<i class="fa-solid fa-plane-circle-xmark text-[10px] mr-1 text-amber-600"></i>';
    badge.appendChild(document.createTextNode(pending > 0 ? `오프라인 대기 ${pending}건` : '오프라인'));
    badge.dataset.lastSyncAt = s.lastSyncAt ? String(s.lastSyncAt) : '';
    badge.title = [head,
      '이 폰에 저장된 근무표·사진을 보여 주는 중',
      pending > 0 ? `보낼 편집 ${pending}건은 연결되면 자동 전송` : '',
      s.needLogin ? '연결되면 로그인이 필요합니다' : ''].filter(Boolean).join(' · ');
    badge.setAttribute('aria-label', head + (pending > 0 ? ` · 대기 ${pending}건` : ''));
    return;
  }
  if (s.status === 'pending') {
    badge.className = `${BASE} bg-amber-50 text-amber-800 border-amber-300`;
    badge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-[10px] mr-1 text-amber-600"></i>';
    badge.appendChild(document.createTextNode(`오프라인 대기 ${pending}건`));
    badge.title = `서버에 못 보낸 편집 ${pending}건 — 연결되면 자동 전송`;
    return;
  }
  if (s.status === 'error') {
    badge.className = `${BASE} bg-amber-50 text-amber-800 border-amber-300`;
    badge.innerHTML = '<i class="fa-solid fa-circle text-[7px] mr-1 text-amber-500"></i>동기화 확인필요';
    return;
  }
  badge.className = `${BASE} bg-emerald-50 text-emerald-800 border-emerald-300`;
  badge.innerHTML = '<i class="fa-solid fa-circle text-[7px] mr-1 text-emerald-500 animate-pulse"></i>실시간 공유됨';
  badge.title = s.mode === 'poll' ? '실시간 연결이 안 돼 30초마다 확인 중' : '실시간 연결됨';
}

/** (1단계 호환) isSynced / needLogin 으로 부르던 곳용 */
export function updateSyncBadge(isSynced, needLogin = false) {
  renderSyncBadge({ status: needLogin ? 'login' : (isSynced ? 'live' : 'error') });
}
