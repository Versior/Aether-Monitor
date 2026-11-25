import test from 'node:test'
import assert from 'node:assert/strict'
import { createMonitorSession } from './monitorSession.js'

const first = 'https://first.invalid', second = 'https://second.invalid'
const start = 1800000000000
const waitTurn = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => Promise.withResolvers()
const list = (servers, stats = { total: servers.length, online: servers.length, offline: 0 }) => ({ servers, stats, sysConfig: { show_three_net_details: true } })

function harness({ bases = [first], config = () => ({ is_public: true }), get, hidden = false } = {}) {
  const requests = [], sockets = [], intervals = new Map()
  let timestamp = start, nextTimer = 0
  const session = createMonitorSession({
    bases, now: () => timestamp, isHidden: () => hidden,
    access: {
      async config(base) { requests.push([base, '/api/config']); return config(base) },
      async get(base, path) {
        requests.push([base, path]); const url = new URL(path, base)
        if (get) return get(base, path, url)
        if (url.pathname === '/api/servers') return list([{ id: 'same', name: base, last_updated: start - 5000 }], { total: 7, online: 4, offline: 3 })
        if (url.pathname === '/api/server') return { id: url.searchParams.get('id'), name: base, last_updated: start - 5000 }
        return []
      },
      wsToken(base) { return base === first ? 'one' : 'two' },
    },
    openSocket(scope, handlers, index, ids) { const socket = { scope, handlers, index, ids, closed: false, close() { this.closed = true } }; sockets.push(socket); return socket },
    timers: { setInterval(callback, interval) { assert.equal(interval, 1000); intervals.set(++nextTimer, callback); return nextTimer }, clearInterval(key) { intervals.delete(key) } },
  })
  return { ...session, requests, sockets, intervals,
    tick(seconds = 1) { for (let count = 0; count < seconds; count++) { timestamp += 1000; for (const callback of intervals.values()) callback() } },
    visibility(visible) { hidden = !visible; return session.setVisible(visible) },
  }
}

test('每站只取一次配置和列表；总数服从 REST stats，热详情复用连接，回列表不请求', async () => {
  const app = harness({ bases: [first, second] })
  await app.navigate('#/')
  assert.deepEqual(app.state.stats, { total: 14, online: 8, offline: 6 })
  assert.equal(app.state.nodes.length, 2)
  assert.notEqual(app.state.nodes[0].key, app.state.nodes[1].key)
  assert.deepEqual(app.sockets.map(socket => [socket.index, socket.ids, socket.handlers.getToken()]), [[0, ['same'], 'one'], [1, ['same'], 'two']])
  assert.equal(app.detailHash(app.state.nodes[1]), '#/server/same?site=1')
  app.tick(65)
  assert.equal(app.requests.length, 4)
  await app.navigate(app.detailHash(app.state.nodes[1]))
  assert.equal(app.state.detail.node.source, second)
  assert.deepEqual(app.requests.slice(4), [[second, '/api/server?id=same'], [second, '/api/history/all?id=same&hours=0.167']])
  await app.setHours(6); await app.setHours(6); await app.setHours(5); await app.setHours(48)
  assert.deepEqual(app.requests.slice(6), [[second, '/api/history/all?id=same&hours=6']])
  await app.navigate('#/')
  assert.equal(app.sockets.length, 2)
  assert.equal(app.requests.length, 7)
  app.dispose(); assert.equal(app.intervals.size, 0)
})

test('冷详情只请求选中源站，按单节点补前台快照；第一次返回首页各站按需初始化', async () => {
  const app = harness({ bases: [first, second] })
  await app.navigate('#/server/same?site=1')
  assert.deepEqual(app.requests, [[second, '/api/config'], [second, '/api/server?id=same'], [second, '/api/history/all?id=same&hours=0.167']])
  assert.deepEqual(app.sockets.map(socket => socket.scope), ['same'])
  await app.visibility(false); assert.equal(app.sockets[0].closed, true); assert.equal(app.intervals.size, 0)
  await app.visibility(true)
  assert.deepEqual(app.requests.slice(3), [[second, '/api/server?id=same'], [second, '/api/history/all?id=same&hours=0.167']])
  assert.deepEqual(app.sockets.map(socket => socket.scope), ['same', 'same'])
  await app.navigate('#/')
  assert.equal(app.requests.filter(([, path]) => path === '/api/config').length, 2)
  assert.equal(app.requests.filter(([, path]) => path === '/api/servers').length, 2)
  assert.equal(app.sockets[1].closed, true)
})

