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
// 공항코드-공항코드 (3자리 영문 대문자끼리만 — 숫자 편명 쌍 '721/806' 과 헷갈리지 않음). 'GMP-CJU-GMP' 처럼 이어진 것도 한 번에.
const ROUTE_SEP = '(?:->|-|–|—|>|→|~|\\/)';
const ROUTE_CHAIN_RE = new RegExp(`\\b[A-Z]{3}(?:\\s*${ROUTE_SEP}\\s*[A-Z]{3}\\b)+`);
// 근무표의 시각(14:30~19:00)·날짜(11/14 는 편명 쌍과 모양이 같아 지우지 않음)는 편명이 아님
const TIME_RE = /\b\d{1,2}:\d{2}\b/g;
const FLIGHT_TOKEN_RE = /(?:^|[^A-Z0-9])(TWB|[A-Z]{2}|[0-9][A-Z](?=[0-9]))?\s?([0-9]{1,4})(?![0-9])/g;

function prepFlightText(raw) {
  let s = String(raw).toUpperCase().replace(AIRLINE_WORDS_RE, ' TW ').replace(TIME_RE, ' ');
  const chain = ROUTE_CHAIN_RE.exec(s);
  let airports = [];
  if (chain) {
    airports = chain[0].split(new RegExp(`\\s*${ROUTE_SEP}\\s*`)).filter(Boolean);
    s = s.replace(chain[0], ' ');
  }
  return { s, airports };
}

function tokenToFlight(code, num) {
  let c = code;
  if (c === 'TWB') c = 'TW';
  const number = String(Number(num)); // 0405 → 405
  return { airline: c, number, iata: `${c}${number}`, icao: c === HOME_AIRLINE.iata ? `${HOME_AIRLINE.icao}${number}` : '' };
}

/**
 * 편명 문자열 → { airline, number, iata, icao, dep, arr, multi, raw } | null
 *  - 항공사 코드가 없으면 트리니티(TW)로 본다. 다른 항공사 코드(OZ123 등)는 그대로.
 *  - 'OAL'(타 항공사 이동) 표시만 있고 코드가 없으면 null (어느 회사 편인지 모름).
 *  - '283/284' 처럼 두 편이 있으면 첫 편 + multi:true (퀵턴 왕복 등). 모든 편은 parseFlightList.
 */
export function normalizeFlight(raw) {
  if (raw === null || raw === undefined) return null;
  const list = parseFlightList(raw);
  if (!list.length) return null;
  const f = list[0];
  return { airline: f.airline, number: f.number, iata: f.iata, icao: f.icao, dep: f.dep, arr: f.arr, multi: list.length > 1, raw: String(raw) };
}

/**
 * v2.3.1: 편명 쌍(왕복)·여러 편 → 편별 목록 [{ airline, number, iata, icao, dep, arr }]
 *  사진에는 'TW' 가 빠진 숫자 쌍으로 찍힌다: '721/806' = TW721(가는 편) + TW806(오는 편).
 *  받는 표기: '721/806' · 'TW721/TW806' · '721,806' · '721→806' · '721·806' · 'TW721(TW806)' · '721-806' · '721 806' …
 *  구간: 'GMP-CJU' 하나면 가는 편 GMP→CJU, 오는 편은 거꾸로 CJU→GMP. 'GMP-CJU-TAE' 처럼 이어지면 차례대로.
 *  공항코드(3자리 영문)는 편명으로 보지 않고, 시각(14:30)은 지운다. 같은 편이 겹치면 한 번만.
 */
export function parseFlightList(raw) {
  if (raw === null || raw === undefined) return [];
  const { s, airports } = prepFlightText(raw);
  const found = [];
  FLIGHT_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = FLIGHT_TOKEN_RE.exec(s))) found.push({ code: m[1] || '', num: m[2] });
  if (!found.length) return [];
  // 첫 편에 항공사 코드가 있으면 뒤 숫자만 있는 편도 같은 항공사 (TW721/806, 7C101/102)
  const firstCode = found[0].code;
  if (!firstCode && /\bOAL\b/.test(s)) return [];
  const out = [];
  for (const { code, num } of found) {
    const c = code || (firstCode && firstCode !== 'TWB' ? firstCode : 'TW');
    const f = tokenToFlight(c === 'TWB' ? 'TW' : c, num);
    if (Number(f.number) === 0) continue;
    if (out.some(x => x.iata === f.iata)) continue;
    out.push(f);
  }
  out.forEach((f, i) => {
    let dep = '', arr = '';
    if (airports.length >= 2) {
      if (airports.length > i + 1) { dep = airports[i]; arr = airports[i + 1]; }
      else if (airports.length === 2 && out.length === 2 && i === 1) { dep = airports[1]; arr = airports[0]; } // 왕복: 거꾸로
    }
    f.dep = dep; f.arr = arr;
  });
  return out;
}

