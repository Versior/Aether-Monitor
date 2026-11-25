import { getApiBases } from './config.js'
import { FRONTEND_WS_TIMEOUT_MINUTES_MAX, TIME } from './constants.js'
import { normalizeTimestamp } from './time.js'

export const normalizeLiveSocketTimeoutMinutes = value => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= FRONTEND_WS_TIMEOUT_MINUTES_MAX ? minutes : 0
}

export const isServerOnline = (server, now = Date.now()) => {
  const updated = normalizeTimestamp(server?.last_updated)
  return updated !== null && now - updated < TIME.ONLINE_THRESHOLD_MS
}

export function forEachLiveSample(updates, accept) {
  for (const update of updates || []) {
    if (!update?.serverId || !Array.isArray(update.samples)) continue
    for (const sample of update.samples) {
      const data = sample?.data || sample?.payload || sample?.metrics
      const ts = normalizeTimestamp(sample?.ts ?? sample?.timestamp ?? data?.sample_timestamp ?? data?.last_updated)
      if (data && typeof data === 'object' && !Array.isArray(data) && ts !== null) accept({ serverId: update.serverId, data, ts })
    }
  }
}

export function createLiveSocket(scope, handlers = {}, apiIndex = 0, ids = [], platform = globalThis) {
  const base = new URL(handlers.base || getApiBases()[apiIndex])
  const lifetime = normalizeLiveSocketTimeoutMinutes(handlers.timeoutMinutes) * 60000
  const allowed = new Set(scope === 'all' ? ids : [scope])
  let socket = null, retryTimer = null, lifetimeTimer = null, openedAt = null
  let attempts = 0, stopped = false, connected = false

  function status(reason, terminal = false) { handlers.onStatus?.({ connected, reason, terminal }) }
  function close() {
    stopped = true
    platform.clearTimeout(retryTimer)
    platform.clearTimeout(lifetimeTimer)
    retryTimer = lifetimeTimer = null
    const previous = socket
    socket = null
    connected = false
    previous?.close()
  }
  function schedule() {
    if (stopped || handlers.canConnect?.() === false) return
    if (attempts >= TIME.MAX_RECONNECT_ATTEMPTS) { stopped = true; status('exhausted', true); return }
    const wait = Math.min(TIME.RECONNECT_INITIAL_DELAY_MS * 2 ** attempts++, TIME.RECONNECT_MAX_DELAY_MS)
    status('retrying')
    retryTimer = platform.setTimeout(connect, wait)
  }
  function connect() {
    retryTimer = null
    if (stopped || handlers.canConnect?.() === false) return
    const url = new URL('/api/ws', base)
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('subscribe', scope)
    if (base.origin !== platform.location.origin) {
      const token = handlers.getToken?.()
      if (token) url.searchParams.set('token', token)
    }
    let current
    try { current = new platform.WebSocket(url.href) }
    catch { stopped = true; status('unavailable', true); return }
    socket = current
    openedAt = null
    current.addEventListener('open', () => {
      if (socket !== current) return
      if (handlers.canConnect?.() === false) { close(); return }
      openedAt = platform.Date.now()
      if (scope === 'all') current.send(JSON.stringify({ type: 'subscribe', scope, ids }))
      connected = true
      status('connected')
      if (lifetime) lifetimeTimer = platform.setTimeout(() => {
        close()
        handlers.onTimeout?.()
      }, lifetime)
    })
    current.addEventListener('message', event => {
      if (socket !== current || stopped) return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message?.type === 'hello') {
        const time = normalizeTimestamp(message.ts)
        if (time !== null) handlers.onServerTime?.(time)
        return
      }
      if (message?.type !== 'batchUpdate' || !Array.isArray(message.updates)) return
      forEachLiveSample(message.updates, update => { if (allowed.has(update.serverId)) handlers.onUpdate?.(update) })
    })
    current.addEventListener('error', () => { if (socket === current) current.close() })
    current.addEventListener('close', event => {
      if (socket !== current) return
      socket = null
      connected = false
      platform.clearTimeout(lifetimeTimer)
      lifetimeTimer = null
      if (event.code === 1008) { stopped = true; status('policy', true); return }
      if (openedAt !== null && platform.Date.now() - openedAt >= TIME.RECONNECT_MAX_DELAY_MS) attempts = 0
      schedule()
    })
  }
  connect()
  return { close, get isConnected() { return connected } }
}
