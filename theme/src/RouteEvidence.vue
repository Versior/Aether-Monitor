<script setup>
import { locale, t } from './i18n.js'
defineProps({ report: { type: Object, default: null }, now: { type: Number, required: true } })
const names = { ct: '电信', cu: '联通', cm: '移动' }
const states = { unknown: '未识别', failed: '检测失败', disabled: '已关闭' }
</script>

<template>
  <details v-if="report" class="route-evidence">
    <summary><span>{{ t('自动线路检测') }}<small>{{ t('{count} 个方向', { count: report.routes.length }) }} · {{ t(report.expires_at <= now ? '结果已过期' : '查看线路证据') }}</small></span><time>{{ new Date(report.checked_at).toLocaleString(locale, { hour12: false }) }}</time></summary>
    <p>{{ t('VPS 到配置目标的单向路径；ASN 与 IP 段匹配分别列出。* 表示该跳未返回 ASN，未出现某个网络不代表没有经过。“经”表示观测到的国际网络，骨干仍未识别。结果不认证 GIA / GT，也不代表相反方向。') }}</p>
    <div v-for="route in report.routes" :key="`${route.carrier}-${route.family}`" class="route-evidence-row">
      <span>{{ t(names[route.carrier]) }} · IPv{{ route.family }}<small v-if="route.protocol" class="probe-method">{{ t('选用 {protocol} · 共 {count} 次尝试', { protocol: route.protocol.toUpperCase(), count: route.attempts }) }}</small></span>
      <strong :class="{ verified: report.expires_at > now && route.networks.length > 0 }">
        {{ route.networks.join(' / ') }}
        <small v-if="report.expires_at <= now">{{ t('结果已过期') }}</small>
        <small v-else-if="!route.networks.length">{{ t(states[route.status] || states.unknown) }}</small>
      </strong>
      <code v-if="route.hops.some(hop => hop.length)">{{ route.hops.map(hop => hop.length ? hop.map(asn => `AS${asn}`).join('|') : '*').join(' → ') }}</code>
      <small v-if="route.prefix_hints?.length" class="evidence-note">{{ t('IP 段匹配：{prefixes}', { prefixes: route.prefix_hints.map(hint => `${hint.network} (${hint.prefix})`).join(' / ') }) }}</small>
      <small v-if="route.transit_networks?.length" class="evidence-note">{{ t('途经网络：{networks}', { networks: route.transit_networks.join(' / ') }) }}</small>
    </div>
  </details>
</template>

<style scoped>
.route-evidence{margin:12px 0;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface-hover)}
summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-size:13px;font-weight:600}
summary span{display:grid;gap:4px}small,time,p{color:var(--muted);font-size:11px;font-weight:400}
summary small{display:block}p{line-height:1.6;margin:12px 0}
.route-evidence-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;border-top:1px solid var(--border);padding:10px 0;font-size:12px}
.route-evidence-row strong{font-weight:500;text-align:right}.route-evidence-row strong small{display:block;margin-top:4px}
code{grid-column:1/-1;color:var(--muted);font-size:10px;line-height:1.7;overflow-wrap:anywhere}.verified{color:var(--green)}
.probe-method{display:block;margin-top:4px}.evidence-note{grid-column:1/-1;line-height:1.6;overflow-wrap:anywhere}
@media(max-width:480px){summary{align-items:flex-start}time{max-width:130px;text-align:right}}
</style>
