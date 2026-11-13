// 예진 스케줄 사진 → Gemini Vision JSON → 일정 매핑
// 2단계(7번): responseSchema 로 형식 강제(YEJIN_SCHEMA), 호출은 gemini-client.js(모델 설정값·404 자동 대체·한글 오류),
//             저장 전 미리보기용 행 만들기(buildYejinPreviewRows). 매핑(mapGeminiItem)은 1단계 그대로.
import { normalizeFlight, buildGfFlightFields } from '../flight.js';
import { isStayFlight, extractStandbyCode, defaultTimesFor } from '../schedule-model.js';
import { makeDateKey } from '../dates.js';
import { generateJson } from './gemini-client.js';

export const GEMINI_PROMPT = `이 이미지는 트리니티항공(2026-09 티웨이항공에서 사명 변경, 편명 TW 그대로) 승무원의 모바일 월간 근무표 달력 캡처 사진입니다.
1. 사진 상단에 표시된 연도(year)와 월(month)을 먼저 정확히 파악하세요.
2. 1일부터 말일까지의 스케줄을 분석하여 반드시 아래 JSON 형식으로만 응답하세요. 설명이나 마크다운 코드블록은 일체 쓰지 마세요.

형식:
{
  "year": 2026,
  "month": 10,
  "schedule": [
    { "day": 16, "type": "체류", "destination": "싱가포르", "start": "13:50", "end": "21:30" },
    { "day": 17, "type": "체류", "destination": "싱가포르", "start": "21:50", "end": "06:45", "isInbound": true },
    { "day": 18, "type": "체류", "destination": "싱가포르", "start": "", "end": "", "isArrivalOnly": true }
  ]
}

규칙:
- 체류 비행 중 전날 밤 출발해 아침에 도착하는 비행의 도착 당일(마지막 날)은 start와 end를 빈 문자열("")로 두고 isArrivalOnly: true로 표시하세요.
- 비행 없이 호텔에 온전히 머무는 날(L/O)은 start와 end를 빈 문자열("")로 두고 isPureStay: true로 표시하세요.
- 부산, 제주 등 지방 체류 N레그 일정은 destination을 해당 체류 도시(부산 등)로 적어주세요.
- OFF: type: "OFF", SBY: type: 해당 명칭, TR: type: "TR"
- 공항 대기(ISA, ISB, ISC, ISD, GSA, GSB, GSC, GSD)는 SBY 로 바꾸지 말고 적힌 코드 그대로 type 에 적고, 칸에 시간이 있으면 start/end 에 적으세요.
- 시각은 사진에 적힌 그대로(그 공항의 현지시각) "HH:MM" 형식으로 적으세요.
- 편명(flight)을 꼭 찾아 적으세요: 비행 칸(퀵턴·체류 출발/귀국·비행)에 편명 숫자가 보이면 flight 에 적습니다.
  · 'TW405', 'TWB405', '405', '0405' 처럼 2~4자리 숫자만 보여도 편명입니다 → "TW405" 형식 (앞의 0 은 빼고 TW 를 붙임)
  · 출발-도착 공항 코드(예: ICN-FCO, ICN→SYD, 인천-로마)가 함께 보이면 "TW405 ICN-FCO" 처럼 3글자 코드로 붙이세요
  · 한 칸에 왕복 두 편(예: 241/242)이 보이면 "TW241/TW242" 처럼 모두 적으세요
  · 사진에는 'TW' 가 빠진 숫자 쌍으로 찍힙니다. 예) 칸에 '721/806  GMP-CJU  14:30~19:00  TRAIN 20:31~22:21' 이면
    - '721/806' = 왕복 편명 쌍: 앞 숫자 = 가는 편 TW721, 뒤 숫자 = 오는 편 TW806 → flight: "TW721/TW806 GMP-CJU", flights: ["TW721 GMP-CJU", "TW806 CJU-GMP"]
    - 'GMP-CJU' 처럼 영문 3글자-영문 3글자는 공항 코드(구간)이지 편명이 아닙니다. 가는 편 구간이고, 오는 편은 거꾸로(CJU-GMP)입니다
    - '14:30~19:00' 은 근무 시간(집합~해산)입니다 → start: "14:30", end: "19:00". 비행기 이륙·착륙 시각이 아니니 편명 시각으로 쓰지 마세요
    - 'TRAIN 20:31~22:21' 같은 기차·이동 시각은 start/end 에 넣지 마세요
    - 근무 칸 안의 3~4자리 숫자 쌍(721/806)은 날짜가 아니라 편명입니다
  · 화면에 '티웨이'·'트리니티'·'TW'·'TWB' 어느 쪽으로 보여도 같은 회사입니다
  · 숫자가 편명인지 확실하지 않으면(시각·날짜일 수 있으면) 빈 문자열("")로 두세요. 지어내지 마세요.
- 사진에 없는 날은 넣지 마세요.`;

