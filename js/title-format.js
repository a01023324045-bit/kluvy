// v2.4.0 상세 카드(예진) 제목 압축 — 순수 함수 (DOM 없음, 테스트 대상)
//
// 사용자 제보(2026-11-14): '✈️ 시드니 (19:40 ~ 09:15) [도착 KST: (KR+1일 07:15)] [TW501]' 가 큰 글씨로 3줄 넘게 넘쳤다.
//  → 큰 글씨 1줄(main) + 작은 글씨 1줄(sub) 로 나눈다. 괄호·대괄호를 쓰지 않는다.
//     main  '✈️ 시드니 19:40→09:15 (+1일)'          (도시 · 시작→끝 · 끝이 다음 날이면 +1일)
//     sub   'TW501 · 현지 +2시간 · KR 07:15 도착'     (편명 요약 · 시차 · 한국시각)
//     여러 레그: 'TW721 외 1' · 'TW241 외 3'
// 한국시각은 달력 칸·미리보기와 같은 stayKstInfo() 하나를 쓴다 (칸은 'KR07:15' 짧은 꼴 그대로).
import { stayKstInfo, getKstDiffHours, kstDiffText, KST_UNKNOWN } from './timezone.js';
import { gfFlights, legsSummary } from './flight.js';

const HHMM = /^(\d{1,2}):(\d{2})$/;
const pad2 = v => String(v).padStart(2, '0');
function norm(t) {
  const m = HHMM.exec(String(t || '').trim());
  return m ? `${pad2(m[1])}:${m[2]}` : '';
}

/** '+1일' 꼬리표 ('(+1일)' · 0 이면 '') */
export function dayMark(n) {
  return n ? `(${n > 0 ? '+' : ''}${n}일)` : '';
}

/** 시차 짧은 꼴: '현지 +2시간' / '현지 -7시간' (한국과 같거나 미등록이면 '') */
export function diffShort(dest, dateKey) {
  const h = getKstDiffHours(dest, dateKey);
  if (h === null || h === 0) return '';
  const abs = Math.abs(h);
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return `현지 ${h > 0 ? '+' : '-'}${n}시간`;
}

/** 근무 시간(끝이 시작보다 이르면 끝은 다음 날) */
export function endsNextDay(start, end) {
  const a = norm(start), b = norm(end);
  return Boolean(a && b && b < a);
}

/**
 * 예진 근무 → 상세 카드 제목 조각 { main, sub, tip, kind }
 *  kind: 'times'(시작·끝이 있는 근무) | 'plain'(L/O·도착일·시각 없음·근무 없음)
 *  tip : 시차 긴 꼴 ('현지는 한국보다 2시간 빠름') — 툴팁·일반 줄용
 */
export function detailTitleParts(g, dateKey) {
  if (!g) return { main: '근무 없음', sub: '', tip: '', kind: 'plain' };
  const dest = g.destination || '';
  const stayish = (g.type === '체류' || g.isPureStay || g.isArrivalOnly) && !g.isQuickTurn;
  const tip = stayish && dest ? (kstDiffText(dest, dateKey) || '') : '';

  if (g.start && g.end) {
    const legs = gfFlights(g);
    const flight = legs.length ? legsSummary(legs) : (g.flight ? String(g.flight).replace(/\s+/g, ' ').trim() : '');
    const flightish = Boolean(dest);
    const wrap = flightish && endsNextDay(g.start, g.end) ? 1 : 0;
    const main = `${dest ? '✈️ ' + dest : g.type} ${norm(g.start) || g.start}${flightish ? '→' : '~'}${norm(g.end) || g.end}${wrap ? ' ' + dayMark(wrap) : ''}`;
    const parts = [];
    if (flight) parts.push(flight);
    if (stayish && dest) {
      const d = diffShort(dest, dateKey);
      if (d) parts.push(d);
    }
    const k = stayKstInfo(g, dateKey); // 달력 칸과 같은 함수
    if (k && k.status === 'ok') {
      const arrival = k.kind !== 'departure';
      // 한국 날짜가 근무 날짜와 다르면 꼬리표 (도착 시각의 +1일이 이미 제목 끝의 (+1일) 과 같으면 중복이라 생략)
      const extra = k.shift ? (arrival && k.shift === wrap ? 0 : k.shift) : 0;
      parts.push(`KR ${k.time}${extra ? ' ' + dayMark(extra) : ''} ${arrival ? '도착' : '출발'}`);
    } else if (k && k.status === 'unknown') {
      parts.push('KR ? 시간대 미등록');
    }
    return { main, sub: parts.join(' · '), tip, kind: 'times' };
  }

  // 시각 없는 날 (L/O·도착일·대기 등): 예전 문구 그대로, 시차는 작은 둘째 줄
  const main = g.isArrivalOnly ? `${dest} (도착일/체류)` : g.isPureStay ? `${dest} (L/O 체류)` : dest ? `${dest} (${g.type})` : `${g.type}`;
  let sub = '';
  if (tip && tip !== '한국과 같은 시각') sub = `🕒 현지는 ${tip}`;
  else if (stayish && dest && tip === '' && !getKstKnown(dest, dateKey)) sub = `🕒 ${dest}: 시간대 미등록 ${KST_UNKNOWN}`;
  return { main, sub, tip, kind: 'plain' };
}

function getKstKnown(dest, dateKey) {
  return getKstDiffHours(dest, dateKey) !== null;
}

/** 달력 칸 툴팁: '예진 제주 퀵턴 14:30~22:21 TW721 외 2' (v2.4.0: 3레그 이상은 짧게) */
export function cellTooltip(g, flightsShort) {
  if (!g || !g.type) return '';
  return `예진 ${g.destination ? g.destination + ' ' : ''}${g.type}${g.start ? ` ${g.start}~${g.end}` : ''}${flightsShort ? ` ${flightsShort}` : ''}`;
}
