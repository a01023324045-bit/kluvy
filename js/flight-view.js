// v2.3.1 비행 상자에 보일 '시각 고르기·AirLabs 문구' — 순수 함수 (DOM·네트워크 없음, 테스트 대상)
//
// 사용자 제보(2026-11-14): "TW721 은 15:40 이륙~16:55 착륙인데 AirLabs 는 14:15~15:30 으로 나온다"
//  → 조사: TW721(김포→제주, 화·목·토)의 공시 정기시각이 14:15→15:30 이고, 그날은 1시간 25분 지연(예상 15:40)이었다.
//    AirLabs 는 '정기(예정)' 시각을 준 것이고 틀린 값이 아니었지만, 앱이 정기/예상/실제를 구분하지 않아 실제 시각처럼 보였다.
// 원칙
//  1. 사용자가 직접 넣은 편 시각(편집창, source:'manual') > 근무표의 체류 비행 시각 > AirLabs 실제 > AirLabs 예상
//     > 편명 시간표(근무표에서 학습·직접 입력) > AirLabs 정기(예정)·정기 노선.  정기 시각을 '실제'처럼 단정하지 않는다.
//  2. AirLabs 값은 라벨(정기·예상·실제·지연)과 운항 날짜·구간을 붙여 '참고'로 짧게(요약 한 줄 + 운항 한 줄) 보여 준다.
//  3. 정기 노선의 운항 요일에 그 날짜 요일이 없으면 ⚠️, AirLabs 구간이 근무표 구간과 다르면 ⚠️.
//  4. 무료 플랜은 예상·실제·지연이 비어 있을 수 있음 → 한 줄로 알려 줌. 안내 문구는 모두 한 줄 이내(사용자 요청).
import { sourceLabel } from './flight.js';
import { daysKo, dateWithDow, pickRouteVariant, statusKo } from './airlabs.js';

export const SCHEDULED_NOTE = '※ 정기 시각은 실제와 다를 수 있음(AirLabs)';
export const FREE_PLAN_NOTE = '※ 예상·실제 없음(무료 플랜일 수 있음)';

function delayText(min, side) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return '';
  const m = Number(min);
  if (m === 0) return `${side} 정시`;
  return m > 0 ? `${side} ${m}분 지연` : `${side} ${-m}분 일찍`;
}

/** 지연 문구: '출발 85분 지연' (도착 지연이 출발과 다를 때만 '· 도착 N분 지연') */
export function delaysText(live) {
  if (!live) return '';
  const d = delayText(live.depDelay, '출발');
  const a = live.arrDelay !== live.depDelay ? delayText(live.arrDelay, '도착') : '';
  return [d, a].filter(Boolean).join(' · ');
}

/** 실시간 결과에 예상·실제 값이 하나라도 있나 */
export function hasLiveTimes(live) {
  return Boolean(live && (live.etd || live.eta || live.atd || live.ata));
}

/**
 * 한 편(leg)의 화면 표시용 이륙·착륙 시각을 고른다.
 * @param {{leg:object, gf:object, entry:object|null, dateKey:string, legCount:number}} p
 * @returns {null | { kind:'manual'|'roster'|'timetable'|'actual'|'estimated'|'scheduled', label:string,
 *                    std:string, sta:string, depTag:string, arrTag:string, isAirlabs:boolean }}
 *   depTag/arrTag: 시각 옆 꼬리표('실제'·'예상'·'정기' 등, 사용자 입력이면 '')
 */
