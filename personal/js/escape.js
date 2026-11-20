// HTML 이스케이프 (XSS 방지)
// 사용자/서버/AI 문자열을 innerHTML 템플릿에 넣을 때는 반드시 escapeHtml() 을 거치거나 textContent 를 쓴다.

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, ch => MAP[ch]);
}

/** img src 등에 넣어도 되는 이미지 data URL 인지 (javascript: 등 차단) */
export function isSafeImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(value);
}