/** Gemini responseSchema (OpenAPI 부분집합) — 형식 강제 */
export const YEJIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    year: { type: 'INTEGER', description: '사진 상단의 연도' },
    month: { type: 'INTEGER', description: '사진 상단의 월(1~12)' },
    schedule: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'INTEGER' },
          type: { type: 'STRING', description: 'OFF, 체류, 퀵턴, L/O, SBY, ISA, ISB, ISC, ISD, GSA, GSB, GSC, GSD, TR 또는 사진에 적힌 코드' },
          destination: { type: 'STRING' },
          start: { type: 'STRING', description: 'HH:MM 또는 빈 문자열. 퀵턴·왕복은 근무 집합 시각(비행기 이륙 시각 아님)' },
          end: { type: 'STRING', description: 'HH:MM 또는 빈 문자열. 퀵턴·왕복은 근무 해산 시각(비행기 착륙 시각 아님)' },
          flight: { type: 'STRING', description: "편명. 예: 'TW405', 'TW405 ICN-FCO', 'TW721/TW806 GMP-CJU'. 숫자만 보이면 TW 를 붙임('721/806' = TW721 가는 편 / TW806 오는 편). 확실하지 않으면 빈 문자열" },
          flights: { type: 'ARRAY', items: { type: 'STRING' }, description: "왕복이면 편별로 [가는 편, 오는 편]. 예: ['TW721 GMP-CJU', 'TW806 CJU-GMP']. 한 편이면 생략 가능" },
          isInbound: { type: 'BOOLEAN' },
          isArrivalOnly: { type: 'BOOLEAN' },
          isPureStay: { type: 'BOOLEAN' },
          isNightTurn: { type: 'BOOLEAN' }
        },
        required: ['day', 'type']
      }
    }
  },
  required: ['year', 'month', 'schedule']
};

export async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 503 && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    return response;
  }
}

/**
 * 예진 사진 인식 → { parsed, model, fallbackFrom }
 * (스키마 강제 + 모델 404 시 자동 대체. 오류는 한글 메시지의 GeminiError)
 */
export async function recognizeYejinImage(base64Data, mimeType, apiKey, opts = {}) {
  const r = await generateJson({ apiKey, prompt: GEMINI_PROMPT, base64Data, mimeType, schema: YEJIN_SCHEMA, ...opts });
  return { parsed: r.data, model: r.model, fallbackFrom: r.fallbackFrom };
}

/** (1단계 호환) Gemini 호출 → 응답 JSON 텍스트 */
export async function callGeminiVision(base64Data, mimeType, apiKey) {
  const r = await recognizeYejinImage(base64Data, mimeType, apiKey);
  return JSON.stringify(r.parsed);
}

/** 응답 텍스트에서 JSON 부분만 꺼내 파싱 */
export function parseGeminiText(text) {
  let rawText = String(text).trim();
  rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    rawText = rawText.substring(jsonStart, jsonEnd + 1);
  }
  return JSON.parse(rawText);
}

/**
 * Gemini 일정 항목 하나 → gf 객체
 * - 공항 대기(GSA·GSB·GSC·GSD·ISA·ISB·ISC·ISD …)는 SBY 로 뭉개지 않고 자기 코드로 저장 (달력에선 노란 대기 계열)
 * - 대기·TR 은 사진에서 읽은 시간이 우선, 없을 때만 기본시간(GF_DEFAULT_TIMES; 모르는 코드는 빈칸)
 */
export function mapGeminiItem(item) {
  const rawType = String(item.type || '').trim().toUpperCase();
  const dest = item.destination ? String(item.destination).trim() : "";
  const isStay = (rawType === '체류' || rawType === 'L/O' || isStayFlight(dest));
  const isNight = Boolean(item.isNightTurn) || (dest.includes('우한') || (item.end && item.end <= '06:00'));
  // 3단계: 편명이 적힌 날은 비행하는 날 → 시각이 빠졌어도 L/O 로 추정하지 않음 (편명 시간표로 시각을 채울 수 있게)
  const hasFlightNo = Boolean(item.flight && normalizeFlight(item.flight));
  const isPure = Boolean(item.isPureStay) || (isStay && !item.start && !item.end && !item.isArrivalOnly && !hasFlightNo);
  const photoStart = item.start ? String(item.start).trim() : '';
  const photoEnd = item.end ? String(item.end).trim() : '';

  if (rawType.includes('OFF')) {
    return { type: 'OFF', destination: '', isQuickTurn: false };
  } else if (rawType.includes('SB') || rawType.includes('IS') || rawType.includes('GS')) {
    const code = extractStandbyCode(rawType) || 'SBY';
    const [defStart, defEnd] = defaultTimesFor(code);
    return {
      type: code,
      destination: '',
      start: photoStart || defStart,
      end: photoEnd || defEnd,
      isQuickTurn: false
    };
  } else if (rawType === 'TR' || rawType.includes('훈련')) {
    const [defStart, defEnd] = defaultTimesFor('TR');
    return { type: 'TR', destination: '', start: photoStart || defStart, end: photoEnd || defEnd, isQuickTurn: false };
  }
  // v2.3.1: '721/806' 같은 왕복 편명 쌍 → gf.flight(가는 편, v2.3.0 호환) + gf.flights([가는 편, 오는 편])
  const fl = geminiFlightFields(item);
  const out = {
    type: isStay ? '체류' : '퀵턴',
    destination: dest || (isStay ? '체류' : '비행'),
    flight: fl.flight,
    start: item.start || '',
    end: item.end || '',
    isQuickTurn: !isStay,
    isNightTurn: isNight,
    isPureStay: isPure,
    isInbound: Boolean(item.isInbound),
    isArrivalOnly: Boolean(item.isArrivalOnly)
  };
  if (fl.flights) out.flights = fl.flights;
  return out;
}

