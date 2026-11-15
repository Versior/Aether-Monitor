<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { getApiBases } from '../../src/frontend/utils/config.js'
import { flag, regionName } from './data.js'
import { browserInfo, maskIp, normalizeIpReport, parseTrace } from './visitorNetwork.js'
import UiIcon from './UiIcon.vue'

const demo = import.meta.env.AETHER_DEMO
const emit = defineEmits(['country'])
const browser = browserInfo(navigator.userAgent)
const trace = ref({})
const report = ref(null)
const open = ref(false)
const revealed = ref(false)
const loading = ref(true)
const error = ref('')
const traceError = ref('')
const checkedAt = ref(null)
const ip = computed(() => report.value?.ip || trace.value.ip || '')
const countryCode = computed(() => report.value?.countryCode || trace.value.loc || '')
const location = computed(() => report.value ? `${report.value.country} · ${report.value.city}` : countryCode.value ? regionName(countryCode.value) : '地区未获取')
const riskScore = computed(() => report.value?.riskScore ?? null)
watch(countryCode, country => emit('country', country), { immediate: true })

async function read(url, json = true) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`网络信息读取失败（HTTP ${response.status}）。`)
  return json ? response.json() : response.text()
}
async function inspect() {
  loading.value = true
  error.value = ''
  traceError.value = ''
  report.value = null
  trace.value = {}
  checkedAt.value = null
  revealed.value = false
  try {
    const data = parseTrace(await read(new URL('/cdn-cgi/trace', getApiBases()[0]), false))
    if (!data.ip) throw new Error('站点未提供出口 IP')
    trace.value = data
  } catch { traceError.value = '站点未提供 Cloudflare 出口信息，改由 IPQuery 获取当前出口 IP。' }
  try {
    if (demo) report.value = normalizeIpReport(await read('/__theme/network-info'))
    if (!demo) {
      const address = trace.value.ip || (await read('https://api.ipquery.io/', false)).trim()
      report.value = normalizeIpReport(await read(`https://api.ipquery.io/${encodeURIComponent(address)}`))
    }
    checkedAt.value = Date.now()
  } catch (cause) { error.value = cause.message }
  loading.value = false
}
onMounted(inspect)
</script>

<template>
  <section class="visitor-network" aria-label="当前访客网络信息">
    <button class="network-strip" :aria-expanded="open" aria-controls="visitor-network-details" @click="open = !open">
      <span class="network-location"><img v-if="flag(countryCode)" :src="flag(countryCode)" alt="">{{ location }}</span>
      <span class="network-ip"><UiIcon name="globe" class="network-indicator" />{{ maskIp(ip) }}</span>
      <span><UiIcon name="browser" class="network-indicator" />{{ browser.name }}</span>
      <span class="purity-status" :class="{ amber: !loading && (error || riskScore > 0), green: !loading && !error && riskScore === 0 }" role="status">
        <UiIcon :name="loading ? 'loader' : error || riskScore > 0 ? 'shield-alert' : riskScore === 0 ? 'shield-check' : 'shield'" class="network-indicator" :class="{ checking: loading }" />
        纯净度 · {{ loading ? '检测中' : error ? '检测失败' : riskScore === null ? '未提供评分' : '风险分 ' + riskScore }}
      </span>
      <small v-if="demo" class="network-demo">示例网络</small><span class="network-chevron"><UiIcon name="chevron" /></span>
    </button>
    <div v-if="open" id="visitor-network-details" class="network-details">
      <div class="network-details-heading"><strong>当前访客 · 出口网络</strong><button class="clear-button" :disabled="loading" @click="inspect">{{ loading ? '正在检测…' : error ? '重试检测' : '重新检测' }}</button></div>
      <p class="network-source">{{ demo ? '本地使用文档保留地址与示例结果。' : '页面打开时自动向 IPQuery 查询当前出口 IP 的地区、运营商和风险标记。' }}</p>
      <p v-if="error" class="network-error" role="alert">{{ error }}</p>
      <p v-if="traceError" class="network-source">{{ traceError }}</p>
      <dl class="network-facts">
        <div><dt>出口 IP</dt><dd>{{ revealed ? ip || '未获取' : maskIp(ip) }}<button v-if="ip" class="reveal-ip" @click="revealed = !revealed">{{ revealed ? '隐藏' : '显示' }}</button></dd></div>
        <div><dt>浏览器</dt><dd>{{ browser.name }} {{ browser.version }}</dd></div>
        <div><dt>地区</dt><dd>{{ location }}</dd></div>
        <div><dt>ASN</dt><dd>{{ report?.asn || '未检测' }}</dd></div>
        <div><dt>运营商</dt><dd>{{ report?.isp || '未检测' }}</dd></div>
        <div><dt>组织</dt><dd>{{ report?.org || '未检测' }}</dd></div>
        <div><dt>网络协议 / TLS</dt><dd>{{ trace.http || '未提供' }} / {{ trace.tls || '未提供' }}</dd></div>
        <div><dt>时区</dt><dd>{{ report?.timezone || '未检测' }}</dd></div>
      </dl>
      <div v-if="report" class="network-risk"><div class="risk-score"><span>纯净度参考 · IPQuery 风险分</span><strong>{{ report.riskScore ?? '未提供' }}</strong><small>直接展示来源评分，分数越低，已知风险越少。</small></div><div class="risk-checks"><div v-for="check in report.checks" :key="check.name"><span>{{ check.name }}</span><strong :class="{ amber: check.value === true, green: check.value === false }">{{ check.value === null ? '未提供' : check.value ? '是' : '否' }}</strong></div></div></div>
      <p v-if="report" class="network-source">{{ demo ? '来源：本地示例' : '来源：IPQuery' }} · {{ new Date(checkedAt).toLocaleString('zh-CN', { hour12: false }) }}。地理位置是 IP 归属信息；数据中心标记单独展示，风险分不保证各平台的信誉或解锁情况。</p>
    </div>
  </section>
</template>
