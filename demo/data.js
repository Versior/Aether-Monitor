const started = Date.now()
export const demoNodes = [
  { id: 'demo-harbor', name: 'Harbor · 香港', region: 'HK', group: '亚太', routes: 'CN2 GIA', v4: '1', v6: '1', cpu: 24, ram: 41, disk: 32, ping: 28, days: 83, online: true },
  { id: 'demo-sakura', name: 'Sakura · 东京', region: 'JP', group: '亚太', routes: '4837', v4: '1', v6: '0', cpu: 16, ram: 28, disk: 46, ping: 47, days: 5, online: true },
  { id: 'demo-strait', name: 'Strait · 新加坡', region: 'SG', group: '亚太', routes: 'CMI', v4: '1', v6: '1', cpu: 38, ram: 53, disk: 24, ping: 62, days: 126, online: true },
  { id: 'demo-bamboo', name: 'Bamboo · 台北', region: 'TW', group: '亚太', routes: '9929', v4: '0', v6: '1', cpu: 8, ram: 19, disk: 16, ping: 36, days: 49, online: true },
  { id: 'demo-pacific', name: 'Pacific · 洛杉矶', region: 'US', group: '北美', routes: 'CN2 GIA,4837', v4: '1', v6: '1', cpu: 84, ram: 88, disk: 52, ping: 148, days: 3, online: true },
  { id: 'demo-rhine', name: 'Rhine · 法兰克福', region: 'DE', group: '欧洲', routes: '普通线路', v4: '1', v6: '1', cpu: 12, ram: 36, disk: 29, ping: 182, days: 211, online: true },
  { id: 'demo-atlas', name: 'Atlas · 伦敦', region: 'GB', group: '欧洲', routes: '4837', v4: '1', v6: '0', cpu: 0, ram: 0, disk: 44, ping: 0, days: -2, online: false },
  { id: 'demo-island', name: 'Island · 未标地区', region: 'ZZ', group: '亚太', routes: '', v4: '0', v6: '0', cpu: 0, ram: 0, disk: 21, ping: 0, days: null, online: false },
].map((node, index) => ({
  ...node,
  cores: [4, 2, 4, 2, 8, 4, 2, 1][index],
  ramTotal: [4096, 2048, 8192, 2048, 16384, 8192, 2048, 1024][index],
  diskTotal: [81920, 40960, 163840, 30720, 327680, 163840, 40960, 20480][index],
  loss: index === 4 ? [2, 1, 3] : index === 1 ? [0, 1, 0] : index === 2 ? [0, 0, 2] : [0, 0, 0],
  bootTime: started - (index + 2) * 86400000,
}))

export function demoMetrics(node, index, timestamp, wave = 0) {
  return {
    timestamp, cpu: node.online ? Math.max(0, node.cpu + wave) : 0,
    ram_total: node.ramTotal, ram_used: node.ramTotal * node.ram / 100,
    disk_total: node.diskTotal, disk_used: node.diskTotal * node.disk / 100,
    swap_total: index === 0 ? 2048 : 0, swap_used: index === 0 ? 128 : 0,
    net_in_speed: node.online ? (index + 1) * (285000 + wave * 15000) : 0,
    net_out_speed: node.online ? (index + 1) * (94000 + wave * 3000) : 0,
    net_rx: (index + 1) * 128e9, net_tx: (index + 1) * 32e9,
    net_rx_monthly: index === 4 ? 950 * 1024 ** 3 : (index + 1) * 24e9,
    net_tx_monthly: index === 4 ? 100 * 1024 ** 3 : (index + 1) * 6e9,
    ping_ct: index === 3 ? 'false' : node.ping + Math.max(0, wave),
    ping_cu: node.ping + 7 + Math.max(0, wave), ping_cm: node.ping + 12 + Math.max(0, wave),
    loss_ct: index === 3 ? 'false' : node.loss[0], loss_cu: node.loss[1], loss_cm: node.loss[2],
    ping_node_1: index === 0 ? 12 + Math.max(0, wave) : null,
    loss_node_1: index === 0 ? 0 : null,
    ip_v4: node.v4, ip_v6: node.v6, cpu_cores: node.cores,
    cpu_info: 'AMD EPYC · 测试配置', os: index % 2 ? 'Debian 12' : 'Ubuntu 24.04', arch: 'x86_64',
    boot_time: String(node.bootTime), load_avg: index === 4 ? '6.82 5.71 4.38' : '0.42 0.38 0.31',
    processes: 96 + index * 13, tcp_conn: 42 + index * 7, udp_conn: 12 + index,
    kernel_version: '6.8.0-test', agent_version: 'local-demo',
    ...(index === 4 ? { gpu_info: JSON.stringify([{ id: '0', name: 'NVIDIA RTX 3060 · 测试', info: 34, mem_used: 2048, mem_total: 12288, power: 72 }]) } : {}),
    ...(index < 6 ? { disk: { read_bps: 524288 + Math.max(0, wave) * 20000, write_bps: 131072, read_iops: 82, write_iops: 26, await_ms: 1.8, util: 12 } } : {}),
  }
}
