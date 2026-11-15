import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { computed, reactive, ref } from 'vue'
import { chartSegments, number, timestamp } from './data.js'

test('紧凑趋势图和缩小后的完整图映射到真实样本，缺失读数不补零', () => {
  const start = 1e12
  const props = reactive({ rows: [{ ts: start, ct: 0 }, { ts: start + 500000, ct: null }, { ts: start + 1000000, ct: 42 }], series: [{ key: 'ct', name: '电信', color: '#8fb6f0' }], start, end: start + 1000000, unit: 'ms', compact: false })
  const sandbox = vm.createContext({ computed, ref, chartSegments, number, timestamp, defineProps: () => props })
  const script = readFileSync(new URL('./MetricChart.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
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