/** 편 하나 → 저장용 문자열 'TW721 GMP-CJU' (구간 모르면 'TW721') */
export function flightLabel(f) {
  if (!f || !f.iata) return '';
  return f.dep && f.arr ? `${f.iata} ${f.dep}-${f.arr}` : f.iata;
}

/** 왕복·여러 편의 이름: 2편이면 가는 편/오는 편, 그 밖은 1편·2편… */
export function legName(i, n) {
  if (n === 2) return i === 0 ? '가는 편' : '오는 편';
  return n > 1 ? `${i + 1}편` : '비행';
}

const HHMM_RE = /^\d{1,2}:\d{2}$/;
function cleanLeg(x) {
  if (!x) return null;
  if (typeof x === 'string') {
    const f = parseFlightList(x)[0];
    return f ? { no: f.iata, iata: f.iata, icao: f.icao, airline: f.airline, number: f.number, dep: f.dep, arr: f.arr, std: '', sta: '', source: '' } : null;
  }
  if (typeof x !== 'object') return null;
  const f = parseFlightList(x.no || x.flight || x.iata || '')[0];
  if (!f) return null;
  const up = v => String(v || '').trim().toUpperCase();
  return {
    no: f.iata, iata: f.iata, icao: f.icao, airline: f.airline, number: f.number,
    dep: /^[A-Z]{3}$/.test(up(x.dep)) ? up(x.dep) : f.dep, arr: /^[A-Z]{3}$/.test(up(x.arr)) ? up(x.arr) : f.arr,
    std: HHMM_RE.test(String(x.std || '')) ? x.std : '', sta: HHMM_RE.test(String(x.sta || '')) ? x.sta : '',
    source: x.source === 'manual' ? 'manual' : ''
  };
}

/**
 * 근무(gf) → 편별 목록 (상세 카드·학습·편집창 공용). 하위호환:
 *  - v2.3.1 이 저장한 gf.flights([출국, 귀국] — 객체 또는 문자열)가 있고, 첫 편이 gf.flight 와 같을 때만 그것을 쓴다.
 *    (v2.3.0 폰이 gf.flight 만 바꾸거나 지우면 낡은 gf.flights 는 자동으로 무시)
 *  - 아니면 gf.flight 문자열을 parseFlightList 로 나눈다 ('TW721/TW806 GMP-CJU' 처럼 옛 방식으로 둘 다 적혀 있어도 됨).
 * @returns {{no,iata,icao,airline,number,dep,arr,std,sta,source}[]}
 */
export function gfFlights(gf) {
  if (!gf || typeof gf !== 'object' || !gf.flight) return [];
  const main = parseFlightList(gf.flight);
  if (!main.length) return [];
  const raw = Array.isArray(gf.flights) ? gf.flights : (gf.flights && typeof gf.flights === 'object' ? Object.keys(gf.flights).sort((a, b) => a - b).map(k => gf.flights[k]) : null);
  if (raw && raw.length) {
    const legs = raw.map(cleanLeg).filter(Boolean);
    if (legs.length && legs[0].iata === main[0].iata) {
      // 첫 편의 구간을 gf.flight 에서 고쳤으면 그쪽을 따름
      if (main[0].dep && main[0].arr && (!legs[0].dep || !legs[0].arr)) { legs[0].dep = main[0].dep; legs[0].arr = main[0].arr; }
      return legs;
    }
  }
  return main.map(f => ({ no: f.iata, iata: f.iata, icao: f.icao, airline: f.airline, number: f.number, dep: f.dep, arr: f.arr, std: '', sta: '', source: '' }));
}

/** 왕복·여러 편을 짧게: 'TW721/TW806 GMP-CJU' (한 편이면 gf.flight 그대로) */
export function flightsText(gf) {
  const legs = gfFlights(gf);
  if (legs.length < 2) return gf && gf.flight ? String(gf.flight) : '';
  const r = legs[0].dep && legs[0].arr ? ` ${legs[0].dep}-${legs[0].arr}` : '';
  return `${legs.map(l => l.iata).join('/')}${r}`;
}

/**
 * 편집창·미리보기 입력 → 저장할 gf 필드 { flight, flights }
 *  - flight  = 가는 편(첫 편) 문자열 'TW721 GMP-CJU' (v2.3.0 폰도 읽음)
 *  - flights = 편이 2개 이상이거나 직접 입력 시각이 있을 때만 [{no, dep, arr, std?, sta?, source?}] , 아니면 null(지움)
 * @param {{no:string, dep?:string, arr?:string, std?:string, sta?:string}[]} legsIn  입력 (no 에 '721/806' 처럼 쌍을 넣어도 됨)
 */
