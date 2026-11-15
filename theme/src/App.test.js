import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { compile, computed, createSSRApp, nextTick, reactive, ref, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'
import * as data from './data.js'

function app(savedPreferences = {}, systemLight = false) {
  const requests = []
  const storage = new Map()
  const sandbox = vm.createContext({
    ...data, computed, nextTick, reactive, ref, watch,
    onMounted() {}, onUnmounted() {},
    window: { __AETHER_PREFERENCES__: savedPreferences, matchMedia: () => ({ matches: systemLight }), location: { hash: '#/' } },
    document: { title: '测试监控站', querySelector: () => ({ href: 'https://example.invalid/site-icon.svg' }), documentElement: { dataset: {} }, body: { style: {} } }, localStorage: { setItem: (key, value) => storage.set(key, value) },
    isServerOnline: () => true, DEFAULT_SITE_TITLE: 'Test',
    http: { get: path => new Promise(resolve => requests.push({ path, resolve })) },
  })
  const script = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
  vm.runInContext('nodes.value = [{ id: "a", name: "A" }]; detailId.value = "a";', sandbox)
  return { requests, storage, run: code => vm.runInContext(code, sandbox) }
}

test('首次渲染使用已保存的深色和纯色背景，无需等待站点配置', () => {
  const harness = app({ appearance: 'dark', background: 'default', cardOpacity: 65 }, true)
  assert.equal(harness.run('light.value'), false)
  assert.equal(harness.run('prefs.background'), 'default')
  assert.equal(harness.run('prefs.cardOpacity'), 65)
})

test('个性化选项即时保存，恢复站点默认同时重置透明度、背景与动效', async () => {
  const harness = app()
  harness.run('config.value = { preferred_theme: "light", theme_options: { aether: { cardOpacity: 85, background: "default", motion: false } } }; prefs.cardOpacity = 55; prefs.background = "project"')
  await nextTick()
  assert.equal(JSON.parse(harness.storage.get('orbit-preferences')).cardOpacity, 55)
  assert.equal(harness.run('themeStyle.value["--panel-opacity"]'), '55%')
  harness.run('restorePreferences()')
  await nextTick()
  const saved = JSON.parse(harness.storage.get('orbit-preferences'))
  assert.equal(saved.cardOpacity, 85)
  assert.equal(saved.background, 'default')
  assert.equal(saved.motion, false)
  assert.equal(saved.appearance, 'light')
})

test('页头显示站点标题与宿主图标，配置标题更新后同步显示', async () => {
  const harness = app()
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const render = compile(source.match(/<a href="#\/" class="brand"[\s\S]*?<\/a>/)[0])
  const component = () => createSSRApp({ setup: () => harness.run('({ siteTitle, siteIcon })'), render })
  const initial = await renderToString(component())
  assert.match(initial, /测试监控站/)
  assert.match(initial, /src="https:\/\/example.invalid\/site-icon.svg"/)
  harness.run('config.value = { site_title: "星港监控" }')
  const updated = await renderToString(component())
  assert.match(updated, /星港监控/)
  assert.doesNotMatch(updated, /CF-Server-Monitor/)
})

test('同一节点连续刷新历史时，只提交最新请求，旧响应不覆盖数据或加载状态', async () => {
  const harness = app()
  const first = harness.run('loadHistory()')
  const second = harness.run('loadHistory()')
  harness.requests[0].resolve({ data: { id: 'a', name: 'Old' } })
  harness.requests[1].resolve({ data: [{ timestamp: 1e12, cpu: 1 }] })
  await first
  assert.equal(harness.run('detailLoading.value'), true)
  assert.equal(harness.run('history.value.length'), 0)
  harness.requests[2].resolve({ data: { id: 'a', name: 'New' } })
  harness.requests[3].resolve({ data: [{ timestamp: 1e12, cpu: 99 }] })
  await second
  assert.equal(harness.run('history.value[0].cpu'), 99)
  assert.equal(harness.run('detailNode.value.name'), 'New')
  assert.equal(harness.run('detailLoading.value'), false)

  const third = harness.run('loadHistory()')
  const fourth = harness.run('loadHistory()')
  harness.requests[6].resolve({ data: { id: 'a', name: 'Latest' } })
  harness.requests[7].resolve({ data: [{ timestamp: 1e12, cpu: 42 }] })
  await fourth
  harness.requests[4].resolve({ error: 'late failure', status: 500 })
  harness.requests[5].resolve({ data: [] })
  await third
  assert.equal(harness.run('history.value[0].cpu'), 42)
  assert.equal(harness.run('historyError.value'), '')
})

test('历史请求期间离开详情后，响应不会重新打开或更新详情', async () => {
  const harness = app()
  const pending = harness.run('loadHistory()')
  harness.run('window.location.hash = "#/";')
  await harness.run('hashChanged()')
  harness.requests[0].resolve({ data: { id: 'a', name: 'Old' } })
  harness.requests[1].resolve({ data: [{ timestamp: 1e12, cpu: 1 }] })
  await pending
  assert.equal(harness.run('detailId.value'), '')
  assert.equal(harness.run('history.value.length'), 0)
})

test('无效的节点 URL 提供可见错误，不抛 URIError', async () => {
  const harness = app()
  harness.run('window.location.hash = "#/server/%E0%A4%A";')
  await harness.run('hashChanged()')
  assert.equal(harness.run('detailId.value'), '')
  assert.equal(harness.run('error.value'), '节点链接格式无效')
  assert.equal(harness.requests.length, 0)
})

test('下行汇总区分零值与缺失读数，并统计实际参与的节点', () => {
  const harness = app()
  harness.run('nodes.value = [{ net_in_speed: null }, {}]')
  assert.equal(harness.run('totalDownload.value'), null)
  harness.run('nodes.value.push({ net_in_speed: 0 })')
  assert.equal(harness.run('totalDownload.value'), 0)
  assert.equal(harness.run('downloadNodes.value.length'), 1)
  harness.run('nodes.value.push({ net_in_speed: 1024 })')
  assert.equal(harness.run('totalDownload.value'), 1024)
})

test('登录权限变更后，历史时间范围收敛到公开接口允许的 24 小时', async () => {
  const harness = app()
  harness.run('detailId.value = ""; config.value = { authorization: true, is_public: true }; historyHours.value = 168')
  await nextTick()
  harness.run('config.value = { authorization: false, is_public: true }')
  await nextTick()
  assert.equal(harness.run('historyHours.value'), 24)
})
test('接口返回 401 后清空旧节点和详情，避免继续展示授权快照', async () => {
  const harness = app()
  harness.run('config.value = { authorization: true }; snapshotAt.value = 1')
  const request = harness.run('request("/api/servers")')
  harness.requests[0].resolve({ error: 'Unauthorized', status: 401 })
  await assert.rejects(request, /401/)
  assert.equal(harness.run('nodes.value.length'), 0)
  assert.equal(harness.run('detailId.value'), '')
  assert.equal(harness.run('snapshotAt.value'), null)
  assert.equal(harness.run('config.value.authorization'), false)
})
