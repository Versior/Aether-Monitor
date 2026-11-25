import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveSocket, isServerOnline } from '../../src/frontend/utils/api.js'

function transport(scope = 'all', options = {}) {
  let clock = 0, serial = 0
  const jobs = new Map(), sockets = [], status = [], samples = [], timeouts = []
  const platform = {
    Date: { now: () => clock }, location: { origin: 'https://theme.invalid' },
    setTimeout(callback, delay) { jobs.set(++serial, { at: clock + delay, callback }); return serial },
    clearTimeout(timer) { jobs.delete(timer) },
    WebSocket: class {
      constructor(address) { this.url = new URL(address); this.started = clock; this.handlers = {}; this.messages = []; sockets.push(this) }
      addEventListener(name, callback) { this.handlers[name] = callback }
      send(value) { this.messages.push(JSON.parse(value)) }
      close() { this.closed = true; this.emit('close', { code: 1000 }) }
      emit(name, event = {}) { this.handlers[name]?.(event) }
    },
  }
  function tick(duration) {
    const until = clock + duration
    while (jobs.size) {
      const [id, job] = [...jobs].sort((first, second) => first[1].at - second[1].at)[0]
      if (job.at > until) break
      jobs.delete(id); clock = job.at; job.callback()
    }
    clock = until
  }
  const socket = createLiveSocket(scope, {
    base: 'https://worker.invalid', getToken: () => 'test-ticket',
    onStatus: event => status.push(event), onUpdate: sample => samples.push(sample), onTimeout: () => timeouts.push(clock), ...options,
  }, 0, scope === 'all' ? ['one'] : [], platform)
  return { socket, sockets, status, samples, timeouts, tick }
}

test('all 发送本站 ID；具体节点仅用 URL 订阅；JWT 只取当前跨域源的 token', () => {
  const cross = transport(); const all = cross.sockets[0]; all.emit('open')
  assert.equal(all.url.origin, 'wss://worker.invalid'); assert.equal(all.url.searchParams.get('token'), 'test-ticket')
  assert.deepEqual(all.messages, [{ type: 'subscribe', scope: 'all', ids: ['one'] }])
  const same = transport('one', { base: 'https://theme.invalid', getToken: () => assert.fail('同源使用 Cookie') }); same.sockets[0].emit('open')
  assert.equal(same.sockets[0].url.searchParams.has('token'), false); assert.equal(same.sockets[0].url.searchParams.get('subscribe'), 'one'); assert.deepEqual(same.sockets[0].messages, [])
})

test('回调保留样本的真实时间，兼容三种载体，忽略其他节点和非数据帧', () => {
  const app = transport(), socket = app.sockets[0]; socket.emit('open')
  const ts = 1800000000000
  socket.emit('message', { data: JSON.stringify({ type: 'batchUpdate', updates: [
    { serverId: 'one', samples: [{ ts, data: { cpu: 50 } }, { ts: ts - 2000, payload: { cpu: 10 } }, { ts: ts - 1000, metrics: { loss_ct: 0 } }] },
    { serverId: 'other', samples: [{ ts, data: { cpu: 20 } }] },
  ] }) }); socket.emit('message', { data: '{' })
  assert.deepEqual(app.samples.map(sample => [sample.ts, sample.data]), [[ts, { cpu: 50 }], [ts - 2000, { cpu: 10 }], [ts - 1000, { loss_ct: 0 }]])
})

test('退避期间 close 能取消全部拨号；重新检查可见性，连续失败有上限', () => {
  const cancel = transport(); cancel.sockets[0].emit('close', { code: 1006 }); cancel.tick(100); cancel.socket.close(); cancel.tick(30000)
  assert.equal(cancel.sockets.length, 1)
  let visible = true
  const hidden = transport('all', { canConnect: () => visible }); hidden.sockets[0].emit('close', { code: 1006 }); visible = false; hidden.tick(30000); assert.equal(hidden.sockets.length, 1)
  const failing = transport()
  for (let attempt = 0; attempt < 11; attempt++) {
    const socket = failing.sockets.at(-1); socket.emit('open'); socket.emit('close', { code: 1006 }); failing.tick(Math.min(1000 * 2 ** attempt, 30000))
  }
  assert.equal(failing.sockets.length, 11)
  assert.deepEqual(failing.sockets.slice(0, 4).map(socket => socket.started), [0, 1000, 3000, 7000])
  assert.equal(failing.status.at(-1).reason, 'exhausted'); assert.equal(failing.status.at(-1).terminal, true)
})

test('稳定连接后从初次退避重新开始；策略拒绝不重试', () => {
  const app = transport()
  app.sockets[0].emit('close', { code: 1006 }); app.tick(1000); app.sockets[1].emit('open'); app.tick(30000); app.sockets[1].emit('close', { code: 1006 })
  app.tick(999); assert.equal(app.sockets.length, 2); app.tick(1); assert.equal(app.sockets.length, 3)
  app.sockets[2].emit('close', { code: 1008 }); app.tick(120000)
  assert.equal(app.sockets.length, 3); assert.equal(app.status.at(-1).reason, 'policy')
})

test('正值寿命从 open 起计时，到时关闭且不重连；零值无时限', () => {
  const limited = transport('all', { timeoutMinutes: 1 }); limited.tick(25000); limited.sockets[0].emit('open'); limited.tick(59999)
  assert.equal(limited.socket.isConnected, true); limited.tick(1); limited.tick(60000)
  assert.deepEqual(limited.timeouts, [85000]); assert.equal(limited.sockets[0].closed, true); assert.equal(limited.sockets.length, 1)
  const open = transport('all', { timeoutMinutes: 0 }); open.sockets[0].emit('open'); open.tick(24 * 3600000)
  assert.equal(open.sockets[0].closed, undefined); assert.deepEqual(open.timeouts, [])
})

test('在线用上报时间的五分钟边界，不采用浏览器收到包的时间', () => {
  const now = 1800000000000
  assert.equal(isServerOnline({ last_updated: now - 299999 }, now), true)
  assert.equal(isServerOnline({ last_updated: now - 300000, report_timestamp: now }, now), false)
  assert.equal(isServerOnline({}, now), false)
})
