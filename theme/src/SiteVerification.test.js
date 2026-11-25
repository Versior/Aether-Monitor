import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { nextTick, reactive, ref, watch } from 'vue'

function widget(verify) {
  const props = reactive({ siteKey: 'TEST_PUBLIC_SITE_KEY', light: false, verify })
  const renders = []
  const removed = []
  const events = []
  let cleanup
  const sandbox = vm.createContext({
    ref, watch, locale: ref('en'), onMounted() {}, onUnmounted: callback => { cleanup = callback },
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    loadTurnstileScript: async () => {},
    window: { turnstile: {
      render: (_container, options) => { renders.push(options); return renders.length },
      remove: id => removed.push(id),
    } },
  })
  const script = readFileSync(new URL('./SiteVerification.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
  return { props, renders, removed, events, sandbox, mount: () => vm.runInContext('mountWidget()', sandbox), unmount: () => cleanup() }
}

test('验证组件配色跟随主题切换，卸载时移除当前组件', async () => {
  const { props, renders, removed, mount, unmount } = widget()
  await mount()
  assert.equal(renders[0].theme, 'dark')
  props.light = true
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(renders.at(-1).theme, 'light')
  assert.deepEqual(removed, [1])
  unmount()
  assert.deepEqual(removed, [1, 2])
})

test('小组件只向绑定站交换一次票据，事件直接返回同一个配置', async () => {
  const tokens = []
  const config = { verified: true, site_title: 'Fixture' }
  const { renders, events, mount } = widget(async token => { tokens.push(token); return config })
  await mount()
  await renders[0].callback('single-use')
  assert.deepEqual(tokens, ['single-use'])
  assert.equal(events[0][0], 'verified')
  assert.equal(events[0][1], config)
})
