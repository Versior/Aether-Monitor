<script setup>
import { computed } from 'vue'
import { adminUrl, hasVerificationWidget, sourceViewUrl } from './siteAccess.js'
import { t } from './i18n.js'
import SiteVerification from './SiteVerification.vue'
const props = defineProps({ site: { type: Object, required: true }, access: { type: Object, required: true }, detailId: String, light: Boolean, multi: Boolean })
const emit = defineEmits(['verified', 'retry'])
const sourceUrl = computed(() => sourceViewUrl(props.site.base, props.detailId))
</script>
<template>
  <div v-if="site.blocked === 401 || site.blocked === 403 || site.paused || site.error" class="site-status">
    <strong v-if="multi">{{ site.config?.site_title || site.base }}</strong>
    <div v-if="site.blocked === 401" class="error-state refresh-error">
      <span>{{ t('此站点需要登录') }}</span><a :href="adminUrl(site.base)">{{ t('管理后台') }}</a>
      <a v-if="sourceUrl" :href="sourceUrl" referrerpolicy="no-referrer">{{ t('在源站查看') }}</a>
    </div>
    <SiteVerification v-else-if="site.blocked === 403 && hasVerificationWidget(site.config)" :site-key="site.config.turnstile_site_key" :verify="token => access.verify(site.base, token)" :light="light" @verified="config => emit('verified', site.base, config)" />
    <div v-else class="error-state refresh-error" role="status">
      <span>{{ site.paused ? t('实时连接已暂停') : t(site.error || '连接失败') }}</span>
      <button :disabled="site.loading" @click="emit('retry', site.base)">{{ t(site.loading ? '正在连接…' : '重新连接') }}</button>
    </div>
  </div>
</template>
