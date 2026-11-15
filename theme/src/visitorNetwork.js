export function maskIp(ip) {
  if (!ip) return '未获取 IP'
  if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':••••'
  const parts = ip.split('.')
  return `${parts[0]}.${parts[1]}.**.${parts[3]}`
}

export function browserInfo(userAgent) {
  const matched = userAgent.match(/(Edg)\/([\d.]+)/) || userAgent.match(/(Firefox|Chrome|Version)\/([\d.]+)/)
  if (!matched) return { name: '浏览器', version: '未识别' }
  return { name: { Edg: 'Edge', Firefox: 'Firefox', Chrome: 'Chrome', Version: 'Safari' }[matched[1]], version: matched[2] }
}

export function parseTrace(text) {
  return Object.fromEntries(text.split('\n').filter(line => line.includes('=')).map(line => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

export function normalizeIpReport(raw) {
  if (raw.error || !raw.ip) throw new Error('网络信息服务没有返回可用数据。')
  return {
    ip: raw.ip,
    country: raw.location?.country || '未提供',
    countryCode: raw.location?.country_code || '',
    city: raw.location?.city || '未提供',
    state: raw.location?.state || '未提供',
    timezone: raw.location?.timezone || '未提供',
    asn: raw.isp?.asn || '未提供',
    isp: raw.isp?.isp || '未提供',
    org: raw.isp?.org || '未提供',
    riskScore: typeof raw.risk?.risk_score === 'number' ? raw.risk.risk_score : null,
    checks: [
      ['代理', raw.risk?.is_proxy], ['VPN', raw.risk?.is_vpn], ['Tor', raw.risk?.is_tor],
      ['数据中心', raw.risk?.is_datacenter], ['移动网络', raw.risk?.is_mobile],
    ].map(([name, value]) => ({ name, value: typeof value === 'boolean' ? value : null })),
  }
}
