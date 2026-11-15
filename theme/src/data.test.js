import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNode, nodeArea, bytes, usage, daysLeft, expiry, probeValue, monthlyCosts, chartSegments, trafficBytes, quota, issues, preferences, flag, uptime, timestamp, routes, latencyClass } from './data.js'

test('中国地区输入在节点入口统一为 CN，国家与大区显示正确', () => {
  for (const region of ['CN', 'cn', ' CN ', 'CHN', 'China', '中国', '中华人民共和国']) {
    const node = normalizeNode({ region })
    assert.equal(node.region, 'CN')
    assert.equal(nodeArea(node), '亚太')
  }
})

test('宿主普通标签与线路前缀标签都显示，忽略空白并去重', () => {
  assert.deepEqual(routes({ tags: ' CN2 GIA, CMI ,线路-4837,线路-CN2 GIA,, ' }), ['CN2 GIA', 'CMI', '4837'])
  assert.deepEqual(routes({ tags: '线路- 普通线路 ' }), ['普通线路'])
  assert.deepEqual(routes({ tags: '' }), [])
  assert.deepEqual(routes({}), [])
})

test('美国节点优先显示明确的东西部或已识别的城市，其余按国家归类', () => {
  assert.equal(nodeArea({ region: 'HK', server_group: '默认分组' }), '亚太')
  assert.equal(nodeArea({ region: 'JP', server_group: '欧洲' }), '亚太')
  assert.equal(nodeArea({ region: 'AU' }), '亚太')
  assert.equal(nodeArea({ region: 'DE' }), '欧洲')
  assert.equal(nodeArea({ region: 'BR' }), '拉美')
  assert.equal(nodeArea({ region: 'ZA' }), '非洲')
  assert.equal(nodeArea({ region: 'US', server_group: '美西' }), '美西')
  assert.equal(nodeArea({ region: 'US', server_group: '美东 / 生产' }), '美东')
  assert.equal(nodeArea({ region: 'US', name: 'DR-美东水牛城', server_group: 'Default' }), '美东')
  assert.equal(nodeArea({ region: 'US', name: 'RS-圣何塞4837', server_group: 'Default' }), '美西')
  assert.equal(nodeArea({ region: 'US', name: 'Buffalo' }), '美东')
  assert.equal(nodeArea({ region: 'US', name: 'San Jose' }), '美西')
  assert.equal(nodeArea({ region: 'US', name: '洛杉矶', server_group: '北美' }), '美西')
  assert.equal(nodeArea({ region: 'US', name: '圣何塞', server_group: '美东' }), '美东')
  assert.equal(nodeArea({ region: 'US', tags: '线路-4837,美西' }), '美西')
  assert.equal(nodeArea({ region: 'US', name: '未注明城市' }), '北美')
  assert.equal(nodeArea({ region: 'SG', name: '圣何塞' }), '亚太')
  assert.equal(nodeArea({ region: 'ZZ', server_group: '亚太' }), '未知地区')
  assert.equal(nodeArea({}), '未知地区')
})

test('延迟颜色保留低、中、高边界，离线、禁用及缺失读数不着色', () => {
  assert.equal(latencyClass(0), 'latency-good')
  assert.equal(latencyClass(93), 'latency-good')
  assert.equal(latencyClass(159.9), 'latency-good')
  assert.equal(latencyClass(160), 'latency-warning')
  assert.equal(latencyClass(239.9), 'latency-warning')
  assert.equal(latencyClass(240), 'latency-high')
  assert.equal(latencyClass(472), 'latency-high')
  for (const value of [false, null, undefined, -1]) assert.equal(latencyClass(value), '')
  assert.equal(latencyClass(325, false), '')
})

test('旧主题选项仍有效，新外观数值只在读取配置时限制到可用范围', () => {
  const old = preferences({ appearance: 'light', globe: false })
  assert.equal(old.appearance, 'light')
  assert.equal(old.globe, false)
  assert.equal(old.background, 'project')
  assert.equal(old.cardOpacity, 100)
  const custom = preferences({ background: 'default', cardOpacity: 65, panelBlur: 8 })
  assert.equal(custom.background, 'default')
  assert.equal(custom.cardOpacity, 65)
  assert.equal(custom.panelBlur, 8)
  assert.equal(preferences({ cardOpacity: 0 }).cardOpacity, 40)
  assert.equal(preferences({ cardOpacity: 130 }).cardOpacity, 100)
  assert.equal(preferences({ panelBlur: 100 }).panelBlur, 20)
  assert.equal(preferences({ cardOpacity: 'bad' }).cardOpacity, 100)
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
test('自动线路保留未完成标识、过期隐藏与手动标签优先', () => {
  const route_report = { expires_at: 2000, routes: [
    { carrier: 'ct', status: 'detected', networks: ['CN2', '163'] },
    { carrier: 'cu', status: 'partial', networks: ['9929'] },
    { carrier: 'cm', status: 'failed', networks: [] },
  ] }
  assert.deepEqual(routes({ tags: '', route_report }, 1000), ['电信 CN2 / 163', '联通 9929（路径未完成）'])
  assert.deepEqual(routes({ tags: '手动线路', route_report }, 1000), ['手动线路'])
  assert.deepEqual(routes({ tags: '', route_report }, 2000), [])
})
test('仅识别到国际网络时显示途经网络，保留骨干未识别的含义', () => {
  const route_report = { expires_at: 2000, routes: [
    { carrier: 'ct', status: 'unknown', completed: true, networks: [], transit_networks: ['TATA'] },
    { carrier: 'cu', status: 'unknown', completed: false, networks: [], transit_networks: ['NTT'] },
    { carrier: 'cm', status: 'unknown', completed: true, networks: [] },
  ] }
  assert.deepEqual(routes({ route_report }, 1000), ['电信 经 TATA'])
  assert.deepEqual(routes({ tags: '手动线路', route_report }, 1000), ['手动线路'])
  assert.deepEqual(routes({ route_report }, 2000), [])
})
