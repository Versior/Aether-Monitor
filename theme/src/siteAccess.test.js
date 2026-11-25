import test from 'node:test'
import assert from 'node:assert/strict'
import { createSiteAccess, needsVerification, sourceViewUrl } from './siteAccess.js'
import { createMonitorSession } from './monitorSession.js'
import { STORAGE } from '../../src/frontend/utils/constants.js'

const primary = 'https://primary.example.test'
const secondary = 'https://other.example.test'
const publicSite = { is_public: true, authorization: false, turnstile_enabled: false, verified: false, theme_options: {} }

test('跨域受限站点可在源站查看相同节点：仅携带节点 ID，不沿用多站参数或登录信息', () => {
  const staticOrigin = 'https://theme.example.test'
  assert.equal(sourceViewUrl(secondary, '', staticOrigin), `${secondary}/#/`)
  assert.equal(sourceViewUrl(`${secondary}/?site=1#old`, 'node:42', staticOrigin), `${secondary}/#/server/node%3A42`)
  assert.equal(sourceViewUrl(primary, 'node:42', primary), '')
})

test('静态页首次跳源站登录，返回或刷新后留在页面；每个标签页与 Worker 单独计数', async () => {
  const persisted = new Map()
  const tabStorage = { getItem: key => persisted.get(key), setItem: (key, value) => persisted.set(key, value), removeItem: key => persisted.delete(key) }
  const options = { origin: 'https://theme.example.test', tabStorage, shouldRedirect: () => true }
  const privateSite = () => Response.json({ ...publicSite, is_public: false })
  const firstVisit = fixture(privateSite, options)
  await firstVisit.access.config(primary)
  assert.deepEqual(firstVisit.navigations, [`${primary}/admin#/admin`])
  const backOrReload = fixture(privateSite, options)
  await backOrReload.access.config(primary)
  assert.deepEqual(backOrReload.navigations, [])
  await backOrReload.access.config(secondary)
  assert.deepEqual(backOrReload.navigations, [`${secondary}/admin#/admin`])
  assert.equal(persisted.size, 2)
  assert.deepEqual([...new Set(persisted.values())], ['1'])
  const otherTab = fixture(privateSite, { ...options, tabStorage: { getItem: () => null, setItem() {} } })
  await otherTab.access.config(primary)
  assert.deepEqual(otherTab.navigations, [`${primary}/admin#/admin`])
})

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

function connectedFixture(handle, bases = [primary]) {
  const harness = fixture(handle, {
    onBlocked: (base, status, error) => monitor.block(base, status, error),
    onConfig: (base, config) => { monitor.state.sites.find(site => site.base === base).config = config },
  })
  const monitor = createMonitorSession({ bases, access: harness.access, isHidden: () => false,
    timers: { setInterval: () => 1, clearInterval() {} }, openSocket: () => ({ close() {} }) })
  return { ...harness, monitor }
}

test('运行中开启验证：第一次数据 403 只重读本站配置一次，不带验证票，不重放失败请求', async () => {
  let reads = 0
  const { access, monitor, requests } = connectedFixture(request => {
    const { origin, pathname } = new URL(request.url)
    if (pathname === '/api/config') return Response.json(origin === primary && ++reads > 1
      ? { ...publicSite, turnstile_enabled: true, turnstile_site_key: 'new-sitekey' } : publicSite)
    return origin === primary ? Response.json({}, { status: 403 }) : Response.json({ servers: [], stats: { total: 0, online: 0, offline: 0 } })
  }, [primary, secondary])
  await monitor.navigate('#/')
  const [blocked, unaffected] = monitor.state.sites
  assert.equal(blocked.blocked, 403)
  assert.equal(needsVerification(blocked.config), true)
  assert.equal((await access.config(primary)).turnstile_site_key, 'new-sitekey')
  assert.equal(unaffected.blocked, null)
  const own = requests.filter(req => new URL(req.url).origin === primary)
  assert.deepEqual(own.map(req => new URL(req.url).pathname), ['/api/config', '/api/servers', '/api/config'])
  assert.equal(own.at(-1).headers.has('X-Turnstile-Token') || own.at(-1).headers.has('X-Turnstile-Verified'), false)
  assert.equal(requests.filter(req => req.url === `${secondary}/api/config`).length, 1)
  monitor.dispose()
})

for (const deniedAt of ['config', 'servers']) test(`首次 ${deniedAt} 被拒且无可用验证组件时，等手动重连后重新加载`, async () => {
  let limited = true
  const { monitor, requests } = connectedFixture(request => {
    const path = new URL(request.url).pathname
    if (limited && path === `/api/${deniedAt}`) return Response.json({ error: 'Forbidden' }, { status: 403 })
    return Response.json(path === '/api/config' ? publicSite : { servers: [], stats: { total: 0, online: 0, offline: 0 } })
  })
  await monitor.navigate('#/')
  const site = monitor.state.sites[0]
  assert.equal(site.blocked, 403)
  const paths = () => requests.map(req => new URL(req.url).pathname)
  const before = deniedAt === 'config' ? ['/api/config'] : ['/api/config', '/api/servers', '/api/config']
  assert.deepEqual(paths(), before)
  await monitor.setVisible(false); await monitor.setVisible(true)
  assert.deepEqual(paths(), before)
  limited = false
  await monitor.retry(primary)
  assert.equal(site.blocked, null)
  assert.deepEqual(paths(), [...before, '/api/config', '/api/servers'])
  assert.ok(site.snapshotAt)
  monitor.dispose()
})

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

test('配套宿主只接收 Aether 的补丁，新的其他主题配置从写入响应带回', async () => {
  const original = { aether: { layout: 'compact', unknown: true }, other: { color: 'red' } }
  const updated = { aether: { layout: 'full', unknown: true }, other: { color: 'green' }, added: {} }
  const { access, requests } = fixture(async request => {
    if (request.method === 'GET') return Response.json({ ...publicSite, authorization: true, theme_options_patch: true, theme_options: original })
    assert.deepEqual(await request.json(), { theme_options_patch: { namespace: 'aether', options: { layout: 'full' } } })
    return Response.json({ success: true, theme_options: updated })
  })
  await access.config(primary)
  await access.save(primary, { layout: 'full' })
  assert.deepEqual((await access.config(primary)).theme_options, updated)
  assert.equal(requests.length, 2)
})

test('旧宿主只在显式保存前重读其他主题；缺失有效快照时不写完整对象', async () => {
  let options = { aether: { layout: 'compact' }, other: { color: 'red' } }
  const { access, requests } = fixture(async request => {
    if (request.method === 'GET') return Response.json({ ...publicSite, authorization: true, theme_options: options })
    const body = await request.json()
    assert.deepEqual(body, { theme_options: { aether: { layout: 'full', unknown: 1 }, other: { color: 'green' }, added: {} } })
    return Response.json({ success: true, theme_options: body.theme_options })
  })
  await access.config(primary)
  options = { aether: { layout: 'compact', unknown: 1 }, other: { color: 'green' }, added: {} }
  await access.save(primary, { layout: 'full' })
  options = null
  await assert.rejects(access.save(primary, { layout: 'compact' }), /Invalid theme options/)
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/api/config', '/api/config', '/api/theme_options', '/api/config'])
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
