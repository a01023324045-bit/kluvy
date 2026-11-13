// Gemini 호출 공통: JSON 스키마 강제(responseMimeType + responseSchema), 모델 설정값, 모델 404 → 자동 대체, 한글 오류
import { GEMINI_MODEL, GEMINI_MODEL_KEY, getGeminiEndpoint, getGeminiModelsEndpoint } from '../config.js';

export class GeminiError extends Error {
  constructor(message, { httpStatus = 0, apiStatus = '', raw = '' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.httpStatus = httpStatus;
    this.apiStatus = apiStatus;
    this.raw = raw;
  }
}

export function getGeminiModel() {
  try { return (localStorage.getItem(GEMINI_MODEL_KEY) || '').trim() || GEMINI_MODEL; } catch (e) { return GEMINI_MODEL; }
}
export function setGeminiModel(model) {
  try {
    if (model && model !== GEMINI_MODEL) localStorage.setItem(GEMINI_MODEL_KEY, model);
    else localStorage.removeItem(GEMINI_MODEL_KEY);
  } catch (e) { /* */ }
}

/** generateContent 요청 본문 */
export function buildGenerateBody(prompt, base64Data, mimeType, schema) {
  return {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
  };
}

/** 오류 → 한글 안내 */
export function koreanGeminiError({ httpStatus = 0, apiStatus = '', message = '', model = '' } = {}) {
  const m = String(message || '');
  if (httpStatus === 0) return '인터넷 연결을 확인해 주세요. (구글 AI 서버에 연결하지 못했습니다)';
  if (/API[_ ]KEY[_ ]INVALID|API key not valid|API key expired/i.test(m)) return 'Gemini API 키가 올바르지 않거나 만료됐습니다. [설정]에서 키를 다시 확인해 주세요.';
  if (httpStatus === 404 || apiStatus === 'NOT_FOUND') return `모델 '${model}'을(를) 찾을 수 없습니다(단종·이름 오류). [설정]의 모델 이름을 확인해 주세요.`;
  if (httpStatus === 403 || apiStatus === 'PERMISSION_DENIED') return '이 API 키로는 Gemini 를 쓸 수 없습니다. (키 사용 제한·결제 설정 확인)';
  if (httpStatus === 429 || apiStatus === 'RESOURCE_EXHAUSTED') return '무료 사용량 한도를 넘었습니다. 1분쯤 뒤에 다시 시도해 주세요.';
  if (httpStatus === 503 || httpStatus === 500 || apiStatus === 'UNAVAILABLE' || apiStatus === 'INTERNAL') return '구글 AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.';
  if (httpStatus === 400) return `요청을 처리하지 못했습니다(400). 사진 형식(jpg/png)을 확인해 주세요. (${m.slice(0, 120)})`;
  return `AI 분석 오류(${httpStatus}): ${m.slice(0, 160)}`;
}

/** 모델이 없거나 generateContent 를 지원하지 않는다는 오류인가 */
export function isModelUnavailable(httpStatus, message = '', apiStatus = '') {
  if (httpStatus === 404 || apiStatus === 'NOT_FOUND') return true;
  return httpStatus === 400 && /not (found|supported)|unsupported model|is not supported for generateContent/i.test(String(message));
}

/**
 * ListModels 결과 → 대체 후보 (flash 계열, generateContent 지원). 정식 > preview/exp, lite 아닌 것 우선, 버전 높은 순.
 * @param {{models:{name:string, supportedGenerationMethods?:string[]}[]}} list
 */
export function pickFallbackModels(list, exclude = []) {
  const ex = new Set(exclude);
  const ver = n => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? Number(m[1]) : 0; };
  return (list && Array.isArray(list.models) ? list.models : [])
    .filter(m => m && typeof m.name === 'string')
    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /flash/i.test(n) && !/(image|tts|audio|live|embedding|thinking)/i.test(n) && !ex.has(n))
    .sort((a, b) => {
      const pa = /(preview|exp)/i.test(a) ? 1 : 0; const pb = /(preview|exp)/i.test(b) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const la = /lite/i.test(a) ? 1 : 0; const lb = /lite/i.test(b) ? 1 : 0;
      if (la !== lb) return la - lb;
      return ver(b) - ver(a);
    });
}

