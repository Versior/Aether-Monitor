<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { createLiveSocket, isServerOnline } from '../../src/frontend/utils/api.js'
import { http } from '../../src/frontend/utils/http.js'
import { initConfig, getApiBases } from '../../src/frontend/utils/config.js'
import { ADMIN_ENTRY_URL } from '../../src/frontend/router/adminEntryUrl.js'
import { DEFAULT_SITE_TITLE } from '../../src/frontend/utils/constants.js'
import { normalizeNode, preferences, defaultPreferences, regionName, flag, routes, hasIp, usage, percent, capacity, bytes, speed, trafficBytes, trafficPercent, trafficNames, quota, price, expiry, daysLeft, uptime, dateTime, activeProbes, probeValue, latencyClass, issues, timestamp, number } from './data.js'
import Globe from './Globe.vue'
import NodeCard from './NodeCard.vue'
import MetricChart from './MetricChart.vue'
import SiteVerification from './SiteVerification.vue'
import VisitorNetwork from './VisitorNetwork.vue'
import UiIcon from './UiIcon.vue'
import RouteEvidence from './RouteEvidence.vue'

const nodes = ref([])
const visitorRegion = ref('')
const config = ref({})
const initialTitle = document.title || DEFAULT_SITE_TITLE
const siteTitle = computed(() => config.value.site_title || initialTitle)
const siteIcon = document.querySelector('link[rel~="icon"]').href
const sysConfig = ref({})
const loading = ref(true)
const error = ref('')
const clock = ref(Date.now())
const snapshotAt = ref(null)
const prefs = reactive({ ...defaultPreferences })
const settingsOpen = ref(false)
const settingsDialog = ref(null)
const projectBackground = ref('none')
const themeStyle = computed(() => ({ '--panel-opacity': `${prefs.cardOpacity}%`, '--panel-blur': prefs.cardOpacity < 100 ? `blur(${prefs.panelBlur}px)` : 'none' }))
const reducedMotion = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const systemLight = ref(window.matchMedia('(prefers-color-scheme: light)').matches)
const group = ref('全部节点')
const route = ref('全部线路')
const protocol = ref('全部网络')
const region = ref('全部地区')
const issueFilter = ref('全部状态')
const sort = ref('默认排序')
const search = ref('')
const filtersOpen = ref(false)
const filterFields = [
  { key: 'group', label: '分组', state: group, initial: '全部节点' },
  { key: 'route', label: '线路', state: route, initial: '全部线路' },
  { key: 'protocol', label: '网络', state: protocol, initial: '全部网络' },
  { key: 'region', label: '地区', state: region, initial: '全部地区' },
  { key: 'issue', label: '状态', state: issueFilter, initial: '全部状态' },
  { key: 'search', label: '搜索', state: search, initial: '' },
]
const activeFilters = computed(() => filterFields.filter(field => field.state.value !== field.initial))
const adminUrl = computed(() => new URL(ADMIN_ENTRY_URL, getApiBases()[0]).href)
const detailId = ref('')
const detailTab = ref('概览')
const history = ref([])
const historyHours = ref(1)
const historyEnd = ref(Date.now())
const detailLoading = ref(false)
const historyError = ref('')
const detailDialog = ref(null)
const lastFocus = ref(null)
const pending = new Map()
const runtime = { socket: null, timer: null, refreshTimer: null, refreshRunning: false, stopped: false, historyRequest: 0 }
const online = node => isServerOnline(node, clock.value)
const light = computed(() => prefs.appearance === 'light' || (prefs.appearance === 'auto' && systemLight.value))
const needsVerification = computed(() => config.value.turnstile_enabled && !config.value.verified && (config.value.is_public || config.value.authorization))
const show = computed(() => ({ price: config.value.authorization || sysConfig.value.show_price === true, expire: sysConfig.value.show_expire === true, traffic: sysConfig.value.show_tf === true, network: sysConfig.value.show_three_net_details === true }))
const effectiveView = computed(() => prefs.view === 'network' && !show.value.network ? 'card' : prefs.view)
const onlineNodes = computed(() => nodes.value.filter(online))
const regions = computed(() => [...new Set(nodes.value.map(node => node.region))])
const groups = computed(() => ['全部节点', ...new Set(nodes.value.map(node => node.server_group).filter(Boolean))])
const routeOptions = computed(() => ['全部线路', ...new Set(nodes.value.flatMap(node => routes(node, clock.value)))])
const probes = computed(() => activeProbes(nodes.value, sysConfig.value))
const resourceLoad = computed(() => Object.fromEntries(['cpu', 'memory'].map(metric => {
  const values = onlineNodes.value.map(node => metric === 'cpu' ? node.cpu : usage(node.ram_used, node.ram_total)).filter(value => typeof value === 'number')
  return [metric, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null]
})))
const expiring = computed(() => nodes.value.filter(node => daysLeft(node, clock.value) !== null && daysLeft(node, clock.value) <= 7).length)
const downloadNodes = computed(() => onlineNodes.value.filter(node => typeof node.net_in_speed === 'number'))
const totalDownload = computed(() => downloadNodes.value.length ? downloadNodes.value.reduce((sum, node) => sum + node.net_in_speed, 0) : null)
const warningNodes = computed(() => nodes.value.filter(node => issues(node, online(node), show.value, clock.value).length))
const statusTabs = computed(() => [
  { name: '全部状态', label: '全部', count: nodes.value.length },
  { name: '在线', label: '在线', count: onlineNodes.value.length },
  { name: '离线', label: '离线', count: nodes.value.length - onlineNodes.value.length },
  { name: '需要关注', label: '需关注', count: warningNodes.value.length },
])
const issueOptions = computed(() => ['全部状态', '在线', '离线', '需要关注', '资源紧张', ...(show.value.network ? ['存在丢包'] : []), ...(show.value.traffic ? ['流量将满'] : []), ...(show.value.expire ? ['到期关注'] : [])])
const visibleNodes = computed(() => {
  const filtered = nodes.value.filter(node => {
    if (group.value !== '全部节点' && node.server_group !== group.value) return false
    if (region.value !== '全部地区' && node.region !== region.value) return false
    if (route.value !== '全部线路' && !routes(node, clock.value).includes(route.value)) return false
    if (protocol.value === '双栈' && !(hasIp(node, 4) && hasIp(node, 6))) return false
    if (protocol.value === '仅 IPv4' && !(hasIp(node, 4) && !hasIp(node, 6))) return false
    if (protocol.value === '仅 IPv6' && !(!hasIp(node, 4) && hasIp(node, 6))) return false
    if (protocol.value === '无公网 IP' && (hasIp(node, 4) || hasIp(node, 6))) return false
    if (issueFilter.value === '在线' && !online(node)) return false
    if (issueFilter.value === '离线' && online(node)) return false
    const warnings = issues(node, online(node), show.value, clock.value)
    if (issueFilter.value === '需要关注' && !warnings.length) return false
    if (!['全部状态', '在线', '离线', '需要关注'].includes(issueFilter.value) && !warnings.includes(issueFilter.value)) return false
    return `${node.name} ${node.tags} ${regionName(node.region)}`.toLowerCase().includes(search.value.trim().toLowerCase())
  })
  if (sort.value === '名称') return filtered.sort((a, b) => a.name.localeCompare(b.name))
  if (sort.value === 'CPU 从高到低') return filtered.sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1))
  if (sort.value === '到期从近到远') return filtered.sort((a, b) => (daysLeft(a, clock.value) ?? Infinity) - (daysLeft(b, clock.value) ?? Infinity))
  if (sort.value === '丢包从高到低') return filtered.sort((a, b) => Math.max(0, ...probes.value.map(probe => b['loss_' + probe.key] || 0)) - Math.max(0, ...probes.value.map(probe => a['loss_' + probe.key] || 0)))
  return filtered
})
const detailNode = computed(() => nodes.value.find(node => node.id === detailId.value))
const detailTabs = computed(() => ['概览', ...(show.value.network ? ['网络'] : []), '资源', ...(show.value.price || show.value.expire || show.value.traffic ? ['资产'] : [])])
const chartStart = computed(() => historyEnd.value - historyHours.value * 3600000)
const chartRows = computed(() => history.value.map(row => ({ ...row, ram_percent: usage(row.ram_used, row.ram_total), swap_percent: usage(row.swap_used, row.swap_total), net_down: row.net_in_speed === null ? null : row.net_in_speed / 1024 ** 2, net_up: row.net_out_speed === null ? null : row.net_out_speed / 1024 ** 2 })))
const probeColors = ['#8fb6f0', '#b79cd6', '#74d9b3', '#eac080', '#72c5d9', '#dd98af', '#a5b67f', '#bbbfe0']
const probeSeries = field => probes.value.map((probe, index) => ({ key: `${field}_${probe.key}`, name: probe.name, color: probeColors[index] }))
const maxHistoryHours = computed(() => config.value.authorization || !config.value.is_public ? 168 : 24)

