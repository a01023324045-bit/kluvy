// KLUVY 서비스 워커
// ⚠️ 앱 파일을 고치거나 새 파일을 추가하면:
//   1) CACHE_VERSION 을 올리고  2) 새 파일을 ASSETS 에 추가할 것 (npm test 가 빠진 파일을 잡아낸다)
// 전략: 앱 파일(html/js/css 등 같은 출처 GET)은 항상 network-first(+재검증) → 실패(오프라인) 시 캐시.
//       v2.5.0: 버전이 고정된 CDN 두 가지(Font Awesome 6.4.0 아이콘, SheetJS xlsx 0.18.5)만 따로 캐시(cache-first) →
//       비행기모드에서도 아이콘이 보이고 엑셀 읽기가 된다. 그 밖의 다른 출처(Firebase·Google·AirLabs 등)와
//       GET 이 아닌 요청은 건드리지 않는다 (근무표 데이터는 앱이 localStorage·IndexedDB 에 직접 보관).
const CACHE_VERSION = 'kluvy-v2.6.1';
// CDN 캐시: 주소에 버전이 박혀 있어 내용이 바뀌지 않으므로 앱 버전과 따로 둔다 (앱 업데이트 때 지우지 않음)
const CDN_CACHE = 'kluvy-cdn-fa6.4.0-xlsx0.18.5';
const FA_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/';
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const CDN_PREFIXES = [FA_BASE, 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/'];
// 설치할 때 미리 받아 둘 CDN 파일 (index.html 의 link·script 와 같은 주소. 아이콘 글꼴은 solid·regular 만 씀)
const CDN_PRECACHE = [
  { url: FA_BASE + 'css/all.min.css', mode: 'cors' },
  { url: FA_BASE + 'webfonts/fa-solid-900.woff2', mode: 'cors' },
  { url: FA_BASE + 'webfonts/fa-regular-400.woff2', mode: 'cors' },
  { url: XLSX_URL, mode: 'no-cors' }
];

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
  './css/tailwind.css',
  './css/app.css',
  './fonts/PretendardVariable.woff2',
  './fonts/Pretendard-LICENSE.txt',
  './vendor/modern-screenshot.js',
  './vendor/modern-screenshot-LICENSE.txt',
  './js/main.js',
  './js/handlers.js',
  './js/config.js',
  './js/state.js',
  './js/storage.js',
  './js/dates.js',
  './js/escape.js',
  './js/auth.js',
  './js/db-rest.js',
  './js/sync-core.js',
  './js/firebase-sync.js',
  './js/offline.js',
  './js/photo-store.js',
  './js/file-history.js',
  './js/schedule-model.js',
  './js/holidays.js',
  './js/places.js',
  './js/timezone.js',
  './js/anniversary.js',
  './js/backup.js',
  './js/upload-merge.js',
  './js/upload-undo.js',
  './js/apply-summary.js',
  './js/flight-stats.js',
  './js/flight-reread.js',
  './js/flight.js',
  './js/flight-times.js',
  './js/airlabs.js',
  './js/flight-view.js',
  './js/title-format.js',
  './js/app-mode.js',
  './js/parsers/excel-kyuho.js',
  './js/parsers/gemini-client.js',
  './js/parsers/gemini-yejin.js',
  './js/parsers/gemini-kyuho.js',
  './js/parsers/quick-text.js',
  './js/render/calendar.js',
  './js/ui/sync-badge.js',
  './js/ui/login.js',
  './js/ui/edit-modal.js',
  './js/ui/upload-modal.js',
  './js/ui/anniversary-modal.js',
  './js/ui/image-modal.js',
  './js/ui/backup-ui.js',
  './js/ui/recognize-preview.js',
  './js/ui/apply-bar.js',
  './js/ui/reread-flights.js',
  './js/ui/flight-card.js',
  './js/ui/personal.js'
];

// v2.6.0: 같은 주소(a01023324045-bit.github.io)에 커플 앱(/kluvy/)과 개인 모드 앱(/kluvy/personal/)이 함께 있다.
//   · 캐시 저장소는 주소(출처)마다 하나라 두 앱이 같이 쓴다 → 각자 자기 접두어 캐시만 지운다
//     (커플: 'kluvy-personal-' 로 시작하지 않는 옛 캐시 / 개인: 'kluvy-personal-' 로 시작하는 옛 캐시). CDN 캐시는 함께 쓴다.
//   · 커플 앱 서비스 워커의 범위(/kluvy/)는 /kluvy/personal/ 도 덮으므로, 그 폴더 요청은 건드리지 않고 그 폴더의 서비스 워커에 맡긴다.
const PERSONAL_CACHE_PREFIX = 'kluvy-personal-';
const IS_PERSONAL_SW = CACHE_VERSION.startsWith(PERSONAL_CACHE_PREFIX);
const isOwnCache = (k) => (IS_PERSONAL_SW ? k.startsWith(PERSONAL_CACHE_PREFIX) : !k.startsWith(PERSONAL_CACHE_PREFIX));
const OTHER_APP_PATH = new URL('personal/', self.location).pathname; // 개인 모드 사본에서는 /kluvy/personal/personal/ (없는 경로)

self.addEventListener('install', (e) => {
  // 파일 하나가 실패해도 설치 전체가 실패하지 않도록 개별 저장
  e.waitUntil(Promise.all([
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    ),
    // CDN: 이미 있으면 다시 받지 않는다 (버전 고정 주소). 실패해도 설치는 계속 (온라인일 때 쓰면서 채워짐)
    caches.open(CDN_CACHE).then((cache) =>
      Promise.all(CDN_PRECACHE.map(async ({ url, mode }) => {
        try {
          if (await cache.match(url)) return;
          const res = await fetch(new Request(url, { mode, credentials: 'omit' }));
          if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
        } catch (err) { /* 오프라인·차단 → 다음에 */ }
      }))
    )
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== CDN_CACHE && isOwnCache(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(OTHER_APP_PATH)) return; // 개인 모드 앱(/personal/)은 그쪽 서비스 워커가
  if (url.origin !== self.location.origin) {
    // 버전 고정 CDN 만 cache-first (나머지 다른 출처는 브라우저가 그대로 처리)
    if (CDN_PREFIXES.some((p) => req.url.startsWith(p))) e.respondWith(cdnFirst(req));
    return;
  }

  // 페이지 이동(navigate)은 원래 요청 그대로(리다이렉트 처리 보존), 나머지 앱 파일은 HTTP 캐시를 재검증(no-cache)해서
  // 배포 직후 새 index.html 과 옛 js 가 섞이는 일을 막는다.
  const isNav = req.mode === 'navigate';
  const network = isNav ? fetch(req) : fetch(req, { cache: 'no-cache' });

  e.respondWith(
    network
      .then((res) => {
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (isNav) {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});

async function cdnFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req); // 실패(오프라인)면 그대로 네트워크 오류 — 캐시에 없던 파일
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}
