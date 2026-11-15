// 예진 스케줄 사진 → Gemini Vision JSON → 일정 매핑
// 2단계(7번): responseSchema 로 형식 강제(YEJIN_SCHEMA), 호출은 gemini-client.js(모델 설정값·404 자동 대체·한글 오류),
//             저장 전 미리보기용 행 만들기(buildYejinPreviewRows). 매핑(mapGeminiItem)은 1단계 그대로.
import { normalizeFlight, buildGfFlightFields, parseFlightList, gfFlights, MAX_LEGS } from '../flight.js';
import { isStayFlight, extractStandbyCode, defaultTimesFor } from '../schedule-model.js';
import { placeByIata } from '../places.js';
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
  · ★ 한 칸에 편명이 여러 개면 보이는 순서대로 전부 적으세요. 하나도 빠뜨리거나 합치거나 지어내지 마세요. 사용자가 편명을 따로 입력하는 일이 없어야 합니다.
  · 'TW405', 'TWB405', '405', '0405' 처럼 2~4자리 숫자만 보여도 편명입니다 → \"TW405\" 형식 (TW 를 붙임). 앞자리 0 은 사진에 적힌 그대로 둡니다 ('033' → \"TW033\", 0 을 빼서 TW33 으로 적지 마세요)
  · 사진에는 'TW' 가 빠진 숫자로 찍힙니다. 칸에서 편명 숫자가 몇 개인지 먼저 세어 flightCount 에 적고, 그 개수만큼 flights 배열에 순서대로 하나씩 적으세요.
    - '721/806' → flightCount 2, flights: [\"TW721 GMP-CJU\", \"TW806 CJU-GMP\"]  (앞 숫자 = 가는 편 TW721, 뒤 숫자 = 오는 편 TW806)
    - '241/242/243' → flightCount 3, flights: [\"TW241\", \"TW242\", \"TW243\"]  (3개)
    - '241/242/243/244' → 4개  (퀵턴 하루 2회 왕복)
    - '501 … 502' · '501 502' · '501, 502' · '501→502' · '501·502' · 'TW501 / TW502' 도 모두 편명 두 개입니다
    - 편명 하나만 있으면 flightCount 1, flights 는 생략하거나 한 개
  · flight 문자열에도 전부 적으세요: 편명이 여러 개면 \"TW721/TW806\" · \"TW241/TW242/TW243\" 처럼 '/' 로 이어서 (뒤 편명에도 TW 를 붙임), 공항 코드가 있으면 뒤에 \"TW721/TW806 GMP-CJU\"
  · 각 레그의 출발-도착 공항 코드가 사진에 보이면 flights 각 항목에 붙이세요 (예: ICN-FCO, ICN→SYD, 인천-로마 → 3글자 코드). 공항이 둘뿐인 왕복·퀵턴이면 레그마다 번갈아 뒤집습니다 (ICN-NRT, NRT-ICN, ICN-NRT, NRT-ICN). 사진에 공항이 안 보이면 붙이지 마세요.
  · 'GMP-CJU' 처럼 영문 3글자-영문 3글자는 공항 코드(구간)이지 편명이 아닙니다
  · 예) 칸에 '721/806' 'GMP/CJU' 'TAE' '14:30~18:50' 'TRAIN' '20:31~22:21' 이 위에서 아래로 있으면 (실제 11/14 칸)
    - flight: \\"TW721/TW806\\", flights: [\\"TW721 GMP-CJU\\", \\"TW806 CJU-TAE\\"], flightCount: 2  ('GMP/CJU' 아래 'TAE' 한 줄 = 이어서 도착: GMP→CJU→TAE)
    - '14:30~18:50' 은 근무 시간(집합~해산)입니다 → start: \\"14:30\\", end: \\"18:50\\". 비행기 이륙·착륙 시각이 아니니 편명 시각으로 쓰지 마세요
    - 'TRAIN 20:31~22:21' 같은 기차·이동·교육 시각은 start/end 에 넣지 말고 trains: [{\\"start\\": \\"20:31\\", \\"end\\": \\"22:21\\"}] 에 적으세요
    - 근무 칸 안의 3~4자리 숫자 쌍(721/806)은 날짜가 아니라 편명입니다
  · 화면에 '티웨이'·'트리니티'·'TW'·'TWB' 어느 쪽으로 보여도 같은 회사입니다
  · 숫자가 편명인지 확실하지 않으면(시각·날짜일 수 있으면) 빈 문자열(\\"\\")로 두세요. 지어내지 마세요.
- ★ 한 칸에 색 블록(줄 묶음)이 여러 개일 수 있습니다 (실제 사진에서 확인):
  · cellText: 그 칸 안의 글자를 위에서 아래로 보이는 줄 그대로 적으세요 (줄바꿈은 \\n, 맨 위 날짜 숫자는 빼고, 고치거나 합치지 말고). 예: \\"705/706\\n711\\nGMP/CJU\\nGMP/CJU\\n06:35~13:32\\nL/O\\n13:32~18:35\\"
  · 편명 줄이 여러 개면(예: '705/706' 아래 '711') 모두 같은 비행 블록입니다 → flightCount 3, flights: [\\"TW705 GMP-CJU\\", \\"TW706 CJU-GMP\\", \\"TW711 GMP-CJU\\"]. 편명 줄 i 번째는 구간 줄 i 번째와 짝입니다 ('705/706'↔'GMP/CJU' 왕복, '711'↔'GMP/CJU'). 3개 이상이어도 하나도 빼지 마세요(최대 4).
  · 구간 줄 아래 공항 코드 한 줄은 이어서 도착하는 공항입니다: 'ICN/NRT' + 'ICN' = ICN→NRT→ICN, 'GMP/TSA' + 'GMP' = GMP→TSA→GMP.
  · 'L/O 13:32~18:35' 는 비행편이 아니라 현지 체류·대기입니다 → flights 에 넣지 말고 layovers: [{\\"start\\": \\"13:32\\", \\"end\\": \\"18:35\\"}] 에 적으세요. start/end 에도 넣지 마세요.
  · start/end = 그날 시작하는 비행 블록의 첫 시작 ~ 마지막 끝 (L/O·TRAIN 제외). 그날 시작하는 비행이나 대기가 있으면 start/end 는 반드시 채우세요(빈칸 금지).
  · 날짜 넘김: 자정을 넘는 블록(예: '165 CJU/SIN 18:35~00:58', 'L/O 23:42~23:45', '034 CXR/ICN 23:45~07:49')은 사진에서 이틀 칸에 똑같이 다시 나옵니다. 두 칸 모두 cellText 에는 보이는 그대로 적되,
    전날에서 이어진 블록은 그날의 flights·flightCount·start/end 에 넣지 마세요. 전날 출발해 오늘 착륙만 하는 날은 start·end 를 \\"\\" 로 두고 isArrivalOnly: true 입니다.
  · '19:40~' 다음 줄 '09:15(S:10:15)' 처럼 끝 시각이 다음 줄에 있어도 한 블록입니다 → start \\"19:40\\", end \\"09:15\\" (끝이 시작보다 이르면 다음 날). '(S:10:15)'·'(S:11:05)' 괄호 안 시각은 참고 시각이라 start/end 에 넣지 마세요.
  · 귀국편(해외에서 출발해 한국에 내리는 편)은 isInbound: true. 집(인천·김포)에서 나가 그날 돌아오면(TRAIN 으로 돌아와도) 퀵턴, 밖에서 자면 체류.
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
          flight: { type: 'STRING', description: "편명 전부(보이는 순서). 예: 'TW405', 'TW405 ICN-FCO', 'TW721/TW806 GMP-CJU', 'TW241/TW242/TW243'. 숫자만 보이면 TW 를 붙임('721/806' = TW721 가는 편 / TW806 오는 편). 확실하지 않으면 빈 문자열" },
          flightCount: { type: 'INTEGER', description: '이 칸에 보이는 편명(숫자)의 개수 — 먼저 세고 그만큼 flights 에 적을 것 (0~4)' },
          flights: { type: 'ARRAY', items: { type: 'STRING' }, description: "레그별 편명, 사진에 보이는 순서 그대로 전부(최대 4, 편명 줄이 여러 개여도 모두). 예: ['TW721 GMP-CJU', 'TW806 CJU-TAE'] · ['TW705 GMP-CJU', 'TW706 CJU-GMP', 'TW711 GMP-CJU']. 공항 코드가 보이면 붙임. L/O·TRAIN·전날에서 이어진 비행은 넣지 않음. 한 편이면 생략 가능" },
          cellText: { type: 'STRING', description: "칸 안의 글자를 위에서 아래로 보이는 줄 그대로(줄바꿈 \\n, 날짜 숫자 제외, 고치지 말 것). 예: '705/706\\n711\\nGMP/CJU\\nGMP/CJU\\n06:35~13:32\\nL/O\\n13:32~18:35'" },
          layovers: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start: { type: 'STRING' }, end: { type: 'STRING' } } }, description: "칸의 'L/O HH:MM~HH:MM' 줄들(현지 체류·대기, 비행편 아님)" },
          trains: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start: { type: 'STRING' }, end: { type: 'STRING' } } }, description: "칸의 'TRAIN HH:MM~HH:MM' 줄들(기차 이동·교육, 편명 아님, start/end 에 넣지 않음)" },
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
export function mapGeminiItem(item, ctx) {
  return mapGeminiItemDetailed(item, ctx).value;
}

