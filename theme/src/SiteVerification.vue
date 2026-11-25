<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import { t, locale } from './i18n.js'
import { loadTurnstileScript } from '../../src/frontend/utils/turnstile.js'

const props = defineProps({ siteKey: { type: String, required: true }, verify: { type: Function, required: true }, light: Boolean })
const emit = defineEmits(['verified'])
const container = ref(null)
const error = ref('')
const loading = ref(false)
const runtime = { widget: null, renderId: 0 }

async function mountWidget() {
  const renderId = ++runtime.renderId
  const current = () => renderId === runtime.renderId
  error.value = ''
  if (runtime.widget !== null) { window.turnstile.remove(runtime.widget); runtime.widget = null }
  if (!props.siteKey) { error.value = '站点未配置验证公钥，请在管理后台完成配置。'; loading.value = false; return }
  loading.value = true
  try {
    await loadTurnstileScript()
    if (!current()) return
    runtime.widget = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      theme: props.light ? 'light' : 'dark',
      language: locale.value,
      size: 'flexible',
      callback: async token => {
        if (!current()) return
        loading.value = true
        try {
          const config = await props.verify(token)
          if (current()) emit('verified', config)
        } catch {
          if (current()) error.value = '验证未通过，请重试。'
        } finally { if (current()) loading.value = false }
      },
      'error-callback': () => { if (current()) error.value = '验证服务暂时无法连接，请重试。' },
      'expired-callback': () => { if (current()) error.value = '验证已过期，请重试。' },
    })
  } catch { if (current()) error.value = '验证组件加载失败，请检查网络后重试。' }
  if (current()) loading.value = false
}
onMounted(mountWidget)
watch([() => props.light, () => props.siteKey, locale], mountWidget)
onUnmounted(() => {
  runtime.renderId++
  if (runtime.widget !== null) window.turnstile.remove(runtime.widget)
})
</script>

<template>
  <section class="verification-panel" :aria-label="t('站点访问验证')">
    <UiIcon name="shield" class="verification-symbol" /><h3>{{ t('验证后查看服务器') }}</h3>
    <p>{{ t('完成站点的人机验证后，数据会自动加载。') }}</p>
    <div ref="container" class="verification-widget" />
    <p v-if="loading" role="status">{{ t('正在验证…') }}</p>
    <p v-if="error" class="amber" role="alert">{{ t(error) }}</p>
    <button v-if="error && siteKey" class="clear-button" :disabled="loading" @click="mountWidget">{{ t('重新验证') }}</button>
  </section>
</template>