/** 응답 텍스트 → JSON (스키마 강제라 보통 순수 JSON. 혹시 코드블록이 섞여도 처리) */
export function parseJsonText(text) {
  let raw = String(text || '').trim().replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a !== -1 && b !== -1) raw = raw.substring(a, b + 1);
  return JSON.parse(raw);
}

async function postOnce(fetchImpl, url, body) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    return { httpStatus: 0, json: null, error: e };
  }
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  return { httpStatus: res.status, json };
}

/**
 * 이미지 + 프롬프트 + 스키마 → 파싱된 JSON.
 * 모델이 없으면(404 등) ListModels 로 flash 계열을 찾아 최대 3개까지 차례로 재시도하고, 성공한 모델을 설정값으로 저장한다.
 * @returns {Promise<{data:object, model:string, fallbackFrom:string|null}>}
 */
export async function generateJson({ apiKey, prompt, base64Data, mimeType, schema, model = getGeminiModel(), fetchImpl = (...a) => fetch(...a), retries503 = 2, onStatus = () => {} }) {
  const body = buildGenerateBody(prompt, base64Data, mimeType, schema);
  const tryModel = async (m) => {
    for (let attempt = 0; ; attempt++) {
      const r = await postOnce(fetchImpl, getGeminiEndpoint(apiKey, m), body);
      if ((r.httpStatus === 503 || r.httpStatus === 500) && attempt < retries503) { await new Promise(res => setTimeout(res, 1500)); continue; }
      return r;
    }
  };
  const fail = (r, m) => {
    const err = (r.json && r.json.error) || {};
    return new GeminiError(koreanGeminiError({ httpStatus: r.httpStatus, apiStatus: err.status, message: err.message || (r.error && r.error.message), model: m }), { httpStatus: r.httpStatus, apiStatus: err.status || '', raw: err.message || '' });
  };
  const extract = (r, m) => {
    const c = r.json && r.json.candidates && r.json.candidates[0];
    const text = c && c.content && c.content.parts && c.content.parts.map(p => p.text || '').join('');
    if (!text) {
      const block = r.json && r.json.promptFeedback && r.json.promptFeedback.blockReason;
      throw new GeminiError(block ? `사진을 분석할 수 없습니다 (차단 사유: ${block}).` : 'AI 분석 결과가 비어 있습니다. 다시 시도해 주세요.', { httpStatus: r.httpStatus });
    }
    try { return parseJsonText(text); } catch (e) {
      throw new GeminiError(c.finishReason === 'MAX_TOKENS' ? 'AI 응답이 너무 길어 잘렸습니다. 다시 시도해 주세요.' : 'AI 응답을 해석하지 못했습니다. 다시 시도하거나 더 선명한 사진을 올려 주세요.', { httpStatus: r.httpStatus, raw: text.slice(0, 200) });
    }
  };

  const first = await tryModel(model);
  if (first.httpStatus === 200) return { data: extract(first, model), model, fallbackFrom: null };
  const ferr = (first.json && first.json.error) || {};
  if (!isModelUnavailable(first.httpStatus, ferr.message, ferr.status)) throw fail(first, model);

  // 모델 없음 → 사용 가능한 flash 모델 찾기
  onStatus(`모델 '${model}' 사용 불가 → 사용 가능한 모델 찾는 중…`);
  let list = null;
  try {
    const lr = await fetchImpl(getGeminiModelsEndpoint(apiKey));
    if (lr.ok) list = await lr.json();
  } catch (e) { list = null; }
  const candidates = pickFallbackModels(list, [model]).slice(0, 3);
  if (!candidates.length) throw new GeminiError(`${koreanGeminiError({ httpStatus: 404, model })} 사용할 수 있는 다른 flash 모델도 찾지 못했습니다.`, { httpStatus: 404 });
  let last = first;
  for (const m of candidates) {
    onStatus(`'${m}' 모델로 다시 시도 중…`);
    const r = await tryModel(m);
    if (r.httpStatus === 200) {
      const data = extract(r, m);
      setGeminiModel(m);
      return { data, model: m, fallbackFrom: model };
    }
    last = r;
    const e = (r.json && r.json.error) || {};
    if (!isModelUnavailable(r.httpStatus, e.message, e.status)) throw fail(r, m);
  }
  throw fail(last, candidates[candidates.length - 1]);
}
