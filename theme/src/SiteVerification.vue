<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
import { http } from '../../src/frontend/utils/http.js'
import { loadTurnstileScript, setTurnstileToken, clearTurnstileToken } from '../../src/frontend/utils/turnstile.js'

const props = defineProps({ siteKey: { type: String, required: true }, light: Boolean })
const emit = defineEmits(['verified'])
const container = ref(null)
const error = ref('')
const loading = ref(false)
const runtime = { widget: null, mounted: true }

async function mountWidget() {
  error.value = ''
  if (!props.siteKey) { error.value = '站点未配置验证公钥，请在管理后台完成配置。'; return }
  loading.value = true
  try {
    await loadTurnstileScript()
    if (!runtime.mounted) return
    if (runtime.widget !== null) window.turnstile.remove(runtime.widget)
    runtime.widget = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      theme: props.light ? 'light' : 'dark',
      size: 'flexible',
      callback: async token => {
        setTurnstileToken(token)
        const result = await http.get('/api/config', { autoRedirect: false, timeoutMs: 15000 })
        clearTurnstileToken()
        if (!runtime.mounted) return
        if (result.error || !result.data.verified) { error.value = '验证未通过，请重试。'; return }
        emit('verified')
      },
      'error-callback': () => { error.value = '验证服务暂时无法连接，请重试。' },
      'expired-callback': () => { clearTurnstileToken(); error.value = '验证已过期，请重试。' },
    })
  } catch { error.value = '验证组件加载失败，请检查网络后重试。' }
  loading.value = false
}
onMounted(mountWidget)
watch(() => props.light, mountWidget)
onUnmounted(() => {
  runtime.mounted = false
  if (runtime.widget !== null) window.turnstile.remove(runtime.widget)
})
</script>

<template>
  <section class="verification-panel" aria-label="站点访问验证">
    <UiIcon name="shield" class="verification-symbol" /><h3>验证后查看服务器</h3>
    <p>完成站点的人机验证后，数据会自动加载。</p>
    <div ref="container" class="verification-widget" />
    <p v-if="loading" role="status">正在加载验证组件…</p>
    <p v-if="error" class="amber" role="alert">{{ error }}</p>
    <button v-if="error && siteKey" class="clear-button" :disabled="loading" @click="mountWidget">重新验证</button>
  </section>
</template>
