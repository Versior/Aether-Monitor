import { reactive } from 'vue'
import { createLiveSocket, forEachLiveSample, isServerOnline } from '../../src/frontend/utils/api.js'
import { normalizeTimestamp } from '../../src/frontend/utils/time.js'
import { normalizeNode } from './data.js'
import { hasVerificationWidget } from './siteAccess.js'

export const HISTORY_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168]
const defaultHours = HISTORY_HOURS[0]
const emptyDetail = () => ({ id: '', site: 0, base: '', node: null, hours: defaultHours, rows: [], end: null, loading: false, error: '' })
const publicIdentity = (site, id) => ({ id, site: site.index, source: site.base, apiBase: site.base, key: `${site.base}/${id}` })
const statFields = ['total', 'online', 'offline']

function snapshotPresence(servers, stats) {
  if (stats.total !== servers.length || stats.online + stats.offline !== stats.total || !Number.isInteger(stats.online) || stats.online < 0 || stats.online > stats.total) return null
  const ranked = servers.map(node => ({ id: node.id, updated: normalizeTimestamp(node.last_updated) })).sort((first, second) => (second.updated ?? 0) - (first.updated ?? 0))
  if (stats.online && (ranked[stats.online - 1].updated === null || ranked[stats.online - 1].updated === ranked[stats.online]?.updated)) return null
  return new Map(ranked.map(({ id, updated }, index) => [id, { updated, online: index < stats.online }]))
}

function readRoute(hash, sites) {
  const path = hash.replace(/^#/, '')
  if (!path || path === '/') return null
  const [pathname, query] = path.split('?')
  if (!pathname.startsWith('/server/')) throw new Error('页面链接无效')
  const id = decodeURIComponent(pathname.slice(8))
  const index = new URLSearchParams(query).get('site') ?? '0'
  if (!/^[\w.:-]{1,64}$/.test(id) || !/^\d+$/.test(index) || !sites[Number(index)]) throw new Error('节点链接无效')
  return { id, site: Number(index) }
}

function combineRows(history, samples, hours, end) {
  const rows = new Map()
  const start = end - hours * 3600000
  for (const raw of [...history, ...samples.values()]) {
    const timestamp = normalizeTimestamp(raw.timestamp ?? raw.ts)
    if (timestamp !== null && timestamp >= start) rows.set(timestamp, { ...rows.get(timestamp), ...raw, timestamp })
  }
  return [...rows.values()].sort((first, second) => first.timestamp - second.timestamp)
}

function rowIndex(rows, timestamp) {
  let low = 0, high = rows.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (rows[middle].timestamp < timestamp) low = middle + 1
    else high = middle
  }
  return low
}

