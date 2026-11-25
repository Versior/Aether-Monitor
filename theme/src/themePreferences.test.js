import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreferencesController } from './themePreferences.js'

test('站点默认值不写入本机；只保存客人调整的字段，恢复后可持续跟随服务器', () => {
  const entries = new Map()
  const storage = { setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
  const controller = createPreferencesController({ initial: { layout: 'full' }, storage })
  const { prefs } = controller
  controller.applyConfig({ preferred_theme: 'dark', theme_options: { aether: { cardOpacity: 95 } } })
  assert.equal(prefs.appearance, 'dark')
  assert.equal(prefs.layout, 'full')
  assert.equal(entries.size, 0)
  prefs.appearance = 'light'
  assert.deepEqual(JSON.parse(entries.get('orbit-preferences')), { layout: 'full', appearance: 'light' })
  controller.applyConfig({ preferred_theme: 'dark', theme_options: { aether: { cardOpacity: 70 } } })
  assert.equal(prefs.cardOpacity, 70)
  assert.equal(prefs.appearance, 'light')
  controller.clearOverrides()
  assert.equal(entries.has('orbit-preferences'), false)
  assert.equal(prefs.appearance, 'dark')
  controller.applyConfig({ preferred_theme: 'light', theme_options: { aether: { cardOpacity: 80 } } })
  assert.equal(prefs.appearance, 'light')
  assert.equal(prefs.cardOpacity, 80)
  assert.equal(entries.size, 0)
})