/**
 * v2.4.4: mapGeminiItem + 경고 목록 { value, warnings }
 *  - 칸 글자(cellText) 나 blocks 가 있으면 그것을 블록으로 나눠(parseYejinCellText) 결정적으로 정리한다(dayFromBlocks):
 *    비행편 = 그날 시작하는 비행 블록의 편명 전부(보이는 순서, 최대 4), 근무 시각 = 그 블록들의 첫 시작~마지막 끝,
 *    L/O = layovers, TRAIN = trains, 전날 출발해 오늘 착륙하는 비행 = carryIn (오늘 편명이 아님).
 *  - 둘 다 없으면 v2.4.1 까지의 방식(legacyMapGeminiItem) 그대로.
 * @param {object} item Gemini 일정 항목
 * @param {{blocks?:object[]}} [ctx] annotateYejinMonth 로 날짜 넘김(startDay/endDay)을 붙인 그날 블록
 */
export function mapGeminiItemDetailed(item, ctx) {
  const it = item || {};
  const blocks = ctx && Array.isArray(ctx.blocks) ? ctx.blocks : annotateSingle(it);
  if (blocks && blocks.length) {
    const r = dayFromBlocks(it, blocks);
    if (r && r.value) return r;
    if (r && r.code) {
      const v = legacyMapGeminiItem({ ...it, type: r.code, start: r.start || it.start || '', end: r.end || it.end || '' });
      return { value: v, warnings: r.warnings || [] };
    }
  }
  const v = legacyMapGeminiItem(it);
  const ex = extrasFromItem(it);
  if (v && (v.type === '체류' || v.type === '퀵턴')) Object.assign(v, ex);
  return { value: v, warnings: [] };
}