export function createMonitorSession({ bases, access, openSocket = createLiveSocket, now = Date.now, isHidden = () => document.hidden, timers = globalThis }) {
  const sites = reactive(bases.map((base, index) => ({ base, index, config: null, sysConfig: {}, nodes: [], stats: null, presence: null, clockOffset: null, blocked: null, paused: false, error: '', loading: false, snapshotAt: null })))
  const runtimes = sites.map(() => ({ generation: 0, configured: null, listTask: null, loaded: false, needsList: false, mode: '', sockets: [], pending: new Map(), stamps: new Map() }))
  const state = reactive({
    sites, clock: now(), detail: emptyDetail(), routeError: '',
    get nodes() { return sites.flatMap(site => site.nodes) },
    get stats() {
      const known = sites.filter(site => site.stats && !site.blocked)
      return known.length ? Object.fromEntries(statFields.map(field => [field, known.reduce((sum, site) => sum + site.stats[field], 0)])) : null
    },
    get snapshotAt() { return sites.reduce((latest, site) => site.snapshotAt !== null ? Math.max(latest ?? 0, site.snapshotAt) : latest, null) },
    get loading() { return sites.some(site => site.loading) || this.detail.loading },
    get error() { return this.routeError || sites.find(site => site.error)?.error || '' },
  })
  let route, visible = !isHidden(), disposed = false, clockTimer = null, routeVersion = 0, rangeVersion = 0
  const liveHistory = new Map(), pendingHistory = new Map()
  let activeLoad = null, detailReady = false

  async function readSnapshot(site, path) {
    let offset = null
    const data = await access.get(site.base, path, { onResponseDate: time => { offset = time - now() } })
    if (offset === null) {
      const report = data.latestReportUpdates?.find(update => normalizeTimestamp(update?.reportTs) !== null && Number.isFinite(update.reportAgeMs) && update.reportAgeMs >= 0)
      if (report) offset = normalizeTimestamp(report.reportTs) + report.reportAgeMs - now()
    }
    return { data, offset }
  }
  function online(node) {
    const site = sites[node.site]
    return site.presence?.get(node.id)?.online ?? isServerOnline(node, state.clock + (site.clockOffset ?? 0))
  }
  function updatePresence(site) {
    if (site.clockOffset === null || !site.presence || state.clock <= site.snapshotAt) return
    let delta = 0
    for (const node of site.nodes) {
      const previous = site.presence.get(node.id)
      const updated = normalizeTimestamp(node.last_updated)
      const current = isServerOnline(node, state.clock + site.clockOffset) && (previous.online || updated > (previous.updated ?? 0))
      if (current === previous.online) continue
      site.presence.set(node.id, { updated, online: current })
      delta += current ? 1 : -1
    }
    if (delta) site.stats = { ...site.stats, online: site.stats.online + delta, offline: site.stats.offline - delta }
  }

  function stopSockets(runtime) {
    runtime.mode = ''
    for (const socket of runtime.sockets.splice(0)) socket.close()
    runtime.pending.clear()
  }
  function active(site) { return !disposed && visible && !isHidden() && !site.blocked && !site.paused }
  function currentDetail(site, id) { return state.detail.site === site.index && state.detail.id === id }
  function configure(site, config) {
    site.config = config
    site.sysConfig = { ...site.sysConfig, ...config.sysConfig }
    if (state.detail.id && state.detail.site === site.index && !config.authorization && state.detail.hours > 24) {
      rangeVersion++
      state.detail.hours = 24
      state.detail.rows = []
    }
    if (config.is_public === false && !config.authorization) block(site.base, 401)
    else if (config.turnstile_enabled === true && !config.verified && !config.verificationPending) block(site.base, 403)
  }
  async function ready(site) {
    if (!site.config) {
      const runtime = runtimes[site.index]
      const generation = runtime.generation
      runtime.configured ??= access.config(site.base).then(config => {
        if (!disposed && !site.blocked) configure(site, config)
        else if (!disposed && !site.config && generation === runtime.generation) site.config = config
      }).finally(() => { runtime.configured = null })
      await runtime.configured
    }
    return active(site)
  }
  function block(base, status, error) {
    const site = sites.find(item => item.base === base)
    if (!site || site.blocked === status || error?.staleCredentials || disposed) return
    const runtime = runtimes[site.index]
    runtime.generation++
    runtime.loaded = false
    runtime.listTask = null
    runtime.stamps.clear()
    stopSockets(runtime)
    site.blocked = status
    site.paused = false
    site.loading = false
    site.error = (typeof error === 'string' ? error : error?.message) || (status === 401 ? '需要登录' : '需要站点验证')
    if (site.config) site.config = status === 401 ? { ...site.config, authorization: false } : { ...site.config, verified: false, verificationPending: false }
    Object.assign(site, { nodes: [], stats: null, presence: null, snapshotAt: null, sysConfig: {} })
    if (state.detail.id && site.index === state.detail.site) {
      rangeVersion++
      detailReady = false
      liveHistory.clear()
      pendingHistory.clear()
      Object.assign(state.detail, { node: null, rows: [], loading: false, error: site.error })
    }
  }
  function failed(site, error) {
    if ((error.status === 401 || error.status === 403) && !error.staleCredentials) block(site.base, error.status, error)
    else site.error = error.message
  }

  function applyFields(site, id, source, stamps) {
    const runtime = runtimes[site.index]
    const previous = runtime.stamps.get(id) || new Map()
    const changes = {}
    for (const [field, value] of Object.entries(source)) {
      if (['id', 'site', 'key', 'source', 'apiBase', 'latestReportUpdates', 'sysConfig'].includes(field)) continue
      const time = stamps instanceof Map ? stamps.get(field) : stamps
      if (time >= (previous.get(field)?.time ?? -Infinity)) { changes[field] = value; previous.set(field, { time, value }) }
    }
    runtime.stamps.set(id, previous)
    return changes
  }
  function record(site, { serverId: id, data, ts }) {
    const runtime = runtimes[site.index]
    const sample = normalizeNode(data)
    const pending = runtime.pending.get(id) || { fields: {}, times: new Map() }
    const metricTime = normalizeTimestamp(sample.last_updated) ?? ts
    for (const [key, value] of Object.entries({ ...sample, last_updated: metricTime, sample_timestamp: ts })) {
      if (ts >= (pending.times.get(key) ?? -Infinity)) { pending.fields[key] = value; pending.times.set(key, ts) }
    }
    runtime.pending.set(id, pending)
    if (currentDetail(site, id) && ts >= state.clock - state.detail.hours * 3600000) {
      const row = { ...liveHistory.get(ts), ...sample, timestamp: ts }
      liveHistory.set(ts, row)
      pendingHistory.set(ts, row)
    }
  }
  function flush() {
    if (disposed || !visible) return
    state.clock = now()
    for (const site of sites) {
      const runtime = runtimes[site.index]
      if (!runtime.pending.size || !active(site)) continue
      const updated = new Map()
      for (const [id, entry] of runtime.pending) updated.set(id, applyFields(site, id, entry.fields, entry.times))
      if (site.nodes.some(node => updated.has(node.id))) site.nodes = site.nodes.map(node => updated.has(node.id) ? { ...node, ...updated.get(node.id) } : node)
      const detail = state.detail
      if (currentDetail(site, detail.id) && updated.has(detail.id) && detail.node) {
        detail.node = { ...detail.node, ...updated.get(detail.id) }
        detail.end = state.clock
        if (!detail.loading) {
          const start = detail.end - detail.hours * 3600000
          const expired = rowIndex(detail.rows, start)
          if (expired) for (const row of detail.rows.splice(0, expired)) liveHistory.delete(row.timestamp)
          for (const [time, row] of pendingHistory) {
            if (time < start) { liveHistory.delete(time); continue }
            const index = rowIndex(detail.rows, time)
            if (detail.rows[index]?.timestamp === time) detail.rows[index] = { ...detail.rows[index], ...row }
            else detail.rows.splice(index, 0, row)
          }
          pendingHistory.clear()
        }
      }
      runtime.pending.clear()
    }
    for (const site of sites) updatePresence(site)
  }
  function clockOn() { if (clockTimer === null && visible && !disposed) clockTimer = timers.setInterval(flush, 1000) }
  function clockOff() { timers.clearInterval(clockTimer); clockTimer = null }
  function pause(site, reason) {
    if (site.paused) return
    site.paused = true
    site.error = reason
    stopSockets(runtimes[site.index])
    if (state.detail.id && state.detail.site === site.index) state.detail.loading = false
  }
  function subscribe(site, scope, ids) {
    const runtime = runtimes[site.index]
    if (runtime.mode === scope || !active(site)) return
    stopSockets(runtime)
    runtime.mode = scope
    const valid = () => active(site) && runtime.mode === scope
    const handlers = {
      base: site.base, timeoutMinutes: site.config.frontend_ws_timeout_minutes, getToken: () => access.wsToken?.(site.base), canConnect: valid,
      onServerTime: time => { if (valid() && site.clockOffset === null) site.clockOffset = time - now() },
      onUpdate: update => { if (valid()) record(site, update) },
      onTimeout: () => { if (valid()) pause(site, '实时连接已达站点时限') },
      onStatus: ({ terminal, reason }) => { if (terminal && valid()) pause(site, reason === 'policy' ? '站点拒绝实时订阅' : '实时连接已停止') },
    }
    const groups = scope === 'all' ? Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) => ids.slice(index * 500, (index + 1) * 500)) : [[]]
    for (const group of groups) {
      if (!valid()) break
      const socket = openSocket(scope, handlers, site.index, group)
      if (valid()) runtime.sockets.push(socket)
      else socket.close()
    }
  }
  function applySnapshot(site, server, retainWindows = false) {
    const id = server.id
    const time = normalizeTimestamp(server.sample_timestamp ?? server.last_updated ?? server.timestamp) ?? 0
    const stamps = runtimes[site.index].stamps.get(id)
    const retained = {}
    if (stamps) for (const [field, sample] of stamps) {
      if (sample.time > time || (retainWindows && (field === 'ping' || field === 'loss'))) retained[field] = sample.value
      else if (!(field in server)) stamps.delete(field)
    }
    return { ...retained, ...applyFields(site, id, normalizeNode(server), time), ...publicIdentity(site, id) }
  }

  function loadList(site) {
    const runtime = runtimes[site.index]
    if (runtime.listTask) return runtime.listTask
    if (runtime.loaded && !runtime.needsList) { subscribe(site, 'all', site.nodes.map(node => node.id)); return }
    const generation = runtime.generation
    const valid = () => generation === runtime.generation && active(site)
    site.loading = true
    const task = (async () => {
      try {
        if (!await ready(site) || !valid()) return
        const { data: result, offset } = await readSnapshot(site, '/api/servers')
        if (!valid()) return
        if (!Array.isArray(result.servers) || !statFields.every(field => Number.isFinite(result.stats?.[field]))) throw new Error('服务器列表或汇总数据无效')
        const ids = new Set(result.servers.map(node => node.id))
        site.nodes = result.servers.map(node => applySnapshot(site, node))
        for (const id of runtime.stamps.keys()) if (!ids.has(id)) runtime.stamps.delete(id)
        site.stats = result.stats
        site.presence = snapshotPresence(result.servers, result.stats)
        if (offset !== null) site.clockOffset = offset
        site.sysConfig = { ...site.config?.sysConfig, ...result.sysConfig }
        site.snapshotAt = now()
        site.error = ''
        runtime.loaded = true
        runtime.needsList = false
        subscribe(site, 'all', [...ids])
        forEachLiveSample(result.latestReportUpdates, update => { if (ids.has(update.serverId)) record(site, update) })
      } catch (error) { if (valid()) failed(site, error) }
    })().finally(() => { if (runtime.listTask === task) { site.loading = false; runtime.listTask = null } })
    runtime.listTask = task
    return task
  }

  function clearMissing(site, id, error) {
    const runtime = runtimes[site.index]
    stopSockets(runtime)
    runtime.stamps.delete(id)
    runtime.needsList = true
    site.nodes = site.nodes.filter(node => node.id !== id)
    site.stats = null
    site.presence = null
    site.snapshotAt = null
    liveHistory.clear()
    pendingHistory.clear()
    rangeVersion++
    detailReady = false
    Object.assign(state.detail, { node: null, rows: [], loading: false, error: error.message })
  }
  async function history(site, id) {
    const detail = state.detail, version = ++rangeVersion, generation = runtimes[site.index].generation
    const valid = () => rangeVersion === version && generation === runtimes[site.index].generation && currentDetail(site, id) && active(site)
    detail.loading = true
    detail.error = ''
    try {
      const rows = await access.get(site.base, `/api/history/all?id=${encodeURIComponent(id)}&hours=${detail.hours}`)
      if (!valid()) return
      if (!Array.isArray(rows)) throw new Error('节点历史数据无效')
      detail.end = now()
      detail.rows = combineRows(rows.map(normalizeNode), liveHistory, detail.hours, detail.end)
      for (const time of liveHistory.keys()) if (time < detail.end - detail.hours * 3600000) liveHistory.delete(time)
      pendingHistory.clear()
    } catch (error) {
      if (!valid()) return
      if (error.status === 404) clearMissing(site, id, error)
      else if ((error.status === 401 || error.status === 403) && !error.staleCredentials) block(site.base, error.status, error)
      else detail.error = error.message
    } finally { if (valid()) detail.loading = false }
  }
  async function loadDetail(site, id) {
    const detail = state.detail, version = routeVersion, runtime = runtimes[site.index], generation = runtime.generation
    const valid = () => version === routeVersion && generation === runtime.generation && currentDetail(site, id) && active(site)
    detailReady = false
    detail.loading = true
    detail.error = ''
    try {
      if (!await ready(site) || !valid()) return
      const { data: server, offset } = await readSnapshot(site, `/api/server?id=${encodeURIComponent(id)}`)
      if (!valid()) return
      if (server.id !== id) throw new Error('节点返回的标识与请求不符')
      if (offset !== null) site.clockOffset = offset
      detail.node = applySnapshot(site, server, true)
      detailReady = true
      site.sysConfig = { ...site.sysConfig, ...server.sysConfig }
      site.error = ''
      if (site.nodes.some(node => node.id === id)) site.nodes = site.nodes.map(node => node.id === id ? detail.node : node)
      if (runtime.mode !== 'all' || !site.nodes.some(node => node.id === id)) subscribe(site, id, [])
      forEachLiveSample(server.latestReportUpdates, update => { if (update.serverId === id) record(site, update) })
      await history(site, id)
    } catch (error) {
      if (!valid()) return
      if (error.status === 404) clearMissing(site, id, error)
      else { failed(site, error); detail.error = error.message; detail.loading = false }
    } finally { if (valid() && !detailReady) detail.loading = false }
  }
  function enter(base) {
    if (disposed || !visible || isHidden() || route === undefined || state.routeError) return
    clockOn()
    if (route) {
      const site = sites[route.site]
      if ((!base || base === site.base) && active(site)) return loadDetail(site, route.id)
    } else return Promise.all(sites.filter(site => (!base || site.base === base) && active(site)).map(loadList))
  }
  function navigate(hash) {
    if (disposed) return
    let next
    try { next = readRoute(hash, sites) }
    catch {
      routeVersion++; rangeVersion++; route = undefined
      state.routeError = '节点链接格式无效'; state.detail = emptyDetail()
      for (const [index, runtime] of runtimes.entries()) { runtime.generation++; runtime.listTask = null; sites[index].loading = false; stopSockets(runtime) }
      clockOff()
      return
    }
    if (route !== undefined && route?.id === next?.id && route?.site === next?.site) return activeLoad
    routeVersion++; rangeVersion++
    detailReady = false
    liveHistory.clear(); pendingHistory.clear()
    state.routeError = ''
    route = next
    for (const [index, runtime] of runtimes.entries()) {
      if (runtime.mode && runtime.mode !== 'all') stopSockets(runtime)
      if (next && runtime.listTask && runtime.mode !== 'all') { runtime.generation++; runtime.listTask = null; sites[index].loading = false }
    }
    state.detail = next ? { ...emptyDetail(), ...next, base: sites[next.site].base, node: sites[next.site].nodes.find(node => node.id === next.id) || null } : emptyDetail()
    activeLoad = enter()
    return activeLoad
  }
  function setVisible(value) {
    if (disposed || visible === value) return activeLoad
    visible = value
    routeVersion++; rangeVersion++
    if (visible) { state.clock = now(); activeLoad = enter(); return activeLoad }
    clockOff()
    detailReady = false
    state.detail.loading = false
    for (const [index, runtime] of runtimes.entries()) {
      runtime.generation++; runtime.listTask = null; runtime.needsList = true
      sites[index].loading = false
      stopSockets(runtime)
    }
  }
  function setHours(hours) {
    if (!route || !HISTORY_HOURS.includes(hours) || state.detail.hours === hours) return
    const site = sites[route.site]
    if (hours > 24 && !site.config?.authorization) return
    state.detail.hours = hours
    state.detail.rows = []
    if (active(site) && detailReady) return history(site, route.id)
  }
  function retry(base = route ? sites[route.site].base : undefined) {
    const targets = sites.filter(site => (!base || site.base === base) && (site.blocked === 403 ? !hasVerificationWidget(site.config) : !site.blocked && (site.error || site.paused || (route?.site === site.index && state.detail.error))))
    return Promise.all(targets.map(site => {
      const paused = site.paused
      if (site.blocked === 403) {
        access.invalidateConfig(site.base)
        site.config = null
        site.blocked = null
      }
      site.paused = false; site.error = ''
      if (route?.site === site.index && detailReady && active(site)) {
        if (paused) subscribe(site, route.id, [])
        if (state.detail.error) return history(site, route.id)
        return
      }
      return enter(site.base)
    }))
  }
  function verified(base, config) {
    const site = sites.find(item => item.base === base)
    if (!site || disposed) return
    site.blocked = null; site.error = ''; site.paused = false
    if (config) configure(site, config)
    else site.config = null
    return enter(base)
  }
  function dispose() { disposed = true; clockOff(); for (const runtime of runtimes) stopSockets(runtime) }
  function detailHash(node) { return `#/server/${encodeURIComponent(node.id)}${sites.length > 1 ? `?site=${node.site}` : ''}` }
  return { state, online, navigate, setVisible, setHours, retry, verified, block, dispose, detailHash }
}