/** Gemini 의 flight/flights → { flight, flights } (알아볼 수 없는 글자는 flight 에 그대로) */
export function geminiFlightFields(item) {
  const raw = String((item && item.flight) || '').trim();
  const list = Array.isArray(item && item.flights) ? item.flights.map(x => String(x || '').trim()).filter(Boolean) : [];
  let legsIn = list.length ? list.map(no => ({ no })) : [{ no: raw }];
  // flights 에 구간이 없고 flight 에만 구간이 있으면(예: 'TW721/TW806 GMP-CJU') flight 쪽을 씀
  if (list.length && raw && buildGfFlightFields([{ no: raw }]).flights && !buildGfFlightFields(legsIn).flight.includes(' ')) legsIn = [{ no: raw }];
  const fl = buildGfFlightFields(legsIn);
  if (!fl.flight) return { flight: raw, flights: null };
  return fl;
}

/**
 * 파싱된 Gemini 결과를 scheduleDB 에 반영. (gf 만 덮어씀)
 * @returns {{year:number, month:number, count:number}} 실제 반영한 연/월
 */
export function applyGeminiResult(parsed, scheduleDB, fallbackYear, fallbackMonth) {
  const targetY = (parsed.year && parsed.year >= 2025 && parsed.year <= 2040) ? parsed.year : fallbackYear;
  const targetM = (parsed.month && parsed.month >= 1 && parsed.month <= 12) ? parsed.month : fallbackMonth;

  const scheduleArray = Array.isArray(parsed.schedule) ? parsed.schedule : (Array.isArray(parsed.days) ? parsed.days : []);
  let count = 0;
  scheduleArray.forEach(item => {
    const d = item.day;
    if (!d || d < 1 || d > 31) return;
    const dKey = makeDateKey(targetY, targetM, d);
    if (!scheduleDB[dKey]) scheduleDB[dKey] = {};
    scheduleDB[dKey].gf = mapGeminiItem(item);
    count++;
  });
  return { year: targetY, month: targetM, count };
}

/** 인식 결과의 연/월 (사진에서 읽은 값이 이상하면 업로드 대상 월) */
export function resolveTargetMonth(parsed, fallbackYear, fallbackMonth) {
  const y = Number(parsed && parsed.year);
  const m = Number(parsed && parsed.month);
  return {
    year: (y >= 2025 && y <= 2040) ? y : fallbackYear,
    month: (m >= 1 && m <= 12) ? m : fallbackMonth
  };
}

/**
 * 미리보기용 행: [{ who:'gf', dateKey, day, raw, value }]  (value = mapGeminiItem 결과, 아직 저장 안 함)
 * 같은 날짜가 여러 번 나오면 마지막 것 (applyGeminiResult 와 같은 결과)
 */
export function buildYejinPreviewRows(parsed, fallbackYear, fallbackMonth) {
  const { year, month } = resolveTargetMonth(parsed, fallbackYear, fallbackMonth);
  const arr = Array.isArray(parsed && parsed.schedule) ? parsed.schedule : (Array.isArray(parsed && parsed.days) ? parsed.days : []);
  const lastDay = new Date(year, month, 0).getDate();
  const byKey = new Map();
  for (const item of arr) {
    const d = Number(item && item.day);
    if (!d || d < 1 || d > lastDay) continue;
    const dateKey = makeDateKey(year, month, d);
    byKey.set(dateKey, { who: 'gf', dateKey, day: d, raw: { ...item }, value: mapGeminiItem(item) });
  }
  return { year, month, rows: [...byKey.values()].sort((a, b) => a.day - b.day) };
}

/** 파일 → base64 (data URL 의 콤마 뒤) */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