function legacyMapGeminiItem(item) {
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

/**
 * Gemini 의 flight/flights → { flight, flights } (알아볼 수 없는 글자는 flight 에 그대로)
 * v2.4.0: 레그 N개(최대 4). flight 문자열('TW241/TW242/TW243 ICN-NRT')과 flights 배열 중 편이 더 많은 쪽을 기준으로 하고,
 *         없는 편은 다른 쪽에서 보태며, 구간(공항)이 빠진 레그는 다른 쪽에서 채운다.
 */
export function geminiFlightFields(item) {
  const raw = String((item && item.flight) || '').trim();
  const list = Array.isArray(item && item.flights) ? item.flights.map(x => String(x || '').trim()).filter(Boolean) : [];
  const fromList = [];
  for (const t of list) for (const f of parseFlightList(t)) if (!fromList.some(x => x.iata === f.iata)) fromList.push(f);
  const fromRaw = parseFlightList(raw);
  const [base, other] = fromList.length >= fromRaw.length ? [fromList, fromRaw] : [fromRaw, fromList];
  const merged = base.map(f => {
    const o = other.find(x => x.iata === f.iata);
    return { no: f.iata, dep: f.dep || (o && o.dep) || '', arr: f.arr || (o && o.arr) || '' };
  });
  for (const o of other) if (!merged.some(m => m.no === o.iata)) merged.push({ no: o.iata, dep: o.dep, arr: o.arr });
  const fl = buildGfFlightFields(merged);
  if (!fl.flight) return { flight: raw, flights: null };
  return fl;
}

// ───────────────── v2.4.4 한 칸 여러 근무 블록 (실제 11월 사진 기준) ─────────────────
// 예진 크루 앱의 달력 칸은 색 블록이 위에서 아래로 쌓인다. 실제 사진(2026-11)에서 확인한 표기:
//   비행  '705/706' '711' 'GMP/CJU' 'GMP/CJU' '06:35~13:32'   (편명 줄 여러 개 + 구간 줄 여러 개 + 시각, 편명 줄 i ↔ 구간 줄 i)
//         '721/806' 'GMP/CJU' 'TAE' '14:30~18:50'               (구간 줄 뒤 공항 하나 = 이어서 도착: GMP→CJU→TAE)
//         '241/242' 'ICN/NRT' 'ICN' '06:35~14:39'               (ICN→NRT→ICN)
//         '501' 'ICN/SYD' '19:40~' '09:15(S:10:15)'            ('(S:…)' 은 참고 시각 — 근무 시각이 아님)
//   L/O   'L/O' '13:32~18:35'                                    (현지 체류·대기 — 비행편 아님)
//   TRAIN 'TRAIN' '20:31~22:21'                                  (기차 이동/교육 — 편명 아님, 근무 시각에 넣지 않음)
//   자정을 넘는 블록은 이틀 칸에 똑같이 다시 나온다(예: 11/2·11/3 의 '165 CJU/SIN 18:35~00:58', 11/9·11/10 의 'L/O 23:42~23:45').
//   → annotateYejinMonth 가 이웃 날짜의 같은 블록을 찾아 startDay(-1 = 전날 시작)·endDay(+1 = 다음 날 끝)를 붙인다.
const HOME_AIRPORTS = Object.freeze(['ICN', 'GMP']);
const T_RE = '\\d{1,2}:\\d{2}';
const S_NOTE_RE = '(?:\\s*\\(\\s*S\\s*:\\s*\\d{1,2}:\\d{2}\\s*\\))?';
const PLUS_TAIL_RE = '(?:\\s*\\(\\s*\\+\\s*1\\s*\\))?';
const CELL_TOKEN_RE = new RegExp(
  '(?<lo>\\bL\\s*/\\s*[O0](?![A-Z0-9])|\\bLAYOVER\\b)' +
  '|(?<train>\\bTRAIN\\b|기차|\\bKTX\\b|\\bSRT\\b)' +
  `|(?<time>${T_RE}${S_NOTE_RE}\\s*~\\s*(?:\\+\\s*(?:1(?![0-9:])\\s*)?)?(?:${T_RE}${S_NOTE_RE}${PLUS_TAIL_RE})?)` +
  `|(?<tend>${T_RE}${S_NOTE_RE}${PLUS_TAIL_RE})` +
  '|(?<route>\\b[A-Z]{3}(?:\\s*(?:[/>\\-–—]|→)\\s*[A-Z]{3}\\b)+)' +
  '|(?<code>\\bOFF\\b|\\bSBY\\b|\\b(?:IS|GS)[A-Z]\\b|\\bTR\\b|\\bOAL\\b)' +
  '|(?<ap>\\b[A-Z]{3}\\b)' +
  '|(?<nums>(?:\\bTWB?\\s?)?\\d{1,4}(?:\\s*[/,·、]\\s*(?:TWB?\\s?)?\\d{1,4})*)',
  'g');

const pad5 = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

function parseTimeToken(s) {
  const notes = [];
  const rest = String(s).replace(/\(\s*S\s*:\s*(\d{1,2}:\d{2})\s*\)/g, (_, t) => { notes.push(pad5(t)); return ' '; });
  const times = rest.match(/\d{1,2}:\d{2}/g) || [];
  return { start: pad5(times[0]), end: pad5(times[1]), plus: /\+/.test(rest), notes };
}

/**
 * 칸 글자(사진에 보이는 그대로, 줄바꿈 포함) → 블록 목록 (날짜 넘김 표시는 아직 없음)
 *  블록: { kind:'flight'|'lo'|'train'|'code'|'duty', start, end, nums:[['705','706'],['711']], routes:[['GMP','CJU'],…], code?, plus?, sNotes? }
 * @param {string} text
 * @param {{day?:number}} [opts] day: 칸 맨 앞의 날짜 숫자를 실수로 적었으면 버린다
 */
export function parseYejinCellText(text, opts = {}) {
  const src = String(text || '').toUpperCase()
    .replace(/[〜～∼]/g, '~').replace(/[／⁄]/g, '/').replace(/：/g, ':').replace(/[（]/g, '(').replace(/[）]/g, ')');
  const blocks = [];
  let cur = null;
  let first = true;
  const newBlock = b => { cur = b; blocks.push(b); return b; };
  CELL_TOKEN_RE.lastIndex = 0;
  for (const m of src.matchAll(CELL_TOKEN_RE)) {
    const g = m.groups;
    const isFirst = first; first = false;
    if (g.lo) newBlock({ kind: 'lo', start: '', end: '' });
    else if (g.train) newBlock({ kind: 'train', start: '', end: '' });
    else if (g.code) {
      if (g.code === 'OAL') { if (cur && cur.kind === 'flight') cur.oal = true; else newBlock({ kind: 'flight', nums: [], routes: [], start: '', end: '', oal: true }); }
      else newBlock({ kind: 'code', code: g.code, start: '', end: '' });
    } else if (g.nums) {
      const list = g.nums.split(/[/,·、]/).map(x => x.replace(/TWB?/, '').trim()).filter(x => /^\d{1,4}$/.test(x)).filter(x => Number(x) !== 0); // v2.4.5: 앞자리 0 은 적힌 그대로 (033 → '033')
      if (!list.length) continue;
      if (isFirst && opts.day && list.length === 1 && Number(list[0]) === Number(opts.day) && g.nums.trim().length <= 2) continue; // 날짜 숫자
      if (cur && cur.kind === 'flight' && !cur.start && !cur.end) cur.nums.push(list);
      else newBlock({ kind: 'flight', nums: [list], routes: [], start: '', end: '' });
    } else if (g.route) {
      const aps = g.route.split(/\s*(?:[/>\-–—]|→)\s*/).filter(Boolean);
      const t = cur && cur.kind === 'flight' ? cur : newBlock({ kind: 'flight', nums: [], routes: [], start: '', end: '' });
      t.routes.push(aps);
    } else if (g.ap) {
      if (cur && cur.kind === 'flight' && cur.routes.length) { const r = cur.routes[cur.routes.length - 1]; if (r[r.length - 1] !== g.ap) r.push(g.ap); }
    } else if (g.time) {
      const t = parseTimeToken(g.time);
      if (!cur || (cur.start && cur.end) || cur.kind === 'code' && cur.start) newBlock({ kind: 'duty', start: '', end: '' });
      cur.start = t.start; cur.end = t.end;
      if (t.plus) cur.plus = true;
      if (t.notes.length) cur.sNotes = t.notes;
    } else if (g.tend) {
      const t = parseTimeToken(g.tend);
      if (cur && cur.start && !cur.end) { cur.end = t.start; if (t.plus) cur.plus = true; if (t.notes.length) cur.sNotes = [...(cur.sNotes || []), ...t.notes]; }
      else if (cur && !cur.start) cur.start = t.start;
    }
  }
  return blocks.filter(b => b.kind !== 'flight' || b.nums.length || b.routes.length || b.start || b.oal);
}

/** Gemini blocks 배열([{kind, flights, route, start, end}]) → 칸 글자 (parseYejinCellText 로 같은 규칙 적용) */
export function blocksToCellText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(b => {
    if (!b || typeof b !== 'object') return '';
    const k = String(b.kind || '').toUpperCase().replace(/\s/g, '');
    const t = b.start || b.end ? `${b.start || ''}~${b.end || ''}` : '';
    if (k === 'LO' || k === 'L/O' || k === 'LAYOVER') return `L/O ${t}`;
    if (k === 'TRAIN') return `TRAIN ${t}`;
    if (k === 'FLIGHT' || k === '비행') return `${b.flights || ''} ${b.route || ''} ${t}`;
    return `${b.kind || ''} ${t}`;
  }).filter(s => s.trim()).join('\n');
}

