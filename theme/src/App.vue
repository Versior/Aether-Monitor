<script setup>
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getApiBases } from '../../src/frontend/utils/config.js'
import { DEFAULT_SITE_TITLE } from '../../src/frontend/utils/constants.js'
import { activeProbes, regionName, flag, routes, usage, percent, speed, daysLeft, issues } from './data.js'
import { createSiteAccess, adminUrl as siteAdminUrl } from './siteAccess.js'
import { createMonitorSession } from './monitorSession.js'
import { createPreferencesController } from './themePreferences.js'
import { locale, resolveLocale, t } from './i18n.js'
import { initialFilters, displayRules, filterNodes } from './dashboardView.js'
import NodeCard from './NodeCard.vue'
import NodeRows from './NodeRows.vue'
import NodeDetail from './NodeDetail.vue'
import SiteStatus from './SiteStatus.vue'
import AppearancePanel from './AppearancePanel.vue'
import VisitorNetwork from './VisitorNetwork.vue'
import UiIcon from './UiIcon.vue'

const Globe = defineAsyncComponent({
  loader: () => import('./Globe.vue'),
  errorComponent: { setup: () => () => h('p', {class:'globe-error',role:'status'}, t('地球组件加载失败')) },
})

const bases = getApiBases()
const initialTitle = document.title || DEFAULT_SITE_TITLE
const siteIcon = document.querySelector('link[rel~="icon"]').href
const access = createSiteAccess({
  onBlocked: (base,status,error) => session.block(base,status,error),
  shouldRedirect: base => base === (state.detail.id ? state.detail.base : bases[0]),
  onConfig(base, config) { const site = state.sites.find(s => s.base === base); if (site) site.config = config },
})
const session = createMonitorSession({bases, access})
const {state} = session
const primary = computed(() => state.sites[0])
const statusSites = computed(() => state.detail.id ? [] : state.sites)
const detailSite = computed(() => state.sites[state.detail.site] || primary.value)
const config = computed(() => (state.detail.id ? detailSite.value : primary.value)?.config || {})
const siteTitle = computed(() => config.value.site_title || initialTitle)
const adminUrl = computed(() => siteAdminUrl(state.detail.id ? detailSite.value.base : bases[0]))
const settings = createPreferencesController({initial:window.__AETHER_PREFERENCES__, storage:window.localStorage})
const {prefs} = settings
const settingsOpen = ref(false), saving = ref(false), notice = ref('')
const lastFocus = ref(null), detailTab = ref('概览'), visitorRegion = ref('')
const projectBackground = ref('none')
const media = {light:window.matchMedia('(prefers-color-scheme: light)'), motion:window.matchMedia('(prefers-reduced-motion: reduce)'), mobile:window.matchMedia('(max-width: 767px)')}
const systemLight = ref(media.light.matches), reducedMotion = ref(media.motion.matches)
const light = computed(() => prefs.appearance === 'light' || (prefs.appearance === 'auto' && systemLight.value))
const themeStyle = computed(() => ({'--panel-opacity': `${prefs.cardOpacity}%`, '--panel-blur':prefs.cardOpacity<100?`blur(${prefs.panelBlur}px)`:'none'}))
const allowVisitor = computed(() => primary.value.config?.theme_options?.aether?.visitorLookup !== false)
const showVisitor = computed(() => Boolean(primary.value.snapshotAt && !primary.value.blocked && allowVisitor.value && prefs.visitorLookup))
watch(showVisitor, show=>{if (!show) visitorRegion.value=''})
const nodes = computed(() => state.nodes), clock = computed(() => state.clock), snapshotAt = computed(() => state.snapshotAt)
const stats = computed(() => state.stats || {total:'—',online:'—',offline:'—'}), loading = computed(() => state.loading)
const siteSettings = site => ({...site?.config,...site?.sysConfig})
const settingsBySite = computed(() => state.sites.map(siteSettings))
const rulesBySite = computed(() => settingsBySite.value.map(displayRules))
const settingsFor = node => settingsBySite.value[node.site]
const rulesFor = node => rulesBySite.value[node.site]
const online = session.online
const show = computed(() => Object.fromEntries(['price','expire','network','traffic'].map(k=>[k,rulesBySite.value.some(s=>s[k])])))
const effectiveView = computed(() => prefs.view === 'network' && !show.value.network ? 'card' : prefs.view)
const filters = reactive({...initialFilters}), sort = ref('默认排序'), filtersOpen = ref(false)
const filterFields = Object.entries({group:'分组',route:'线路',protocol:'网络',region:'地区',issue:'状态',search:'搜索'}).map(([key,label])=>({key,label}))
const activeFilters = computed(()=>filterFields.filter(f=>filters[f.key]!==initialFilters[f.key]))
const groups = computed(()=>['全部节点',...new Set(nodes.value.map(n=>n.server_group).filter(Boolean))])
const regions = computed(()=>[...new Set(nodes.value.map(n=>n.region))])
const routeOptions = computed(()=>['全部线路',...new Set(nodes.value.flatMap(n=>routes(n,clock.value)))])
const issueOptions = computed(()=>['全部状态','在线','离线','需要关注','资源紧张',...(show.value.network?['存在丢包']:[]),...(show.value.traffic?['流量将满']:[]),...(show.value.expire?['到期关注']:[])])
const visibleNodes = computed(()=>filterNodes(nodes.value,filters,sort.value,{now:clock.value,online,rules:rulesFor,settings:settingsFor}))
const tableSites = computed(()=>state.sites.map(site=>({site,nodes:visibleNodes.value.filter(n=>n.site===site.index)})).filter(entry=>entry.nodes.length && (effectiveView.value!=='network'||rulesBySite.value[entry.site.index].network)))
const onlineNodes = computed(()=>nodes.value.filter(online))
const resourceLoad = computed(()=>Object.fromEntries(['cpu','memory'].map(key=>{ const values=onlineNodes.value.map(n=>key==='cpu'?n.cpu:usage(n.ram_used,n.ram_total)).filter(v=>typeof v==='number'); return [key,values.length?values.reduce((a,b)=>a+b,0)/values.length:null] })))
const expiring = computed(()=>nodes.value.filter(n=>rulesFor(n).expire && daysLeft(n,clock.value)!==null && daysLeft(n,clock.value)<=7).length)
const downloadNodes = computed(()=>onlineNodes.value.filter(n=>typeof n.net_in_speed==='number'))
const totalDownload = computed(()=>downloadNodes.value.length?downloadNodes.value.reduce((v,n)=>v+n.net_in_speed,0):null)
const warningNodes = computed(()=>nodes.value.filter(n=>issues(n,online(n),rulesFor(n),clock.value).length))
const statusTabs = computed(()=>[{name:'全部状态',label:'全部',count:stats.value.total},{name:'在线',label:'在线',count:stats.value.online},{name:'离线',label:'离线',count:stats.value.offline},{name:'需要关注',label:'需关注',count:warningNodes.value.length}])
const clearFilters = () => Object.assign(filters,initialFilters)
const selectRegion = code => { filters.region = filters.region === code ? initialFilters.region : code }
function openDetail(node,tab='概览') { lastFocus.value=document.activeElement; detailTab.value=tab; window.location.hash=session.detailHash(node) }
function closeDetail() { window.location.hash='/'; detailTab.value='概览' }
function openSettings() { notice.value=''; lastFocus.value=document.activeElement; settingsOpen.value=true }
async function closeSettings() { settingsOpen.value=false; await nextTick(); lastFocus.value?.focus() }
async function saveDefaults() {
  if (!primary.value.config?.authorization || saving.value) return
  saving.value=true; notice.value=''
  try { await access.save(bases[0],{...prefs}); settings.clearOverrides(); notice.value=t('已保存为站点默认') }
  catch (e) { notice.value=e.message; if (!e.staleCredentials && (e.status===401 || e.status===403)) { session.block(bases[0],e.status,e); await closeSettings() } }
  finally { saving.value=false }
}
const restorePreferences = () => { settings.clearOverrides(); notice.value='' }
function readProjectBackground() { const bg=getComputedStyle(document.body).backgroundImage; projectBackground.value=bg==='none'?getComputedStyle(document.body,'::after').backgroundImage:bg }
function mediaChanged() { systemLight.value=media.light.matches; reducedMotion.value=media.motion.matches }
const visibilityChanged = () => session.setVisible(!document.hidden)
const hashChanged = () => session.navigate(window.location.hash)
watch(()=>primary.value?.config,c=>{if(c) settings.applyConfig(c)},{immediate:true,flush:'sync'})
watch(config,c=>{locale.value=resolveLocale(c.default_language); document.documentElement.lang=locale.value},{immediate:true})
watch(siteTitle,title=>{document.title=title},{immediate:true})
watch(light,value=>{document.documentElement.dataset.appearance=value?'light':'dark'},{immediate:true})
watch(()=>Boolean(state.detail.id)||settingsOpen.value,async (open,wasOpen)=>{document.body.style.overflow=open?'hidden':''; if(!open&&wasOpen){await nextTick();lastFocus.value?.focus()} })
watch(show,()=>{if(!issueOptions.value.includes(filters.issue)) filters.issue=initialFilters.issue;if(!show.value.expire&&sort.value==='到期从近到远'||!show.value.network&&sort.value==='丢包从高到低')sort.value='默认排序'})
onMounted(()=>{readProjectBackground();document.addEventListener('visibilitychange',visibilityChanged);window.addEventListener('hashchange',hashChanged);media.light.addEventListener('change',mediaChanged);media.motion.addEventListener('change',mediaChanged);media.mobile.addEventListener('change',readProjectBackground);hashChanged()})
onUnmounted(()=>{session.dispose();document.removeEventListener('visibilitychange',visibilityChanged);window.removeEventListener('hashchange',hashChanged);media.light.removeEventListener('change',mediaChanged);media.motion.removeEventListener('change',mediaChanged);media.mobile.removeEventListener('change',readProjectBackground);document.body.style.overflow=''})
</script>
<template>
  <div class="orbit-app" :class="{light}" :style="themeStyle">
    <template v-if="prefs.background==='project' && projectBackground!=='none'"><div class="project-backdrop" :style="{backgroundImage:projectBackground}" aria-hidden="true"/><div class="ambient-glow"/></template>
    <div class="page-shell" :inert="Boolean(state.detail.id)||settingsOpen" :aria-hidden="Boolean(state.detail.id)||settingsOpen">
      <header class="topbar">
        <a href="#/" class="brand" :aria-label="t('监控首页')"><img :src="siteIcon" class="brand-icon" alt="" /><strong class="project-brand" :title="siteTitle">{{ siteTitle }}</strong></a>
        <nav class="topbar-actions" :aria-label="t('页面操作')">
          <button class="icon-button" :aria-label="t('主题设置')" :title="t('主题设置')" @click="openSettings"><UiIcon name="palette" /></button>
          <a :href="adminUrl" class="icon-button admin-link" :aria-label="t('管理后台')" :title="t('管理后台')"><UiIcon name="settings"/></a>
          <button class="icon-button theme-button" :aria-label="t(light ? '切换深色模式' : '切换浅色模式')" :title="t(light ? '切换深色模式' : '切换浅色模式')" @click="prefs.appearance = light ? 'dark' : 'light'"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="light" d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" /><template v-else><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></template></svg></button>
        </nav>
      </header>
      <section class="hero" :class="{ 'without-globe': !prefs.globe }">
        <div class="hero-copy">
          <section v-if="snapshotAt" class="overview" :aria-label="t('服务器统计')">
            <div class="overview-card"><div class="overview-heading"> {{ t('节点总览') }} <UiIcon name="server" class="overview-icon" /></div><div class="overview-value">{{ stats.total }}<small> {{ t('台服务器') }} </small></div><div class="overview-note"><span class="tiny-dot" />{{ stats.online }} {{ t('在线') }} <span class="muted-dot" />{{ stats.offline }} {{ t('离线') }}</div></div>
            <div class="overview-card" :title="t('在线节点逐台平均，仅计入已上报指标')"><div class="overview-heading"> {{ t('资源负载') }} <UiIcon name="cpu" class="overview-icon" /></div><div class="overview-value" :class="{ amber: resourceLoad.cpu > 80 }">{{ percent(resourceLoad.cpu) }}<small> {{ t('平均 CPU') }} </small></div><div class="overview-note"> {{ t('内存') }} <b :class="{ amber: resourceLoad.memory > 80 }">{{ percent(resourceLoad.memory) }}</b><span class="small-divider" />{{ onlineNodes.length }} {{ t('台在线') }}</div></div>
            <div class="overview-card"><div class="overview-heading"> {{ t('实时下行') }} <UiIcon name="download" class="overview-icon" /></div><div class="overview-value network-value">{{ speed(totalDownload).split(' ')[0] }}<small>{{ speed(totalDownload).split(' ')[1] }}</small></div><div class="overview-note"> {{ t('已上报') }} {{ downloadNodes.length }} / {{ onlineNodes.length }} {{ t('台在线') }}</div></div>
            <button class="overview-card attention-card" @click="filters.issue = '需要关注'"><div class="overview-heading"> {{ t('需要关注') }} <UiIcon name="alert" class="overview-icon" /></div><div class="overview-value" :class="{ amber: warningNodes.length }">{{ warningNodes.length }}<small> {{ t('台节点') }} </small></div><div class="overview-note">{{ show.expire ? t('到期 {n} 台 · ', {n:expiring}) : '' }}{{ t('查看异常') }}</div></button>
          </section>
          <p v-else> {{ t('等待服务器数据') }} </p>
          <div class="hero-regions"><button v-for="code in regions" :key="code" :title="regionName(code)" :aria-label="t('筛选地区：{name}',{name:regionName(code)})" :aria-pressed="filters.region === code" :class="{ selected: filters.region === code }" @click="selectRegion(code)"><img v-if="flag(code)" :src="flag(code)" alt=""><span>{{ regionName(code) }}</span></button></div>
        </div>
        <div v-if="prefs.globe && snapshotAt" class="globe-scene"><Globe :motion="prefs.motion && !reducedMotion && !state.detail.id && !settingsOpen" :light="light" :regions="regions" :selected="filters.region" :visitor-region="visitorRegion" :visitor-flow="prefs.visitorFlow" @select="selectRegion" /></div>
      </section>
      <section class="nodes-section">
        <div class="node-header">
        <h2><UiIcon name="server" /> {{ t('服务器') }} <span>{{ snapshotAt ? visibleNodes.length : '—' }}</span></h2>
          <div class="group-tabs" :aria-label="t('节点分组')"><button v-for="item in groups" :key="item" :aria-pressed="filters.group === item" :class="{ selected: filters.group === item }" @click="filters.group = item">{{ item === '全部节点' ? t('全部') : item }}<small>{{ snapshotAt ? (item === '全部节点' ? nodes.length : nodes.filter(node => node.server_group === item).length) : '—' }}</small></button></div>
          <div class="node-header-actions"><div class="view-switch"><button :class="{ selected: effectiveView === 'card' }" :aria-pressed="effectiveView === 'card'" :aria-label="t('卡片视图')" @click="prefs.view = 'card'"><UiIcon name="grid" /><span> {{ t('卡片') }} </span></button><button :class="{ selected: effectiveView === 'table' }" :aria-pressed="effectiveView === 'table'" :aria-label="t('表格视图')" @click="prefs.view = 'table'"><UiIcon name="list" /><span> {{ t('列表') }} </span></button><button v-if="show.network" :class="{ selected: effectiveView === 'network' }" :aria-pressed="effectiveView === 'network'" :aria-label="t('网络质量矩阵')" @click="prefs.view = 'network'"><UiIcon name="activity" /><span> {{ t('网络') }} </span></button></div>
        </div>
        </div>
        <div class="node-controls">
          <div class="status-tabs" :aria-label="t('节点状态')"><button v-for="tab in statusTabs" :key="tab.name" :class="{ selected: filters.issue === tab.name, attention: tab.name === '需要关注' }" :aria-pressed="filters.issue === tab.name" :aria-label="t('筛选{status}节点',{status:t(tab.label)})" @click="filters.issue = tab.name"><i />{{ t(tab.label) }}<small>{{ snapshotAt ? tab.count : '—' }}</small></button></div>
          <div class="filter-actions"><label class="search-box"><UiIcon name="search" /><input v-model="filters.search" :placeholder="t('搜索节点、地区或线路')" :aria-label="t('搜索节点或线路')"></label><button class="filter-toggle" :class="{ selected: filtersOpen }" :aria-expanded="filtersOpen" aria-controls="node-filters" @click="filtersOpen = !filtersOpen"><UiIcon name="filter" /> {{ t('筛选') }} <span v-if="activeFilters.length">{{ activeFilters.length }}</span></button></div>
        </div>
        <div v-show="filtersOpen" id="node-filters" class="filters filter-bar">
          <label> {{ t('线路 / 标签') }} <select v-model="filters.route" :aria-label="t('筛选服务器线路')"><option v-for="item in routeOptions" :key="item" :value="item">{{ item===initialFilters.route?t(item):item }}</option></select></label>
          <label> {{ t('公网协议') }} <select v-model="filters.protocol" :aria-label="t('筛选 IP 协议')"><option v-for="item in ['全部网络', '双栈', '仅 IPv4', '仅 IPv6', '无公网 IP']" :key="item" :value="item">{{ t(item) }}</option></select></label>
          <label> {{ t('地区') }} <select v-model="filters.region" :aria-label="t('筛选地区')"><option value="全部地区"> {{ t('全部地区') }} </option><option v-for="code in regions" :key="code" :value="code">{{ regionName(code) }}</option></select></label>
          <label> {{ t('异常类型') }} <select v-model="filters.issue" :aria-label="t('筛选异常状态')"><option v-for="item in issueOptions" :key="item" :value="item">{{ t(item) }}</option></select></label>
          <label> {{ t('排序') }} <select v-model="sort" :aria-label="t('排序节点')"><option value="默认排序">{{ t('默认排序') }}</option><option value="名称">{{ t('名称') }}</option><option value="CPU 从高到低">{{ t('CPU 从高到低') }}</option><option v-if="show.expire" value="到期从近到远">{{ t('到期从近到远') }}</option><option v-if="show.network" value="丢包从高到低">{{ t('丢包从高到低') }}</option></select></label>
        </div>
        <div v-if="activeFilters.length" class="active-filters"><span> {{ t('已筛选') }} </span><button v-for="field in activeFilters" :key="field.key" :aria-label="t('清除筛选：{name}',{name:t(field.label)})" @click="filters[field.key] = initialFilters[field.key]">{{ t(field.label) }}：{{ field.key === 'region' ? regionName(filters[field.key]) : ['issue','protocol'].includes(field.key)?t(filters[field.key]):filters[field.key] }}<UiIcon name="close" /></button><button class="clear-all" @click="clearFilters"> {{ t('重置') }} </button></div>
        <p v-if="state.error && !state.sites.some(site=>site.error===state.error || site.paused || site.blocked)" class="error-state" role="status">{{ t(state.error) }}</p>
        <SiteStatus v-for="site in statusSites" :key="site.base" :site="site" :multi="bases.length>1" :access="access" :light="light" @retry="session.retry" @verified="session.verified"/>
        <div v-if="loading && !snapshotAt" class="loading-grid" role="status" :aria-label="t('正在读取服务器数据')"><div v-for="n in 3" :key="n" class="node-skeleton"><i/><i/><i/><i/></div></div>
        <div v-else-if="!visibleNodes.length && !state.error && !state.sites.some(s=>s.error||s.blocked||s.paused) && !state.detail.id" class="empty-state"><UiIcon name="search" class="empty-symbol"/><strong>{{ t(nodes.length?'没有符合条件的节点':'还没有服务器节点') }}</strong><button v-if="nodes.length" @click="clearFilters">{{ t('清除筛选') }}</button><a v-else :href="adminUrl">{{ t('管理后台') }}<UiIcon name="external"/></a></div>
        <div v-else-if="effectiveView==='card'" class="node-grid"><NodeCard v-for="node in visibleNodes" :key="node.key" :node="node" :online="online(node)" :full="prefs.layout==='full'" :show="rulesFor(node)" :probes="activeProbes([node],settingsFor(node))" :now="clock" @open="openDetail"/></div>
        <template v-else><section v-for="entry in tableSites" :key="entry.site.base"><h3 v-if="bases.length>1">{{ entry.site.config?.site_title || entry.site.base }}</h3><NodeRows :nodes="entry.nodes" :show="rulesBySite[entry.site.index]" :settings="settingsBySite[entry.site.index]" :now="clock" :online="online" :matrix="effectiveView==='network'" @open="openDetail"/></section></template>
      </section>
      <VisitorNetwork v-if="showVisitor" @country="visitorRegion=$event"/>
      <footer class="site-credit"><a href="https://github.com/huilang-me/CF-Server-Monitor/" :title="config.version" target="_blank" rel="noopener noreferrer">Powered by CF-Server-Monitor</a><span>Aether · 以太</span></footer>
    </div>
    <AppearancePanel v-if="settingsOpen" :prefs="prefs" :project-background="projectBackground" :allow-visitor="allowVisitor" :can-save="primary.config?.authorization===true" :saving="saving" :notice="notice" @restore="restorePreferences" @save="saveDefaults" @close="closeSettings"/>
    <NodeDetail v-if="state.detail.id" :key="state.detail.base+state.detail.id" :detail="state.detail" :site="detailSite" :show="rulesBySite[detailSite.index]" :settings="settingsBySite[detailSite.index]" :access="access" :now="clock" :online="Boolean(state.detail.node && online(state.detail.node))" :light="light" :tab="detailTab" @tab="detailTab=$event" @hours="session.setHours" @retry="session.retry" @verified="session.verified" @close="closeDetail"/>
  </div>
</template>