test('初始隐藏不联网；隐藏期间完成的列表不能开 WS、覆写或泄露旧资源', async () => {
  const pending = deferred(); let loads = 0
  const app = harness({ hidden: true, get: () => ++loads === 1 ? pending.promise : list([{ id: 'current' }]) })
  await app.navigate('#/'); assert.equal(app.requests.length, 0)
  const late = app.visibility(true); await waitTurn()
  await app.visibility(false); await app.visibility(true)
  pending.resolve(list([{ id: 'stale' }])); await late
  assert.equal(app.sockets.length, 1)
  assert.deepEqual(app.state.nodes.map(node => node.id), ['current'])
  assert.equal(app.requests.filter(([, path]) => path === '/api/config').length, 1)
})

test('暂停不可自动恢复；只有点继续才重连，期间不再重复查配置', async () => {
  const app = harness()
  await app.navigate('#/')
  app.sockets[0].handlers.onTimeout()
  assert.equal(app.state.sites[0].paused, true); assert.equal(app.sockets[0].closed, true)
  await app.visibility(false); await app.visibility(true); app.tick(70)
  assert.equal(app.requests.length, 2); assert.equal(app.sockets.length, 1)
  await app.retry(first)
  assert.deepEqual(app.requests.slice(2), [[first, '/api/servers']]); assert.equal(app.sockets.length, 2)
  assert.equal(app.state.sites[0].paused, false)
})

test('一个 Worker 的 501 个 ID 分两批，多站零节点不空订阅', async () => {
  const ids = Array.from({ length: 501 }, (_, index) => `node-${index}`)
  const app = harness({ bases: [first, second], get: base => list((base === first ? ids : []).map(id => ({ id }))) })
  await app.navigate('#/')
  assert.deepEqual(app.sockets.map(socket => [socket.index, socket.ids.length]), [[0, 500], [0, 1]])
  assert.deepEqual(app.sockets.flatMap(socket => socket.ids), ids)
})

test('三种样本按字段时间合并；详情保留真实样本，不把更老的 CPU 或缺失的探测写入新点', async () => {
  const app = harness({ get(base, path) {
    if (path.startsWith('/api/server?')) return { id: 'a', cpu: 10, last_updated: start - 4000, latestReportUpdates: [{ serverId: 'a', samples: [{ ts: start - 3000, payload: { cpu: 15, ping_ct: 21 } }, { ts: start - 2000, metrics: { cpu: 22 } }] }] }
    return [{ timestamp: start - 3000, ram_used: 400 }]
  } })
  await app.navigate('#/server/a')
  const ws = app.sockets[0]
  ws.handlers.onUpdate({ serverId: 'a', ts: start, data: { cpu: 33 } })
  ws.handlers.onUpdate({ serverId: 'a', ts: start - 1000, data: { cpu: 28, tcp_conn: 90 } })
  assert.equal(app.state.detail.node.cpu, 10)
  app.tick()
  assert.equal(app.state.detail.node.cpu, 33); assert.equal(app.state.detail.node.tcp_conn, 90); assert.equal(app.state.detail.node.ping_ct, 21)
  assert.deepEqual(app.state.detail.rows.map(row => row.timestamp), [start - 3000, start - 2000, start - 1000, start])
  assert.equal(app.state.detail.rows[0].ram_used, 400); assert.equal(app.state.detail.rows.at(-1).ping_ct, undefined)
  ws.handlers.onUpdate({ serverId: 'a', ts: start - 500, data: { cpu: 12, loss_ct: 0 } }); app.tick()
  assert.equal(app.state.detail.node.cpu, 33); assert.equal(app.state.detail.node.loss_ct, 0)
})

test('权限与可见性按站隔离：403 清快照和详情，旧历史不过界；验证后复用 config', async () => {
  const late = deferred()
  const app = harness({ bases: [first, second], get(base, path, url) {
    if (url.pathname === '/api/servers') return list([{ id: 'same', name: base }])
    if (url.pathname === '/api/server') return { id: 'same', name: base }
    if (url.searchParams.get('hours') === '6') return late.promise
    return []
  } })
  await app.navigate('#/'); await app.navigate('#/server/same?site=1')
  const old = app.setHours(6)
  app.block(second, 403); app.block(second, 403)
  late.resolve([{ timestamp: start, cpu: 50 }]); await old
  assert.deepEqual(app.state.nodes.map(node => node.name), [first]); assert.equal(app.state.detail.node, null); assert.deepEqual(app.state.detail.rows, [])
  assert.equal(app.sockets[0].closed, false); assert.equal(app.sockets[1].closed, true)
  await app.setHours(1)
  await app.verified(second, { is_public: true, turnstile_enabled: true, verified: true })
  assert.equal(app.state.detail.node.name, second)
  assert.equal(app.requests.filter(([, path]) => path === '/api/config').length, 2)
})