/** 항목 하나의 블록 (cellText > blocks > 없음 null) */
export function blocksOfItem(item) {
  if (!item || typeof item !== 'object') return null;
  const day = Number(item.day) || 0;
  if (typeof item.cellText === 'string' && item.cellText.trim()) {
    const b = parseYejinCellText(item.cellText, { day });
    if (b.length) return b;
  }
  if (Array.isArray(item.blocks) && item.blocks.length) {
    const b = parseYejinCellText(blocksToCellText(item.blocks), { day });
    if (b.length) return b;
  }
  return null;
}

const blockSig = b => `${b.kind}|${b.start}|${b.end}|${(b.nums || []).flat().join(',')}|${(b.routes || []).flat().join(',')}`;
// 이틀 칸에 다시 나오는 블록으로 볼 수 있는가: L/O(24시간 이상일 수 있음) 또는 자정을 넘는 블록만 (같은 퀵턴을 이틀 연속 하는 날을 합치지 않게)
const canSpan = b => b.kind !== 'code' && Boolean(b.start && b.end) && (b.kind === 'lo' || b.end < b.start || b.plus);

function setSpan(b, back, fwd) {
  b.startDay = back ? -back : 0;
  b.endDay = fwd || (!back && b.start && b.end && (b.end < b.start || b.plus) ? 1 : 0);
}

