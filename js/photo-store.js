// 스케줄 사진 캐시 (폰 안 IndexedDB) + 서버 메타 비교
//
// 서버 (호환 유지)
//   images/{YYYY-MM}           = { data: "data:image/jpeg;base64,…", updatedAt: 밀리초, updatedBy?: 이메일 }   ← v1 과 같은 경로·필드
//   kluvyMeta/images/{YYYY-MM} = { updatedAt, updatedBy, bytes }   ← v2 새 경로(가벼움). v1 이 올린 사진엔 없음
// 폰
//   IndexedDB 'kluvy' / 'photos' : { monthKey, data, who, updatedAt, source }
//   v1 이 localStorage 'yejin_sched_img_YYYY-MM' 에 넣던 base64 는 처음 실행 때 IndexedDB 로 옮기고 localStorage 에서 지운다.
//
// 이 파일의 '대역(backend)'은 { get, put, delete, keys } 를 가진 객체 — 브라우저는 IndexedDB, 테스트·IndexedDB 불가 시 메모리.

export const LEGACY_PHOTO_PREFIX = 'yejin_sched_img_';
export const PHOTO_DB_NAME = 'kluvy';
export const PHOTO_STORE = 'photos';

/** 메모리 대역 (테스트, IndexedDB 를 못 쓰는 브라우저) */
export function createMemoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(k) { return m.has(k) ? structuredCloneSafe(m.get(k)) : null; },
    async put(rec) { m.set(rec.monthKey, structuredCloneSafe(rec)); return true; },
    async delete(k) { m.delete(k); return true; },
    async keys() { return [...m.keys()]; }
  };
}

function structuredCloneSafe(v) { return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/** IndexedDB 대역 */
export function createIdbBackend(idb = globalThis.indexedDB) {
  let dbp = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = idb.open(PHOTO_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'monthKey' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(PHOTO_STORE, mode);
      const store = t.objectStore(PHOTO_STORE);
      let result;
      const r = fn(store);
      if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    kind: 'indexeddb',
    async get(k) { return (await tx('readonly', s => s.get(k))) || null; },
    async put(rec) { await tx('readwrite', s => s.put(rec)); return true; },
    async delete(k) { await tx('readwrite', s => s.delete(k)); return true; },
    async keys() { return (await tx('readonly', s => s.getAllKeys())) || []; }
  };
}

let backend = null;
/** 앱에서 쓰는 사진 저장소 (IndexedDB, 안 되면 메모리) */
export function getPhotoBackend() {
  if (!backend) {
    try {
      backend = (typeof indexedDB !== 'undefined' && indexedDB) ? createIdbBackend(indexedDB) : createMemoryBackend();
    } catch (e) {
      backend = createMemoryBackend();
    }
  }
  return backend;
}
/** 테스트용 */
export function setPhotoBackend(b) { backend = b; }

/**
 * v1 localStorage 사진 → 사진 저장소로 옮기고 localStorage 에서 삭제.
 * 이미 저장소에 있는 달은 덮지 않는다(저장소 쪽이 더 새 것). 저장에 실패한 키는 localStorage 에 남긴다.
 * @param {Storage} ls localStorage 와 같은 인터페이스 (length, key(i), getItem, removeItem)
 * @returns {Promise<{moved:string[], skipped:string[], failed:string[]}>}
 */
export async function migrateLocalStoragePhotos(ls, store, isSafe = v => typeof v === 'string' && v.startsWith('data:image/')) {
  const out = { moved: [], skipped: [], failed: [] };
  const keys = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && k.startsWith(LEGACY_PHOTO_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    const monthKey = k.slice(LEGACY_PHOTO_PREFIX.length);
    let data = ls.getItem(k);
    // safeSetStorage 로 저장된 값은 JSON 문자열일 수도 있다
    if (data && data.startsWith('"')) { try { data = JSON.parse(data); } catch (e) { /* 그대로 */ } }
    try {
      if (!/^\d{4}-\d{2}$/.test(monthKey) || !isSafe(data)) { ls.removeItem(k); out.skipped.push(monthKey); continue; }
      const existing = await store.get(monthKey);
      if (!existing) await store.put({ monthKey, data, who: 'yejin', updatedAt: 0, source: 'localStorage' });
      ls.removeItem(k);
      out.moved.push(monthKey);
    } catch (e) {
      out.failed.push(monthKey);
    }
  }
  return out;
}

/**
 * 서버에서 사진을 다시 받아야 하나?
 * @param {{updatedAt:number}|null} cached 이 폰 캐시
 * @param {number|null} serverUpdatedAt 서버 메타(kluvyMeta → 없으면 images/{월}/updatedAt) 값. 서버에 사진이 없으면 null
 * @param {boolean} serverHasPhoto 메타가 없어도 사진 자체가 있는지(모르면 true)
 */
export function needsDownload(cached, serverUpdatedAt, serverHasPhoto = true) {
  if (!cached) return serverHasPhoto;
  if (serverUpdatedAt === null || serverUpdatedAt === undefined) return false; // 서버 정보 없음 → 캐시 사용
  return Number(serverUpdatedAt) !== Number(cached.updatedAt);
}

/** 서버에 올릴 PATCH 본문 (루트 다중 경로 1회: 사진 + 가벼운 메타) */
export function buildPhotoPatch(monthKey, data, updatedAt, updatedBy = '') {
  return {
    [`images/${monthKey}`]: { data, updatedAt, updatedBy },
    [`kluvyMeta/images/${monthKey}`]: { updatedAt, updatedBy, bytes: data.length }
  };
}
