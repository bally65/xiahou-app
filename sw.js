/* service worker: NETWORK-FIRST for same-origin (so updates apply on next online open,
   no reinstall), falling back to cache when offline. */
const CACHE = 'sbcv-pwa-v4';
const ASSETS = ['./','./index.html','./app.js','./config.js','./vendor/jsQR.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e=>{ self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{})); });
self.addEventListener('activate', e=>{ e.waitUntil(
  caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('message', e=>{ if(e.data==='skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e=>{ const u=new URL(e.request.url);
  if(u.origin!==location.origin || e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request).then(resp=>{ const cp=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{}); return resp; })
    .catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))
  );
});
