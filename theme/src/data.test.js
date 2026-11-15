import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNode, nodeArea, bytes, usage, daysLeft, expiry, probeValue, monthlyCosts, chartSegments, trafficBytes, quota, issues, preferences, flag, uptime, timestamp } from './data.js'

test('卡片大区由国家归类，美国东西部只采用已明确配置的分组', () => {
  assert.equal(nodeArea({ region: 'HK', server_group: '默认分组' }), '亚太')
  assert.equal(nodeArea({ region: 'JP', server_group: '欧洲' }), '亚太')
  assert.equal(nodeArea({ region: 'AU' }), '亚太')
  assert.equal(nodeArea({ region: 'DE' }), '欧洲')
  assert.equal(nodeArea({ region: 'BR' }), '拉美')
  assert.equal(nodeArea({ region: 'ZA' }), '非洲')
  assert.equal(nodeArea({ region: 'US', server_group: '美西' }), '美西')
  assert.equal(nodeArea({ region: 'US', server_group: '美东 / 生产' }), '美东')
  assert.equal(nodeArea({ region: 'US', name: '洛杉矶', server_group: '北美' }), '北美')
  assert.equal(nodeArea({ region: 'ZZ', server_group: '亚太' }), '未知地区')
  assert.equal(nodeArea({}), '未知地区')
})

test('零值、禁用和缺失探针保持不同语义', () => {
  const node = normalizeNode({ cpu: '0', ping_ct: 'false', loss_ct: false, ping_cu: null, loss_cu: '0' })
  assert.equal(node.cpu, 0)
  assert.equal(probeValue(node, 'ct', 'ping', true), '未启用')
  assert.equal(probeValue(node, 'cu', 'ping', true), '未上报')
  assert.equal(probeValue(node, 'cu', 'loss', true), '0%')
  assert.equal(probeValue(node, 'cu', 'loss', false), '离线')
  assert.equal(usage(null, 4096), null)
  assert.equal(usage(0, 4096), 0)
  assert.equal(usage(0, 0), null)
})
test('容量和流量按接口单位计算，未设置额度不当作零容量', () => {
  assert.equal(bytes(1024 ** 3), '1.0 GB')
  const node = normalizeNode({ net_rx_monthly: 20, net_tx_monthly: 10, traffic_limit: '0', traffic_calc_type: 'max' })
  assert.equal(trafficBytes(node), 20)
  assert.equal(quota(node), '未设置额度')
  assert.equal(trafficBytes({ net_rx_monthly: null, net_tx_monthly: 10 }), null)
})
test('到期日期按同一 UTC 日期口径展示，空日期不误报', () => {
  const now = Date.parse('2026-11-15T23:00:00Z')
  assert.equal(daysLeft({ expire_date: '2026-11-15' }, now), 0)
  assert.equal(expiry({ expire_date: '2026-11-15' }, now), '今天到期')
  assert.equal(expiry({ expire_date: '2026-11-13' }, now), '已到期 2 天')
  assert.equal(daysLeft({ expire_date: '' }, now), null)
  assert.equal(daysLeft({ expire_date: 'not-a-date' }, now), null)
  assert.equal(expiry({ expire_date: 'not-a-date' }, now), '到期日期无效')
  assert.equal(expiry({ expire_date: '2026-02-31' }, now), '到期日期无效')
})
test('独立静态托管时，国旗从配置的 API 源站加载', () => {
  const previous = globalThis.window
  globalThis.window = { __APP_API_BASES__: ['https://monitor.example.com'] }
  try {
    assert.equal(flag('JP'), 'https://monitor.example.com/flags/jp.svg')
    assert.equal(flag('ZZ'), null)
  } finally { globalThis.window = previous }
})
test('运行时长兼容秒和毫秒时间戳，离线使用最后样本，缺失不伪造', () => {
  const boot = Date.parse('2026-11-13T00:00:00Z')
  const sample = Date.parse('2026-11-15T04:00:00Z')
  assert.equal(uptime({ boot_time: String(boot) }, sample), '2 天 4 小时')
  assert.equal(uptime({ boot_time: String(boot / 1000) }, sample), '2 天 4 小时')
  assert.equal(uptime({ boot_time: String(boot) }, timestamp(String(sample))), '2 天 4 小时')
  assert.equal(uptime({}, sample), '未上报')
})
test('月均费用分开币种，年付按十二个月分摊，免费与未填写不同', () => {
  const result = monthlyCosts([{ price: '120', currency: '€', billing_cycle: 'year' }, { price: '5', currency: '$', billing_cycle: 'month' }, { price: '-1', currency: '$' }, { price: '' }])
  assert.deepEqual(result, [{ currency: '€', monthly: 10, count: 1 }, { currency: '$', monthly: 5, count: 2 }])
})
test('历史缺失样本和长时间无上报中断曲线，零值保留', () => {
  const rows = [{ ts: 1e12, cpu: 0 }, { ts: 1e12 + 60000, cpu: null }, { ts: 1e12 + 120000, cpu: 10 }, { ts: 1e12 + 180000, cpu: 20 }, { ts: 1e12 + 1200000, cpu: 30 }]
  const chart = chartSegments(rows, 'cpu', 1e12, 1e12 + 1800000, 100)
  assert.equal(chart.count, 4)
  assert.equal(chart.segments.length, 3)
  assert.equal(chart.segments[0], '32.0,132.0')
})
test('关闭站点展示开关后不通过异常筛选泄露隐藏数据', () => {
  const node = normalizeNode({ cpu: '10', loss_ct: '5', expire_date: '2026-11-15', net_rx_monthly: 1024 ** 3, net_tx_monthly: 1024 ** 3, traffic_limit: '1' })
  assert.deepEqual(issues(node, true, { network: false, traffic: false, expire: false }, Date.parse('2026-11-15')), [])
  assert.deepEqual(preferences({ view: 'unknown', globe: false }).view, 'card')
})
test('历史五分钟采样与实时十秒采样切换时保留连续曲线', () => {
  const start = 1e12
  const rows = [0, 300000, 600000, 900000, 910000, 920000, 930000, 940000, 950000, 960000].map(offset => ({ ts: start + offset, cpu: 20 }))
  assert.equal(chartSegments(rows, 'cpu', start, start + 1000000, 100).segments.length, 1)
})
