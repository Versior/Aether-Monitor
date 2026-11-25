import { activeProbes, daysLeft, hasIp, issues, regionName, routes } from './data.js'

export const initialFilters = { group:'全部节点', route:'全部线路', protocol:'全部网络', region:'全部地区', issue:'全部状态', search:'' }
export const displayRules = (settings = {}) => ({ price:settings.show_price === true, expire:settings.show_expire === true, traffic:settings.show_tf === true, network:settings.show_three_net_details === true })
export function filterNodes(nodes, filters, sort, {now, online, rules, settings}) {
  const {group, route, protocol, region, issue, search} = filters
  const result = nodes.filter(n => {
    if (group !== '全部节点' && group !== n.server_group || region !== '全部地区' && region !== n.region || route !== '全部线路' && !routes(n,now).includes(route)) return false
    const v4=hasIp(n,4), v6=hasIp(n,6)
    if (protocol==='双栈' && !(v4&&v6) || protocol==='仅 IPv4' && !(v4&&!v6) || protocol==='仅 IPv6' && !(!v4&&v6) || protocol==='无公网 IP' && (v4||v6)) return false
    const up=online(n), warnings=issues(n,up,rules(n),now)
    if (issue==='在线' && !up || issue==='离线' && up || issue==='需要关注' && !warnings.length) return false
    if (!['全部状态','在线','离线','需要关注'].includes(issue) && !warnings.includes(issue)) return false
    return !search.trim() || [n.name,regionName(n.region),...routes(n,now)].join(' ').toLowerCase().includes(search.trim().toLowerCase())
  })
  const expiryRank=n=>rules(n).expire ? daysLeft(n,now) ?? Infinity : Infinity
  const lossRank=n=>rules(n).network ? Math.max(-1,...activeProbes([n],settings(n)).map(p => typeof n['loss_'+p.key]==='number'?n['loss_'+p.key]:-1)) : -1
  if (sort==='名称') result.sort((a,b)=>a.name.localeCompare(b.name))
  if (sort==='CPU 从高到低') result.sort((a,b)=>(b.cpu??-1)-(a.cpu??-1))
  if (sort==='到期从近到远') result.sort((a,b)=>expiryRank(a)-expiryRank(b))
  if (sort==='丢包从高到低') result.sort((a,b)=>lossRank(b)-lossRank(a))
  return result
}