export function pickLegTimes({ leg, gf, entry, dateKey, legCount = 1 }) {
  if (!leg) return null;
  const g = gf || {};
  if (leg.source === 'manual' && (leg.std || leg.sta)) {
    return { kind: 'manual', label: '직접 입력', std: leg.std || '', sta: leg.sta || '', depTag: '', arrTag: '', depLabel: '이륙', isAirlabs: false };
  }
  const quick = g.isQuickTurn || g.type === '퀵턴';
  if (legCount === 1 && !quick && !g.isPureStay && !g.isArrivalOnly && g.start && g.end && leg.dep && leg.arr) {
    const fromTable = g.timesFrom === 'flightTimes';
    // 예진 근무표의 두 시각은 '공항 집합 ~ 착륙'이다(2026-11-14 사용자 확인). 시간표가 근무표에서 배운 값이면 첫 시각도 집합.
    const tableFromRoster = fromTable && (!entry || entry.source === 'schedule');
    return { kind: fromTable ? 'timetable' : 'roster', label: fromTable ? `편명 시간표 (${sourceLabel(entry && entry.source)})` : '근무표', std: g.start, sta: g.end, depTag: '', arrTag: '', depLabel: (fromTable && !tableFromRoster) ? '이륙' : '집합', isAirlabs: false };
  }
  const live = entry && entry.days && entry.days[dateKey];
  if (live && (live.atd || live.ata || live.etd || live.eta)) {
    const pick = (a, e, s) => (a ? [a, '실제'] : e ? [e, '예상'] : s ? [s, '정기'] : ['', '']);
    const [std, depTag] = pick(live.atd, live.etd, live.std);
    const [sta, arrTag] = pick(live.ata, live.eta, live.sta);
    const actual = Boolean(live.atd || live.ata);
    return { kind: actual ? 'actual' : 'estimated', label: `AirLabs ${actual ? '실제' : '예상'} 시각${delaysText(live) ? ` · ${delaysText(live)}` : ''}`, std, sta, depTag, arrTag, depLabel: '이륙', isAirlabs: true };
  }
  const sameRoute = e => !e.dep || !leg.dep || e.dep === leg.dep;
  if (entry && (entry.std || entry.sta) && entry.source !== 'airlabs' && sameRoute(entry)) {
    return { kind: 'timetable', label: `편명 시간표 (${sourceLabel(entry.source)})`, std: entry.std || '', sta: entry.sta || '', depTag: '', arrTag: '', depLabel: entry.source === 'schedule' ? '집합' : '이륙', isAirlabs: false };
  }
  if (live && (live.std || live.sta)) {
    return { kind: 'scheduled', label: 'AirLabs 정기 시각', std: live.std || '', sta: live.sta || '', depTag: '정기', arrTag: '정기', depLabel: '이륙', isAirlabs: true };
  }
  const route = entry && entry.airlabs ? pickRouteVariant(entry.airlabs, dateKey) : null;
  if (route && (route.std || route.sta) && sameRoute(route)) {
    return { kind: 'scheduled', label: 'AirLabs 정기 노선', std: route.std, sta: route.sta, depTag: '정기', arrTag: '정기', depLabel: '이륙', isAirlabs: true };
  }
  if (entry && (entry.std || entry.sta) && sameRoute(entry)) {
    return { kind: 'scheduled', label: 'AirLabs 정기 시각', std: entry.std || '', sta: entry.sta || '', depTag: '정기', arrTag: '정기', depLabel: '이륙', isAirlabs: true };
  }
  return null;
}

/**
 * AirLabs '참고' 문구 (캐시된 실시간·정기 노선) → { summary, live:boolean, lines:[{text, kind?}], warns:[], notes:[] } | null
 *  summary 예) '정기 14:15 → 15:30 (화·목·토) · 2026-11-14(토) 예상 15:40 → 16:55 (출발 85분 지연)'
 */
export function airlabsReference({ leg, entry, dateKey }) {
  if (!entry) return null;
  const live = entry.days && entry.days[dateKey];
  const route = entry.airlabs && (entry.airlabs.std || entry.airlabs.sta || (entry.airlabs.variants || []).length) ? pickRouteVariant(entry.airlabs, dateKey) : null;
  if (!live && !route) return null;
  const lines = [];
  const warns = [];
  const notes = [];
  const parts = [];
  const days = route && route.days.length ? ` (${daysKo(route.days)})` : '';
  const schedStd = live ? live.std : route.std;
  const schedSta = live ? live.sta : route.sta;
  if (schedStd || schedSta) parts.push(`정기 ${schedStd || '-'} → ${schedSta || '-'}${days}`);
  if (live) {
    const day = dateWithDow(live.depDate || dateKey);
    const dl = delaysText(live);
    if (live.atd || live.ata) parts.push(`${day} 실제 ${live.atd || '-'} → ${live.ata || '-'}${dl ? ` (${dl})` : ''}`);
    else if (live.etd || live.eta) parts.push(`${day} 예상 ${live.etd || '-'} → ${live.eta || '-'}${dl ? ` (${dl})` : ''}`);
    else parts.push(`${day} 예상·실제 없음`);
  }
  const summary = parts.join(' · ');

  // 운항 날짜·구간·상태 한 줄 (요약에 실제가 나오면 예상도 한 줄)
  if (live) {
    const r = live.dep && live.arr ? ` · ${live.dep}→${live.arr}` : '';
    lines.push({ text: `운항 ${dateWithDow(live.depDate || dateKey)}${r}${live.status ? ` · ${statusKo(live.status)}` : ''}` });
    if ((live.atd || live.ata) && (live.etd || live.eta)) lines.push({ text: `예상 ${live.etd || '-'} → ${live.eta || '-'}`, kind: 'estimated' });
    if (!hasLiveTimes(live)) notes.push(live.depDelay ? `※ 지연 ${live.depDelay}분(예상·실제 시각 없음)` : FREE_PLAN_NOTE);
    if (leg && leg.dep && leg.arr && live.dep && live.arr && (live.dep !== leg.dep || live.arr !== leg.arr)) {
      warns.push(`⚠️ AirLabs 구간 ${live.dep}→${live.arr} ≠ 근무표 ${leg.dep}→${leg.arr}`);
    }
  } else if (route) {
    if (route.dep && route.arr) lines.push({ text: `정기 노선 ${route.dep}→${route.arr}` });
    if (leg && leg.dep && leg.arr && route.dep && route.arr && (route.dep !== leg.dep || route.arr !== leg.arr)) {
      warns.push(`⚠️ AirLabs 구간 ${route.dep}→${route.arr} ≠ 근무표 ${leg.dep}→${leg.arr}`);
    }
  }
  if (route && route.knownDays && !route.operatesThatDay) {
    warns.push(`⚠️ ${dateWithDow(dateKey)}은(는) 정기 운항 요일(${daysKo(route.allDays)})이 아님`);
  }
  if (!notes.length) notes.push(SCHEDULED_NOTE); // 안내는 한 줄만
  return { summary, live: hasLiveTimes(live), lines, warns, notes };
}

