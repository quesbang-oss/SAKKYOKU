// Voice DAW Service Worker — オフライン動作のためのキャッシュ管理
// scripts/gen-precache.mjs が下記2つの定数を自動更新します（npm run build 時）。
const CACHE_VERSION = "b072cf091ed5";
const PRECACHE_FILES = [
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "index.html",
  "manifest.json",
  "package.json",
  "src/analysis/analyze.js",
  "src/analysis/pitch.js",
  "src/app.js",
  "src/audio/drums.js",
  "src/audio/edit.js",
  "src/audio/engine.js",
  "src/audio/fft.js",
  "src/effects/core.js",
  "src/effects/fx-basic.js",
  "src/effects/fx-drive.js",
  "src/effects/fx-glitch.js",
  "src/effects/fx-mod.js",
  "src/effects/fx-time.js",
  "src/effects/fx-voice.js",
  "src/effects/presets.js",
  "src/effects/registry.js",
  "src/effects/worklet-fx.js",
  "src/export/exporter.js",
  "src/export/wav.js",
  "src/main.js",
  "src/midi/midi.js",
  "src/pwa/pwa.js",
  "src/recorder/recorder.js",
  "src/recorder/worklet-rec.js",
  "src/sampler/sampler.js",
  "src/sequencer/render-worker.js",
  "src/sequencer/render.js",
  "src/sequencer/renderer.js",
  "src/sequencer/transport.js",
  "src/storage/db.js",
  "src/synthesizer/synth.js",
  "src/timeline/project.js",
  "src/ui/compare.js",
  "src/ui/draw.js",
  "src/ui/drummachine.js",
  "src/ui/experiment.js",
  "src/ui/exportdialog.js",
  "src/ui/fxchain.js",
  "src/ui/instruments.js",
  "src/ui/keyboard.js",
  "src/ui/library.js",
  "src/ui/livemode.js",
  "src/ui/loop.js",
  "src/ui/mixer.js",
  "src/ui/pads.js",
  "src/ui/projectdialog.js",
  "src/ui/recordpanel.js",
  "src/ui/settingsdialog.js",
  "src/ui/setupwizard.js",
  "src/ui/style.css",
  "src/ui/timeline.js",
  "src/utils/bus.js",
  "src/utils/dom.js",
  "src/utils/util.js",
  "src/vendor/lame.min.js"
];
const CACHE_NAME = 'voice-daw-' + CACHE_VERSION;
const SCOPE = self.registration.scope;
const abs = (p) => new URL(p, SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_FILES.map(async (f) => { try { await cache.add(new Request(abs(f), { cache: 'reload' })); } catch (e) { console.warn('[sw] precache failed', f, e); } }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('voice-daw-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return; // 外部(CDN等)は素通し

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { const net = await fetch(req); const cache = await caches.open(CACHE_NAME); cache.put(req, net.clone()); return net; }
      catch { const cache = await caches.open(CACHE_NAME); return (await cache.match(req)) || (await cache.match(abs('index.html'))); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME); const cached = await cache.match(req);
    const fetchPromise = fetch(req).then((net) => { if (net && net.ok) cache.put(req, net.clone()); return net; }).catch(() => null);
    return cached || (await fetchPromise) || new Response('オフラインのため読み込めません', { status: 503, statusText: 'Offline' });
  })());
});
