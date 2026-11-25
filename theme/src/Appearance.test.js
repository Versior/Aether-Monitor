import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createPreferencesController } from './themePreferences.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function initialAppearance(saved, systemLight, blocked = false, cached = {}, apiBase = '') {
  const script = html.match(/<script id="aether-appearance">([\s\S]*?)<\/script>/)
  assert.ok(script, 'the HTML head must restore appearance before the main module')
  const sandbox = vm.createContext({
    URL,
    window: { location: { origin: 'https://theme.test' }, matchMedia: () => ({ matches: systemLight }) },
    document: { querySelector: () => ({ content: apiBase }), documentElement: { dataset: {} } },
    localStorage: { getItem(key) { if (blocked) throw new Error('Storage unavailable'); return key === 'orbit-preferences' ? saved : cached[key] ?? null } },
  })
  vm.runInContext(script[1], sandbox)
  return { appearance: sandbox.document.documentElement.dataset.appearance, preferences: sandbox.window.__AETHER_PREFERENCES__, siteAppearance: sandbox.window.__AETHER_SITE_APPEARANCE__ }
}

test('保存的深色和浅色在主脚本加载前生效，优先于系统配色', () => {
  assert.equal(initialAppearance('{"appearance":"dark"}', true).appearance, 'dark')
  assert.equal(initialAppearance('{"appearance":"light"}', false).appearance, 'light')
})

test('自动配色跟随系统，背景与透明度偏好传给页面初始化', () => {
  assert.equal(initialAppearance('{"appearance":"auto"}', true).appearance, 'light')
  assert.equal(initialAppearance(null, false).appearance, 'dark')
  const result = initialAppearance('{"appearance":"dark","background":"default","cardOpacity":65}', true)
  assert.equal(result.preferences.background, 'default')
  assert.equal(result.preferences.cardOpacity, 65)
})

test('损坏或不可读的浏览器存储仍能完成首屏初始化', () => {
  for (const saved of ['{', 'null', '[]']) assert.equal(initialAppearance(saved, true).appearance, 'light')
  assert.equal(initialAppearance(null, false, true).appearance, 'dark')
})

test('恢复站点默认后，已知的深色从 HTML 首帧保持到 Vue 挂载；更换 Worker 不混用缓存', () => {
  const cache = {}
  const storage = { setItem(key, value) { cache[key] = value }, removeItem(key) { delete cache[key] } }
  const first = initialAppearance(null, true, false, cache, 'https://first.test,https://other.test')
  assert.equal(first.appearance, 'light')
  const controller = createPreferencesController({ initial: first.preferences, siteAppearance: first.siteAppearance, storage })
  controller.applyConfig({ preferred_theme: 'dark' })
  controller.prefs.appearance = 'light'
  controller.clearOverrides()
  assert.equal(cache['orbit-preferences'], undefined)
  const reload = initialAppearance(null, true, false, cache, 'https://first.test,https://other.test')
  assert.equal(reload.appearance, 'dark')
  const restarted = createPreferencesController({ initial: reload.preferences, siteAppearance: reload.siteAppearance, storage })
  assert.equal(restarted.prefs.appearance, 'dark')
  restarted.applyConfig({ preferred_theme: 'auto' })
  assert.equal(restarted.prefs.appearance, 'auto')
  assert.equal(initialAppearance(null, true, false, cache, 'https://first.test').appearance, 'light')
  assert.equal(initialAppearance(null, true, false, cache, 'https://other.test').appearance, 'light')
})
