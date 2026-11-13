// 편명(비행편) 정규화 · 실시간 조회 링크 · 공항 시간대 · 이륙/착륙 시각 계산 (순수 함수, DOM·네트워크 없음)
//
// 트리니티항공(Trinity Airways) = 2026-09-10 티웨이항공에서 사명 변경. IATA 코드 TW·편명은 그대로, ICAO 는 TWB.
// 근무표·사진에서 오는 편명 표기는 제각각이라 하나로 맞춘다:
//   '405 ICN-FCO' · 'TW405' · 'TW 405' · 'TWB405' · '티웨이 405' · '트리니티405' · '405'  → { iata:'TW405', icao:'TWB405', dep, arr }
import { localWallToUtc, tzOffsetMinutes } from './timezone.js';
import { PLACES } from './places.js';

export const HOME_AIRLINE = Object.freeze({ iata: 'TW', icao: 'TWB', name: '트리니티항공', oldName: '티웨이항공' });

/** 화면 문구용: '티웨이' → '트리니티' (인식은 둘 다 받음) */
export function renameAirlineText(s) {
  return String(s ?? '').replace(/티웨이항공/g, '트리니티항공').replace(/티웨이/g, '트리니티');
}

const AIRLINE_WORDS_RE = /(티웨이|트리니티)\s*(항공)?/g;
const ROUTE_RE = /\b([A-Z]{3})\s*(?:-|–|—|>|→|~|\/)\s*([A-Z]{3})\b/;

/**
 * 편명 문자열 → { airline, number, iata, icao, dep, arr, multi, raw } | null
 *  - 항공사 코드가 없으면 트리니티(TW)로 본다. 다른 항공사 코드(OZ123 등)는 그대로.
 *  - 'OAL'(타 항공사 이동) 표시만 있고 코드가 없으면 null (어느 회사 편인지 모름).
 *  - '283/284' 처럼 두 편이 있으면 첫 편 + multi:true (퀵턴 왕복 등)
 */
export function normalizeFlight(raw) {
  if (raw === null || raw === undefined) return null;
  const original = String(raw);
  let s = original.toUpperCase().replace(AIRLINE_WORDS_RE, ' TW ');
  const route = ROUTE_RE.exec(s);
  if (route) s = s.replace(route[0], ' ');
  const re = /(?:^|[^A-Z0-9])(TWB|[A-Z]{2}|[0-9][A-Z](?=[0-9]))?\s?([0-9]{1,4})(?![0-9])/g;
  const found = [];
  let m;
  while ((m = re.exec(s))) found.push({ code: m[1] || '', num: m[2] });
  if (!found.length) return null;
  let { code, num } = found[0];
  if (!code) {
    if (/\bOAL\b/.test(s)) return null;
    code = 'TW';
  }
  if (code === 'TWB') code = 'TW';
  const number = String(Number(num)); // 0405 → 405
  const iata = `${code}${number}`;
  const icao = code === HOME_AIRLINE.iata ? `${HOME_AIRLINE.icao}${number}` : '';
  return {
    airline: code, number, iata, icao,
    dep: route ? route[1] : '', arr: route ? route[2] : '',
    multi: found.length > 1, raw: original
  };
}

/** 실시간 조회 링크 (키 없이 바로 열림). FlightAware 는 ICAO(TWB405), Flightradar24 는 IATA 소문자(tw405) */
export function flightLinks(f) {
  if (!f || !f.iata) return [];
  return [
    { name: 'FlightAware', url: `https://www.flightaware.com/live/flight/${encodeURIComponent(f.icao || f.iata)}` },
    { name: 'Flightradar24', url: `https://www.flightradar24.com/data/flights/${encodeURIComponent(f.iata.toLowerCase())}` }
  ];
}

// 공항 → [도시, IANA 시간대, (선택) {from, tz} 날짜별 예외] — places.js(취항지 표)에서 만든다 (timezone.js 와 같은 원천).
// 목록에 없는 공항은 현지시각만 보여 주고 console.warn 으로 알린다.
export const AIRPORTS = Object.freeze(Object.fromEntries(PLACES.flatMap(p => p.iata.map(code => {
  const city = code === 'HND' ? '도쿄 하네다' : code === 'NRT' ? '도쿄 나리타' : p.name;
  return [code, p.rule ? [city, p.tz, { ...p.rule }] : [city, p.tz]];
}))));

/** 한국 공항 (한국시각 = 현지시각이라 '→ 한국' 을 붙이지 않음) */
export const KOREAN_AIRPORTS = Object.freeze(Object.keys(AIRPORTS).filter(c => AIRPORTS[c][1] === 'Asia/Seoul'));

const warnedAirports = new Set();
/** 그 날짜에 쓸 공항 시간대 (없으면 null) */
export function airportZone(code, dateKey) {
  const c = String(code || '').toUpperCase();
  const a = AIRPORTS[c];
  if (!a) {
    if (c && !warnedAirports.has(c)) { warnedAirports.add(c); console.warn(`[KLUVY] 시간대를 모르는 공항 '${c}' — 현지시각만 표시합니다. app/js/places.js 에 추가하세요.`); }
    return null;
  }
  const rule = a[2];
  if (rule && dateKey && dateKey >= rule.from) return rule.tz;
  return a[1];
}

export function airportCity(code) {
  const a = AIRPORTS[String(code || '').toUpperCase()];
  return a ? a[0] : String(code || '');
}

const KST = 'Asia/Seoul';
const HHMM = /^(\d{1,2}):(\d{2})$/;

