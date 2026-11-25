<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { getApiBases } from '../../src/frontend/utils/config.js'
import { flag, regionName } from './data.js'
import { t, locale } from './i18n.js'
import { browserInfo, maskIp, normalizeIpReport, parseTrace } from './visitorNetwork.js'
import UiIcon from './UiIcon.vue'

const demo = import.meta.env.AETHER_DEMO
const emit = defineEmits(['country'])
const browser = browserInfo(navigator.userAgent)
const trace = ref({}), report = ref(null), open = ref(false), revealed = ref(false)
const loading = ref(false), error = ref(''), checkedAt = ref(null)
const ip = computed(() => report.value?.ip || trace.value.ip || '')
const countryCode = computed(() => report.value?.countryCode || trace.value.loc || '')
const location = computed(() => countryCode.value ? [regionName(countryCode.value),report.value?.city].filter(s=>s && s!=='未提供').join(' · ') : t('地区未获取'))
const score = computed(() => report.value?.riskScore ?? null)
watch(countryCode, country => emit('country', country), { immediate: true })
let controller
async function inspect() {
  if (loading.value) return
  loading.value=true; error.value=''; report.value=null; trace.value={}; checkedAt.value=null; revealed.value=false
  controller = new AbortController()
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])
  async function read(url,json=false) {
    const response=await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'})
    if (!response.ok) throw new Error(t('检测失败（HTTP {status}）',{status:response.status}))
    return json?response.json():response.text()
  }
  try {
    try { trace.value=parseTrace(await read(new URL('/cdn-cgi/trace',getApiBases()[0]))) }
    catch (cause) { if (signal.aborted) throw cause }
    const raw = demo ? await read('/__theme/network-info',true) : await read(`https://api.ipquery.io/${encodeURIComponent(trace.value.ip || (await read('https://api.ipquery.io/')).trim())}`,true)
    report.value=normalizeIpReport(raw); checkedAt.value=Date.now()
  } catch (cause) { if (!controller.signal.aborted) error.value=t(cause.message) }
  finally { loading.value=false }
}
onUnmounted(()=>controller?.abort())
</script>
<template>
  <section class="visitor-network" :aria-label="t('当前访客网络信息')">
    <button class="network-strip" :aria-expanded="open" aria-controls="visitor-network-details" @click="open=!open">
      <span v-if="countryCode"><img v-if="flag(countryCode)" :src="flag(countryCode)" alt="">{{ location }}</span>
      <span v-if="ip" class="network-ip"><UiIcon name="globe" class="network-indicator"/>{{ maskIp(ip) }}</span>
      <span><UiIcon name="browser" class="network-indicator"/>{{ t(browser.name) }}</span>
      <span class="purity-status" :class="{amber:!!error||score>0,green:score===0}" role="status"><UiIcon :name="loading?'loader':score===0?'shield-check':error||score>0?'shield-alert':'shield'" class="network-indicator" :class="{checking:loading}"/>{{ t('IP 纯净度') }}<template v-if="loading || error || report"> · {{ loading?t('检测中'):error?t('检测失败'):score===null?t('未提供评分'):t('风险分 {score}',{score}) }}</template></span>
      <small v-if="demo" class="network-demo">{{ t('示例网络') }}</small><span class="network-chevron"><UiIcon name="chevron"/></span>
    </button>
    <div v-if="open" id="visitor-network-details" class="network-details">
      <div class="network-details-heading"><strong>{{ t('当前访客 · 出口网络') }}</strong><button class="clear-button" :disabled="loading" @click="inspect">{{ t(loading?'正在检测…':report?'重新检测':error?'重试检测':'检测我的 IP') }}</button></div>
      <p class="network-source">{{ t(demo?'本地使用示例结果，不查询真实出口。':'点击检测会将当前出口 IP 发送给 IPQuery，以查询归属和风险。') }}</p>
      <p v-if="error" class="network-error" role="alert">{{ error }}</p>
      <dl v-if="report || ip" class="network-facts"><div><dt>{{ t('出口 IP') }}</dt><dd>{{ revealed?ip:maskIp(ip) }}<button v-if="ip" class="reveal-ip" @click="revealed=!revealed">{{ t(revealed?'隐藏':'显示') }}</button></dd></div><div><dt>{{ t('浏览器') }}</dt><dd>{{ t(browser.name) }} {{ t(browser.version) }}</dd></div>
        <div><dt>{{ t('地区') }}</dt><dd>{{ location }}</dd></div><div><dt>ASN</dt><dd>{{ t(report?.asn || '未提供') }}</dd></div><div><dt>{{ t('运营商') }}</dt><dd>{{ t(report?.isp || '未提供') }}</dd></div><div><dt>{{ t('组织') }}</dt><dd>{{ t(report?.org || '未提供') }}</dd></div><div><dt>{{ t('网络协议 / TLS') }}</dt><dd>{{ trace.http || '—' }} / {{ trace.tls || '—' }}</dd></div><div><dt>{{ t('时区') }}</dt><dd>{{ t(report?.timezone || '未提供') }}</dd></div></dl>
      <div v-if="report" class="network-risk"><div class="risk-score"><span>{{ t('IPQuery 风险分') }}</span><strong>{{ score ?? t('未提供') }}</strong><small>{{ t('分数越低，已知风险越少。') }}</small></div><div class="risk-checks"><div v-for="check in report.checks" :key="check.name"><span>{{ t(check.name) }}</span><strong :class="{amber:check.value===true,green:check.value===false}">{{ t(check.value===null?'未提供':check.value?'是':'否') }}</strong></div></div></div>
      <p v-if="checkedAt" class="network-source">{{ demo?t('本地示例'):'IPQuery' }} · {{ new Date(checkedAt).toLocaleString(locale,{hour12:false}) }}</p>
    </div>
  </section>
</template>
