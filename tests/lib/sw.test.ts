import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

// public/sw.js runs in a sandbox with a fake Cache Storage and a fake network.
const ORIGIN = 'https://site.test'
const SCOPE = `${ORIGIN}/cns-lab/`
const SOURCE = readFileSync(join(import.meta.dirname, '../../public/sw.js'), 'utf8')
  .replace('__BUILD_ID__', 'test1')
  .replace('/* __SHELL_ASSETS__ */', '"./assets/index-a.js", "./assets/index-b.css"')

type Handler = (e: unknown) => void
interface Sw {
  handlers: Record<string, Handler>
  store: Map<string, Map<string, Response>>
  requests: { url: string; cache?: RequestCache }[]
  online: boolean
  failPut: boolean
  /** Path → [body, content-type] served while online. */
  files: Record<string, [string, string, number?]>
}

let sw: Sw

function makeWorker(): Sw {
  const s: Sw = { handlers: {}, store: new Map(), requests: [], online: true, failPut: false, files: {} }
  const urlOf = (r: RequestInfo | URL) => new URL(typeof r === 'string' ? r : r instanceof URL ? r.href : r.url, SCOPE).href
  const openCache = (name: string) => {
    if (!s.store.has(name)) s.store.set(name, new Map())
    const m = s.store.get(name)!
    return {
      match: async (r: RequestInfo) => m.get(urlOf(r))?.clone(),
      put: async (r: RequestInfo, res: Response) => {
        if (s.failPut) throw new DOMException('full', 'QuotaExceededError')
        m.set(urlOf(r), res)
      },
      addAll: async (list: Request[]) => {
        for (const r of list) {
          const res = await fakeFetch(r)
          if (!res.ok) throw new TypeError('addAll failed')
          m.set(urlOf(r), res)
        }
      },
    }
  }
  const fakeFetch = async (r: RequestInfo | URL): Promise<Response> => {
    const url = urlOf(r)
    s.requests.push({ url, cache: r instanceof Request ? r.cache : undefined })
    if (!s.online) throw new TypeError('Failed to fetch')
    const path = new URL(url).pathname
    const f = s.files[path] ?? (path === '/cns-lab/' ? s.files['/cns-lab/index.html'] : undefined)
    if (!f) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    return new Response(f[0], { status: f[2] ?? 200, headers: { 'content-type': f[1] } })
  }
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    addEventListener: (type: string, h: Handler) => (s.handlers[type] = h),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  const caches = {
    open: async (name: string) => openCache(name),
    keys: async () => [...s.store.keys()],
    delete: async (name: string) => s.store.delete(name),
    match: async (r: RequestInfo) => {
      for (const name of s.store.keys()) {
        const hit = await openCache(name).match(r)
        if (hit) return hit
      }
      return undefined
    },
  }
  // In a worker, relative request URLs resolve against the worker's own location.
  class SwRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, self.location.href).href : input, init)
    }
  }
  runInNewContext(SOURCE, { self, caches, fetch: fakeFetch, Request: SwRequest, Response, URL, Promise, setTimeout, console })
  return s
}

async function dispatch(type: string, init: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = []
  let response: Promise<Response> | undefined
  sw.handlers[type]({ ...init, waitUntil: (p: Promise<unknown>) => pending.push(p), respondWith: (p: Promise<Response>) => (response = p) })
  const res = response ? await response : undefined
  await Promise.all(pending)
  return res
}

const get = (path: string, mode: RequestMode = 'no-cors') => ({ request: { method: 'GET', url: `${ORIGIN}${path}`, mode } })
const cached = () => [...(sw.store.get('cnslab-test1')?.keys() ?? [])].map((u) => new URL(u).pathname).sort()