export function buildGfFlightFields(legsIn) {
  const legs = [];
  for (const L of legsIn || []) {
    if (!L) continue;
    const list = parseFlightList(L.no || '');
    list.forEach((f, j) => {
      if (legs.some(x => x.no === f.iata)) return;
      const up = v => String(v || '').trim().toUpperCase();
      const leg = { no: f.iata, dep: (j === 0 && /^[A-Z]{3}$/.test(up(L.dep)) ? up(L.dep) : f.dep) || '', arr: (j === 0 && /^[A-Z]{3}$/.test(up(L.arr)) ? up(L.arr) : f.arr) || '' };
      if (list.length === 1 && (HHMM_RE.test(String(L.std || '')) || HHMM_RE.test(String(L.sta || '')))) {
        leg.std = HHMM_RE.test(String(L.std || '')) ? L.std : '';
        leg.sta = HHMM_RE.test(String(L.sta || '')) ? L.sta : '';
        leg.source = 'manual';
      }
      legs.push(leg);
    });
  }
  // 오는 편 구간이 비어 있고 가는 편 구간이 있으면 거꾸로
  if (legs.length === 2 && legs[0].dep && legs[0].arr && !legs[1].dep && !legs[1].arr) { legs[1].dep = legs[0].arr; legs[1].arr = legs[0].dep; }
  if (!legs.length) return { flight: '', flights: null };
  const flight = flightLabel({ iata: legs[0].no, dep: legs[0].dep, arr: legs[0].arr });
  const needArray = legs.length > 1 || legs.some(l => l.source === 'manual');
  return { flight, flights: needArray ? legs : null };
}

/**
 * 편명 칸 → 저장할 { flight, flights } (편집창·미리보기 공용)
 *  가는 편 칸에 '721/806' 처럼 쌍을 넣고 오는 편 칸을 비우면 둘로 나눔. 이륙·착륙 칸 값은 source:'manual'.
 */
export function flightFieldsFromInputs(vals) {
  const f1 = String(vals.f1 || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const f2 = String(vals.f2 || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const list1 = parseFlightList(f1);
  let legsIn;
  if (list1.length >= 2 && !f2) {
    legsIn = list1.map((f, i) => ({ no: flightLabel(f), std: i === 0 ? vals.s1 : i === 1 ? vals.s2 : '', sta: i === 0 ? vals.a1 : i === 1 ? vals.a2 : '' }));
  } else {
    legsIn = [{ no: f1, std: vals.s1, sta: vals.a1 }];
    if (f2) legsIn.push({ no: f2, std: vals.s2, sta: vals.a2 });
  }
  const out = buildGfFlightFields(legsIn);
  if (!out.flight && (f1 || f2)) out.flight = f1 || f2; // 알아볼 수 없는 글자는 그대로 둠 (상세 카드가 안내)
  return out;
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
  const legs = gfFlights(gf);
  if (legs.length !== 1) return null; // 왕복·여러 편이면 근무 시각은 한 편의 시각이 아님
  const f = legs[0];
  if (!f.dep || !f.arr) return null;
  if (!HHMM.test(String(gf.start || '')) || !HHMM.test(String(gf.end || ''))) return null;
  return { code: f.iata, dep: f.dep, arr: f.arr, std: gf.start, sta: gf.end };
}

/**
 * v2.3.1: 편별로 배울 값 목록 [{ code, dep, arr, std, sta, source }]
 *  - 체류 비행 1편(learnableFromGf) → source 'schedule'(업로드) / 'manual'(편집창)
 *  - 편집창에서 편마다 직접 넣은 이륙·착륙 시각(gf.flights[i].source==='manual', 구간·두 시각 모두) → source 'manual'
 *    (그날의 지연 시각일 수 있어, 시간표에 그 편 시각이 아예 없을 때만 채움 — flight-times.js. 그날 표시는 gf.flights 가 맡음)
 */
export function learnableLegs(gf, source = 'schedule') {
  const out = [];
  const one = learnableFromGf(gf);
  const legs = gfFlights(gf);
  for (const L of legs) {
    if (L.source === 'manual' && L.dep && L.arr && HHMM.test(L.std) && HHMM.test(L.sta)) out.push({ code: L.iata, dep: L.dep, arr: L.arr, std: L.std, sta: L.sta, source: 'manual', perDay: true });
  }
  if (one && !out.some(x => x.code === one.code)) out.push({ ...one, source });
  return out;
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
  if (gfFlights(gf).length > 1) return null; // 왕복은 근무 시각(집합~해산)이라 한 편 시각으로 채우지 않음
  const f = normalizeFlight(gf.flight);
  if (!f || f.multi) return null;
  const e = table && table[f.iata];
  if (!e || !(e.std || e.sta)) return null;
  if (f.dep && e.dep && f.dep !== e.dep) return null; // 같은 편명이라도 구간이 다르면 쓰지 않음
  return { ...gf, start: gf.start || e.std || '', end: gf.end || e.sta || '', timesFrom: 'flightTimes' };
}

/** 출처 이름 */
export function sourceLabel(src) {
  return ({ schedule: '근무표에서 학습', manual: '직접 입력', airlabs: 'AirLabs 정기 시각' })[src] || '시간표';
}
