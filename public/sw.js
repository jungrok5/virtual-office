// PWA 서비스워커 (정적 모드에서만 등록됨).
// 앱 셸은 캐시 우선, 데이터(state.json/evidence)는 네트워크 우선 + 오프라인 폴백.
const CACHE = 'guild-hq-v2';
const SHELL = ['./', 'index.html', 'about.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isData = url.pathname.endsWith('.json') || url.pathname.includes('/evidence/');
  if (isData) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
  }
});
