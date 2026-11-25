import { ADMIN_ENTRY_URL } from '../../src/frontend/router/adminEntryUrl.js'
import { STORAGE } from '../../src/frontend/utils/constants.js'
import { requestJson } from '../../src/frontend/utils/http.js'

export const adminUrl = base => new URL(ADMIN_ENTRY_URL, base).href
export function sourceViewUrl(base, detailId, origin = window.location.origin) {
  const worker = new URL(base).origin
  return worker === origin ? '' : `${worker}/#/${detailId ? `server/${encodeURIComponent(detailId)}` : ''}`
}
export const needsVerification = config => config?.turnstile_enabled === true && !config.verified && !config.verificationPending && (config.is_public || config.authorization)
export const hasVerificationWidget = config => config?.turnstile_enabled === true && !!config.turnstile_site_key

export function createSiteAccess({ fetch: fetcher = globalThis.fetch, origin = window.location.origin, storage = window.localStorage, tabStorage = globalThis.sessionStorage,
  navigate = url => window.location.assign(url), shouldRedirect = base => base === origin, onConfig, onBlocked } = {}) {
  const configs = new Map()
  const pending = new Map()
  const credentialRevision = new Map()
  const redirected = new Set()
  const key = (base, field) => new URL(base).origin === origin ? field : `aether:${new URL(base).origin}:${field}`
  const wsToken = base => storage.getItem(key(base, STORAGE.JWT_TOKEN)) || ''
  const receiptKey = base => key(base, STORAGE.TURNSTILE_VERIFIED)

  function redirect(base) {
    if (redirected.has(base) || !shouldRedirect(base)) return
    const worker = new URL(base).origin
    if (worker !== origin) {
      const key = `aether:login-visited:${worker}`
      if (tabStorage?.getItem(key)) return
      tabStorage?.setItem(key, '1')
    }
    redirected.add(base)
    navigate(adminUrl(base))
  }
  function publish(base, value) {
    configs.set(base, value)
    onConfig?.(base, value)
    return value
  }
  function invalidateConfig(base) {
    configs.delete(base)
    onConfig?.(base, null)
  }
  async function request(base, path, options = {}) {
    const token = wsToken(base)
    const receipt = storage.getItem(receiptKey(base))
    const revision = credentialRevision.get(base) ?? 0
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
    try { return await requestJson(fetcher, base, path, { ...options, headers }) }
    catch (error) {
      error.loginUrl = adminUrl(base)
      if (error.status === 401 || error.status === 403) {
        if (token !== wsToken(base) || receipt !== storage.getItem(receiptKey(base)) || revision !== (credentialRevision.get(base) ?? 0)) {
          throw Object.assign(error, { staleCredentials: true })
        }
        credentialRevision.set(base, revision + 1)
      }
      if (error.status === 401) {
        storage.removeItem(key(base, STORAGE.JWT_TOKEN))
        if (configs.has(base)) publish(base, { ...configs.get(base), authorization: false })
        onBlocked?.(base, 401, error)
        redirect(base)
      }
      if (error.status === 403) {
        storage.removeItem(receiptKey(base))
        const cached = configs.get(base)
        const mustReadSettings = path !== '/api/config' && !hasVerificationWidget(cached)
        if (mustReadSettings) invalidateConfig(base)
        else if (cached) publish(base, { ...cached, verified: false, verificationPending: false })
        onBlocked?.(base, 403, error)
        if (mustReadSettings) {
          const fresh = await config(base)
          if (fresh.is_public === false && !fresh.authorization) onBlocked?.(base, 401)
        }
      }
      throw error
    }
  }

  async function config(base) {
    if (configs.has(base)) return configs.get(base)
    if (!pending.has(base)) pending.set(base, (async () => {
      const value = await request(base, '/api/config')
      if (value.is_public === false && !value.authorization) {
        storage.removeItem(key(base, STORAGE.JWT_TOKEN))
        redirect(base)
      }
      if (!value.turnstile_enabled) storage.removeItem(receiptKey(base))
      return publish(base, { ...value, verificationPending: value.turnstile_enabled === true && !!storage.getItem(receiptKey(base)) })
    })().finally(() => pending.delete(base)))
    return pending.get(base)
  }
  async function verify(base, token) {
    const value = await request(base, '/api/config', { headers: { 'X-Turnstile-Token': token } })
    if (value.verified !== true || !value.turnstile_verified) throw Object.assign(new Error('Turnstile verification failed'), { status: 403, base, path: '/api/config', loginUrl: adminUrl(base) })
    storage.setItem(receiptKey(base), value.turnstile_verified)
    credentialRevision.set(base, (credentialRevision.get(base) ?? 0) + 1)
    return publish(base, { ...value, verificationPending: false })
  }
  async function authorizedRequest(base, path, options) {
    const current = await config(base)
    const receipt = current.turnstile_enabled && storage.getItem(receiptKey(base))
    const result = await request(base, path, { ...options, headers: receipt ? { 'X-Turnstile-Verified': receipt } : {} })
    if (receipt && configs.get(base).verificationPending && storage.getItem(receiptKey(base)) === receipt) {
      publish(base, { ...configs.get(base), verified: true, verificationPending: false })
    }
    return result
  }
  async function save(base, preferences) {
    const bootstrapped = configs.has(base)
    let current = await config(base)
    const path = '/api/theme_options'
    if (bootstrapped && current.authorization === true && current.theme_options_patch !== true) current = await authorizedRequest(base, '/api/config')
    if (current.authorization !== true) throw Object.assign(new Error('Unauthorized'), { status: 401, base, path, loginUrl: adminUrl(base) })
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new TypeError('Invalid theme preferences')
    let body
    if (current.theme_options_patch === true) {
      body = { theme_options_patch: { namespace: 'aether', options: preferences } }
    } else {
      const options = current.theme_options
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid theme options response')
      body = { theme_options: { ...options, aether: { ...options.aether, ...preferences } } }
    }
    const result = await authorizedRequest(base, path, { body })
    if (result?.success !== true || !result.theme_options || typeof result.theme_options !== 'object' || Array.isArray(result.theme_options)) throw new Error('Invalid theme options response')
    return publish(base, { ...configs.get(base), theme_options: result.theme_options })
  }
  return { config, invalidateConfig, wsToken, verify, get: authorizedRequest, save }
}
