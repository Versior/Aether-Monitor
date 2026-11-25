<script setup>
import { nextTick, onMounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'
import { t } from './i18n.js'
import { dialogKey } from './dialogKey.js'
const props = defineProps({ prefs: Object, projectBackground: String, allowVisitor: Boolean, canSave: Boolean, saving: Boolean, notice: String })
const emit = defineEmits(['close','restore','save'])
const dialog = ref(null)
onMounted(() => nextTick(() => dialog.value?.focus()))
</script>
<template>
  <div class="dialog-backdrop settings-backdrop" @click.self="emit('close')"><section ref="dialog" class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-settings-title" tabindex="-1" @keydown="dialogKey($event, () => emit('close'))">
    <div class="settings-heading"><div><span>AETHER</span><h2 id="theme-settings-title">{{ t('主题设置') }}</h2></div><button class="icon-button" :aria-label="t('关闭主题设置')" @click="emit('close')"><UiIcon name="close" /></button></div>
    <p class="settings-note">{{ t('调整保存在当前浏览器。') }}</p>
    <div class="settings-section"><h3>{{ t('背景与质感') }}</h3><div class="background-options" role="group" :aria-label="t('页面背景')">
      <button :class="{selected:prefs.background==='project'}" :aria-pressed="prefs.background==='project'" @click="prefs.background='project'"><span class="background-preview" :style="{backgroundImage:projectBackground}" aria-hidden="true"/><strong>{{ t('项目背景') }}</strong><small>{{ t(projectBackground==='none'?'后台未设置背景，使用纯色':'跟随项目的桌面与手机背景') }}</small></button>
      <button :class="{selected:prefs.background==='default'}" :aria-pressed="prefs.background==='default'" @click="prefs.background='default'"><span class="background-preview solid" aria-hidden="true"/><strong>{{ t('纯色背景') }}</strong><small>{{ t('随深浅色切换，关闭背景图片') }}</small></button></div>
      <label class="setting-range"><span>{{ t('卡片不透明度') }}<output>{{ prefs.cardOpacity }}%</output></span><input v-model.number="prefs.cardOpacity" type="range" min="40" max="100" step="5" :aria-label="t('卡片不透明度')"></label>
      <label class="setting-range"><span>{{ t('毛玻璃模糊') }}<output>{{ prefs.panelBlur }} px</output></span><input v-model.number="prefs.panelBlur" type="range" min="0" max="20" step="1" :aria-label="t('毛玻璃模糊')"></label>
    </div><div class="settings-section"><h3>{{ t('显示与动效') }}</h3>
      <label class="setting-row"><span>{{ t('配色') }}</span><select v-model="prefs.appearance" :aria-label="t('主题配色')"><option value="auto">{{ t('跟随系统') }}</option><option value="light">{{ t('浅色') }}</option><option value="dark">{{ t('深色') }}</option></select></label>
      <label class="setting-row"><span>{{ t('卡片信息') }}</span><select v-model="prefs.layout" :aria-label="t('卡片信息')"><option value="compact">{{ t('紧凑') }}</option><option value="full">{{ t('完整') }}</option></select></label>
      <div class="setting-toggles"><label class="setting-row"><span>{{ t('显示地球') }}</span><input v-model="prefs.globe" type="checkbox" role="switch"></label>
      <label class="setting-row"><span>{{ t('地球动效') }}</span><input v-model="prefs.motion" type="checkbox" role="switch"></label>
      <label class="setting-row"><span>{{ t('向访客位置汇聚') }}</span><input v-model="prefs.visitorFlow" type="checkbox" role="switch"></label></div>
      <label v-if="allowVisitor || canSave" class="setting-row"><span>{{ t('访客 IP 检测入口') }}<small>{{ t('关闭后仅使用监控接口。') }}</small></span><input v-model="prefs.visitorLookup" type="checkbox" role="switch"></label>
    </div><p v-if="notice" role="status">{{ notice }}</p><div class="settings-footer"><button class="clear-button" @click="emit('restore')">{{ t('恢复站点默认') }}</button><button v-if="canSave" class="clear-button" :disabled="saving" @click="emit('save')">{{ t(saving ? '正在保存…' : '保存为站点默认') }}</button><button class="settings-done" @click="emit('close')">{{ t('完成') }}</button></div>
  </section></div>
</template>
