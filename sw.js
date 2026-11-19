const prefix = 'ubc-trees-' + encodeURIComponent(self.registration.scope) + '-';
const cacheName = prefix + '9e58bfcd88bd';
const files = [
  "./app.js",
  "./assets/photos/abies-grandis.jpg",
  "./assets/photos/acer-circinatum.jpg",
  "./assets/photos/acer-freemanii.jpg",
  "./assets/photos/acer-macrophyllum.jpg",
  "./assets/photos/acer-palmatum.jpg",
  "./assets/photos/acer-platanoides.jpg",
  "./assets/photos/alnus-rubra.jpg",
  "./assets/photos/arbutus-menziesii.jpg",
  "./assets/photos/cercidiphyllum-japonicum.jpg",
  "./assets/photos/cornus-kousa.jpg",
  "./assets/photos/cornus-nuttallii.jpg",
  "./assets/photos/ginkgo-biloba.jpg",
  "./assets/photos/liquidambar-styraciflua.jpg",
  "./assets/photos/metasequoia-glyptostroboides.jpg",
  "./assets/photos/picea-sitchensis.jpg",
  "./assets/photos/pinus-nigra.jpg",
  "./assets/photos/platanus-hispanica.jpg",
  "./assets/photos/populus-trichocarpa.jpg",
  "./assets/photos/prunus-serrulata.jpg",
  "./assets/photos/pseudotsuga-menziesii.jpg",
  "./assets/photos/quercus-garryana.jpg",
  "./assets/photos/quercus-rubra.jpg",
  "./assets/photos/sequoia-sempervirens.jpg",
  "./assets/photos/sequoiadendron-giganteum.jpg",
  "./assets/photos/thuja-plicata.jpg",
  "./assets/photos/tilia-cordata.jpg",
  "./assets/photos/tsuga-heterophylla.jpg",
  "./backup.js",
  "./data/locations.json",
  "./data/species.json",
  "./icons/tree-180.png",
  "./icons/tree-192.png",
  "./icons/tree-512.png",
  "./index.html",
  "./learning.js",
  "./manifest.webmanifest",
  "./storage.js",
  "./styles.css",
  "./vendor/fflate.js",
  "./vendor/images/layers-2x.png",
  "./vendor/images/layers.png",
  "./vendor/images/marker-icon-2x.png",
  "./vendor/images/marker-icon.png",
  "./vendor/images/marker-shadow.png",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter(key => key.startsWith(prefix) && key !== cacheName);
    await Promise.all(old.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  const page = new URL(request.url);
  const scope = new URL(self.registration.scope);
  const isHome = request.mode === 'navigate'
    && (page.pathname === scope.pathname || page.pathname === scope.pathname + 'index.html');
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (isHome) {
      const home = await cache.match('./index.html');
      if (home) return home;
    }
    return (await cache.match(request)) ?? fetch(request);
  })());
});