// ---------------- v2.4.0 하루 여러 레그(1·2·3·4레그) 선택 ----------------
// 퀵턴처럼 하루에 레그가 2개 이상이면 상세 카드에 레그 칩(1 TW721 · 2 TW806 …)을 두고, 고른 레그 하나만 보여 준다.
// AirLabs 무료 한도를 아끼려고 조회는 '고른 레그만' 한다. 조회 결과는 이미 편명·날짜별로 저장되어 있다
//  (flightTimes/{편명}/days/{날짜} 실시간, flightTimes/{편명}/airlabs 정기 노선) → 레그마다 따로 캐시되고 두 폰이 공유한다.

/** 고른 레그 번호(0부터)를 범위 안으로 */
export function clampLeg(i, n) {
  const k = Math.trunc(Number(i));
  if (!Number.isFinite(k) || n < 1) return 0;
  return Math.min(Math.max(k, 0), n - 1);
}

/** 레그 칩 글자: '1 TW721' */
export function legChipLabel(leg, i) {
  return `${i + 1} ${(leg && (leg.iata || leg.no)) || ''}`.trim();
}

/** 레그별 캐시 키 (Firebase 경로 그대로): 'flightTimes/TW721/days/2026-11-14' */
export function legCacheKey(iata, dateKey) {
  return `flightTimes/${iata}/days/${dateKey}`;
}
export function routeCacheKey(iata) {
  return `flightTimes/${iata}/airlabs`;
}

/** 조회 버튼 글자(v2.4.1): 한 레그면 '비행정보 확인', 여러 레그면 '2레그 비행정보 확인' */
export function lookupButtonText(i, n) {
  return n > 1 ? `${i + 1}레그 비행정보 확인` : '비행정보 확인';
}

/**
 * 선택 상태: 같은 날짜·같은 편명 묶음이 계속 열려 있는 동안만 고른 레그를 유지하고, 다른 날짜로 갔다 오거나 편명이 바뀌면 1레그로 돌아간다.
 * @param {{sig:string, idx:number}|null} prev  이전 상태
 * @returns {{sig:string, idx:number}} 새 상태 (idx 는 범위 안)
 */
export function resolveLegSelection(prev, dateKey, legs) {
  const sig = `${dateKey}|${(legs || []).map(l => l.iata).join('/')}`;
  if (prev && prev.sig === sig) return { sig, idx: clampLeg(prev.idx, (legs || []).length) };
  return { sig, idx: 0 };
}

/** 이 레그를 조회하면 AirLabs 를 실제로 부르게 되나? (캐시가 신선하면 부르지 않음) — flight-times.lookupFlightOnAirlabs 와 같은 기준 */
export function wouldCallAirlabs(entry, dateKey, now, { liveTtlMin, routeTtlDays, routesOnly }) {
  const day = entry && entry.days && entry.days[dateKey];
  const liveFresh = Boolean(day && day.fetchedAt && now - day.fetchedAt < liveTtlMin * 60000);
  const routeFresh = Boolean(entry && entry.airlabs && entry.airlabs.fetchedAt && now - entry.airlabs.fetchedAt < routeTtlDays * 86400000);
  return routesOnly ? !routeFresh : !liveFresh; // 오늘·어제·내일은 실시간(flight) 캐시, 그 밖은 정기 노선(routes) 캐시
}
