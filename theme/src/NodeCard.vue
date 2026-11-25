<script setup>
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'
import { getOSImage, getOSName } from '../../src/frontend/utils/osIcon.js'
import { getApiBases } from '../../src/frontend/utils/config.js'
import { routes, flag, regionName, nodeArea, hasIp, usage, capacity, speed, bytes, trafficBytes, trafficPercent, trafficNames, quota, price, expiry, daysLeft, hasProbeReading, probeValue, latencyClass, issues, dateTime, uptime, timestamp } from './data.js'
import { t } from './i18n.js'
const props = defineProps({ node: { type: Object, required: true }, online: Boolean, full: Boolean, show: { type: Object, required: true }, probes: { type: Array, required: true }, now: Number })
defineEmits(['open'])
const metrics = computed(() => [{ name: 'CPU', value: props.node.cpu, amount: t('{usage} · {count} 核心', { usage: typeof props.node.cpu === 'number' ? `${props.node.cpu.toFixed(1)}%` : t('未上报'), count: props.node.cpu_cores ?? '—' }) }, { name: t('内存'), value: usage(props.node.ram_used, props.node.ram_total), amount: `${capacity(props.node.ram_used)} / ${capacity(props.node.ram_total)}` }, { name: t('磁盘'), value: usage(props.node.disk_used, props.node.disk_total), amount: `${capacity(props.node.disk_used)} / ${capacity(props.node.disk_total)}` }])
const cardProbes = computed(() => props.probes.filter(({ key }) => hasProbeReading(props.node, key)).slice(0, 3))
const warnings = computed(() => issues(props.node, props.online, props.show, props.now))
const priorityWarnings = computed(() => ['离线', '到期关注', '资源紧张', '流量将满', '存在丢包'].filter(warning => warnings.value.includes(warning)))
const osIcon = computed(() => new URL('/' + getOSImage(props.node.os), props.node.apiBase || getApiBases()[0]).href)
const osVersion = computed(() => props.node.os?.match(/\b\d+(?:\.\d+)*\b/)?.[0] || (props.node.os ? getOSName(props.node.os) : t('未上报')))
</script>
<template>
  <button class="node-card" :class="{ offline: !online, compact: !full, 'has-warning': online && warnings.length }" :aria-label="t('查看 {name} 详情', { name: node.name }) + (online ? '' : ' · ' + t('离线'))" @click="$emit('open', node)">
    <div class="node-heading"><img v-if="flag(node.region, node.apiBase)" class="country-flag" :src="flag(node.region, node.apiBase)" :alt="regionName(node.region)"><UiIcon v-else name="globe" class="unknown-flag" /><div><h3>{{ node.name }}</h3></div><span class="node-os" :title="node.os || t('系统未上报')" :aria-label="node.os || t('系统未上报')"><img :src="osIcon" alt="">{{ osVersion }}</span></div>
    <div class="node-tags"><span v-for="item in routes(node)" :key="item" class="route-badge" :title="t(node.tags?.trim() ? '后台手动标签' : '本次路径的 ASN 或 IP 段匹配；经表示国际网络，骨干可能未识别，详情可查看来源。不认证线路等级。')" :class="{ premium: item.includes('CN2'), unicom: ['4837', '9929'].includes(item), cmi: item === 'CMI' }">{{ item }}</span><span v-for="version in [4, 6].filter(version => hasIp(node, version))" :key="version" class="ip-badge supported">IPv{{ version }}</span></div>
    <div class="node-body">
    <div class="node-readings" :aria-hidden="!online">
    <div class="resource-meters"><div v-for="metric in metrics" :key="metric.name" class="resource-line"><div class="resource-caption"><span>{{ metric.name }}</span><span class="resource-amount" :class="{ amber: online && metric.value >= 80 }">{{ metric.amount }}</span></div><div class="meter-track"><i v-if="metric.value !== null && metric.value !== undefined" :style="{ width: Math.min(100, Math.max(0, metric.value)) + '%' }" :class="{ warm: metric.value >= 80 }" /></div></div></div>
    <div class="node-network"><span><UiIcon name="down" class="direction down" />{{ online ? speed(node.net_in_speed) : '—' }}</span><span><UiIcon name="up" class="direction up" />{{ online ? speed(node.net_out_speed) : '—' }}</span></div>
    <div v-if="show.network && cardProbes.length" class="three-net"><div v-for="probe in cardProbes" :key="probe.key"><span>{{ probe.name }}</span><strong v-if="hasProbeReading(node, probe.key, 'ping')" :class="latencyClass(node['ping_' + probe.key], online)">{{ probeValue(node, probe.key, 'ping', online) }}</strong><small v-if="hasProbeReading(node, probe.key, 'loss')" :class="{ amber: online && node['loss_' + probe.key] > 0 }">{{ t('丢包') }} {{ probeValue(node, probe.key, 'loss', online) }}</small></div></div>
    <div v-if="show.traffic" class="traffic-summary"><div><span>{{ t('本月流量') }}</span><strong>{{ bytes(trafficBytes(node)) }} <small>/ {{ quota(node) }}</small></strong></div><div v-if="full" class="traffic-directions"><span><UiIcon name="down" />{{ bytes(node.net_rx_monthly) }}</span><span><UiIcon name="up" />{{ bytes(node.net_tx_monthly) }}</span><span>{{ t('按{direction}计', { direction: t(trafficNames[node.traffic_calc_type || 'total']) }) }}</span></div><div v-if="trafficPercent(node) !== null" class="meter-track traffic-meter"><i :style="{ width: Math.min(100, trafficPercent(node)) + '%' }" :class="{ warm: trafficPercent(node) >= 80 }" /></div></div>
    <div class="node-meta">
      <div v-if="show.price" class="node-meta-item"><span class="node-meta-label">{{ t('费用') }}</span><strong>{{ price(node) }}</strong></div>
      <div v-if="show.expire" class="node-meta-item" :title="expiry(node, now)"><span class="node-meta-label">{{ t('到期') }}</span><strong :class="{ amber: daysLeft(node, now) !== null && daysLeft(node, now) <= 7 }">{{ node.expire_date || t('未填写') }}</strong></div>
      <div class="node-meta-item" :title="t(online ? '按探针上报的开机时间计算，不代表连续在线可用率' : '按最后样本计算，离线后不继续累加')"><span class="node-meta-label"><i class="runtime-dot" :class="{ green: online }" />{{ t(online ? '在线时长' : '最后运行') }}</span><strong>{{ uptime(node, online ? now : timestamp(node.last_updated)) }}</strong></div>
    </div>
    <div v-if="full && online" class="card-last-report">{{ t('最后上报') }} {{ dateTime(node.last_updated) }}</div>
    </div>
    <div v-if="!online" class="node-offline-label"><strong>{{ t('离线') }}</strong><span>{{ t('最后样本') }} · {{ dateTime(node.last_updated) }}</span></div>
    </div>
    <div class="node-footer"><span><span class="node-location" :title="regionName(node.region)">{{ nodeArea(node) }}</span><span v-for="warning in priorityWarnings.slice(0, full ? priorityWarnings.length : 2)" :key="warning" class="issue-tag">{{ t(warning) }}</span><span v-if="!full && priorityWarnings.length > 2" class="issue-more" :title="priorityWarnings.slice(2).map(warning => t(warning)).join(' · ')" :aria-label="t('另有 {warnings}', { warnings: priorityWarnings.slice(2).map(warning => t(warning)).join(t('、')) })">+{{ priorityWarnings.length - 2 }}</span></span><span class="detail-link">{{ t('详情') }}<UiIcon name="external" /></span></div>
  </button>
</template>
