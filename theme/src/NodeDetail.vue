<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { flag, regionName, routes, hasIp, issues, hasProbeReading, activeProbes, probeValue, latencyClass, historyChartRows, timestamp, uptime, percent, capacity, dateTime, speed, number, price, expiry, bytes, quota, trafficBytes, trafficPercent, trafficNames } from './data.js'
import { t } from './i18n.js'
import { adminUrl } from './siteAccess.js'
import { dialogKey } from './dialogKey.js'
import SiteStatus from './SiteStatus.vue'
import MetricChart from './MetricChart.vue'
import RouteEvidence from './RouteEvidence.vue'
import UiIcon from './UiIcon.vue'
const props = defineProps({ detail: Object, site: Object, show: Object, settings: Object, access: Object, now: Number, online: Boolean, light: Boolean, tab: String })
const emit = defineEmits(['close','tab','hours','retry','verified'])
const dialog = ref(null)
const node = computed(() => props.detail.node)
const tabs = computed(() => ['概览', ...(props.show.network?['网络']:[]), '资源', ...(props.show.price||props.show.expire||props.show.traffic?['资产']:[])])
const tab = computed(() => tabs.value.includes(props.tab) ? props.tab : '概览')
const rows = computed(() => historyChartRows(props.detail.rows))
const start = computed(() => props.detail.end-props.detail.hours*3600000)
const hours = computed(() => [0.167,0.5,1,6,12,24,...(props.site.config?.authorization ? [48,96,168]:[])])
const probes = computed(() => node.value ? activeProbes([node.value], props.settings) : [])
const colors = ['#8fb6f0','#b79cd6','#74d9b3','#eac080','#72c5d9','#dd98af','#a5b67f','#bbbfe0']
const charts = computed(() => ['ping','loss'].map(field => ({
  field, series: activeProbes([], props.settings, props.detail.rows, field).map((probe,i) => ({key:`${field}_${probe.key}`, name:probe.name, color:colors[i]})),
})).filter(chart => chart.series.length))
const hasDisk = computed(() => rows.value.some(row=>row.disk))
const activeTime = computed(() => props.online ? props.now : timestamp(node.value?.last_updated))
onMounted(() => nextTick(() => dialog.value?.focus()))
</script>
<template>
  <div class="dialog-backdrop" @click.self="emit('close')"><section ref="dialog" class="detail-dialog" :class="{'network-detail':tab==='网络','resource-detail':tab==='资源'}" role="dialog" aria-modal="true" :aria-label="t('节点详情')" tabindex="-1" @keydown="dialogKey($event, () => emit('close'))">
    <div class="detail-top"><h2><img v-if="node && flag(node.region,site.base)" :src="flag(node.region,site.base)" class="table-flag" alt=""> {{ node?.name || t('节点详情') }}</h2><div class="detail-actions"><a :href="adminUrl(site.base)" class="icon-button" :title="t('管理后台')" :aria-label="t('管理后台')"><UiIcon name="settings"/></a><button class="icon-button" :aria-label="t('关闭详情')" @click="emit('close')"><UiIcon name="close"/></button></div></div>
    <SiteStatus :site="site" :detail-id="detail.id" :light="light" :access="access" @retry="base=>emit('retry',base)" @verified="(base,config)=>emit('verified',base,config)"/>
    <p v-if="!node && detail.loading" role="status">{{ t('正在读取服务器数据') }}</p>
    <p v-if="detail.error && detail.error!==site.error && !site.blocked" class="error-state" role="status">{{ t(detail.error) }} <button class="clear-button" @click="emit('retry',site.base)">{{ t('重试') }}</button></p>
    <template v-if="node">
      <p class="detail-subtitle">{{ node.server_group }} / {{ regionName(node.region) }} · {{ t(online?'在线':'离线 · 资源为最后样本') }}</p>
      <div class="detail-badges"><span v-for="item in routes(node,now)" :key="item" class="route-badge">{{ item }}</span><span v-for="v in [4,6].filter(v=>hasIp(node,v))" :key="v" class="ip-badge supported">IPv{{ v }}</span></div>
      <div v-if="issues(node,online,show,now).length" class="detail-issues"><UiIcon name="alert"/><span v-for="issue in issues(node,online,show,now)" :key="issue">{{ t(issue) }}</span></div>
      <div class="detail-tabs"><button v-for="item in tabs" :key="item" :class="{selected:tab===item}" @click="emit('tab',item)">{{ t(item) }}</button></div>
      <div v-if="tab==='概览'" class="detail-stats">
        <div><span>{{ t('处理器 / 核心数') }}</span><strong>{{ node.cpu_cores ?? '—' }} {{ t('核心') }} · {{ percent(node.cpu) }}</strong><small>{{ node.cpu_info || t('未上报型号') }}</small></div>
        <div><span>{{ t('运行时长') }}</span><strong>{{ uptime(node,activeTime) }}</strong><small>{{ t('最后上报') }} {{ dateTime(node.last_updated) }}</small></div>
        <div><span>{{ t('内存 已用 / 总量') }}</span><strong>{{ capacity(node.ram_used) }} / {{ capacity(node.ram_total) }}</strong></div><div><span>{{ t('磁盘 已用 / 总量') }}</span><strong>{{ capacity(node.disk_used) }} / {{ capacity(node.disk_total) }}</strong></div>
        <div><span>{{ t('系统 / 架构') }}</span><strong>{{ node.os || '—' }} · {{ node.arch || '—' }}</strong><small>{{ t('内核') }} {{ node.kernel_version || '—' }} · Agent {{ node.agent_version || '—' }}</small></div><div><span>{{ t('平均负载 1 / 5 / 15 分钟') }}</span><strong>{{ node.load_avg || '—' }}</strong></div>
      </div>
      <div v-if="tab==='网络'"><div class="detail-probe-grid"><div v-for="probe in probes" :key="probe.key"><span>{{ probe.name }} · {{ (node.ping_mode||'tcp').toUpperCase() }}</span><strong v-if="hasProbeReading(node,probe.key,'ping')" :class="latencyClass(node['ping_'+probe.key],online)">{{ probeValue(node,probe.key,'ping',online) }}</strong><small v-if="hasProbeReading(node,probe.key,'loss')">{{ t('丢包') }} {{ probeValue(node,probe.key,'loss',online) }}</small></div></div>
        <div class="detail-stats"><div><span>{{ t('下行 / 上行速率') }}</span><strong>{{ online?speed(node.net_in_speed)+' / '+speed(node.net_out_speed):t('离线') }}</strong></div><div><span>{{ t('TCP / UDP 连接') }}</span><strong>{{ node.tcp_conn ?? '—' }} / {{ node.udp_conn ?? '—' }}</strong></div></div><RouteEvidence :report="node.route_report" :now="now"/></div>
      <div v-if="tab==='资源'" class="detail-stats"><div><span>{{ t('进程数 / 平均负载') }}</span><strong>{{ node.processes ?? '—' }}</strong><small>{{ node.load_avg || '—' }}</small></div><div><span>{{ t('Swap 已用 / 总量') }}</span><strong>{{ node.swap_total===0?t('未配置 Swap'):capacity(node.swap_used)+' / '+capacity(node.swap_total) }}</strong></div><template v-if="node.disk"><div><span>{{ t('磁盘读取 / 写入') }}</span><strong>{{ speed(node.disk.read_bps) }} / {{ speed(node.disk.write_bps) }}</strong></div><div><span>{{ t('读 / 写 IOPS') }}</span><strong>{{ node.disk.read_iops ?? '—' }} / {{ node.disk.write_iops ?? '—' }}</strong><small>{{ t('等待') }} {{ node.disk.await_ms ?? '—' }} ms · {{ t('忙碌') }} {{ percent(node.disk.util) }}</small></div></template><div v-for="gpu in node.gpu_info" :key="gpu.id"><span>{{ gpu.name }}</span><strong>{{ t('利用率') }} {{ percent(number(gpu.info)) }}</strong><small v-if="number(gpu.mem_total)!==null">{{ t('显存') }} {{ capacity(number(gpu.mem_used)) }} / {{ capacity(number(gpu.mem_total)) }}</small><small v-if="number(gpu.power)!==null">{{ t('功耗') }} {{ gpu.power }} W</small></div></div>
      <div v-if="tab==='资产'" class="detail-stats"><div v-if="show.price"><span>{{ t('价格 / 账单周期') }}</span><strong>{{ price(node) }}</strong></div><div v-if="show.expire"><span>{{ t('到期日期') }}</span><strong>{{ node.expire_date || t('未填写') }}</strong><small>{{ expiry(node,now) }}</small><small v-if="node.auto_renewal==='1'">{{ t('启用到期日自动推进') }}</small></div><template v-if="show.traffic"><div><span>{{ t('本月已用 / 额度') }} · {{ t(trafficNames[node.traffic_calc_type||'total']) }}</span><strong>{{ bytes(trafficBytes(node)) }} / {{ quota(node) }}</strong><small class="asset-traffic"><UiIcon name="down"/>{{ bytes(node.net_rx_monthly) }} · <UiIcon name="up"/>{{ bytes(node.net_tx_monthly) }} {{ trafficPercent(node)===null?'':' · '+trafficPercent(node)+'%' }}</small></div><div><span>{{ t('月流量重置日') }}</span><strong>{{ node.reset_day?t('每月 {day} 日',{day:node.reset_day}):t('未填写') }}</strong></div></template></div>
      <div v-if="tab!=='资产'" class="detail-chart"><div class="chart-heading"><strong>{{ t('历史趋势') }}</strong><select :value="detail.hours" :aria-label="t('历史时间范围')" @change="emit('hours',Number($event.target.value))"><option v-for="h in hours" :key="h" :value="h">{{ h<1?t('{n} 分钟',{n:h===0.167?10:30}):t('{n} 小时',{n:h}) }}</option></select></div><p v-if="detail.loading" class="empty-chart">{{ t('正在加载历史…') }}</p>
        <div v-else-if="!detail.error" class="detail-chart-grid"><MetricChart v-if="tab==='概览'" :rows="rows" :start="start" :end="detail.end" :series="[{key:'cpu',name:'CPU',color:'#8fb6f0'},{key:'ram_percent',name:t('内存'),color:'#74d9b3'}]" :ceiling="100" unit="%"/>
          <template v-if="tab==='网络'"><MetricChart v-for="{field,series} in charts" :key="field" :rows="rows" :start="start" :end="detail.end" :series="series" :ceiling="field==='loss'?100:undefined" :unit="field==='loss'?'%':'ms'"/><MetricChart :rows="rows" :start="start" :end="detail.end" :series="[{key:'net_down',name:t('下行'),color:'#8fb6f0'},{key:'net_up',name:t('上行'),color:'#74d9b3'}]" unit="MB/s"/></template>
          <template v-if="tab==='资源'"><MetricChart :rows="rows" :start="start" :end="detail.end" :series="[{key:'ram_percent',name:t('内存'),color:'#74d9b3'},{key:'swap_percent',name:'Swap',color:'#b79cd6'}]" :ceiling="100" unit="%"/><MetricChart v-if="hasDisk" :rows="rows" :start="start" :end="detail.end" :series="[{key:'disk_read_iops',name:t('读 IOPS'),color:'#8fb6f0'},{key:'disk_write_iops',name:t('写 IOPS'),color:'#eac080'}]" unit="IOPS"/></template>
        </div></div>
    </template>
  </section></div>
</template>