test('未登录或尚待验证不请求资源，有缓存票据则先走真实 REST；404 不保留旧卡片', async () => {
  for (const [config, blocked] of [[{ is_public: false, authorization: false }, 401], [{ is_public: true, turnstile_enabled: true }, 403]]) {
    const app = harness({ config: () => config }); await app.navigate('#/server/a')
    assert.equal(app.state.sites[0].blocked, blocked); assert.equal(app.requests.length, 1); assert.equal(app.sockets.length, 0)
  }
  const app = harness({ config: () => ({ is_public: true, turnstile_enabled: true, verificationPending: true }), get(base, path) {
    if (path === '/api/servers') return list([{ id: 'gone' }])
    throw Object.assign(new Error('removed'), { status: 404 })
  } })
  await app.navigate('#/'); await app.navigate('#/server/gone')
  assert.equal(app.state.detail.node, null); assert.equal(app.state.nodes.length, 0); assert.equal(app.state.detail.error, 'removed')
})

test('范围切换只接受当前请求，离开详情后旧响应不会打开错误节点', async () => {
  const pending = deferred()
  const app = harness({ get(base, path, url) {
    if (url.pathname === '/api/servers') return list([{ id: 'a' }])
    if (url.pathname === '/api/server') return { id: url.searchParams.get('id') }
    if (url.searchParams.get('hours') === '6') return pending.promise
    return [{ timestamp: start, cpu: Number(url.searchParams.get('hours')) }]
  } })
  await app.navigate('#/server/a'); const late = app.setHours(6); await app.setHours(12)
  assert.equal(app.state.detail.rows[0].cpu, 12)
  await app.navigate('#/'); pending.resolve([{ timestamp: start, cpu: 60 }]); await late
  assert.equal(app.state.detail.id, ''); assert.deepEqual(app.state.detail.rows, [])
})

test('新快照移除不再返回的报告级字段，热详情仍保留首页专属窗口；被撤下的节点不进入新订阅', async () => {
  let visits = 0
  const app = harness({ get(base, path) {
    if (path === '/api/servers') {
      if (++visits === 1) return list([{ id: 'a', disk: { read_iops: 20 }, ping: [{ ts: start, ct: 5 }], last_updated: start - 1000 }, { id: 'gone' }])
      return list([{ id: 'a', ping: [], last_updated: start + 1000 }])
    }
    if (path.startsWith('/api/server?')) return { id: 'a', last_updated: start }
    return []
  } })
  await app.navigate('#/'); await app.navigate('#/server/a')
  assert.equal(app.state.detail.node.disk, undefined); assert.equal(app.state.detail.node.ping.length, 1)
  await app.navigate('#/'); await app.visibility(false); await app.visibility(true)
  assert.deepEqual(app.state.nodes.map(node => node.id), ['a']); assert.deepEqual(app.sockets.at(-1).ids, ['a'])
  assert.deepEqual(app.state.nodes[0].ping, [])
})

test('部分失败可单站恢复且不重拉健康站；无效路由中旧请求不得重新拨号', async () => {
  let firstFailed = false
  const app = harness({ bases: [first, second], get(base) {
    if (base === first && !firstFailed) { firstFailed = true; throw new Error('offline') }
    return list([{ id: 'ok' }])
  } })
  await app.navigate('#/'); assert.equal(app.state.sites[0].error, 'offline'); assert.equal(app.sockets[0].index, 1)
  await app.retry(first); assert.deepEqual(app.requests.slice(4), [[first, '/api/servers']])
  assert.equal(app.sockets.length, 2); assert.equal(app.sockets[0].closed, false)
  const pending = deferred(), transition = harness({ get: () => pending.promise })
  const old = transition.navigate('#/'); await waitTurn(); await transition.navigate('#/server/%')
  pending.resolve(list([{ id: 'outdated' }])); await old
  assert.equal(transition.sockets.length, 0); assert.equal(transition.state.nodes.length, 0); assert.ok(transition.state.routeError)
})

test('从冷详情切到较老的列表快照，保留真实的较新字段值与原始上报时间', async () => {
  const app = harness({ get(base, path) {
    if (path === '/api/servers') return list([{ id: 'a', cpu: 20, last_updated: start - 5000 }])
    if (path.startsWith('/api/server?')) return { id: 'a', cpu: 30, last_updated: start - 2000 }
    return []
  } })
  await app.navigate('#/server/a')
  app.sockets[0].handlers.onUpdate({ serverId: 'a', ts: start, data: { cpu: 50, loss_ct: 0 } }); app.tick()
  await app.navigate('#/')
  assert.equal(app.state.nodes[0].cpu, 50); assert.equal(app.state.nodes[0].loss_ct, 0); assert.equal(app.state.nodes[0].last_updated, start)
})
