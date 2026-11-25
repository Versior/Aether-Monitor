import test from 'node:test'
import assert from 'node:assert/strict'
import { createSiteAccess, needsVerification } from './siteAccess.js'
import { createMonitorSession } from './monitorSession.js'
import { STORAGE } from '../../src/frontend/utils/constants.js'

const primary = 'https://primary.example.test'
const secondary = 'https://other.example.test'
const publicSite = { is_public: true, authorization: false, turnstile_enabled: false, verified: false, theme_options: {} }

function fixture(handle, options = {}) {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
  const requests = [], navigations = [], blocked = []
  const access = createSiteAccess({ origin: primary, storage, navigate: url => navigations.push(url), shouldRedirect: base => base === primary,
    onBlocked: (base, status) => blocked.push([base, status]), ...options,
    fetch: async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      return await handle(request)
    } })
  return { access, storage, requests, navigations, blocked }
}

test('私有站配置先决定登录，聚合次站不接管主页面，并发初始化不重复取配置', async () => {
  const { access, requests, navigations } = fixture(() => Response.json({ ...publicSite, is_public: false, turnstile_enabled: true }))
  await Promise.all([access.config(primary), access.config(primary), access.config(secondary)])
  assert.equal((await access.config(primary)).authorization, false)
  assert.deepEqual(navigations, [`${primary}/admin#/admin`])
  assert.deepEqual(requests.map(request => request.url), [`${primary}/api/config`, `${secondary}/api/config`])
})

