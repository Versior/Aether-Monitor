<script setup>
defineProps({ name: { type: String, required: true } })
const paths = {
  server: 'M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 10h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2ZM7 7h.01M7 17h.01M11 7h6m-6 10h6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 12a4 9 0 1 1-8 0 4 9 0 0 1 8 0ZM3 12h18',
  cpu: 'M6 6h12v12H6V6Zm3 3h6v6H9V9ZM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  alert: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v6m0 4h.01',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  list: 'M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  refresh: 'M20 7a9 9 0 0 0-15-1L3 8m0-5v5h5m-4 9a9 9 0 0 0 15 1l2-2m0 5v-5h-5',
  filter: 'M3 5h18M6 12h12M9 19h6',
  close: 'm6 6 12 12M6 18 18 6',
  external: 'M7 17 17 7M7 7h10v10',
  down: 'M12 4v16m-6-6 6 6 6-6',
  up: 'M12 20V4m-6 6 6-6 6 6',
  browser: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM3 9h18M7 6.5h.01M10 6.5h.01',
  'shield-check': 'M12 3 20 6v6c0 4.5-4 7.5-8 9-4-1.5-8-4.5-8-9V6l8-3Zm-3.5 9 2.5 2.5 4.5-5',
  'shield-alert': 'M12 3 20 6v6c0 4.5-4 7.5-8 9-4-1.5-8-4.5-8-9V6l8-3Zm0 5v5m0 3h.01',
  shield: 'M12 3 20 6v6c0 4.5-4 7.5-8 9-4-1.5-8-4.5-8-9V6l8-3Zm-3 9h6',
  loader: 'M21 12a9 9 0 1 1-9-9',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  chevron: 'm7 10 5 5 5-5',
}
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name]" /></svg>
</template>
