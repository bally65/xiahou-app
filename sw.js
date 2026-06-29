/* service worker: offline app shell (cache-first for our files) */
const CACHE = 'sbcv-pwa-v1';
const ASSETS = ['./','./index.html','./app.js','./vendor/jsQR.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e=>{ self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{})); });
self.addEventListener('activate', e=>{ e.waitUntil(
  caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{ const u=new URL(e.request.url);
  if(u.origin!==location.origin) return; // don't intercept cross-origin
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{}); return resp;
  }).catch(()=>caches.match('./index.html')))); });