async function request(path) {
  const result = await http.get(path, { autoRedirect: false, timeoutMs: 15000 })
  if (result.status === 401) {
    runtime.socket?.close()
    pending.clear()
    detailId.value = ''
    nodes.value = []
    sysConfig.value = {}
    snapshotAt.value = null
    config.value = { ...config.value, authorization: false }
  }
  if (result.status === 403 && config.value.turnstile_enabled) config.value = { ...config.value, verified: false }
  if (result.error) throw new Error(`数据读取失败（${result.status || '网络'}）：${result.error}`)
  return result.data
}
async function loadNodes() {
  const data = await request('/api/servers')
  nodes.value = data.servers.map(normalizeNode)
  sysConfig.value = data.sysConfig
  snapshotAt.value = Date.now()
}
function connect() {
  runtime.socket?.close()
  runtime.socket = createLiveSocket('all', {
    timeoutMinutes: Number(config.value.frontend_ws_timeout_minutes || 0),
    onUpdate: update => pending.set(update.serverId, { ...pending.get(update.serverId), ...normalizeNode(update.data) }),
    onTimeout: () => { error.value = '实时连接已达到站点设置时限，可以重新连接。'; runtime.stopped = true },
  }, 0, nodes.value.map(node => node.id))
}
async function refreshSnapshot() {
  if (document.hidden || runtime.refreshRunning || runtime.stopped) return
  runtime.refreshRunning = true
  const previousIds = nodes.value.map(node => node.id).join(',')
  try {
    const updatedConfig = await request('/api/config')
    config.value = updatedConfig
    document.title = siteTitle.value
    if (needsVerification.value) { error.value = ''; return }
    await loadNodes()
    if (previousIds !== nodes.value.map(node => node.id).join(',')) connect()
    error.value = ''
  } catch (cause) { error.value = cause.message }
  finally { runtime.refreshRunning = false }
}
async function reconnect() {
  runtime.stopped = false
  await refreshSnapshot()
  if (!error.value && !needsVerification.value) connect()
}
async function verified() { await reconnect(); await hashChanged() }
async function visibilityChanged() {
  if (document.hidden) { runtime.socket?.close(); pending.clear(); return }
  if (runtime.stopped) return
  await refreshSnapshot()
  if (!needsVerification.value) connect()
}
async function loadHistory() {
  const id = detailId.value
  const hours = historyHours.value
  if (!id) return
  const requestId = ++runtime.historyRequest
  detailLoading.value = true
  historyError.value = ''
  history.value = []
  try {
    const [server, rows] = await Promise.all([request(`/api/server?id=${encodeURIComponent(id)}`), request(`/api/history/all?id=${encodeURIComponent(id)}&hours=${hours}`)])
    if (requestId !== runtime.historyRequest || id !== detailId.value || hours !== historyHours.value) return
    nodes.value = nodes.value.map(node => node.id === id ? { ...node, ...normalizeNode(server) } : node)
    history.value = rows.map(normalizeNode)
    historyEnd.value = Date.now()
  } catch (cause) { if (requestId === runtime.historyRequest && id === detailId.value && hours === historyHours.value) historyError.value = cause.message }
  if (requestId === runtime.historyRequest && id === detailId.value && hours === historyHours.value) detailLoading.value = false
}
async function hashChanged() {
  const hash = window.location.hash
  if (!hash.startsWith('#/server/')) { detailId.value = ''; return }
  try { detailId.value = decodeURIComponent(hash.slice(9)) }
  catch { detailId.value = ''; error.value = '节点链接格式无效'; return }
  await nextTick()
  if (detailDialog.value) detailDialog.value.focus()
  await loadHistory()
  if (detailId.value && !detailNode.value) error.value = historyError.value || '没有找到这个节点'
}
function openDetail(node, tab = '概览') { detailTab.value = tab; lastFocus.value = document.activeElement; window.location.hash = `/server/${encodeURIComponent(node.id)}` }
async function closeDetail() { detailTab.value = '概览'; detailId.value = ''; window.location.hash = '/'; await nextTick(); lastFocus.value?.focus() }
function selectRegion(code) { region.value = region.value === code ? '全部地区' : code }
function clearFilters() { for (const field of filterFields) field.state.value = field.initial }
function restorePreferences() { Object.assign(prefs, preferences({ appearance: config.value.preferred_theme, ...(config.value.theme_options?.aether ?? config.value.theme_options?.orbit) })) }
function readProjectBackground() {
  const bodyBackground = getComputedStyle(document.body).backgroundImage
  projectBackground.value = bodyBackground === 'none' ? getComputedStyle(document.body, '::after').backgroundImage : bodyBackground
}
async function openSettings() {
  lastFocus.value = document.activeElement
  settingsOpen.value = true
  await nextTick()
  settingsDialog.value.focus()
}
async function closeSettings() { settingsOpen.value = false; await nextTick(); lastFocus.value?.focus() }
function dialogKey(event) {
  if (event.key === 'Escape') { settingsOpen.value ? closeSettings() : closeDetail(); return }
  if (event.key !== 'Tab') return
  const elements = [...event.currentTarget.querySelectorAll('button, select, input, a[href], [tabindex="0"]')]
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { last.focus(); event.preventDefault(); return }
  if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { first.focus(); event.preventDefault() }
}
const media = { light: window.matchMedia('(prefers-color-scheme: light)'), motion: window.matchMedia('(prefers-reduced-motion: reduce)'), background: window.matchMedia('(max-width: 767px)') }
function mediaChanged() { systemLight.value = media.light.matches; reducedMotion.value = media.motion.matches }
watch(prefs, () => localStorage.setItem('orbit-preferences', JSON.stringify(prefs)))
watch(historyHours, loadHistory)
watch(maxHistoryHours, hours => { if (historyHours.value > hours) historyHours.value = hours })
watch(needsVerification, needed => { if (needed) { runtime.socket?.close(); pending.clear(); detailId.value = ''; nodes.value = []; sysConfig.value = {}; snapshotAt.value = null } })
watch(show, () => { if (!issueOptions.value.includes(issueFilter.value)) issueFilter.value = '全部状态'; if (!detailTabs.value.includes(detailTab.value)) detailTab.value = '概览'; if (!show.value.expire && sort.value === '到期从近到远' || !show.value.network && sort.value === '丢包从高到低') sort.value = '默认排序' })
watch(() => Boolean(detailNode.value) || settingsOpen.value, open => { document.body.style.overflow = open ? 'hidden' : '' })

