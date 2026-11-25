import { ref } from 'vue'
import { messages } from './messages.js'

export const resolveLocale = (setting = 'auto', language = globalThis.navigator?.language || 'zh-CN') =>
  setting === 'zh' || (setting !== 'en' && /^zh(?:-|$)/i.test(language)) ? 'zh-CN' : 'en'
export const locale = ref('zh-CN')

export function t(key, params) {
  const value = locale.value === 'en' ? messages[key] ?? key : key
  return params ? value.replace(/\{(\w+)\}/g, (name, field) => String(params[field] ?? name)) : value
}