function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function wallOf(tz, utcMs) {
  const off = tzOffsetMinutes(tz, utcMs);
  const t = new Date(utcMs + off * 60000);
  return {
    date: `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`,
    time: `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
  };
}

/**
 * 출발일(dateKey, 출발지 현지 날짜) + 출발/도착 현지시각 → 이륙·착륙 시각(현지 + KST, 날짜 넘김 포함).
 * 도착 시각이 출발보다 이르면 다음 날 도착으로 본다. 공항 시간대를 모르면 그 쪽 KST 는 비워 둔다.
 * @returns {{dep:{code,city,local,localDate,kst,kstDate,known}, arr:{…}, durationMin:number|null}|null}
 */
export function computeFlightTimes({ dep, arr, std, sta }, dateKey) {
  if (!dateKey || !HHMM.test(String(std || '')) && !HHMM.test(String(sta || ''))) return null;
  const depTz = airportZone(dep, dateKey);
  const out = { dep: null, arr: null, durationMin: null };
  let depUtc = null;
  if (HHMM.test(String(std || ''))) {
    const [h, mi] = std.split(':').map(Number);
    const [y, m, d] = dateKey.split('-').map(Number);
    if (depTz) {
      depUtc = localWallToUtc(depTz, y, m, d, h, mi);
      const k = wallOf(KST, depUtc);
      out.dep = { code: dep || '', city: airportCity(dep), local: std, localDate: dateKey, kst: k.time, kstDate: k.date, known: true };
    } else {
      out.dep = { code: dep || '', city: airportCity(dep), local: std, localDate: dateKey, kst: '', kstDate: '', known: false };
    }
  }
  if (HHMM.test(String(sta || ''))) {
    const [h, mi] = sta.split(':').map(Number);
    const arrTz = airportZone(arr, dateKey);
    if (arrTz && depUtc !== null) {
      let day = dateKey; let arrUtc = null;
      for (let i = 0; i < 3; i++) {
        const [y, m, d] = day.split('-').map(Number);
        arrUtc = localWallToUtc(arrTz, y, m, d, h, mi);
        if (arrUtc > depUtc) break;
        day = addDays(day, 1);
      }
      const k = wallOf(KST, arrUtc);
      out.arr = { code: arr || '', city: airportCity(arr), local: sta, localDate: wallOf(arrTz, arrUtc).date, kst: k.time, kstDate: k.date, known: true };
      out.durationMin = Math.round((arrUtc - depUtc) / 60000);
    } else {
      out.arr = { code: arr || '', city: airportCity(arr), local: sta, localDate: '', kst: '', kstDate: '', known: false };
    }
  }
  return out;
}

/** "(KST 01:00, +1일)" 처럼 기준일 대비 날짜 차이 */
export function dayShift(baseKey, otherKey) {
  if (!baseKey || !otherKey) return 0;
  const a = Date.UTC(...baseKey.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...otherKey.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

/**
 * 근무(gf)에서 편명 시간표로 배울 수 있는 값 → { code, dep, arr, std, sta } | null
 *  - 체류 비행(퀵턴 아님) + 편명 1개 + 출발·도착 공항 + 시작·끝 시각이 모두 있을 때만.
 *    (퀵턴의 시작~끝은 왕복 근무 시간이라 한 편의 이륙·착륙이 아니어서 배우지 않음)
 *  - 근무표의 체류 비행 시각 = '출발 공항 현지 출발 ~ 도착 공항 현지 도착' (Gemini 프롬프트 규칙과 같음)
 */
export function learnableFromGf(gf) {
  if (!gf || typeof gf !== 'object' || !gf.flight) return null;
  if (gf.isQuickTurn || gf.type === '퀵턴' || gf.isPureStay || gf.isArrivalOnly) return null;
  if (gf.timesFrom === 'flightTimes') return null; // 시간표에서 채운 값을 다시 배우지 않음
  const f = normalizeFlight(gf.flight);
  if (!f || f.multi || !f.dep || !f.arr) return null;
  if (!HHMM.test(String(gf.start || '')) || !HHMM.test(String(gf.end || ''))) return null;
  return { code: f.iata, dep: f.dep, arr: f.arr, std: gf.start, sta: gf.end };
}

/**
 * 시각이 빠진 비행 근무를 편명 시간표로 채운다 → 채웠으면 새 gf(timesFrom:'flightTimes'), 아니면 null
 * @param {object} gf
 * @param {object} table flightTimes ({ TW405: {std, sta, dep, arr, source} })
 */
export function fillGfFromTimetable(gf, table) {
  if (!gf || typeof gf !== 'object' || !gf.flight) return null;
  if (gf.isQuickTurn || gf.type === '퀵턴' || gf.isPureStay || gf.isArrivalOnly) return null;
  if (gf.start && gf.end) return null;
  const f = normalizeFlight(gf.flight);
  if (!f || f.multi) return null;
  const e = table && table[f.iata];
  if (!e || !(e.std || e.sta)) return null;
  if (f.dep && e.dep && f.dep !== e.dep) return null; // 같은 편명이라도 구간이 다르면 쓰지 않음
  return { ...gf, start: gf.start || e.std || '', end: gf.end || e.sta || '', timesFrom: 'flightTimes' };
}

/** 출처 이름 */
export function sourceLabel(src) {
  return ({ schedule: '근무표에서 학습', manual: '직접 입력', airlabs: 'AirLabs' })[src] || '시간표';
}
