// GitHub Pages 용 서비스 워커 (빌드 때 artifact-dist/pages/sw.js 로 복사)
// 1) 한 번 받은 뷰어 화면을 기기에 저장해 두고 항상 저장본을 먼저 보여준다.
//    → 회사 와이파이처럼 github.io 가 막힌 곳에서도 열린다. 새 버전은 다음에 열 때 반영된다.
// 2) 안드로이드에서 카카오톡 등의 '공유 → DWG 뷰어'로 받은 도면을 기기 저장소(IndexedDB)에 넣고 바로 연다.
//    IndexedDB 구조는 src/lib/storage.ts 와 같다.
const CACHE = 'dwg-viewer-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
const scoped = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map(scoped)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dwg-edit', 1);
    req.onupgradeneeded = () => {
      for (const s of ['files', 'scenes', 'marks']) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveShared(file) {
  const db = await openDb();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id, name: file.name || 'shared.dwg', size: file.size, addedAt: now, openedAt: now, blob: file });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

/** 저장본이 있으면 바로 주고, 뒤에서 새 버전을 받아 저장해 둔다 (막힌 망의 차단 안내 페이지는 저장하지 않음) */
async function cacheFirst(request, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const update = fetch(request)
    .then((res) => {
      if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(
      (async () => {
        try {
          const form = await req.formData();
          const file = form.getAll('file').find((f) => typeof f !== 'string');
          if (!file) return Response.redirect(scoped('./'), 303);
          const id = await saveShared(file);
          return Response.redirect(scoped(`./?open=${id}`), 303);
        } catch {
          return Response.redirect(scoped('./'), 303);
        }
      })(),
    );
    return;
  }
  if (req.method !== 'GET') return;
  // 화면(페이지)은 주소의 ?open= 등과 상관없이 같은 저장본을 쓴다
  e.respondWith(cacheFirst(req, req.mode === 'navigate' ? scoped('./') : req));
});
