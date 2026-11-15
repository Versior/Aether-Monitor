import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function initialAppearance(saved, systemLight, blocked = false) {
  const script = html.match(/<script id="aether-appearance">([\s\S]*?)<\/script>/)
  assert.ok(script, 'the HTML head must restore appearance before the main module')
  const sandbox = vm.createContext({
    window: { matchMedia: () => ({ matches: systemLight }) },
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem() { if (blocked) throw new Error('Storage unavailable'); return saved } },
  })
  vm.runInContext(script[1], sandbox)
  return { appearance: sandbox.document.documentElement.dataset.appearance, preferences: sandbox.window.__AETHER_PREFERENCES__ }
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