/** 한 항목만 볼 때(이웃 날짜 모름): 자정을 넘는 시각이면 다음 날 끝 */
function annotateSingle(item) {
  const bl = blocksOfItem(item);
  if (!bl) return null;
  for (const b of bl) setSpan(b, 0, 0);
  return bl;
}

/**
 * 달 전체 항목 → Map(day → 블록[]) — 이웃 날짜에 같은 블록이 있으면 하나의 블록이 자정을 넘은 것
 *  startDay: 0(오늘 시작) · -1(전날 시작) …, endDay: 0(오늘 끝) · 1(다음 날 끝) …
 */
export function annotateYejinMonth(items) {
  const byDay = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const d = Number(it && it.day);
    if (!d) continue;
    const bl = blocksOfItem(it);
    if (bl) byDay.set(d, bl);
  }
  const has = (d, s) => (byDay.get(d) || []).some(x => canSpan(x) && blockSig(x) === s);
  for (const [d, bl] of byDay) {
    for (const b of bl) {
      if (!canSpan(b)) { setSpan(b, 0, 0); continue; }
      const s = blockSig(b);
      let back = 0; while (back < 31 && has(d - back - 1, s)) back++;
      let fwd = 0; while (fwd < 31 && has(d + fwd + 1, s)) fwd++;
      setSpan(b, back, fwd);
    }
  }
  return byDay;
}

