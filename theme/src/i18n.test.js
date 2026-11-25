import assert from 'node:assert/strict'
import test from 'node:test'
import { locale, resolveLocale, t } from './i18n.js'

test('站点语言优先，自动按浏览器选择，动态地名不当作界面文字翻译', () => {
  assert.equal(resolveLocale('en', 'zh-HK'), 'en')
  assert.equal(resolveLocale('zh', 'en-GB'), 'zh-CN')
  assert.equal(resolveLocale('auto', 'zh-TW'), 'zh-CN')
  assert.equal(resolveLocale('auto', 'fr'), 'en')
  assert.equal(resolveLocale('zh-TW', 'en-US'), 'zh-CN')
  assert.equal(resolveLocale('en-GB', 'zh-HK'), 'en')
  locale.value = 'en'
  assert.equal(t('服务器'), 'Servers')
  assert.equal(t('每月 {day} 日', {day: 5}), 'Day 5 of each month')
  locale.value = 'zh-CN'
  assert.equal(t('每月 {day} 日', {day: 5}), '每月 5 日')
})
