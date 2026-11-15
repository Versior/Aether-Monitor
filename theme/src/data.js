import { formatBillingPrice, normalizePrice, normalizeCurrency, detectCurrencySymbol, detectBillingCycle, getBillingCycleOption } from '../../src/frontend/utils/server.js'
import { getTrafficUsageBytes } from '../../src/utils/traffic.js'
import { getApiBases } from '../../src/frontend/utils/config.js'
import { PING } from '../../src/frontend/utils/constants.js'

export const probeKeys = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']
export const trafficNames = { total: '双向', dl: '下行', ul: '上行', max: '较大方向' }
export const defaultPreferences = { layout: 'compact', view: 'card', appearance: 'auto', globe: true, motion: true, visitorFlow: true, background: 'project', cardOpacity: 100, panelBlur: 12 }
const numericFields = ['cpu', 'cpu_cores', 'ram_used', 'ram_total', 'disk_used', 'disk_total', 'swap_used', 'swap_total', 'net_in_speed', 'net_out_speed', 'net_rx', 'net_tx', 'net_rx_monthly', 'net_tx_monthly', 'processes', 'tcp_conn', 'udp_conn', 'traffic_limit', ...probeKeys.flatMap(key => [`ping_${key}`, `loss_${key}`])]
const regionLabels = new Intl.DisplayNames(['zh-CN'], { type: 'region' })
const areaByRegion = new Map([
  ['亚太', 'AE AF AM AS AU AZ BD BH BN BT CC CK CN CX CY FJ FM GE GU HK HM ID IL IN IQ IR JO JP KG KH KI KP KR KW KZ LA LB LK MH MM MN MO MP MV MY NC NF NP NR NU NZ OM PF PG PH PK PN PS PW QA QO SA SB SG SY TH TJ TK TL TM TO TR TV TW UM UZ VN VU WF WS YE'],
  ['欧洲', 'AD AL AT AX BA BE BG BY CH CQ CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK'],
  ['北美', 'BM CA GL PM US'],
  ['拉美', 'AG AI AR AW BB BL BO BQ BR BS BV BZ CL CO CR CU CW DM DO EC FK GD GF GP GS GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PE PR PY SR SV SX TC TT UY VC VE VG VI'],
  ['非洲', 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EA EG EH ER ET GA GH GM GN GQ GW IC IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TN TZ UG YT ZA ZM ZW'],
  ['南极', 'AQ'],
].flatMap(([area, codes]) => codes.split(' ').map(code => [code, area])))
export const number = value => value === null || value === undefined || value === '' || value === false || value === 'false' || !Number.isFinite(Number(value)) ? null : Number(value)
export function normalizeRegion(value = '') {
  const code = String(value || '').trim().toUpperCase()
  if (['CHN', 'CHINA', '中国', '中华人民共和国'].includes(code)) return 'CN'
  return /^[A-Z]{2}$/.test(code) ? code : ''
}

export function normalizeNode(raw) {
  const node = { ...raw }
  if ('region' in raw) node.region = normalizeRegion(raw.region)
  for (const key of numericFields) {
    if (!(key in raw)) continue
    node[key] = raw[key] === false || raw[key] === 'false' ? false : number(raw[key])
  }
  if ('gpu_info' in raw) {
    if (Array.isArray(raw.gpu_info)) node.gpu_info = raw.gpu_info
    if (!raw.gpu_info) node.gpu_info = []
    if (typeof raw.gpu_info === 'string' && raw.gpu_info) {
      try { const parsed = JSON.parse(raw.gpu_info); node.gpu_info = Array.isArray(parsed) ? parsed : [] }
      catch { node.gpu_info = [] }
    }
  }
  return node
}
export function preferences(raw = {}) {
  return {
    layout: ['compact', 'full'].includes(raw.layout) ? raw.layout : 'compact',
    view: ['card', 'table', 'network'].includes(raw.view) ? raw.view : 'card',
    appearance: ['auto', 'dark', 'light'].includes(raw.appearance) ? raw.appearance : 'auto',
    globe: typeof raw.globe === 'boolean' ? raw.globe : true,
    motion: typeof raw.motion === 'boolean' ? raw.motion : true,
    visitorFlow: typeof raw.visitorFlow === 'boolean' ? raw.visitorFlow : true,
    background: raw.background === 'default' ? 'default' : 'project',
    cardOpacity: Number.isFinite(raw.cardOpacity) ? Math.min(100, Math.max(40, raw.cardOpacity)) : 100,
    panelBlur: Number.isFinite(raw.panelBlur) ? Math.min(20, Math.max(0, raw.panelBlur)) : 12,
  }
}
export function regionName(code) {
  if (!code || !/^[A-Z]{2}$/.test(code) || ['XX', 'ZZ'].includes(code)) return '未知地区'
  return regionLabels.of(code)
}
export function nodeArea(node) {
  if (node.region !== 'US') return areaByRegion.get(node.region) || '未知地区'
  const location = `${node.server_group || ''} ${node.tags || ''} ${node.name || ''}`
  const coast = location.match(/美西|美东/)?.[0]
  if (coast) return coast
  if (/水牛城|\bbuffalo\b/i.test(location)) return '美东'
  if (/圣何塞|圣荷西|圣何西|洛杉矶|\bsan[\s-]+jose\b|\blos[\s-]+angeles\b/i.test(location)) return '美西'
  return '北美'
}
export const flag = code => /^[A-Z]{2}$/.test(code || '') && !['XX', 'ZZ'].includes(code) ? new URL(`/flags/${code.toLowerCase()}.svg`, getApiBases()[0]).href : null
export function routes(node, now = Date.now()) {
  const manual = [...new Set((node.tags || '').split(',').map(tag => tag.trim().replace(/^线路-\s*/, '')).filter(Boolean))]
  if (manual.length) return manual
  if (!node.route_report || node.route_report.expires_at <= now) return []
  return [...new Set(node.route_report.routes.filter(route => route.status === 'detected').map(route => `${{ ct: '电信', cu: '联通', cm: '移动' }[route.carrier]} ${route.networks.join(' / ')}`))]
}
export const hasIp = (node, version) => node[`ip_v${version}`] === '1'
export const usage = (used, total) => used === null || used === undefined || !(total > 0) ? null : Math.round(used / total * 100)
export const percent = value => value === null || value === undefined ? '—' : `${Math.round(value)}%`
export function bytes(value) {
  if (value === null || value === undefined) return '未上报'
  if (value === 0) return '0 B'
  const unit = Math.min(4, Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))))
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}
export const capacity = value => bytes(value === null || value === undefined ? null : value * 1024 ** 2)
export const speed = value => value === null || value === undefined ? '未上报' : `${bytes(value)}/s`
export function trafficBytes(node) {
  if (node.net_rx_monthly === null || node.net_rx_monthly === undefined || node.net_tx_monthly === null || node.net_tx_monthly === undefined) return null
  return getTrafficUsageBytes(node.net_rx_monthly, node.net_tx_monthly, node.traffic_calc_type)
}
export const quota = node => node.traffic_limit > 0 ? bytes(node.traffic_limit * 1024 ** 3) : '未设置额度'
export const trafficPercent = node => usage(trafficBytes(node), node.traffic_limit * 1024 ** 3)
export const price = node => formatBillingPrice(node) || '未填写'
export function daysLeft(node, now) {
  if (!node.expire_date) return null
  const date = node.expire_date.slice(0, 10)
  const expires = Date.parse(date)
  if (!Number.isFinite(expires) || new Date(expires).toISOString().slice(0, 10) !== date) return null
  return Math.round((expires - Date.parse(new Date(now).toISOString().slice(0, 10))) / 86400000)
}
export function expiry(node, now) {
  const days = daysLeft(node, now)
  if (days === null) return node.expire_date ? '到期日期无效' : '未填写到期日期'
  if (days === 0) return '今天到期'
  return days < 0 ? `已到期 ${-days} 天` : `${days} 天后到期`
}
export function timestamp(value) {
  const numeric = number(value)
  if (numeric !== null) return numeric < 1e12 ? numeric * 1000 : numeric
  return value ? Date.parse(value) : null
}
export function dateTime(value) {
  const ts = timestamp(value)
  return ts === null || !Number.isFinite(ts) ? '未上报' : new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
export function uptime(node, now) {
  const start = timestamp(node.boot_time)
  if (start === null || !Number.isFinite(start)) return '未上报'
  const hours = Math.max(0, Math.floor((now - start) / 3600000))
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}
export function probeValue(node, key, field, online) {
  if (!online) return '离线'
  const value = node[`${field}_${key}`]
  if (value === false) return '未启用'
  if (value === null || value === undefined) return '未上报'
  return `${field === 'ping' ? Number(value.toFixed(1)) : value}${field === 'ping' ? ' ms' : '%'}`
}
export const latencyClass = (value, online = true) => !online || typeof value !== 'number' || value < 0 ? '' : value < PING.WARNING_THRESHOLD ? 'latency-good' : value < PING.CRITICAL_THRESHOLD ? 'latency-warning' : 'latency-high'
export function activeProbes(nodes, config) {
  return probeKeys.filter(key => ['ct', 'cu', 'cm'].includes(key) || nodes.some(node => node[`ping_${key}`] > 0 || node[['ct', 'cu', 'cm', 'bd'].includes(key) ? `custom_${key}` : key])).map(key => ({ key, name: config[['ct', 'cu', 'cm', 'bd'].includes(key) ? `custom_${key}_name` : `${key}_name`] || key }))
}
export function issues(node, online, show, now) {
  return [
    !online && '离线',
    online && [node.cpu, usage(node.ram_used, node.ram_total), usage(node.disk_used, node.disk_total)].some(value => value >= 80) && '资源紧张',
    online && show.network && probeKeys.some(key => node[`loss_${key}`] > 0) && '存在丢包',
    show.traffic && trafficPercent(node) >= 80 && '流量将满',
    show.expire && daysLeft(node, now) !== null && daysLeft(node, now) <= 7 && '到期关注',
  ].filter(Boolean)
}
export function monthlyCosts(nodes) {
  const result = new Map()
  for (const node of nodes) {
    const normalized = normalizePrice(node.price)
    if (!normalized) continue
    const currency = normalizeCurrency(node.currency || detectCurrencySymbol(node.price)) || '未标币种'
    const entry = result.get(currency) || { currency, monthly: 0, count: 0 }
    entry.monthly += Math.max(0, Number(normalized)) / getBillingCycleOption(detectBillingCycle(node.price) || node.billing_cycle).months
    entry.count++
    result.set(currency, entry)
  }
  return [...result.values()]
}
export function chartSegments(rows, key, start, end, ceiling) {
  const samples = rows.map(row => ({ ts: timestamp(row.timestamp ?? row.ts), value: number(row[key]) })).sort((a, b) => a.ts - b.ts).filter(row => row.ts >= start && row.ts <= end)
  const intervals = samples.slice(1).map((row, index) => row.ts - samples[index].ts).filter(value => value > 0).sort((a, b) => a - b)
  const cadence = intervals[Math.floor(intervals.length / 2)] || 60000
  const maximum = ceiling || Math.max(1, ...samples.map(row => row.value || 0)) * 1.1
  const segments = []
  for (const [index, row] of samples.entries()) {
    if (row.value === null) continue
    const before = index > 1 ? samples[index - 1].ts - samples[index - 2].ts : cadence
    const after = index < samples.length - 1 ? samples[index + 1].ts - row.ts : cadence
    const gap = Math.max(120000, Math.max(before, after) * 3)
    if (index === 0 || samples[index - 1].value === null || row.ts - samples[index - 1].ts > gap) segments.push([])
    segments.at(-1).push(`${(32 + (row.ts - start) / (end - start) * 508).toFixed(1)},${(132 - row.value / maximum * 110).toFixed(1)}`)
  }
  return { segments: segments.map(segment => segment.join(' ')), maximum, count: samples.filter(row => row.value !== null).length }
}