/** 비행 블록 → 레그 [{no:'TW705', dep, arr}] — 편명 줄 i ↔ 구간 줄 i, 공항 둘이면 왕복처럼 번갈아, n+1 개면 차례대로 */
export function legsOfFlightBlock(b) {
  const groups = (b && b.nums) || [];
  const routes = (b && b.routes) || [];
  const assign = (nums, chain) => nums.map((n, i) => {
    let dep = '', arr = '';
    if (chain && chain.length >= 2) {
      if (chain.length === 2) [dep, arr] = i % 2 === 0 ? [chain[0], chain[1]] : [chain[1], chain[0]];
      else if (i + 1 < chain.length) { dep = chain[i]; arr = chain[i + 1]; }
    }
    return { no: `TW${n}`, dep, arr };
  });
  if (!groups.length) return [];
  if (groups.length === routes.length) return groups.flatMap((g, i) => assign(g, routes[i]));
  const flat = groups.flat();
  if (routes.length === 1) return assign(flat, routes[0]);
  if (!routes.length) return assign(flat, null);
  // 줄 수가 다르면: 구간을 하나로 이어 붙여(끝 공항 = 다음 시작이면 합침) 차례대로
  const chain = [];
  for (const r of routes) for (const a of r) if (chain[chain.length - 1] !== a) chain.push(a);
  return assign(flat, chain);
}

const legLabel = l => (l.dep && l.arr ? `${l.no} ${l.dep}-${l.arr}` : l.no);
const cityOf = code => { const p = placeByIata(code); return p ? p.name : ''; };
const isKoreanAirport = code => { const p = placeByIata(code); return Boolean(p && p.country === 'KR'); };

/** Gemini 의 layovers/trains 배열(칸 글자 없이 온 경우) → 저장 꼴 */
function extrasFromItem(item) {
  const out = {};
  const norm = arr => (Array.isArray(arr) ? arr : []).map(x => {
    if (!x) return null;
    const t = typeof x === 'string' ? parseTimeToken(x) : { start: pad5(x.start), end: pad5(x.end) };
    if (!t.start && !t.end) return null;
    const o = { start: t.start, end: t.end };
    if (t.start && t.end && t.end < t.start) o.endDay = 1;
    return o;
  }).filter(Boolean);
  const lo = norm(item && item.layovers);
  const tr = norm(item && item.trains);
  if (lo.length) out.layovers = lo;
  if (tr.length) out.trains = tr;
  return out;
}

/**
 * 블록(날짜 넘김 표시 포함) → { value: gf, warnings } | { code, start, end } (대기·OFF 칸) | null
 *  규칙(v2.4.4):
 *   - 비행편 = 오늘 시작하는 비행 블록의 편명 전부(보이는 순서) — 최대 MAX_LEGS(4), 넘으면 앞 4개 + 경고
 *   - start/end = 그 블록들의 첫 시작 ~ 마지막 끝 (L/O·TRAIN 은 넣지 않음)
 *   - L/O → layovers [{start, end, startDay?, endDay?, place?}], TRAIN → trains [{start, end, …}]
 *   - 전날 시작해 오늘 끝나는 비행 → carryIn {flights, start, end} (오늘 편명이 아님 — 도착일 isArrivalOnly)
 *   - 종류: 집(ICN·GMP)에서 출발해 그날 돌아오면(TRAIN 귀환 포함) 퀵턴, 아니면 체류(출발 공항이 집이 아니고 한국 공항에 내리면 isInbound)
 */
