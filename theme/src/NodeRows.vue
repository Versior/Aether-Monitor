<script setup>
import { computed } from 'vue'
import { flag, regionName, routes, hasIp, capacity, bytes, trafficBytes, quota, price, expiry, uptime, timestamp, percent, activeProbes, hasProbeReading, probeValue, latencyClass } from './data.js'
import { t } from './i18n.js'
import UiIcon from './UiIcon.vue'
import MetricChart from './MetricChart.vue'
const props = defineProps({ nodes: Array, show: Object, settings: Object, now: Number, online: Function, matrix: Boolean })
defineEmits(['open'])
const probes = computed(() => activeProbes(props.nodes, props.settings, props.nodes.flatMap(node => (node.ping || []).map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => ['ping_'+key,value]))))))
const colors = ['#8fb6f0', '#b79cd6', '#74d9b3', '#eac080', '#72c5d9', '#dd98af', '#a5b67f', '#bbbfe0']
const hours = computed(() => props.settings.latency_window?.hours || 2)
const hasWindow = (node, key) => node.ping?.some(row => row[key] === null || typeof row[key] === 'number')
</script>
<template>
  <div v-if="matrix && show.network" class="network-matrix">
    <div class="matrix-note">{{ t('最近 {hours} 小时的延迟与丢包', {hours}) }}</div>
    <div class="table-shell"><table><thead><tr><th>{{ t('服务器 / 探测模式') }}</th><th v-for="probe in probes" :key="probe.key">{{ probe.name }}</th></tr></thead>
      <tbody><tr v-for="node in nodes" :key="node.key"><td><button class="table-node matrix-node" @click="$emit('open', node, '网络')">{{ node.name }}<UiIcon name="external" /></button><small>{{ regionName(node.region) }} · {{ (node.ping_mode || 'tcp').toUpperCase() }}</small></td>
        <td v-for="(probe, index) in probes" :key="probe.key" :class="{ 'matrix-warning': online(node) && node['loss_' + probe.key] > 0, 'matrix-offline': !online(node) }">
          <strong v-if="hasProbeReading(node, probe.key, 'ping')" :class="latencyClass(node['ping_' + probe.key], online(node))">{{ probeValue(node, probe.key, 'ping', online(node)) }}</strong>
          <small v-if="hasProbeReading(node, probe.key, 'loss')">{{ t('丢包') }} {{ probeValue(node, probe.key, 'loss', online(node)) }}</small>
          <div v-if="hasWindow(node, probe.key)" class="matrix-trend"><MetricChart compact :rows="node.ping" :start="now - hours * 3600000" :end="now" :series="[{ key: probe.key, name: probe.name, color: colors[index] }]" unit="ms" /></div>
        </td></tr></tbody></table></div>
  </div>
  <div v-else-if="!matrix" class="table-shell"><table><thead><tr><th>{{ t('服务器') }}</th><th>{{ t('标签 / 公网') }}</th><th>{{ t('核心 / CPU') }}</th><th>{{ t('内存 / 磁盘') }}</th><th v-if="show.traffic">{{ t('本月流量') }}</th><th v-if="show.network">{{ t('延迟 / 丢包') }}</th><th v-if="show.price">{{ t('价格') }}</th><th v-if="show.expire">{{ t('到期') }}</th><th>{{ t('状态') }}</th></tr></thead>
    <tbody><tr v-for="node in nodes" :key="node.key"><td><button class="table-node" @click="$emit('open', node)"><img v-if="flag(node.region, node.apiBase)" class="table-flag" :src="flag(node.region, node.apiBase)" alt=""> {{ node.name }}</button><small>{{ node.server_group }} / {{ regionName(node.region) }}</small><small>{{ t(online(node) ? '在线时长' : '最后运行时长') }} {{ uptime(node, online(node) ? now : timestamp(node.last_updated)) }}</small></td>
      <td><span v-for="item in routes(node, now)" :key="item" class="route-badge">{{ item }}</span><small class="green">{{ [4, 6].filter(version => hasIp(node, version)).map(version => 'IPv' + version).join(' · ') }}</small></td>
      <td>{{ node.cpu_cores ?? '—' }} {{ t('核心') }}<small>{{ percent(node.cpu) }}</small></td><td>{{ capacity(node.ram_used) }} / {{ capacity(node.ram_total) }}<small>{{ capacity(node.disk_used) }} / {{ capacity(node.disk_total) }}</small></td>
      <td v-if="show.traffic">{{ bytes(trafficBytes(node)) }}<small>/ {{ quota(node) }}</small></td>
      <td v-if="show.network"><small v-for="probe in activeProbes([node], settings).slice(0,3)" :key="probe.key">{{ probe.name }} <span v-if="hasProbeReading(node,probe.key,'ping')" :class="latencyClass(node['ping_'+probe.key], online(node))">{{ probeValue(node,probe.key,'ping',online(node)) }}</span> <span v-if="hasProbeReading(node,probe.key,'loss')">{{ t('丢包') }} {{ probeValue(node,probe.key,'loss',online(node)) }}</span></small></td>
      <td v-if="show.price">{{ price(node) }}</td><td v-if="show.expire">{{ node.expire_date || t('未填写') }}<small>{{ expiry(node, now) }}</small></td><td :class="{green: online(node)}">{{ t(online(node) ? '在线' : '离线') }}</td></tr></tbody></table>
  </div>
</template>
