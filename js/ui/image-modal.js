// 예진 스케줄 원본 사진: 압축 / 저장(IndexedDB 캐시 + 서버 1회 업로드) / 뷰어 모달
// 2단계(8번): localStorage base64 → IndexedDB, 사진 고를 때 + 반영할 때 두 번 올리던 중복 업로드 제거,
//             서버 메타(kluvyMeta/images/{월}, 없으면 images/{월}/updatedAt)로 상대가 바꾼 사진을 감지해 새로 받음.
import { state } from '../state.js';
import { makeMonthKey } from '../dates.js';
import { STORAGE_KEYS } from '../config.js';
import { isSafeImageDataUrl } from '../escape.js';
import { getDbBaseUrl, dbFetch, dbGetJson } from '../db-rest.js';
import { getPhotoBackend, needsDownload, buildPhotoPatch, LEGACY_PHOTO_PREFIX } from '../photo-store.js';

/** 서버 사진의 updatedAt 만 가볍게 확인 → {updatedAt:number|null, updatedBy, hasPhoto:boolean|null, ok} */
export async function fetchPhotoMeta(mKey) {
  const meta = await dbGetJson(`kluvyMeta/images/${mKey}`);
  if (!meta.ok) return { ok: false, updatedAt: null, hasPhoto: null };
  if (meta.data && meta.data.updatedAt) return { ok: true, updatedAt: Number(meta.data.updatedAt), updatedBy: meta.data.updatedBy || '', hasPhoto: true };
  // v1 이 올린 사진: 새 메타가 없으므로 사진 안의 updatedAt 숫자만 받아 본다
  const legacy = await dbGetJson(`images/${mKey}/updatedAt`);
  if (!legacy.ok) return { ok: false, updatedAt: null, hasPhoto: null };
  if (legacy.data !== null && legacy.data !== undefined) return { ok: true, updatedAt: Number(legacy.data), updatedBy: '', hasPhoto: true };
  return { ok: true, updatedAt: null, updatedBy: '', hasPhoto: null }; // 사진이 없거나 updatedAt 없는 아주 옛 사진 → 캐시 없을 때만 받아 봄
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * 이 달 사진 동기화: 캐시 → (온라인이고 서버가 더 새 것이면) 내려받아 캐시 갱신.
 * v2.5.0: 오프라인이면 요청 없이 캐시만 (비행기모드에서 콘솔 오류·대기 없음). 미리 받기(offline.js)도 이 함수를 쓴다.
 * @returns {Promise<{data:string|null, action:'downloaded'|'cached'|'none'|'offline'|'error'}>}
 */
export async function syncPhotoForMonth(mKey) {
  const store = getPhotoBackend();
  let cached = null;
  try { cached = await store.get(mKey); } catch (e) { cached = null; }
  const fromCache = action => ({ data: cached ? cached.data : null, action: cached ? 'cached' : action });
  if (!getDbBaseUrl()) return fromCache('none');
  if (isOffline()) return { data: cached ? cached.data : null, action: 'offline' };
  const meta = await fetchPhotoMeta(mKey);
  if (!meta.ok) return fromCache('error'); // 서버에 못 닿음 → 캐시
  if (!needsDownload(cached, meta.updatedAt, meta.hasPhoto !== false)) return fromCache('none');
  const full = await dbGetJson(`images/${mKey}`);
  if (full.ok && full.data && isSafeImageDataUrl(full.data.data)) {
    const rec = { monthKey: mKey, data: full.data.data, who: meta.updatedBy || full.data.updatedBy || '', updatedAt: Number(meta.updatedAt ?? full.data.updatedAt ?? 0), source: 'server' };
    try { await store.put(rec); } catch (e) { console.warn('사진 캐시 저장 실패:', e); }
    return { data: rec.data, action: 'downloaded' };
  }
  return fromCache(full.ok ? 'none' : 'error');
}

/** 이 달 사진: 캐시 → (서버가 더 새 것이면) 내려받아 캐시 갱신. 반환: dataURL 또는 null */
export async function loadPhotoForMonth(mKey) {
  return (await syncPhotoForMonth(mKey)).data;
}

export async function openYejinImageModal() {
  const { currentYear, currentMonth } = state;
  const mKey = makeMonthKey(currentYear, currentMonth);
  const modalTitle = document.getElementById('yejinImageModalTitle');
  const imgTag = document.getElementById('yejinOriginalImgTag');
  const noImgAlert = document.getElementById('yejinNoImgAlert');
  const noImgText = document.getElementById('yejinNoImgAlertText');

  if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-image text-rose-500"></i> ${currentYear}년 ${currentMonth}월 스케줄 사진`;

  resetZoomImage();
  document.getElementById('yejinImageModal').classList.remove('hidden');
  let imgData = null;
  try { imgData = await loadPhotoForMonth(mKey); } catch (err) { console.warn('사진 불러오기 실패:', err); }

  if (imgData && isSafeImageDataUrl(imgData)) {
    imgTag.src = imgData;
    imgTag.classList.remove('hidden');
    noImgAlert.classList.add('hidden');
  } else {
    imgTag.src = '';
    imgTag.classList.add('hidden');
    noImgAlert.classList.remove('hidden');
    if (noImgText) noImgText.innerText = isOffline()
      ? `오프라인이라 사진을 받을 수 없습니다. 이 폰에 저장된 ${currentYear}년 ${currentMonth}월 사진이 없어요 (인터넷에 연결된 상태에서 한 번 열면 저장됩니다).`
      : `${currentYear}년 ${currentMonth}월에 등록된 스케줄 원본 사진이 없습니다.`;
  }
}

export function closeYejinImageModal() {
  document.getElementById('yejinImageModal').classList.add('hidden');
}

export function zoomImage(delta) {
  state.currentImgScale = Math.max(0.6, Math.min(3.5, state.currentImgScale + delta));
  const imgTag = document.getElementById('yejinOriginalImgTag');
  if (imgTag) imgTag.style.transform = `scale(${state.currentImgScale})`;
}

export function resetZoomImage() {
  state.currentImgScale = 1.0;
  const imgTag = document.getElementById('yejinOriginalImgTag');
  if (imgTag) imgTag.style.transform = `scale(1)`;
}

export function openOriginalImageInNewTab() {
  const imgTag = document.getElementById('yejinOriginalImgTag');
  if (!imgTag || !imgTag.src) return;
  const src = imgTag.getAttribute('src') || '';
  if (!isSafeImageDataUrl(src)) return;
  const w = window.open("");
  if (!w) return;
  // document.write 로 src 를 문자열에 끼워 넣지 않고 DOM 으로 만든다 (XSS 방지)
  w.document.title = '이예진 근무표 원본 고화질';
  w.document.body.style.cssText = 'margin:0;background:#111;display:flex;justify-content:center;';
  const img = w.document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;height:auto;';
  w.document.body.appendChild(img);
}

/** 이미지 파일 → 긴 변 2000px, JPEG 88% dataURL (저장·업로드는 하지 않음) */
export function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 열 수 없습니다.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 2000;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/** 압축된 사진을 이 폰 캐시(IndexedDB)에 넣고 서버에 한 번 올린다 (사진 + 메타를 PATCH 1회) */
export async function savePhotoForMonth(mKey, dataUrl) {
  const updatedAt = Date.now();
  const updatedBy = localStorage.getItem(STORAGE_KEYS.loginEmail) || '';
  try {
    await getPhotoBackend().put({ monthKey: mKey, data: dataUrl, who: updatedBy, updatedAt, source: 'local' });
  } catch (e) {
    console.warn('사진 캐시 저장 실패:', e);
  }
  if (!getDbBaseUrl()) return false;
  try {
    const res = await dbFetch('', { method: 'PATCH', body: buildPhotoPatch(mKey, dataUrl, updatedAt, updatedBy) });
    return res.ok;
  } catch (cloudErr) {
    console.warn('Firebase 이미지 업로드 실패:', cloudErr);
    return false;
  }
}

/** (1단계 이름 호환) 압축 + 저장 + 업로드 1회 */
export async function compressAndStoreYejinImage(file, mKey) {
  const compressed = await compressImageFile(file);
  await savePhotoForMonth(mKey, compressed);
  return compressed;
}

/** 이 폰의 해당 달 사진 캐시 삭제 ('해당 월 비우기') */
export async function deleteLocalPhoto(mKey) {
  try { localStorage.removeItem(`${LEGACY_PHOTO_PREFIX}${mKey}`); } catch (e) { /* */ }
  try { await getPhotoBackend().delete(mKey); } catch (e) { /* */ }
}
