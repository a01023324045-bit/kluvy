// localStorage 안전 래퍼 (운영본 동작 그대로)

export function safeGetStorage(key, defaultVal) {
  try {
    const item = localStorage.getItem(key);
    if (!item || item === "undefined" || item === "null") return defaultVal;
    return JSON.parse(item);
  } catch (e) {
    console.warn("Storage 파싱 에러, 기본값 사용:", key, e);
    return defaultVal;
  }
}

export function safeSetStorage(key, val) {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch (e) {
    console.warn("Storage 저장 실패:", key, e);
  }
}