beforeEach(() => {
  sw = makeWorker()
  sw.files = {
    '/cns-lab/index.html': ['<html>shell</html>', 'text/html'],
    '/cns-lab/manifest.webmanifest': ['{}', 'application/manifest+json'],
    '/cns-lab/favicon.svg': ['<svg/>', 'image/svg+xml'],
    '/cns-lab/assets/index-a.js': ['entry', 'text/javascript'],
    '/cns-lab/assets/index-b.css': ['css', 'text/css'],
    '/cns-lab/assets/psr-c.js': ['psr', 'text/javascript'],
    '/cns-lab/assets/font-d.woff2': ['font', 'font/woff2'],
    '/cns-lab/modules/psr.html': ['<html>psr</html>', 'text/html'],
  }
})

describe('service worker', () => {
  it('installs the shell and the entry JS/CSS, bypassing the HTTP cache', async () => {
    await dispatch('install')
    expect(cached()).toEqual(['/cns-lab/', '/cns-lab/assets/index-a.js', '/cns-lab/assets/index-b.css', '/cns-lab/favicon.svg', '/cns-lab/index.html', '/cns-lab/manifest.webmanifest'])
    expect(sw.requests.every((r) => r.cache === 'reload')).toBe(true)
  })

  it('caches the assets the first visit loaded before it was in control, then serves them offline', async () => {
    await dispatch('install')
    await dispatch('message', { data: { type: 'cache-urls', urls: [`${ORIGIN}/cns-lab/assets/psr-c.js`, `${ORIGIN}/cns-lab/assets/font-d.woff2`, 'https://evil.test/assets/x.js', `${ORIGIN}/cns-lab/api/data`, 'not a url::'] } })
    expect(cached()).toContain('/cns-lab/assets/psr-c.js')
    expect(cached()).toContain('/cns-lab/assets/font-d.woff2')
    expect(cached().some((p) => p.includes('api'))).toBe(false)
    sw.online = false
    const res = await dispatch('fetch', get('/cns-lab/assets/psr-c.js'))
    expect(await res!.text()).toBe('psr')
  })

  it('offline, an unseen page falls back to the cached app shell', async () => {
    await dispatch('install')
    sw.online = false
    const res = await dispatch('fetch', get('/cns-lab/modules/dme', 'navigate'))
    expect(await res!.text()).toBe('<html>shell</html>')
  })

  it('online, pages come from the network and are saved for later', async () => {
    await dispatch('install')
    const res = await dispatch('fetch', get('/cns-lab/modules/psr.html', 'navigate'))
    expect(await res!.text()).toBe('<html>psr</html>')
    expect(cached()).toContain('/cns-lab/modules/psr.html')
  })

  it('never stores an HTML fallback page under a .js asset URL', async () => {
    await dispatch('install')
    sw.files['/cns-lab/assets/old-e.js'] = ['<html>spa fallback</html>', 'text/html']
    await dispatch('fetch', get('/cns-lab/assets/old-e.js'))
    expect(cached()).not.toContain('/cns-lab/assets/old-e.js')
  })

  it('does not cache error responses', async () => {
    await dispatch('install')
    await dispatch('fetch', get('/cns-lab/assets/missing.js'))
    expect(cached()).not.toContain('/cns-lab/assets/missing.js')
  })

  it('still serves an asset when the cache is full', async () => {
    await dispatch('install')
    sw.failPut = true
    const res = await dispatch('fetch', get('/cns-lab/assets/psr-c.js'))
    expect(await res!.text()).toBe('psr')
  })

  it('offline, an uncached non-asset request fails as a network error instead of hanging', async () => {
    await dispatch('install')
    sw.online = false
    const res = await dispatch('fetch', get('/cns-lab/robots.txt'))
    expect(res!.type).toBe('error')
  })

  it('removes the caches of older builds on activate', async () => {
    sw.store.set('cnslab-old', new Map())
    sw.store.set('other-app', new Map())
    await dispatch('install')
    await dispatch('activate')
    expect([...sw.store.keys()].sort()).toEqual(['cnslab-test1', 'other-app'])
  })
})
