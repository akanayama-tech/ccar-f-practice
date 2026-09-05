/* ネット優先。取れたらそれを配り、落ちた時だけキャッシュを返す。
   ★キャッシュ優先にしない。古い版が居座って「直したのに直らない」が起きるため。
   版はビルドの中身から作るので、中身が変われば名前が変わり、古いものは activate で消える。 */
var CACHE = 'ccarf-d7d64848';
var ASSETS = ['./', './index.html', './manifest.webmanifest',
              './icon-180.png', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './diag.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 1つ取れなくても install を落とさない（diag.html が無い環境でも動くように）
    return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // 外部は触らない（そもそも引いていない）
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html') || caches.match('./');
      });
    })
  );
});
