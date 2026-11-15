// KLUVY 서비스 워커
// ⚠️ 앱 파일을 고치거나 새 파일을 추가하면:
//   1) CACHE_VERSION 을 올리고  2) 새 파일을 ASSETS 에 추가할 것 (npm test 가 빠진 파일을 잡아낸다)
// 전략: 앱 파일(html/js/css 등 같은 출처 GET)은 항상 network-first(+재검증) → 실패(오프라인) 시 캐시.
//       Firebase·Google·CDN 등 다른 출처 요청과 GET 이 아닌 요청은 건드리지 않는다.
const CACHE_VERSION = 'kluvy-v2.4.5';

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
  './js/photo-store.js',
  './js/schedule-model.js',
  './js/holidays.js',
  './js/places.js',
  './js/timezone.js',
  './js/anniversary.js',
  './js/backup.js',
  './js/upload-merge.js',
  './js/flight.js',
  './js/flight-times.js',
  './js/airlabs.js',
  './js/flight-view.js',
  './js/title-format.js',
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
  './js/ui/flight-card.js'
];

self.addEventListener('install', (e) => {
  // 파일 하나가 실패해도 설치 전체가 실패하지 않도록 개별 저장
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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
