import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { nextTick, reactive, ref, watch } from 'vue'

test('验证组件配色跟随主题切换，卸载时移除当前组件', async () => {
  const props = reactive({ siteKey: 'TEST_PUBLIC_SITE_KEY', light: false })
  const renders = []
  const removed = []
  let cleanup
  const sandbox = vm.createContext({
    ref, watch, onMounted() {}, onUnmounted: callback => { cleanup = callback },
    defineProps: () => props, defineEmits: () => () => {},
    loadTurnstileScript: async () => {},
    window: { turnstile: {
      render: (_container, options) => { renders.push(options); return renders.length },
      remove: id => removed.push(id),
    } },
  })
  const script = readFileSync(new URL('./SiteVerification.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
  await vm.runInContext('mountWidget()', sandbox)
  assert.equal(renders[0].theme, 'dark')
  props.light = true
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(renders.at(-1).theme, 'light')
  assert.deepEqual(removed, [1])
  cleanup()
  assert.deepEqual(removed, [1, 2])
})
