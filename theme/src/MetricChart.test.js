import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { compile, computed, createSSRApp, reactive, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { chartSegments, isProbeSeries, isProbeReading, number, probeKeys, timestamp } from './data.js'
import { locale, t } from './i18n.js'

const source = readFileSync(new URL('./MetricChart.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
const render = compile(source.match(/<template>([\s\S]*)<\/template>/)[1])

function chartRuntime(props) {
  const sandbox = vm.createContext({ computed, ref, chartSegments, isProbeSeries, isProbeReading, number, timestamp, locale, t, defineProps: () => props })
  vm.runInContext(script, sandbox)
  return sandbox
}

test('紧凑趋势图和缩小后的完整图映射到真实样本，缺失读数不补零', () => {
  const start = 1e12
  const props = reactive({ rows: [{ ts: start, ct: 0 }, { ts: start + 500000, ct: null }, { ts: start + 1000000, ct: 42 }], series: [{ key: 'ct', name: '电信', color: '#8fb6f0' }], start, end: start + 1000000, unit: 'ms', compact: false })
  const sandbox = chartRuntime(props)
  for (const compact of [false, true]) {
    props.compact = compact
    for (const [width, height] of [[160, 44], [718, 180], [320, 88]]) {
      const scale = Math.min(width / (compact ? 516 : 560), height / (compact ? 122 : 160))
      for (const [progress, expected] of [[0, 0], [.5, null], [1, 42]]) {
        const position = (width - (compact ? 516 : 560) * scale) / 2 + (32 + progress * 508 - (compact ? 28 : 0)) * scale
        sandbox.event = { clientX: 100 + position, currentTarget: { getBoundingClientRect: () => ({ left: 100, width, height }) } }
        vm.runInContext('inspect(event)', sandbox)
        assert.ok(Math.abs(vm.runInContext('selectedTime.value', sandbox) - start - progress * 1000000) < .001)
        assert.equal(vm.runInContext('readingValues.value[0].value', sandbox), expected)
      }
    }
  }
  assert.equal(vm.runInContext('charts.value[0].count', sandbox), 2, '采样数量仅计入有读数的样本，包括零值')
  sandbox.event = { key: 'Home', preventDefault() {} }
  vm.runInContext('inspectKey(event)', sandbox)
  assert.equal(vm.runInContext('readingValues.value[0].value', sandbox), 0)
  sandbox.event.key = 'End'
  vm.runInContext('inspectKey(event)', sandbox)
  assert.equal(vm.runInContext('readingValues.value[0].value', sandbox), 42)
})

test('所选时段中仅超时的探测仍有图例和状态；禁用与未上报都不显示，零保留为测量值', async () => {
  const start = 1e12
  const props = reactive({ start, end: start + 60000, compact: false, unit: 'ms', series: [
    { key: 'ping_ct', name: 'disabled' }, { key: 'ping_cu', name: 'missing' }, { key: 'ping_bd', name: 'timed-out' },
  ], rows: [{ timestamp: start - 1000, ping_cu: 5 }, { timestamp: start, ping_ct: false, ping_bd: null }] })
  const sandbox = chartRuntime(props)
  const bindings = vm.runInContext('({ charts, hidden, t, measuredSeries, visibleSeries, readingValues, reading, readingX, timeLabel, readingLabel, maximum, toggleSeries, inspect, inspectKey, selectedTime })', sandbox)
  const component = () => createSSRApp({ setup: () => ({ ...props, ...bindings }), render })
  const timeoutHtml = await renderToString(component())
  assert.match(timeoutHtml, /timed-out/)
  assert.match(timeoutHtml, /探测超时/)
  assert.doesNotMatch(timeoutHtml, /disabled|missing|polyline/)
  props.rows.push({ timestamp: start + 20000, ping_ct: false, ping_bd: 0 }, { timestamp: start + 40000, ping_bd: false })
  bindings.selectedTime.value = start
  assert.equal(bindings.readingValues.value[0].label, '超时')
  bindings.selectedTime.value = start + 20000
  assert.equal(bindings.readingValues.value[0].label, '0 ms')
  assert.match(await renderToString(component()), /<polyline/)
  bindings.selectedTime.value = start + 40000
  assert.equal(bindings.readingValues.value.length, 0)
})

test('两万行八线路按显示宽度绘图，保留尖峰、真实采样数、键盘读数', () => {
  const start = 1e12
  const series = probeKeys.map(key => ({ key: `ping_${key}`, name: key }))
  const readings = Object.fromEntries(series.map(({ key }) => [key, 20]))
  const rows = Array.from({ length: 20000 }, (_, index) => ({ timestamp: start + index * 2000, ...readings }))
  rows[9387].ping_ct = 720
  rows[9388].ping_ct = 0
  const sandbox = chartRuntime({ rows, series, start, end: start + 86400000, unit: 'ms' })
  const charts = vm.runInContext('charts.value', sandbox)
  assert.equal(charts.length, 8)
  assert.equal(charts[0].maximum, 720 * 1.1)
  assert.equal(charts[0].count, rows.length)
  assert.ok(charts[0].segments[0].split(' ').length <= 4 * 509)
  assert.match(charts[0].segments[0], /,32\.0 /)
  assert.match(charts[0].segments[0], /,132\.0 /)
  vm.runInContext(`selectedTime.value = ${rows[9387].timestamp}`, sandbox)
  assert.equal(vm.runInContext('readingValues.value[0].value', sandbox), 720)
  vm.runInContext('inspectKey({ key: "ArrowRight", preventDefault() {} })', sandbox)
  assert.equal(vm.runInContext('readingValues.value[0].value', sandbox), 0)
})
