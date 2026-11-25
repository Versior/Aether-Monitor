import test from 'node:test'
import assert from 'node:assert/strict'
import { browserInfo, maskIp, normalizeIpReport, parseTrace } from './visitorNetwork.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { computed, ref, watch } from 'vue'

test('IPv4 和 IPv6 默认脱敏，保留可辨识的网络前缀', () => {
  assert.equal(maskIp('203.0.113.71'), '203.0.**.71')
  assert.equal(maskIp('2001:db8:1234:5678::1'), '2001:db8:••••')
  assert.equal(maskIp(''), '未获取 IP')
})
test('Edge 不因包含 Chrome 标记而被误识别', () => {
  assert.deepEqual(browserInfo('Chrome/130.0.0.0 Safari/537.36 Edg/130.0.1'), { name: 'Edge', version: '130.0.1' })
  assert.equal(browserInfo('Version/18.0 Safari/605.1.15').name, 'Safari')
})
test('风险分和阴性标记保留零值，缺数据不会当作纯净', () => {
  const raw = { ip: '203.0.113.71', risk: { risk_score: 0, is_proxy: false } }
  assert.equal(normalizeIpReport(raw).riskScore, 0)
  assert.equal(normalizeIpReport(raw).checks[0].value, false)
  assert.equal(normalizeIpReport(raw).checks[1].value, null)
  assert.equal(normalizeIpReport({ ip: '203.0.113.71' }).riskScore, null)
  assert.throws(() => normalizeIpReport({ error: 'rate limit' }), /可用数据/)
})
test('Cloudflare trace 不把值中的等号或空行解析成额外字段', () => {
  assert.deepEqual(parseTrace('ip=203.0.113.71\nloc=JP\nvalue=a=b\n'), { ip: '203.0.113.71', loc: 'JP', value: 'a=b' })
})
test('中国访客地区码和国家名称能产生 CN 定位，CRLF 不进入地区码', () => {
  assert.equal(parseTrace('ip=203.0.113.71\r\nloc=cn\r\n').loc, 'CN')
  for (const location of [{ country_code: 'cn', country: 'China' }, { country_code: 'CHN' }, { country: 'China' }, { country: '中国' }]) {
    assert.equal(normalizeIpReport({ ip: '203.0.113.71', location }).countryCode, 'CN')
  }
})
test('重新检测读取当前出口 IP，失败时清除旧风险报告并恢复脱敏', async () => {
  const urls = []
  let address = '203.0.113.71'
  let failed = false
  const sandbox = vm.createContext({
    computed, ref, watch, onUnmounted() {}, AbortController, t:(s,p)=>p?s.replace('{status}',p.status):s, locale:ref('zh-CN'), defineEmits: () => () => {},
    navigator: { userAgent: 'Chrome/130.0' }, getApiBases: () => ['https://monitor.example.com'],
    browserInfo, maskIp, normalizeIpReport, parseTrace, URL, AbortSignal,
    fetch: async url => {
      urls.push(String(url))
      return String(url).endsWith('/cdn-cgi/trace')
        ? { ok: true, text: async () => `ip=${address}\nloc=JP\n` }
        : { ok: !failed, status: failed ? 503 : 200, json: async () => ({ ip: address, risk: { risk_score: 0 } }) }
    },
  })
  const script = readFileSync(new URL('./VisitorNetwork.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('import.meta.env.AETHER_DEMO', 'false')
  vm.runInContext(script, sandbox)
  await vm.runInContext('inspect()', sandbox)
  assert.equal(vm.runInContext('report.value.ip', sandbox), address)
  address = '198.51.100.23'
  await vm.runInContext('inspect()', sandbox)
  assert.equal(urls.at(-1), 'https://api.ipquery.io/198.51.100.23')
  assert.equal(vm.runInContext('report.value.ip', sandbox), address)
  failed = true
  vm.runInContext('revealed.value = true', sandbox)
  await vm.runInContext('inspect()', sandbox)
  assert.equal(vm.runInContext('report.value', sandbox), null)
  assert.equal(vm.runInContext('score.value', sandbox), null)
  assert.equal(vm.runInContext('revealed.value', sandbox), false)
  assert.match(vm.runInContext('error.value', sandbox), /503/)
})

test('挂载及展开访客面板不触发出口或 IPQuery 请求', async () => {
  let calls=0; const mounted=[]
  const sandbox=vm.createContext({computed,ref,watch, t:s=>s, locale:ref('zh-CN'), onMounted:f=>mounted.push(f),onUnmounted(){},defineEmits:()=>()=>{},navigator:{userAgent:'Firefox/100'},getApiBases:()=>['https://example.invalid'],browserInfo,maskIp,normalizeIpReport,parseTrace, URL,AbortController,AbortSignal,fetch:async()=>{calls++;throw Error('Unexpected egress')}})
  const script=readFileSync(new URL('./VisitorNetwork.vue',import.meta.url),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'').replace('import.meta.env.AETHER_DEMO','false'); vm.runInContext(script,sandbox)
  await Promise.all(mounted.map(f=>f())); vm.runInContext('open.value=true',sandbox); assert.equal(calls,0)
})