test('首次用单次票换取本站凭证，刷新用首个数据请求验证缓存，过期立即回到挑战', async () => {
  let expired = false
  const challenge = { ...publicSite, turnstile_enabled: true, turnstile_site_key: 'fixture-sitekey' }
  const responder = request => {
    if (new URL(request.url).pathname === '/api/config') return Response.json(request.headers.has('X-Turnstile-Token')
      ? { ...challenge, verified: true, turnstile_verified: 'accepted-receipt' } : challenge)
    return !expired && request.headers.get('X-Turnstile-Verified') === 'accepted-receipt'
      ? Response.json({ servers: [] }) : Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const first = fixture(responder)
  assert.equal(needsVerification(await first.access.config(primary)), true)
  assert.equal((await first.access.verify(primary, 'one-time')).verified, true)
  await first.access.get(primary, '/api/servers')
  assert.equal(first.requests.length, 3)
  assert.equal(first.requests[1].headers.get('X-Turnstile-Token'), 'one-time')
  assert.equal(first.requests[2].headers.has('X-Turnstile-Token'), false)
  assert.equal(first.storage.getItem(STORAGE.TURNSTILE_VERIFIED), 'accepted-receipt')
  const refresh = fixture(responder, { storage: first.storage })
  assert.equal(needsVerification(await refresh.access.config(primary)), false)
  await refresh.access.get(primary, '/api/servers')
  assert.equal((await refresh.access.config(primary)).verified, true)
  assert.equal(refresh.requests[0].headers.has('X-Turnstile-Verified'), false)
  expired = true
  await assert.rejects(refresh.access.get(primary, '/api/server?id=fixture'), error => error.status === 403)
  assert.equal(needsVerification(await refresh.access.config(primary)), true)
  assert.equal(first.storage.getItem(STORAGE.TURNSTILE_VERIFIED), null)
  assert.deepEqual(refresh.blocked, [[primary,403]])
})

test('同源 JWT 只发回签发站；跨域站只用按 origin 保存的 JWT，401 不清除另一站登录', async () => {
  const { access, requests, storage, navigations, blocked } = fixture(request => new URL(request.url).pathname === '/api/config'
    ? Response.json({ ...publicSite, authorization: true }) : Response.json({ error: 'Unauthorized' }, { status: 401 }))
  storage.setItem(STORAGE.JWT_TOKEN, 'local-fixture')
  await access.config(primary)
  await access.config(secondary)
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer local-fixture')
  assert.equal(requests[1].headers.has('Authorization'), false)
  assert.equal(access.wsToken(secondary), '')
  storage.setItem(`aether:${secondary}:${STORAGE.JWT_TOKEN}`, 'scoped-fixture')
  assert.equal(access.wsToken(secondary), 'scoped-fixture')
  await assert.rejects(access.get(secondary, '/api/servers'), error => error.status === 401 && error.loginUrl === `${secondary}/admin#/admin`)
  assert.equal(requests[2].headers.get('Authorization'), 'Bearer scoped-fixture')
  assert.equal(access.wsToken(secondary), '')
  assert.equal(storage.getItem(STORAGE.JWT_TOKEN), 'local-fixture')
  assert.deepEqual(blocked, [[secondary, 401]])
  assert.deepEqual(navigations, [])
})

test('只有已登录者能写站点选项；保存保留旁系主题及当前主题未识别的字段，并使用 Worker 的回复', async () => {
  const original = { aether: { layout: 'compact', strictNetwork: true }, neighbor: { lang: 'en' } }
  let written
  const { access, requests, storage } = fixture(async request => {
    if (new URL(request.url).pathname === '/api/config') return Response.json({ ...publicSite,
      authorization: request.headers.has('Authorization'), theme_options: original })
    written = await request.json()
    return Response.json({ success: true, theme_options: { ...written.theme_options, revision: 2 } })
  })
  storage.setItem(STORAGE.JWT_TOKEN, 'fixture-login')
  assert.equal((await access.save(primary, { layout: 'full' })).theme_options.revision, 2)
  assert.equal(requests[1].method, 'POST')
  assert.equal(requests[1].url, `${primary}/api/theme_options`)
  assert.equal(requests[1].headers.get('Authorization'), 'Bearer fixture-login')
  assert.deepEqual(written, { theme_options: { aether: { layout: 'full', strictNetwork: true }, neighbor: original.neighbor } })
  await assert.rejects(access.save(secondary, { layout: 'full' }), error => error.status === 401)
  assert.equal(requests.filter(request => request.method === 'POST').length, 1)
})

test('关闭验证后初始化、读、写都不发送遗留票据', async () => {
  const { access, storage, requests } = fixture(request => Response.json(new URL(request.url).pathname === '/api/config'
    ? { ...publicSite, authorization: true } : request.method === 'POST' ? { success: true, theme_options: {} } : []))
  storage.setItem(STORAGE.TURNSTILE_VERIFIED, 'previous-receipt')
  storage.setItem(STORAGE.TURNSTILE_TOKEN, 'previous-raw-token')
  await access.get(primary, '/api/servers')
  await access.save(primary, { layout: 'compact' })
  assert.equal(requests.some(request => request.headers.has('X-Turnstile-Verified') || request.headers.has('X-Turnstile-Token')), false)
  assert.equal(storage.getItem(STORAGE.TURNSTILE_VERIFIED), null)
})

for (const status of [401, 403]) test(`迟到的 ${status} 保留新凭证，详情与实时连接不会被二次清空`, async () => {
  const waiting = Promise.withResolvers(), sent = Promise.withResolvers()
  const forbidden = () => Response.json({ error: 'fixture' }, { status })
  const challenge = { ...publicSite, authorization: true, turnstile_enabled: status === 403 }
  const { access, storage, navigations, blocked } = fixture(request => {
    const url = new URL(request.url)
    if (url.pathname === '/api/config') return Response.json(request.headers.has('X-Turnstile-Token')
      ? { ...challenge, verified: true, turnstile_verified: 'renewed-receipt' } : challenge)
    if (url.pathname === '/api/server') return Response.json({ id: 'probe', name: 'Fixture', cpu: 12 })
    if (url.searchParams.get('hours') === '6' && !request.headers.get('X-Turnstile-Verified')?.startsWith('renewed')) {
      sent.resolve(); return waiting.promise
    }
    return Response.json([])
  })
  storage.setItem(STORAGE.JWT_TOKEN, 'original-jwt')
  if (status === 403) storage.setItem(STORAGE.TURNSTILE_VERIFIED, 'original-receipt')
  const sockets = []
  const monitor = createMonitorSession({ bases: [primary], access, isHidden: () => false,
    timers: { setInterval: () => 1, clearInterval() {} },
    openSocket() { const socket = { closed: false, close() { this.closed = true } }; sockets.push(socket); return socket },
  })
  try {
    await monitor.navigate('#/server/probe')
    const oldRange = monitor.setHours(6)
    await sent.promise
    if (status === 401) storage.setItem(STORAGE.JWT_TOKEN, 'renewed-jwt')
    else await access.verify(primary, 'new-challenge')
    waiting.resolve(forbidden()); await oldRange
    assert.equal(access.wsToken(primary), status === 401 ? 'renewed-jwt' : 'original-jwt')
    if (status === 403) assert.equal(storage.getItem(STORAGE.TURNSTILE_VERIFIED), 'renewed-receipt')
    assert.deepEqual(navigations, []); assert.deepEqual(blocked, [])
    assert.equal(monitor.state.sites[0].blocked, null); assert.equal(monitor.state.detail.node.id, 'probe'); assert.equal(sockets[0].closed, false)
    assert.match(monitor.state.detail.error, new RegExp(String(status)))
    await monitor.setHours(1); assert.equal(monitor.state.detail.error, '')
  } finally { monitor.dispose() }
})

test('同时失效的两次旧请求只拦截一次，新验证码即便换回相同票值也不被晚响应销毁', async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(), dispatched = Promise.withResolvers()
  let reads = 0
  const { access, storage, blocked } = fixture(request => {
    if (new URL(request.url).pathname === '/api/config') return Response.json(request.headers.has('X-Turnstile-Token')
      ? { ...publicSite, verified: true, turnstile_enabled: true, turnstile_verified: 'fixture-receipt' } : { ...publicSite, turnstile_enabled: true })
    if (++reads === 1) return first.promise
    dispatched.resolve(); return second.promise
  })
  storage.setItem(STORAGE.TURNSTILE_VERIFIED, 'fixture-receipt'); await access.config(primary)
  const early = access.get(primary, '/api/servers'), late = access.get(primary, '/api/history/all?id=fixture&hours=6')
  await dispatched.promise
  first.resolve(Response.json({}, { status: 403 })); await assert.rejects(early, error => error.status === 403 && !error.staleCredentials)
  await access.verify(primary, 'new-challenge')
  second.resolve(Response.json({}, { status: 403 })); await assert.rejects(late, error => error.status === 403 && error.staleCredentials)
  assert.equal(storage.getItem(STORAGE.TURNSTILE_VERIFIED), 'fixture-receipt'); assert.equal((await access.config(primary)).verified, true)
  assert.deepEqual(blocked, [[primary, 403]])
})