export function dayFromBlocks(item, blocks) {
  const warnings = [];
  const own = blocks.filter(b => !b.startDay);
  const ownFlights = own.filter(b => b.kind === 'flight' || b.kind === 'duty');
  const carryBlocks = blocks.filter(b => b.kind === 'flight' && b.startDay < 0);
  const loBlocks = blocks.filter(b => b.kind === 'lo');
  const trBlocks = blocks.filter(b => b.kind === 'train');
  const codes = own.filter(b => b.kind === 'code');

  if (codes.length && !ownFlights.length && !carryBlocks.length) {
    const c = codes[0];
    if (c.code === 'TR') return { code: 'TR', start: c.start, end: c.end, warnings };
    return { code: c.code, start: c.start, end: c.end, warnings };
  }

  // 레그·장소 (L/O 장소 = 바로 앞 비행의 도착 공항, 없으면 바로 뒤 비행의 출발 공항)
  const legsOf = new Map(blocks.map(b => [b, b.kind === 'flight' ? legsOfFlightBlock(b) : []]));
  const fromItem = geminiFlightFields(item);
  const itemLegs = gfFlights({ flight: fromItem.flight, flights: fromItem.flights });
  const fillRoute = l => {
    if (l.dep && l.arr) return l;
    const o = itemLegs.find(x => x.iata === l.no);
    return o && o.dep && o.arr ? { ...l, dep: o.dep, arr: o.arr } : l;
  };
  let allLegs = ownFlights.flatMap(b => legsOf.get(b) || []).map(fillRoute);
  if (!allLegs.length && ownFlights.some(b => b.kind === 'flight') && itemLegs.length) {
    allLegs = itemLegs.map(l => ({ no: l.iata, dep: l.dep, arr: l.arr }));
    warnings.push('칸 글자에서 편명을 찾지 못해 Gemini 의 flights 를 썼습니다');
  }
  // 같은 편명이 두 번 보이면 한 번만
  allLegs = allLegs.filter((l, i) => allLegs.findIndex(x => x.no === l.no) === i);
  const fc = Number(item && item.flightCount);
  const carryCount = carryBlocks.reduce((n, b) => n + (legsOf.get(b) || []).length, 0);
  if (fc > 0 && fc !== allLegs.length && fc !== allLegs.length + carryCount) {
    warnings.push(`Gemini 가 센 편명 수(${fc})와 칸 글자에서 찾은 편명 수(${allLegs.length})가 다릅니다 — 칸 글자 기준`);
  }
  if (allLegs.length > MAX_LEGS) {
    warnings.push(`편명 ${allLegs.length}개 중 앞 ${MAX_LEGS}개만 저장했습니다 (빠진 편: ${allLegs.slice(MAX_LEGS).map(l => l.no).join(', ')})`);
    allLegs = allLegs.slice(0, MAX_LEGS);
  }

  const layovers = [];
  blocks.forEach((b, i) => {
    if (b.kind !== 'lo') return;
    let place = '';
    for (let j = i - 1; j >= 0 && !place; j--) { const L = legsOf.get(blocks[j]) || []; if (L.length) place = L[L.length - 1].arr || ''; }
    for (let j = i + 1; j < blocks.length && !place; j++) { const L = legsOf.get(blocks[j]) || []; if (L.length) place = L[0].dep || ''; }
    const o = { start: b.start, end: b.end };
    if (b.startDay) o.startDay = b.startDay;
    if (b.endDay) o.endDay = b.endDay;
    if (place) o.place = place;
    layovers.push(o);
  });
  const trains = trBlocks.map(b => { const o = { start: b.start, end: b.end }; if (b.startDay) o.startDay = b.startDay; if (b.endDay) o.endDay = b.endDay; return o; });

  let carryIn = null;
  if (carryBlocks.length) {
    const cb = carryBlocks[carryBlocks.length - 1];
    const L = legsOf.get(cb) || [];
    carryIn = { flights: L.map(legLabel), start: cb.start, end: cb.end };
    if (cb.startDay !== -1) carryIn.startDay = cb.startDay;
  }

  // 근무 시각 = 오늘 시작하는 비행 블록의 첫 시작 ~ 마지막 끝
  const timed = ownFlights.filter(b => b.start || b.end);
  let start = timed.length ? timed[0].start : '';
  let end = timed.length ? timed[timed.length - 1].end : '';
  if (ownFlights.length && (!start || !end)) {
    start = start || pad5(item && item.start);
    end = end || pad5(item && item.end);
    if (!start || !end) warnings.push('근무 시각(집합~끝)이 비어 있습니다 — 미리보기에서 채워 주세요');
  }

  const extras = {};
  if (layovers.length) extras.layovers = layovers;
  if (trains.length) extras.trains = trains;
  if (carryIn) extras.carryIn = carryIn;

  const gDest = String((item && item.destination) || '').trim();
  const destOk = gDest && !/[0-9/]/.test(gDest) ? gDest : '';

  if (!ownFlights.length) {
    if (carryIn) {
      const L = legsOf.get(carryBlocks[carryBlocks.length - 1]) || [];
      const last = L[L.length - 1];
      const code = last ? (last.arr && !HOME_AIRPORTS.includes(last.arr) ? last.arr : last.dep) : '';
      return { value: { type: '체류', destination: cityOf(code) || destOk || '체류', flight: '', start: '', end: '', isQuickTurn: false, isNightTurn: false, isPureStay: false, isInbound: false, isArrivalOnly: true, ...extras }, warnings };
    }
    if (layovers.length) {
      const code = layovers[0].place || '';
      return { value: { type: '체류', destination: cityOf(code) || destOk || '체류', flight: '', start: '', end: '', isQuickTurn: false, isNightTurn: false, isPureStay: true, isInbound: false, isArrivalOnly: false, ...extras }, warnings };
    }
    if (trains.length) {
      warnings.push('TRAIN 만 있는 날은 TR(교육·이동)로 저장합니다');
      return { code: 'TR', start: trains[0].start, end: trains[trains.length - 1].end, warnings };
    }
    return null;
  }

  const firstDep = allLegs.length ? allLegs[0].dep : '';
  const lastArr = allLegs.length ? allLegs[allLegs.length - 1].arr : '';
  const loToday = layovers.some(l => !l.startDay);
  const loBefore = layovers.some(l => l.startDay);
  const overnight = ownFlights.some(b => b.endDay > 0);
  const startsAway = loBefore || Boolean(carryIn) || Boolean(firstDep && !HOME_AIRPORTS.includes(firstDep));
  const endsAway = loToday || Boolean(lastArr && !HOME_AIRPORTS.includes(lastArr) && !trains.length);
  let type, destination, isInbound = false, isNightTurn = false;
  if (!startsAway && !endsAway) {
    type = '퀵턴';
    const turn = allLegs.find(l => l.arr && !HOME_AIRPORTS.includes(l.arr));
    destination = (turn && cityOf(turn.arr)) || destOk || '비행';
    isNightTurn = destination.includes('우한') || overnight || Boolean(end && end <= '06:00');
  } else {
    type = '체류';
    // 귀국(isInbound): 밖에서 출발해 한국 공항에 내림 — 그 뒤 국내 L/O 가 이어져도 해외에서 출발했으면 귀국편 (11/4 SIN→CJU 후 제주 L/O)
    isInbound = startsAway && isKoreanAirport(lastArr) && (!loToday || !isKoreanAirport(firstDep));
    destination = (isInbound ? cityOf(firstDep) : cityOf(lastArr)) || destOk || '체류';
  }
  const fl = buildGfFlightFields(allLegs);
  const value = {
    type, destination, flight: fl.flight, start, end,
    isQuickTurn: type === '퀵턴', isNightTurn, isPureStay: false, isInbound, isArrivalOnly: false
  };
  if (fl.flights) value.flights = fl.flights;
  Object.assign(value, extras);
  return { value, warnings };
}