onMounted(async () => {
  readProjectBackground()
  runtime.timer = setInterval(() => {
    clock.value = Date.now()
    if (!pending.size) return
    nodes.value = nodes.value.map(node => pending.has(node.id) ? { ...node, ...pending.get(node.id) } : node)
    if (detailNode.value && pending.has(detailId.value) && !detailLoading.value && !historyError.value) {
      const sampleTime = timestamp(detailNode.value.sample_timestamp ?? detailNode.value.last_updated)
      if (sampleTime > timestamp(history.value.at(-1)?.timestamp)) history.value.push({ ...detailNode.value, timestamp: sampleTime })
      historyEnd.value = Date.now()
      history.value = history.value.filter(row => timestamp(row.timestamp) >= chartStart.value)
    }
    pending.clear()
  }, 1000)
  runtime.refreshTimer = setInterval(refreshSnapshot, 60000)
  document.addEventListener('visibilitychange', visibilityChanged)
  window.addEventListener('hashchange', hashChanged)
  media.light.addEventListener('change', mediaChanged)
  media.motion.addEventListener('change', mediaChanged)
  media.background.addEventListener('change', readProjectBackground)
  try {
    await initConfig()
    config.value = await request('/api/config')
    document.title = siteTitle.value
    restorePreferences()
    const saved = localStorage.getItem('orbit-preferences')
    if (saved) {
      try { Object.assign(prefs, preferences({ ...prefs, ...JSON.parse(saved) })) }
      catch { restorePreferences() }
    }
    if (!needsVerification.value) {
      await loadNodes()
      connect()
      await hashChanged()
    }
  } catch (cause) { error.value = cause.message }
  loading.value = false
})
onUnmounted(() => {
  runtime.socket?.close()
  clearInterval(runtime.timer)
  clearInterval(runtime.refreshTimer)
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('hashchange', hashChanged)
  media.light.removeEventListener('change', mediaChanged)
  media.motion.removeEventListener('change', mediaChanged)
  media.background.removeEventListener('change', readProjectBackground)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="orbit-app" :class="{ light }" :style="themeStyle">
    <div v-if="prefs.background === 'project' && projectBackground !== 'none'" class="project-backdrop" :style="{ backgroundImage: projectBackground }" aria-hidden="true" />
    <div class="ambient-glow" />
    <div class="page-shell" :inert="Boolean(detailNode) || settingsOpen" :aria-hidden="Boolean(detailNode) || settingsOpen">
      <header class="topbar">
        <a href="#/" class="brand" aria-label="监控首页"><img :src="siteIcon" class="brand-icon" alt="" /><strong class="project-brand" :title="siteTitle">{{ siteTitle }}</strong></a>
        <nav class="topbar-actions" aria-label="页面操作">
          <button class="icon-button" aria-label="主题设置" title="主题设置" @click="openSettings"><UiIcon name="palette" /></button>
          <a :href="adminUrl" class="icon-button admin-link" aria-label="管理后台" title="管理后台"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg></a>
          <button class="icon-button theme-button" :aria-label="light ? '切换深色模式' : '切换浅色模式'" :title="light ? '切换深色模式' : '切换浅色模式'" @click="prefs.appearance = light ? 'dark' : 'light'"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="light" d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" /><template v-else><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></template></svg></button>
        </nav>
      </header>
      <section class="hero" :class="{ 'without-globe': !prefs.globe }">
        <div class="hero-copy">
          <section v-if="snapshotAt" class="overview" aria-label="服务器统计">
            <div class="overview-card"><div class="overview-heading">节点总览 <UiIcon name="server" class="overview-icon" /></div><div class="overview-value">{{ nodes.length }}<small>台服务器</small></div><div class="overview-note"><span class="tiny-dot" />{{ onlineNodes.length }} 在线 <span class="muted-dot" />{{ nodes.length - onlineNodes.length }} 离线</div></div>
            <div class="overview-card" title="在线节点逐台平均，仅计入已上报指标"><div class="overview-heading">资源负载 <UiIcon name="cpu" class="overview-icon" /></div><div class="overview-value" :class="{ amber: resourceLoad.cpu > 80 }">{{ percent(resourceLoad.cpu) }}<small>平均 CPU</small></div><div class="overview-note">内存 <b :class="{ amber: resourceLoad.memory > 80 }">{{ percent(resourceLoad.memory) }}</b><span class="small-divider" />{{ onlineNodes.length }} 台在线</div></div>
            <div class="overview-card"><div class="overview-heading">实时下行 <UiIcon name="download" class="overview-icon" /></div><div class="overview-value network-value">{{ speed(totalDownload).split(' ')[0] }}<small>{{ speed(totalDownload).split(' ')[1] }}</small></div><div class="overview-note">已上报 {{ downloadNodes.length }} / {{ onlineNodes.length }} 台在线节点</div></div>
            <button class="overview-card attention-card" @click="issueFilter = '需要关注'"><div class="overview-heading">需要关注 <UiIcon name="alert" class="overview-icon" /></div><div class="overview-value" :class="{ amber: warningNodes.length }">{{ warningNodes.length }}<small>台节点</small></div><div class="overview-note">{{ show.expire ? `到期 ${expiring} 台 · ` : '' }}查看异常</div></button>
          </section>
          <p v-else>等待服务器数据</p>
          <div class="hero-regions"><button v-for="code in regions" :key="code" :title="regionName(code)" :aria-label="'筛选地区：' + regionName(code)" :aria-pressed="region === code" :class="{ selected: region === code }" @click="selectRegion(code)"><img v-if="flag(code)" :src="flag(code)" alt=""><span>{{ regionName(code) }}</span></button></div>
        </div>
        <div v-if="prefs.globe" class="globe-scene"><Globe :motion="prefs.motion && !reducedMotion" :light="light" :regions="regions" :selected="region" :visitor-region="visitorRegion" :visitor-flow="prefs.visitorFlow" @select="selectRegion" /></div>
      </section>
      <section class="nodes-section">
        <div class="node-header">
        <h2><UiIcon name="server" />服务器<span>{{ snapshotAt ? visibleNodes.length : '—' }}</span></h2>
          <div class="group-tabs" aria-label="节点分组"><button v-for="item in groups" :key="item" :aria-pressed="group === item" :class="{ selected: group === item }" @click="group = item">{{ item === '全部节点' ? '全部' : item }}<small>{{ snapshotAt ? (item === '全部节点' ? nodes.length : nodes.filter(node => node.server_group === item).length) : '—' }}</small></button></div>
          <div class="node-header-actions"><button class="icon-button refresh-button" aria-label="刷新节点" title="刷新节点" @click="refreshSnapshot"><UiIcon name="refresh" /></button><div class="view-switch"><button :class="{ selected: effectiveView === 'card' }" :aria-pressed="effectiveView === 'card'" aria-label="卡片视图" @click="prefs.view = 'card'"><UiIcon name="grid" /><span>卡片</span></button><button :class="{ selected: effectiveView === 'table' }" :aria-pressed="effectiveView === 'table'" aria-label="表格视图" @click="prefs.view = 'table'"><UiIcon name="list" /><span>列表</span></button><button v-if="show.network" :class="{ selected: effectiveView === 'network' }" :aria-pressed="effectiveView === 'network'" aria-label="网络质量矩阵" @click="prefs.view = 'network'"><UiIcon name="activity" /><span>网络</span></button></div>
        </div>
        </div>
        <div class="node-controls">
          <div class="status-tabs" aria-label="节点状态"><button v-for="tab in statusTabs" :key="tab.name" :class="{ selected: issueFilter === tab.name, attention: tab.name === '需要关注' }" :aria-pressed="issueFilter === tab.name" :aria-label="'筛选' + tab.label + '节点'" @click="issueFilter = tab.name"><i />{{ tab.label }}<small>{{ snapshotAt ? tab.count : '—' }}</small></button></div>
          <div class="filter-actions"><label class="search-box"><UiIcon name="search" /><input v-model="search" placeholder="搜索节点、地区或线路" aria-label="搜索节点或线路"></label><button class="filter-toggle" :class="{ selected: filtersOpen }" :aria-expanded="filtersOpen" aria-controls="node-filters" @click="filtersOpen = !filtersOpen"><UiIcon name="filter" />筛选<span v-if="activeFilters.length">{{ activeFilters.length }}</span></button></div>
        </div>
        <div v-show="filtersOpen" id="node-filters" class="filters filter-bar">
          <label>线路 / 标签<select v-model="route" aria-label="筛选服务器线路"><option v-for="item in routeOptions" :key="item">{{ item }}</option></select></label>
          <label>公网协议<select v-model="protocol" aria-label="筛选 IP 协议"><option v-for="item in ['全部网络', '双栈', '仅 IPv4', '仅 IPv6', '无公网 IP']" :key="item">{{ item }}</option></select></label>
          <label>地区<select v-model="region" aria-label="筛选地区"><option value="全部地区">全部地区</option><option v-for="code in regions" :key="code" :value="code">{{ regionName(code) }}</option></select></label>
          <label>异常类型<select v-model="issueFilter" aria-label="筛选异常状态"><option v-for="item in issueOptions" :key="item">{{ item }}</option></select></label>
          <label>排序<select v-model="sort" aria-label="排序节点"><option>默认排序</option><option>名称</option><option>CPU 从高到低</option><option v-if="show.expire">到期从近到远</option><option v-if="show.network">丢包从高到低</option></select></label>
        </div>
        <div v-if="activeFilters.length" class="active-filters"><span>已筛选</span><button v-for="field in activeFilters" :key="field.key" :aria-label="'移除' + field.label + '筛选'" @click="field.state.value = field.initial">{{ field.label }}：{{ field.key === 'region' ? regionName(field.state.value) : field.state.value }}<UiIcon name="close" /></button><button class="clear-all" @click="clearFilters">重置</button></div>
        <div v-if="error && !needsVerification" class="error-state" role="alert">{{ error }} <button @click="reconnect">重新连接</button><a :href="adminUrl">后台登录</a></div>
        <SiteVerification v-if="needsVerification" :key="config.turnstile_site_key" :site-key="config.turnstile_site_key" :light="light" @verified="verified" />
        <div v-else-if="loading" class="loading-grid" role="status" aria-label="正在读取服务器数据"><div v-for="item in 3" :key="item" class="node-skeleton"><i /><i /><i /><i /></div></div><div v-else-if="!visibleNodes.length && !error" class="empty-state"><UiIcon name="search" class="empty-symbol" /><strong>{{ nodes.length ? '没有符合条件的节点' : '还没有服务器节点' }}</strong><p>{{ nodes.length ? '调整搜索词或清除筛选后再看看。' : '添加探针后，节点会显示在这里。' }}</p><button v-if="nodes.length" @click="clearFilters">清除筛选</button><a v-else :href="adminUrl">管理后台<UiIcon name="external" /></a></div>
        <div v-else-if="effectiveView === 'card'" class="node-grid"><NodeCard v-for="node in visibleNodes" :key="node.id" :node="node" :online="online(node)" :full="prefs.layout === 'full'" :show="show" :probes="probes" :now="clock" @open="openDetail" /></div>
        <div v-else-if="effectiveView === 'table'" class="table-shell"><table><thead><tr><th>服务器</th><th>标签 / 公网</th><th>核心 / CPU</th><th>内存 / 磁盘</th><th v-if="show.traffic">本月流量</th><th v-if="show.network">延迟 / 丢包</th><th v-if="show.price">价格</th><th v-if="show.expire">到期</th><th>状态</th></tr></thead><tbody><tr v-for="node in visibleNodes" :key="node.id"><td><button class="table-node" @click="openDetail(node)"><img v-if="flag(node.region)" class="table-flag" :src="flag(node.region)" alt=""> {{ node.name }}</button><small>{{ node.server_group }} / {{ regionName(node.region) }}</small><small>{{ online(node) ? '在线时长' : '最后运行时长' }} {{ uptime(node, online(node) ? clock : timestamp(node.last_updated)) }}</small></td><td><span v-for="item in routes(node)" :key="item" class="route-badge">{{ item }}</span><small class="green">{{ [4, 6].filter(version => hasIp(node, version)).map(version => 'IPv' + version).join(' · ') }}</small></td><td>{{ node.cpu_cores ?? '—' }} 核心<small>{{ percent(node.cpu) }}</small></td><td>{{ capacity(node.ram_used) }} / {{ capacity(node.ram_total) }}<small>{{ capacity(node.disk_used) }} / {{ capacity(node.disk_total) }}</small></td><td v-if="show.traffic">{{ bytes(trafficBytes(node)) }}<small>/ {{ quota(node) }}</small></td><td v-if="show.network"><small v-for="probe in probes.slice(0, 3)" :key="probe.key">{{ probe.name }} <span :class="latencyClass(node['ping_' + probe.key], online(node))">{{ probeValue(node, probe.key, 'ping', online(node)) }}</span> · 丢包 {{ probeValue(node, probe.key, 'loss', online(node)) }}</small></td><td v-if="show.price">{{ price(node) }}</td><td v-if="show.expire">{{ node.expire_date || '未填写' }}<small>{{ expiry(node, clock) }}</small></td><td :class="{ green: online(node) }">{{ online(node) ? '在线' : '离线' }}</td></tr></tbody></table></div>
        <div v-else class="network-matrix"><div class="matrix-note">延迟 / 丢包 · 最近 {{ sysConfig.latency_window?.hours || 2 }} 小时采样趋势</div><div class="table-shell"><table><thead><tr><th>服务器 / 探测模式</th><th v-for="probe in probes" :key="probe.key">{{ probe.name }}</th></tr></thead><tbody><tr v-for="node in visibleNodes" :key="node.id"><td><button class="table-node matrix-node" @click="openDetail(node, '网络')">{{ node.name }}<UiIcon name="external" /></button><small>{{ regionName(node.region) }} · {{ (node.ping_mode || 'tcp').toUpperCase() }}</small></td><td v-for="(probe, index) in probes" :key="probe.key" :class="{ 'matrix-warning': online(node) && node['loss_' + probe.key] > 0, 'matrix-offline': !online(node) }"><strong :class="latencyClass(node['ping_' + probe.key], online(node))">{{ probeValue(node, probe.key, 'ping', online(node)) }}</strong><small :class="{ amber: online(node) && node['loss_' + probe.key] > 0 }">丢包 {{ probeValue(node, probe.key, 'loss', online(node)) }}</small><div v-if="node.ping?.length" class="matrix-trend"><MetricChart compact :rows="node.ping" :start="clock - (sysConfig.latency_window?.hours || 2) * 3600000" :end="clock" :series="[{ key: probe.key, name: probe.name, color: probeColors[index] }]" unit="ms" /></div></td></tr></tbody></table></div></div>
      </section>
      <VisitorNetwork @country="visitorRegion = $event" />
      <footer class="site-credit"><a href="https://github.com/huilang-me/CF-Server-Monitor" :title="config.version" target="_blank" rel="noopener noreferrer">Powered by CF-Server-Monitor</a><span>Aether · 以太</span></footer>
    </div>
    <div v-if="settingsOpen" class="dialog-backdrop settings-backdrop" @click.self="closeSettings"><section ref="settingsDialog" class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-settings-title" tabindex="-1" @keydown="dialogKey">
      <div class="settings-heading"><div><span>AETHER</span><h2 id="theme-settings-title">主题设置</h2></div><button class="icon-button" aria-label="关闭主题设置" @click="closeSettings"><UiIcon name="close" /></button></div>
      <p class="settings-note">调整会即时预览，并保存在当前浏览器。</p>
      <div class="settings-section"><h3>背景与质感</h3>
        <label class="setting-row"><span>页面背景<small>{{ projectBackground === 'none' ? '项目未设置背景，将使用默认底色' : '跟随项目的桌面与手机背景' }}</small></span><select v-model="prefs.background" aria-label="页面背景"><option value="project">项目背景</option><option value="default">默认背景</option></select></label>
        <label class="setting-range"><span>卡片不透明度<output>{{ prefs.cardOpacity }}%</output></span><input v-model.number="prefs.cardOpacity" type="range" min="40" max="100" step="5" aria-label="卡片不透明度"><small>数值越低，背景越明显；文字保持清晰。</small></label>
        <label class="setting-range"><span>毛玻璃模糊<output>{{ prefs.panelBlur }} px</output></span><input v-model.number="prefs.panelBlur" type="range" min="0" max="20" step="1" aria-label="毛玻璃模糊"><small>在半透明卡片下生效。</small></label>
      </div>
      <div class="settings-section"><h3>显示与动效</h3>
        <label class="setting-row"><span>配色</span><select v-model="prefs.appearance" aria-label="主题配色"><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label class="setting-row"><span>卡片信息</span><select v-model="prefs.layout" aria-label="卡片信息"><option value="compact">紧凑</option><option value="full">完整</option></select></label>
        <div class="setting-toggles"><label class="setting-row"><span>显示地球</span><input v-model="prefs.globe" type="checkbox" role="switch" aria-label="显示地球"></label>
        <label class="setting-row"><span>地球动效</span><input v-model="prefs.motion" type="checkbox" role="switch" aria-label="地球动效"></label>
        <label class="setting-row visitor-flow-setting"><span>向访客位置汇聚<small>光点从节点流向绿色定位点</small></span><input v-model="prefs.visitorFlow" type="checkbox" role="switch" aria-label="向访客位置汇聚"></label></div>
      </div>
      <div class="settings-footer"><button class="clear-button" @click="restorePreferences">恢复站点默认</button><button class="settings-done" @click="closeSettings">完成</button></div>
    </section></div>
    <div v-if="detailNode" class="dialog-backdrop" @click.self="closeDetail"><section ref="detailDialog" class="detail-dialog" :class="{ 'network-detail': detailTab === '网络', 'resource-detail': detailTab === '资源' }" role="dialog" aria-modal="true" :aria-label="detailNode.name + '服务器详情'" tabindex="-1" @keydown="dialogKey">
      <div class="detail-top"><h2><img v-if="flag(detailNode.region)" class="table-flag" :src="flag(detailNode.region)" alt=""> {{ detailNode.name }}</h2><button class="icon-button" aria-label="关闭详情" @click="closeDetail"><UiIcon name="close" /></button></div><p class="detail-subtitle">{{ detailNode.server_group }} / {{ regionName(detailNode.region) }} · {{ online(detailNode) ? '在线' : '离线 · 资源为最后样本' }}</p><div class="detail-badges"><span v-for="item in routes(detailNode)" :key="item" class="route-badge">{{ item }}</span><span v-for="version in [4, 6].filter(version => hasIp(detailNode, version))" :key="version" class="ip-badge supported">IPv{{ version }}</span></div>
      <div v-if="issues(detailNode, online(detailNode), show, clock).length" class="detail-issues"><UiIcon name="alert" /><span v-for="warning in issues(detailNode, online(detailNode), show, clock)" :key="warning">{{ warning }}</span></div>
      <div class="detail-tabs"><button v-for="tab in detailTabs" :key="tab" :class="{ selected: detailTab === tab }" @click="detailTab = tab">{{ tab }}</button></div>
      <div v-if="detailTab === '概览'" class="detail-stats"><div><span>处理器 / 核心数</span><strong>{{ detailNode.cpu_cores ?? '—' }} 核心 · {{ percent(detailNode.cpu) }}</strong><small>{{ detailNode.cpu_info || '未上报型号' }}</small></div><div><span>运行时长</span><strong>{{ uptime(detailNode, online(detailNode) ? clock : timestamp(detailNode.last_updated)) }}</strong><small>最后上报 {{ dateTime(detailNode.last_updated) }}</small></div><div><span>内存 已用 / 总量</span><strong>{{ capacity(detailNode.ram_used) }} / {{ capacity(detailNode.ram_total) }}</strong></div><div><span>磁盘 已用 / 总量</span><strong>{{ capacity(detailNode.disk_used) }} / {{ capacity(detailNode.disk_total) }}</strong></div><div><span>系统 / 架构</span><strong>{{ detailNode.os || '未上报' }} · {{ detailNode.arch || '未上报' }}</strong><small>内核 {{ detailNode.kernel_version || '未上报' }} · Agent {{ detailNode.agent_version || '未上报' }}</small></div><div><span>平均负载 1 / 5 / 15 分钟</span><strong>{{ detailNode.load_avg || '未上报' }}</strong></div></div>
      <div v-if="detailTab === '网络'"><div class="detail-probe-grid"><div v-for="probe in probes" :key="probe.key"><span>{{ probe.name }} · {{ (detailNode.ping_mode || 'tcp').toUpperCase() }}</span><strong :class="latencyClass(detailNode['ping_' + probe.key], online(detailNode))">{{ probeValue(detailNode, probe.key, 'ping', online(detailNode)) }}</strong><small :class="{ amber: online(detailNode) && detailNode['loss_' + probe.key] > 0 }">丢包 {{ probeValue(detailNode, probe.key, 'loss', online(detailNode)) }}</small></div></div><div class="detail-stats"><div><span>下行 / 上行速率</span><strong>{{ online(detailNode) ? speed(detailNode.net_in_speed) + ' / ' + speed(detailNode.net_out_speed) : '离线' }}</strong></div><div><span>TCP / UDP 连接</span><strong>{{ detailNode.tcp_conn ?? '未上报' }} / {{ detailNode.udp_conn ?? '未上报' }}</strong></div></div></div>
      <div v-if="detailTab === '资源'" class="detail-stats"><div><span>进程数 / 平均负载</span><strong>{{ detailNode.processes ?? '未上报' }}</strong><small>{{ detailNode.load_avg || '未上报' }}</small></div><div><span>Swap 已用 / 总量</span><strong>{{ detailNode.swap_total === 0 ? '未配置 Swap' : capacity(detailNode.swap_used) + ' / ' + capacity(detailNode.swap_total) }}</strong></div><template v-if="detailNode.disk"><div><span>磁盘读取 / 写入</span><strong>{{ speed(detailNode.disk.read_bps) }} / {{ speed(detailNode.disk.write_bps) }}</strong></div><div><span>读 / 写 IOPS</span><strong>{{ detailNode.disk.read_iops ?? '未上报' }} / {{ detailNode.disk.write_iops ?? '未上报' }}</strong><small>等待 {{ detailNode.disk.await_ms ?? '未上报' }} ms · 忙碌 {{ percent(detailNode.disk.util) }}</small></div></template><div v-for="gpu in detailNode.gpu_info" :key="gpu.id"><span>{{ gpu.name }}</span><strong>利用率 {{ percent(number(gpu.info)) }}</strong><small v-if="number(gpu.mem_total) !== null">显存 {{ capacity(number(gpu.mem_used)) }} / {{ capacity(number(gpu.mem_total)) }}</small><small v-if="number(gpu.power) !== null">功耗 {{ gpu.power }} W</small></div></div>
      <div v-if="detailTab === '资产'" class="detail-stats"><div v-if="show.price"><span>价格 / 账单周期</span><strong>{{ price(detailNode) }}</strong></div><div v-if="show.expire"><span>到期日期</span><strong>{{ detailNode.expire_date || '未填写' }}</strong><small>{{ expiry(detailNode, clock) }}</small><small v-if="detailNode.auto_renewal === '1'">启用到期日自动推进</small></div><div v-if="show.traffic"><span>本月已用 / 额度 · 按{{ trafficNames[detailNode.traffic_calc_type || 'total'] }}计</span><strong>{{ bytes(trafficBytes(detailNode)) }} / {{ quota(detailNode) }}</strong><small class="asset-traffic"><UiIcon name="down" />{{ bytes(detailNode.net_rx_monthly) }} · <UiIcon name="up" />{{ bytes(detailNode.net_tx_monthly) }}{{ trafficPercent(detailNode) === null ? '' : ' · ' + trafficPercent(detailNode) + '%' }}</small></div><div v-if="show.traffic"><span>月流量重置日</span><strong>{{ detailNode.reset_day ? `每月 ${detailNode.reset_day} 日` : '未填写' }}</strong></div></div>
      <RouteEvidence v-if="detailTab === '网络'" :report="detailNode.route_report" :now="clock" />
      <div v-if="detailTab !== '资产'" class="detail-chart"><div class="chart-heading"><strong>历史趋势</strong><select v-model="historyHours" aria-label="历史时间范围"><option v-for="hours in [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168].filter(hours => hours <= maxHistoryHours)" :key="hours" :value="hours">{{ hours === 0.167 ? '10 分钟' : hours === 0.5 ? '30 分钟' : hours + ' 小时' }}</option></select><button class="clear-button" aria-label="刷新历史" @click="loadHistory">刷新</button></div><p v-if="detailLoading" class="empty-chart">正在加载历史…</p><p v-else-if="historyError" class="error-state">{{ historyError }}</p><div v-else class="detail-chart-grid"><MetricChart v-if="detailTab === '概览'" :rows="chartRows" :start="chartStart" :end="historyEnd" :series="[{ key: 'cpu', name: 'CPU', color: '#8fb6f0' }, { key: 'ram_percent', name: '内存', color: '#74d9b3' }]" :ceiling="100" unit="%" /><template v-if="detailTab === '网络'"><MetricChart :rows="chartRows" :start="chartStart" :end="historyEnd" :series="probeSeries('ping')" unit="ms" /><MetricChart :rows="chartRows" :start="chartStart" :end="historyEnd" :series="probeSeries('loss')" :ceiling="100" unit="丢包 %" /><MetricChart :rows="chartRows" :start="chartStart" :end="historyEnd" :series="[{ key: 'net_down', name: '下行', color: '#8fb6f0' }, { key: 'net_up', name: '上行', color: '#74d9b3' }]" unit="MB/s" /></template><template v-if="detailTab === '资源'"><MetricChart :rows="chartRows" :start="chartStart" :end="historyEnd" :series="[{ key: 'ram_percent', name: '内存', color: '#74d9b3' }, { key: 'swap_percent', name: 'Swap', color: '#b79cd6' }]" :ceiling="100" unit="%" /><MetricChart v-if="detailNode.disk" :rows="chartRows" :start="chartStart" :end="historyEnd" :series="[{ key: 'disk_read_iops', name: '读 IOPS', color: '#8fb6f0' }, { key: 'disk_write_iops', name: '写 IOPS', color: '#eac080' }]" unit="IOPS" /></template></div></div>

    </section></div>
  </div>
</template>
