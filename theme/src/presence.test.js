import assert from 'node:assert/strict'
import test from 'node:test'
import { createSiteAccess } from './siteAccess.js'
import { createMonitorSession } from './monitorSession.js'

const start = 1_800_000_000_000
const first = 'https://a.example.invalid', second = 'https://b.example.invalid'

function dashboard(hosts, skew) {
  let elapsed = 0, clock
  const sockets = [], requests = [], bases = Object.keys(hosts)
  const access = createSiteAccess({ origin: bases[0], storage: { getItem: () => null, removeItem() {} }, fetch: async address => {
    const url = new URL(address), host = hosts[url.origin], at = host.time + elapsed
    requests.push(url.pathname)
    const headers = host.date ? { date: new Date(at).toUTCString() } : {}
    if (url.pathname === '/api/config') return Response.json({ is_public: true })
    if (url.pathname === '/api/servers') return Response.json({ servers: host.nodes, stats: host.stats, latestReportUpdates: host.reports || [] }, { headers })
    if (url.pathname === '/api/server') return Response.json(host.nodes.find(node => node.id === url.searchParams.get('id')), { headers })
    assert.equal(url.pathname, '/api/history/all')
    return Response.json([])
  } })
  const session = createMonitorSession({ bases, access, now: () => start + elapsed + skew, isHidden: () => false,
    timers: { setInterval(callback) { clock = callback; return 1 }, clearInterval() { clock = null } },
    openSocket(scope, handlers, site) { const socket = { scope, site, ...handlers, close() {} }; sockets.push(socket); return socket },
  })
  return { ...session, sockets, requests, tick(seconds = 1) { for (let count = 0; count < seconds; count++) { elapsed += 1000; clock() } } }
}

for (const skew of [-120000, 120000]) test(`浏览器偏差 ${skew / 60000} 分钟：按本站 Date 和五分钟边界改数，热详情与卡片一致`, async () => {
  const nodes = [{ id: 'offline', last_updated: start - 360000 }, { id: 'edge', last_updated: start - 298000 }]
  const stats = { total: 2, online: 1, offline: 1 }
  const app = dashboard({ [first]: { nodes, stats, time: start, date: true } }, skew)
  await app.navigate('#/')
  assert.deepEqual(app.state.stats, stats)
  assert.deepEqual(app.state.nodes.map(app.online), [false, true])
  await app.navigate('#/server/edge'); assert.equal(app.sockets.length, 1)
  app.tick(); assert.equal(app.online(app.state.detail.node), true)
  app.tick(); assert.equal(app.online(app.state.detail.node), false)
  assert.deepEqual(app.state.stats, { total: 2, online: 0, offline: 2 })
  const stream = app.sockets[0]
  stream.onUpdate({ serverId: 'offline', ts: start + 2000, data: { last_updated: start - 360000 } })
  app.tick(); assert.equal(app.state.stats.online, 0)
  stream.onUpdate({ serverId: 'edge', ts: start + 3000, data: { cpu: 18 } })
  app.tick(); assert.equal(app.online(app.state.detail.node), true)
  await app.navigate('#/'); assert.deepEqual(app.state.stats, stats)
  assert.deepEqual(app.state.nodes.map(app.online), [false, true])
  assert.deepEqual(app.requests, ['/api/config','/api/servers','/api/server','/api/history/all'])
  app.dispose()
})

test('各站独立校时：跨域从报告年龄取得基准，未拿到时间的站保留快照直到 WS hello', async () => {
  const otherTime = start - 900000
  const stats = { total: 1, online: 1, offline: 0 }
  const app = dashboard({
    [first]: { nodes: [{ id: 'same', last_updated: start - 299000 }], stats, time: start, reports: [{ reportTs: start - 8000, reportAgeMs: 8000 }] },
    [second]: { nodes: [{ id: 'same', last_updated: otherTime - 299000 }], stats, time: otherTime },
  }, 120000)
  await app.navigate('#/'); assert.deepEqual(app.state.nodes.map(app.online), [true, true])
  app.tick(2); assert.deepEqual(app.state.nodes.map(app.online), [false, true]); assert.equal(app.state.stats.online, 1)
  app.sockets[1].onServerTime(otherTime + 2000)
  app.tick(); assert.deepEqual(app.state.nodes.map(app.online), [false, false])
  app.sockets[1].onUpdate({ serverId: 'same', ts: otherTime + 3000, data: { cpu: 2 } }); app.tick()
  assert.deepEqual(app.state.nodes.map(app.online), [false, true]); assert.deepEqual(app.state.stats, { total: 2, online: 1, offline: 1 })
  assert.equal(app.requests.length, 4); app.dispose()
})

test('冷详情使用单节点响应 Date；返回首页以前不产生列表统计或全站请求', async () => {
  const app = dashboard({ [first]: { time: start, date: true, nodes: [{ id: 'edge', last_updated: start - 299000 }], stats: { total: 1, online: 0, offline: 1 } } }, 120000)
  await app.navigate('#/server/edge'); assert.equal(app.online(app.state.detail.node), true); assert.equal(app.state.stats, null)
  app.tick(); assert.equal(app.online(app.state.detail.node), false)
  assert.deepEqual(app.requests, ['/api/config','/api/server','/api/history/all'])
  await app.navigate('#/'); assert.equal(app.state.stats.online, 0); assert.equal(app.online(app.state.nodes[0]), false)
  app.dispose()
})
