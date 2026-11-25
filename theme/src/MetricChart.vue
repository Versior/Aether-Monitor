<script setup>
import { computed, ref } from 'vue'
import { chartSegments, isProbeSeries, isProbeReading, number, timestamp } from './data.js'
import { locale, t } from './i18n.js'
const props = defineProps({ rows: { type: Array, required: true }, series: { type: Array, required: true }, start: Number, end: Number, ceiling: Number, compact: Boolean, unit: { type: String, default: '' } })
const hidden = ref([])
const selectedTime = ref(null)
const samples = computed(() => props.rows.map(row => ({ row, time: timestamp(row.timestamp ?? row.ts) })).filter(sample => sample.time >= props.start && sample.time <= props.end).sort((a, b) => a.time - b.time))
const measuredSeries = computed(() => props.series.filter(series => !isProbeSeries(series.key) || samples.value.some(({ row }) => isProbeReading(row[series.key]))))
const visibleSeries = computed(() => measuredSeries.value.filter(series => !hidden.value.includes(series.key)))
const maximum = computed(() => {
  if (props.ceiling) return props.ceiling
  let peak = 1
  for (const { row } of samples.value) for (const { key } of visibleSeries.value) peak = Math.max(peak, number(row[key]) ?? 0)
  return peak * 1.1
})
const charts = computed(() => measuredSeries.value.map(series => ({ ...series, ...chartSegments(props.rows, series.key, props.start, props.end, maximum.value) })))
const reading = computed(() => {
  const time = selectedTime.value
  const points = samples.value
  if (time === null || !points.length) return null
  let left = 0, right = points.length - 1
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (points[mid].time < time) left = mid + 1
    else right = mid
  }
  return left && time - points[left - 1].time <= Math.abs(points[left].time - time) ? points[left - 1] : points[left]
})
const readingX = computed(() => reading.value ? 32 + (reading.value.time - props.start) / (props.end - props.start) * 508 : 0)
const readingValues = computed(() => reading.value ? visibleSeries.value.flatMap(item => {
  const raw = reading.value.row[item.key]
  if (isProbeSeries(item.key) && !isProbeReading(raw)) return []
  const value = number(raw)
  const label = value === null ? t(isProbeSeries(item.key) ? '超时' : '未上报') : `${Number(value.toFixed(2))} ${props.unit}`
  return [{ ...item, value, label }]
}) : [])
const timeLabel = time => new Date(time).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false })
const readingLabel = time => new Date(time).toLocaleString(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
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
    <div v-if="!compact" class="chart-legend"><button v-for="series in charts" :key="series.key" :aria-label="t('显示{name}趋势', { name: series.name })" :aria-pressed="!hidden.includes(series.key)" :class="{ hidden: hidden.includes(series.key) }" @click="toggleSeries(series.key)"><i :style="{ background: series.color }" />{{ series.name }}</button><small>{{ unit }}</small></div>
    <p v-if="!charts.some(series => series.count)" class="empty-chart">{{ t(charts.some(series => series.timeouts) ? '探测超时' : compact ? '暂无趋势样本' : '这个时段没有可用样本') }}</p>
    <div v-else class="chart-plot">
    <svg :viewBox="compact ? '28 16 516 122' : '0 0 560 160'" role="img" tabindex="0" :aria-label="t('{names}历史趋势，左右方向键查看样本', { names: measuredSeries.map(item => item.name).join(t('、')) })" @pointermove="inspect" @pointerleave="selectedTime = null" @focus="selectedTime = end" @blur="selectedTime = null" @keydown="inspectKey">
      <template v-if="!compact"><g v-for="(y, index) in [22, 77, 132]" :key="y"><line x1="32" :y1="y" x2="540" :y2="y" stroke="currentColor" stroke-opacity=".12" /><text x="27" :y="y + 3" text-anchor="end">{{ Math.round(maximum * (1 - index / 2)) }}</text></g></template>
      <line v-else x1="32" y1="132" x2="540" y2="132" stroke="currentColor" stroke-opacity=".12" />
      <g v-for="series in charts.filter(series => !hidden.includes(series.key))" :key="series.key"><polyline v-for="(points, index) in series.segments" :key="index" :points="points" fill="none" :stroke="series.color" :stroke-width="compact ? 1.5 : 2" :vector-effect="compact ? 'non-scaling-stroke' : null" stroke-linecap="round" stroke-linejoin="round" /><circle v-for="(points, index) in series.segments" :key="'dot' + index" :cx="points.split(' ').at(-1).split(',')[0]" :cy="points.split(' ').at(-1).split(',')[1]" :r="compact ? 4 : 2" :fill="series.color" /></g>
      <g v-if="reading"><line :x1="readingX" y1="22" :x2="readingX" y2="132" stroke="currentColor" stroke-opacity=".4" stroke-dasharray="3 4" /><template v-for="item in readingValues" :key="item.key"><circle v-if="item.value !== null" :cx="readingX" :cy="132 - item.value / maximum * 110" r="3.5" :fill="item.color" stroke="var(--surface)" stroke-width="2" /></template></g>
      <template v-if="!compact"><text x="32" y="154">{{ timeLabel(start) }}</text><text x="286" y="154" text-anchor="middle">{{ timeLabel((start + end) / 2) }}</text><text x="540" y="154" text-anchor="end">{{ timeLabel(end) }}</text></template>
    </svg>
    <div v-if="compact" class="compact-reading" role="status"><template v-if="reading"><time>{{ timeLabel(reading.time) }}</time><span v-for="item in readingValues" :key="item.key">{{ item.label }}</span></template><template v-else><span>{{ t('采样 {count} 点', { count: charts[0].count }) }}</span><time>{{ timeLabel(start) }} – {{ timeLabel(end) }}</time></template></div>
    <div v-else-if="reading" class="chart-reading" :class="{ 'reading-left': readingX > 286 }" role="status"><time>{{ readingLabel(reading.time) }}</time><span v-for="item in readingValues" :key="item.key"><i :style="{ background: item.color }" />{{ item.name }}<strong>{{ item.label }}</strong></span></div>
    </div>
  </div>
</template>
