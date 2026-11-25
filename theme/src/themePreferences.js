import { computed, reactive, ref } from 'vue'
import { defaultPreferences, preferences } from './data.js'

const preferenceKey = 'orbit-preferences'

export function createPreferencesController({ initial = {}, storage = window.localStorage, siteAppearance = globalThis.window?.__AETHER_SITE_APPEARANCE__ } = {}) {
  const defaults = ref(preferences({ appearance: siteAppearance?.value }))
  const normalized = preferences(initial)
  const fields = Object.keys(defaultPreferences)
  const overrides = ref(Object.fromEntries(fields.filter(field => Object.hasOwn(initial, field)).map(field => [field, normalized[field]])))

  function persist() {
    if (Object.keys(overrides.value).length) storage.setItem(preferenceKey, JSON.stringify(overrides.value))
    else storage.removeItem(preferenceKey)
  }
  const prefs = reactive(Object.fromEntries(fields.map(field => [field, computed({
    get: () => overrides.value[field] ?? defaults.value[field],
    set(value) {
      const normalizedValue = preferences({ [field]: value })[field]
      if (normalizedValue === defaults.value[field]) delete overrides.value[field]
      else overrides.value[field] = normalizedValue
      persist()
    },
  })])))
  function applyConfig(config) {
    defaults.value = preferences({ appearance: config.preferred_theme, ...(config.theme_options?.aether ?? config.theme_options?.orbit) })
    if (siteAppearance && siteAppearance.value !== defaults.value.appearance) {
      storage.setItem(siteAppearance.key, defaults.value.appearance)
      siteAppearance.value = defaults.value.appearance
    }
  }
  function clearOverrides() { overrides.value = {}; persist() }
  return { prefs, applyConfig, clearOverrides }
}
