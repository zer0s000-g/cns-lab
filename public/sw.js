/*
 * CNS Lab service worker: small and conservative.
 * - Pages: network first, so a new deploy is always picked up when online;
 *   the cached app shell is the offline fallback.
 * - Build assets (hashed file names, never change): cache first, cached on use.
 * Nothing is downloaded in the background beyond the app shell: a module works
 * offline once it has been opened online. The first visit loads before this worker
 * controls the page, so the page sends the list of assets it already loaded
 * ({ type: 'cache-urls' }) and they are cached then.
 * The build id and the shell's asset list are filled in by scripts/postbuild.mjs.
 */
const BUILD = '__BUILD_ID__'
const CACHE = `cnslab-${BUILD}`
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg']
/** Entry JS and CSS of this build (relative to the worker). */
const SHELL_ASSETS = [/* __SHELL_ASSETS__ */]
/** A slow network falls back to the cached page after this long (only when one is cached). */
const NAV_TIMEOUT_MS = 5000

const isAssetPath = (url) => url.origin === self.location.origin && url.pathname.includes('/assets/')

/** Store a response only if it is a real file: an HTML fallback page served for a missing .js must not be cached as that file. */
function cacheable(req, res) {
  if (!res || !res.ok || res.type === 'opaque') return false
  const type = res.headers.get('content-type') || ''
  return !(isAssetPath(new URL(req.url)) && type.includes('text/html'))
}

function put(req, res) {
  if (!cacheable(req, res)) return Promise.resolve()
  const copy = res.clone()
  return caches
    .open(CACHE)
    .then((c) => c.put(req, copy))
    .catch(() => {}) // storage full: serving still works, it just is not saved
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload` skips the browser's HTTP cache, so the shell is this build's, never a stale copy.
      .then((c) => c.addAll([...SHELL, ...SHELL_ASSETS].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cnslab-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return
  const urls = data.urls
    .map((u) => {
      try {
        return new URL(u, self.location.href)
      } catch {
        return null
      }
    })
    .filter((u) => u && isAssetPath(u))
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        urls.map((u) =>
          c.match(u.href).then((hit) =>
            hit
              ? undefined
              : fetch(u.href)
                  .then((res) => put(new Request(u.href), res))
                  .catch(() => {}),
          ),
        ),
      ),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    let saving = Promise.resolve()
    const network = fetch(req).then((res) => {
      saving = put(req, res) // clones before the page reads the body
      return res
    })
    // Registered now: the cached copy may answer first, and the save must still finish.
    event.waitUntil(network.then(() => saving).catch(() => {}))
    const cached = () => caches.match(req).then((hit) => hit || caches.match('./index.html'))
    const slow = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS)).then(() => caches.match(req))
    event.respondWith(
      Promise.race([network, slow.then((hit) => hit || network)])
        .catch(() => cached())
        .then((res) => res || Response.error()),
    )
    return
  }

  if (isAssetPath(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            event.waitUntil(put(req, res))
            return res
          }),
      ),
    )
    return
  }

  event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())))
})
