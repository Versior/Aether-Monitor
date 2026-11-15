<script setup>
import { computed, ref } from 'vue'
import { chartSegments, number, timestamp } from './data.js'
const props = defineProps({ rows: { type: Array, required: true }, series: { type: Array, required: true }, start: Number, end: Number, ceiling: Number, compact: Boolean, unit: { type: String, default: '' } })
const hidden = ref([])
const selectedTime = ref(null)
const visibleSeries = computed(() => props.series.filter(series => !hidden.value.includes(series.key)))
const maximum = computed(() => props.ceiling || Math.max(1, ...props.rows.flatMap(row => visibleSeries.value.map(series => number(row[series.key]) || 0))) * 1.1)
const charts = computed(() => props.series.map(series => ({ ...series, ...chartSegments(props.rows, series.key, props.start, props.end, maximum.value) })))
const samples = computed(() => props.rows.map(row => ({ row, time: timestamp(row.timestamp ?? row.ts) })).filter(sample => sample.time >= props.start && sample.time <= props.end).sort((a, b) => a.time - b.time))
const reading = computed(() => selectedTime.value === null || !samples.value.length ? null : samples.value.reduce((nearest, sample) => Math.abs(sample.time - selectedTime.value) < Math.abs(nearest.time - selectedTime.value) ? sample : nearest))
const readingX = computed(() => reading.value ? 32 + (reading.value.time - props.start) / (props.end - props.start) * 508 : 0)
const readingValues = computed(() => visibleSeries.value.map(item => ({ ...item, value: reading.value ? number(reading.value.row[item.key]) : null })))
const timeLabel = time => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const readingLabel = time => new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
function toggleSeries(key) { hidden.value = hidden.value.includes(key) ? hidden.value.filter(item => item !== key) : [...hidden.value, key] }
function inspect(event) {
  const bounds = event.currentTarget.getBoundingClientRect()
  const scale = Math.min(bounds.width / (props.compact ? 516 : 560), bounds.height / (props.compact ? 122 : 160))
  const inset = (bounds.width - (props.compact ? 516 : 560) * scale) / 2
  selectedTime.value = props.start + Math.min(1, Math.max(0, ((event.clientX - bounds.left - inset) / scale + (props.compact ? 28 : 0) - 32) / 508)) * (props.end - props.start)
}
function inspectKey(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !samples.value.length) return
  event.preventDefault()
  if (event.key === 'Home') { selectedTime.value = samples.value[0].time; return }
  if (event.key === 'End') { selectedTime.value = samples.value.at(-1).time; return }
  const index = samples.value.indexOf(reading.value)
  selectedTime.value = samples.value[Math.max(0, Math.min(samples.value.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))].time
}
</script>
<template>
  <div class="metric-chart" :class="{ 'compact-chart': compact }">
    <div v-if="!compact" class="chart-legend"><button v-for="series in charts" :key="series.key" :aria-label="'显示' + series.name + '趋势'" :aria-pressed="!hidden.includes(series.key)" :class="{ hidden: hidden.includes(series.key) }" @click="toggleSeries(series.key)"><i :style="{ background: series.color }" />{{ series.name }}</button><small>{{ unit }}</small></div>
    <p v-if="!charts.some(series => series.count)" class="empty-chart">{{ compact ? '暂无趋势样本' : '这个时段没有可用样本' }}</p>
    <div v-else class="chart-plot">
    <svg :viewBox="compact ? '28 16 516 122' : '0 0 560 160'" role="img" tabindex="0" :aria-label="series.map(item => item.name).join('、') + '历史趋势，左右方向键查看样本'" @pointermove="inspect" @pointerleave="selectedTime = null" @focus="selectedTime = end" @blur="selectedTime = null" @keydown="inspectKey">
      <template v-if="!compact"><g v-for="(y, index) in [22, 77, 132]" :key="y"><line x1="32" :y1="y" x2="540" :y2="y" stroke="currentColor" stroke-opacity=".12" /><text x="27" :y="y + 3" text-anchor="end">{{ Math.round(maximum * (1 - index / 2)) }}</text></g></template>
      <line v-else x1="32" y1="132" x2="540" y2="132" stroke="currentColor" stroke-opacity=".12" />
      <g v-for="series in charts.filter(series => !hidden.includes(series.key))" :key="series.key"><polyline v-for="(points, index) in series.segments" :key="index" :points="points" fill="none" :stroke="series.color" :stroke-width="compact ? 1.5 : 2" :vector-effect="compact ? 'non-scaling-stroke' : null" stroke-linecap="round" stroke-linejoin="round" /><circle v-for="(points, index) in series.segments" :key="'dot' + index" :cx="points.split(' ').at(-1).split(',')[0]" :cy="points.split(' ').at(-1).split(',')[1]" :r="compact ? 4 : 2" :fill="series.color" /></g>
      <g v-if="reading"><line :x1="readingX" y1="22" :x2="readingX" y2="132" stroke="currentColor" stroke-opacity=".4" stroke-dasharray="3 4" /><template v-for="item in readingValues" :key="item.key"><circle v-if="item.value !== null" :cx="readingX" :cy="132 - item.value / maximum * 110" r="3.5" :fill="item.color" stroke="var(--surface)" stroke-width="2" /></template></g>
      <template v-if="!compact"><text x="32" y="154">{{ timeLabel(start) }}</text><text x="286" y="154" text-anchor="middle">{{ timeLabel((start + end) / 2) }}</text><text x="540" y="154" text-anchor="end">{{ timeLabel(end) }}</text></template>
    </svg>
    <div v-if="compact" class="compact-reading" role="status"><template v-if="reading"><time>{{ timeLabel(reading.time) }}</time><span v-for="item in readingValues" :key="item.key">{{ item.value === null ? '未上报' : Number(item.value.toFixed(2)) + ' ' + unit }}</span></template><template v-else><span>采样 {{ charts[0].count }} 点</span><time>{{ timeLabel(start) }} – {{ timeLabel(end) }}</time></template></div>
    <div v-else-if="reading" class="chart-reading" :class="{ 'reading-left': readingX > 286 }" role="status"><time>{{ readingLabel(reading.time) }}</time><span v-for="item in readingValues" :key="item.key"><i :style="{ background: item.color }" />{{ item.name }}<strong>{{ item.value === null ? '未上报' : Number(item.value.toFixed(2)) + ' ' + unit }}</strong></span></div>
    </div>
  </div>
</template>
