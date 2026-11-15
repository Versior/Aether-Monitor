import { readFile } from 'node:fs/promises'
import { WebSocketServer, WebSocket } from 'ws'
import { demoNodes, demoMetrics } from './data.js'

const offlineAt = Date.now() - 3600000
const sysConfig = { show_price: true, show_expire: true, show_tf: true, show_three_net_details: true, custom_ct_name: '电信', custom_cu_name: '联通', custom_cm_name: '移动', node_1_name: '边缘探测', latency_window: { points: 25, hours: 2 } }
const config = { version: '2.8.7 · Local demo', site_title: 'Aether · 以太 — 本地示例', is_public: true, authorization: false, turnstile_enabled: false, preferred_theme: 'dark', theme_options: { aether: { layout: 'compact', view: 'card', appearance: 'dark', globe: true, motion: true } }, ...sysConfig }
const sample = (node, index, time) => ({ ...demoMetrics(node, index, time, Math.sin(time / 12000 + index) * 4), last_updated: time })
const history = (node, index, now, hours = 2) => Array.from({ length: Math.max(2, Math.ceil(hours * 12) + 1) }, (_, step) => sample(node, index, now - (Math.ceil(hours * 12) - step) * 300000))
const server = (node, index, now) => {
  const last = node.online ? now : offlineAt
  const rows = history(node, index, last)
  return { ...sample(node, index, last), id: node.id, name: node.name, region: node.region, server_group: node.group, tags: node.routes.split(',').filter(Boolean).map(route => `线路-${route}`).join(','), price: index === 7 ? '' : index === 5 ? '120' : String(6 + index * 2), currency: index === 5 ? '€' : index === 2 ? '¥' : '$', billing_cycle: index === 5 ? 'year' : 'month', expire_date: node.days === null ? '' : new Date(now + node.days * 86400000).toISOString().slice(0, 10), traffic_limit: index === 7 ? 0 : 1000, traffic_calc_type: index === 3 ? 'max' : 'total', ping_mode: 'tcp', node_1: index === 0 ? 'edge.example.invalid:443' : '', ping: rows.map(row => ({ ts: row.timestamp, ct: row.ping_ct, cu: row.ping_cu, cm: row.ping_cm, node_1: row.ping_node_1 })) }
}

export function localDemo(root) {
  return {
    name: 'aether-local-demo',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const now = Date.now()
        let data
        if (url.pathname === '/api/config') data = config
        if (url.pathname === '/api/servers') data = { servers: demoNodes.map((node, index) => server(node, index, now)), sysConfig }
        if (['/api/server', '/api/history/all'].includes(url.pathname)) {
          const index = demoNodes.findIndex(node => node.id === url.searchParams.get('id'))
          if (index < 0) { res.writeHead(404); res.end(); return }
          data = url.pathname === '/api/server' ? server(demoNodes[index], index, now) : history(demoNodes[index], index, demoNodes[index].online ? now : offlineAt, Number(url.searchParams.get('hours') || 1))
        }
        if (url.pathname === '/__theme/network-info') data = { ip: '203.0.113.71', isp: { asn: 'AS65536', org: '示例网络组织', isp: '示例运营商' }, location: { country: 'Japan', country_code: 'JP', city: 'Tokyo', timezone: 'Asia/Tokyo' }, risk: { is_proxy: false, is_vpn: false, is_tor: false, is_datacenter: true, is_mobile: false, risk_score: 0 } }
        if (url.pathname === '/cdn-cgi/trace') { res.setHeader('Content-Type', 'text/plain'); res.end('ip=203.0.113.71\nloc=JP\ntls=TLSv1.3\n'); return }
        if (url.pathname === '/admin') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="zh-CN"><meta charset="utf-8"><title>Aether 本地示例</title><p>这是本地主题示例。管理后台由 CF-Server-Monitor 提供，请打开自己的监控站点。</p><a href="/">返回主题</a></html>'); return }
        if (/^\/(flags\/[a-z]{2}\.svg|os-icons\/[\w-]+\.(svg|png|webp|ico))$/.test(url.pathname)) {
          res.setHeader('Content-Type', url.pathname.endsWith('.svg') ? 'image/svg+xml' : url.pathname.endsWith('.webp') ? 'image/webp' : 'image/png')
          res.end(await readFile(`${root}/public${url.pathname}`)); return
        }
        if (data === undefined) { next(); return }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(data))
      })
      const sockets = new WebSocketServer({ noServer: true })
      vite.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url.split('?')[0] === '/api/ws') sockets.handleUpgrade(req, socket, head, client => sockets.emit('connection', client, req))
      })
      const feed = setInterval(() => {
        const now = Date.now()
        const message = JSON.stringify({ type: 'batchUpdate', ts: now, updates: demoNodes.flatMap((node, index) => node.online ? [{ serverId: node.id, samples: [{ ts: now, data: sample(node, index, now) }] }] : []) })
        for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send(message)
      }, 10000)
      vite.httpServer.on('close', () => { clearInterval(feed); sockets.close() })
    },
  }
}
