// 규호 근무표 '사진'(엑셀 캡처 jpg/png) → Gemini → 엑셀 파서와 같은 코드 매핑(parseKyuhoShiftRule)
// 대화①: "엑셀 내용을 이미지(jpeg)파일로 첨부할 경우…사진파일을 업로드하면 이규호 행만 알아서 반영"
// 칸 글자만 읽게 하고(조근/석근/석1/석5/일근/O/대휴/휴가/연차/TS-3 …), 시간·주말/공휴일 조근·석근 판정은 엑셀과 같은 함수가 한다.
import { parseKyuhoShiftRule } from './excel-kyuho.js';
import { makeDateKey } from '../dates.js';
import { generateJson } from './gemini-client.js';
import { resolveTargetMonth } from './gemini-yejin.js';

export const KYUHO_PROMPT = `이 이미지는 방송사 뉴스기술팀 교대근무표(엑셀 표)를 캡처한 사진입니다.
1. 표 제목이나 상단에 연도·월이 보이면 year, month 에 적으세요. 연도가 없으면 0 으로 두세요.
2. 날짜(1~31) 숫자가 나열된 머리글 행을 찾으세요.
3. 성명 칸이 '이규호'인 행 '하나만' 읽으세요. 다른 사람의 행은 절대 읽지 마세요.
4. 이규호 행의 각 날짜 칸에 적힌 글자를 그대로 code 에 적으세요. (예: 조근, 조, 석근, 석, 석1, 석5, 일근, 일, O, 대휴, 휴가, 연차, TS-3, TS-1, 연수)
   '석5'·'석1'처럼 글자 뒤의 숫자는 다른 근무(사무실)를 뜻하므로 숫자까지 빠짐없이 적으세요. ('석5'를 '석'이나 '석근'으로 바꾸지 마세요)
5. 칸에 글자가 없고 배경이 분홍색이면 code 를 "휴가"로, 글자도 색도 없으면 "" 로 적으세요.
6. 시간을 추측해 넣지 마세요. 설명 없이 JSON 만 응답하세요.`;

export const KYUHO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    year: { type: 'INTEGER' },
    month: { type: 'INTEGER' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'INTEGER' },
          code: { type: 'STRING', description: '이규호 행 그 날짜 칸의 글자 그대로' },
          pink: { type: 'BOOLEAN', description: '칸 배경이 분홍색이면 true' }
        },
        required: ['day', 'code']
      }
    }
  },
  required: ['days']
};

export async function recognizeKyuhoImage(base64Data, mimeType, apiKey, opts = {}) {
  const r = await generateJson({ apiKey, prompt: KYUHO_PROMPT, base64Data, mimeType, schema: KYUHO_SCHEMA, ...opts });
  return { parsed: r.data, model: r.model, fallbackFrom: r.fallbackFrom };
}

/** 사진에서 읽은 칸 글자 → 엑셀과 같은 규칙의 my 객체 (빈칸 + 분홍 = 휴가) */
export function mapKyuhoCode(code, dateKey, pink = false) {
  let v = String(code || '').trim().replace(/\s+/g, '');
  if (!v && pink) v = '휴가';
  return parseKyuhoShiftRule(v, dateKey);
}

/** 미리보기용 행 [{ who:'my', dateKey, day, raw:{code}, value }] — 빈칸('-')은 기본으로 반영 안 함(include=false) */
export function buildKyuhoPreviewRows(parsed, fallbackYear, fallbackMonth) {
  const { year, month } = resolveTargetMonth(parsed, fallbackYear, fallbackMonth);
  const arr = Array.isArray(parsed && parsed.days) ? parsed.days : (Array.isArray(parsed && parsed.schedule) ? parsed.schedule : []);
  const lastDay = new Date(year, month, 0).getDate();
  const byKey = new Map();
  for (const item of arr) {
    const d = Number(item && item.day);
    if (!d || d < 1 || d > lastDay) continue;
    const dateKey = makeDateKey(year, month, d);
    const value = mapKyuhoCode(item.code ?? item.type, dateKey, Boolean(item.pink));
    byKey.set(dateKey, { who: 'my', dateKey, day: d, raw: { code: String(item.code ?? item.type ?? ''), pink: Boolean(item.pink) }, value, include: value.type !== '-' });
  }
  return { year, month, rows: [...byKey.values()].sort((a, b) => a.day - b.day) };
}