/**
 * 파싱된 Gemini 결과를 scheduleDB 에 반영. (gf 만 덮어씀)
 * @returns {{year:number, month:number, count:number}} 실제 반영한 연/월
 */
export function applyGeminiResult(parsed, scheduleDB, fallbackYear, fallbackMonth) {
  const targetY = (parsed.year && parsed.year >= 2025 && parsed.year <= 2040) ? parsed.year : fallbackYear;
  const targetM = (parsed.month && parsed.month >= 1 && parsed.month <= 12) ? parsed.month : fallbackMonth;

  const scheduleArray = Array.isArray(parsed.schedule) ? parsed.schedule : (Array.isArray(parsed.days) ? parsed.days : []);
  const ann = annotateYejinMonth(scheduleArray); // v2.4.4 날짜 넘김 블록
  let count = 0;
  scheduleArray.forEach(item => {
    const d = item.day;
    if (!d || d < 1 || d > 31) return;
    const dKey = makeDateKey(targetY, targetM, d);
    if (!scheduleDB[dKey]) scheduleDB[dKey] = {};
    scheduleDB[dKey].gf = mapGeminiItem(item, ann.has(Number(d)) ? { blocks: ann.get(Number(d)) } : undefined);
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
  const ann = annotateYejinMonth(arr); // v2.4.4: 이틀 칸에 다시 나오는 블록(자정 넘김) 표시
  const byKey = new Map();
  for (const item of arr) {
    const d = Number(item && item.day);
    if (!d || d < 1 || d > lastDay) continue;
    const dateKey = makeDateKey(year, month, d);
    const r = mapGeminiItemDetailed(item, ann.has(d) ? { blocks: ann.get(d) } : undefined);
    const row = { who: 'gf', dateKey, day: d, raw: { ...item }, value: r.value };
    if (r.warnings && r.warnings.length) row.warnings = r.warnings;
    byKey.set(dateKey, row);
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
