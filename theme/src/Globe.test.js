import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { computed, reactive, ref } from 'vue'

test('WebGL 不可用时提供错误状态，卸载不会再抛空引用异常', () => {
  let mount
  let cleanup
  const sandbox = vm.createContext({
    computed, ref, world: { features: [] },
    defineProps: () => ({ regions: [] }), defineEmits: () => () => {}, watch() {},
    onMounted: callback => { mount = callback }, onUnmounted: callback => { cleanup = callback },
    ResizeObserver: class { disconnect() {} }, cancelAnimationFrame() {},
    document: { removeEventListener() {} },
    createEarthSurface: () => { throw new Error('WebGL 不可用') },
  })
  const script = readFileSync(new URL('./Globe.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
  mount()
  assert.equal(vm.runInContext('globeError.value', sandbox), 'WebGL 不可用')
  assert.doesNotThrow(cleanup)
})

test('汇聚弧线从每个服务器国家到访客位置，同国不重复连线，缺位置时恢复节点线路', () => {
  const sandbox = vm.createContext({
    computed, ref, world: JSON.parse(readFileSync(new URL('../../public/files/world.zh.json', import.meta.url), 'utf8')),
    defineProps: () => reactive({ regions: ['HK', 'JP', 'SG', 'US'], visitorRegion: 'JP', visitorFlow: true }),
    defineEmits: () => () => {}, onMounted() {}, onUnmounted() {}, watch() {}, ResizeObserver: class {},
  })
  const script = readFileSync(new URL('./Globe.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script, sandbox)
  assert.equal(vm.runInContext('connections.value.length', sandbox), 3)
  assert.ok(vm.runInContext(`connections.value.every(path => Math.hypot(...path.at(-1).map((value, axis) => value - visitorLocation.value[axis])) < 1e-10)`, sandbox))
  assert.ok(vm.runInContext(`connections.value.every((path, index) => Math.hypot(...path[0].map((value, axis) => value - located.value.filter(place => place.region !== props.visitorRegion)[index].point[axis])) < 1e-10)`, sandbox))
  vm.runInContext('props.selected = "US"', sandbox)
  assert.ok(vm.runInContext('connections.value.every(path => Math.hypot(...path.at(-1).map((value, axis) => value - visitorLocation.value[axis])) < 1e-10)', sandbox))
  vm.runInContext('props.visitorRegion = "BR"', sandbox)
  assert.equal(vm.runInContext('connections.value.length', sandbox), 4)
  vm.runInContext('props.visitorFlow = false', sandbox)
  assert.equal(vm.runInContext('gathering.value', sandbox), false)
  assert.equal(vm.runInContext('connections.value.length', sandbox), 3)
  vm.runInContext('props.visitorFlow = true; props.visitorRegion = "ZZ"', sandbox)
  assert.equal(vm.runInContext('gathering.value', sandbox), false)
  assert.equal(vm.runInContext('connections.value.length', sandbox), 3)
  vm.runInContext('props.regions = []; props.visitorRegion = "JP"', sandbox)
  assert.equal(vm.runInContext('connections.value.length', sandbox), 0)
})

test('拖动和俯仰旋转时，正面节点贴合地表，背面节点只在球缘提示方向', () => {
  const rings = []
  const greenRings = []
  const glowStrokes = []
  const dashedLines = []
  const leaderOpacity = []
  const markerOpacity = []
  const markerColors = []
  const pulses = []
  const ellipses = []
  let shadowBlur = 0
  let strokeStyle
  let fillStyle
  let currentArc
  const context = new Proxy({}, { get: (_, key) => {
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} })
    if (key === 'createLinearGradient') return () => ({ addColorStop(offset, color) {
      if (offset === 1) leaderOpacity.push(Number(color.match(/,([\d.]+)\)$/)[1]))
    } })
    if (key === 'setLineDash') return pattern => { if (pattern.length) dashedLines.push(pattern) }
    if (key === 'arc') return (x, y, radius) => { currentArc = [x, y, radius]; if (radius >= 4 && radius <= 6) rings.push([x, y]) }
    if (key === 'ellipse') return (x, y, major, minor, angle) => {
      currentArc = [x, y, major]
      ellipses.push([x, y, major, minor, angle])
      if (major >= 4 && major <= 6) rings.push([x, y])
    }
    if (key === 'fill') return () => {
      if (currentArc?.[2] === 1.5 && typeof fillStyle === 'string') {
        markerOpacity.push(Number(fillStyle.match(/,([\d.]+)\)$/)[1]))
        markerColors.push(fillStyle.slice(0, fillStyle.lastIndexOf(',')))
      }
    }
    if (key === 'stroke') return () => {
      if (shadowBlur > 0) glowStrokes.push(shadowBlur)
      if (currentArc?.[2] > 6) pulses.push({ point: currentArc, color: strokeStyle, shadowBlur })
      if (currentArc?.[2] === 6 && typeof strokeStyle === 'string' && /^rgba\((20,128,88|123,235,186),/.test(strokeStyle)) greenRings.push(currentArc)
    }
    return () => {}
  }, set: (_, key, value) => {
    if (key === 'shadowBlur') shadowBlur = value
    if (key === 'strokeStyle') strokeStyle = value
    if (key === 'fillStyle') fillStyle = value
    return true
  } })
  const canvas = { getContext: () => context, setPointerCapture() {}, releasePointerCapture() {} }
  const sandbox = vm.createContext({
    computed, ref, world: JSON.parse(readFileSync(new URL('../../public/files/world.zh.json', import.meta.url), 'utf8')), testCanvas: canvas,
    createEarthSurface: () => ({ canvas, resize() {}, paint() {} }),
    defineProps: () => reactive({ motion: false, light: true, regions: ['HK', 'JP', 'SG', 'TW', 'US', 'DE', 'GB'], selected: '全部地区' }),
    defineEmits: () => () => {}, onMounted() {}, onUnmounted() {}, watch() {},
    ResizeObserver: class {}, IntersectionObserver: class {}, performance: { now: () => 100 },
    window: { devicePixelRatio: 1 }, document: { hidden: false, createElement: () => canvas },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  })
  const script = readFileSync(new URL('./Globe.vue', import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  vm.runInContext(script + '\ncanvas.value = testCanvas; surface = createEarthSurface(); state.width = 600; state.height = 310; prepareScene();', sandbox)
  const labels = vm.runInContext('JSON.stringify(labels.value)', sandbox)
  for (const light of [false, true]) {
    markerColors.length = 0
    vm.runInContext(`props.light = ${light}; paint();`, sandbox)
    assert.equal(new Set(markerColors).size, 7, '深浅色下七个地区节点使用不同颜色')
  }
  vm.runInContext(`pointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 155 });
    pointerMove({ pointerId: 1, clientX: 300 - 27 * radians * 310 / 2.6, clientY: 155 - 15 * radians * 310 / 2.6 });
    draw(100); pointerUp({ pointerId: 1, type: 'pointerup' });`, sandbox)
  assert.ok(vm.runInContext(`['US', 'DE', 'GB'].every(region => {
    const marker = state.markers.find(marker => marker.region === region)
    return Math.hypot(marker.x - 300, marker.y - 310 * .51) >= 310 * .38 - .001
  })`, sandbox), '拖到太平洋方向时，背面欧美节点不能落在澳洲附近')

  for (const light of [false, true]) {
    for (const pitch of [-1.15, 0, 1.15]) {
      for (let degrees = 0; degrees < 360; degrees += 5) {
        rings.length = 0
        vm.runInContext(`props.light = ${light}; state.yaw = ${degrees * Math.PI / 180}; state.pitch = ${pitch}; paint();`, sandbox)
        assert.equal(rings.length, 7, '每个地区保留一个节点圈')
        assert.ok(vm.runInContext(`located.value.every(place => {
          const x = place.point[0] * Math.cos(state.yaw) - place.point[2] * Math.sin(state.yaw)
          const depth = place.point[0] * Math.sin(state.yaw) + place.point[2] * Math.cos(state.yaw)
          const y = place.point[1] * Math.cos(state.pitch) - depth * Math.sin(state.pitch)
          const z = place.point[1] * Math.sin(state.pitch) + depth * Math.cos(state.pitch)
          const marker = state.markers.find(marker => marker.region === place.region)
          const radius = Math.min(state.width * .36, state.height * .38, state.width / 2 - 54)
          return z < 0
            ? Math.abs(Math.hypot(marker.x - state.width / 2, marker.y - state.height * .51) - radius) < .001
            : Math.hypot(marker.x - state.width / 2 - x * radius, marker.y - state.height * .51 + y * radius) < .001
        })`, sandbox), `配色 ${light}、俯仰 ${pitch}、旋转 ${degrees} 度时，节点位置正确`)
      }
    }
  }
  assert.equal(vm.runInContext('JSON.stringify(labels.value)', sandbox), labels, '旋转不移动地区标签')
  vm.runInContext('state.yaw = (114.2 + 180) * radians; state.pitch = -22.3 * radians; paint();', sandbox)
  assert.ok(vm.runInContext('state.markers.every(marker => Number.isFinite(marker.x) && Number.isFinite(marker.y))', sandbox), '节点位于背面中心时不产生无效坐标')
  for (const width of [288, 358, 360.5]) {
    vm.runInContext(`state.width = ${width}; prepareScene();`, sandbox)
    assert.ok(vm.runInContext('state.markers.every(marker => marker.x >= 48 && marker.x <= state.width - 48)', sandbox), '窄屏国旗不遮挡节点圈')
  }
  for (const elapsed of [500, 1500, 2500]) {
    glowStrokes.length = 0
    vm.runInContext(`state.yaw = 108 * radians; state.pitch = 15 * radians; state.elapsed = ${elapsed}; paint();`, sandbox)
    assert.ok(glowStrokes.length <= vm.runInContext('connections.value.length', sandbox), '每条传输线每帧只绘制一次光晕，尾迹不逐段模糊')
  }
  vm.runInContext('props.motion = true; state.last = 5000; state.released = 0; state.velocityX = state.velocityY = 0;', sandbox)
  const yaw = vm.runInContext('state.yaw', sandbox)
  vm.runInContext('draw(5020);', sandbox)
  assert.ok(Math.abs(vm.runInContext('state.yaw', sandbox) - yaw - 20 * .00009) < .000001, '自转约每秒 5°，仍按帧间隔计算')
  vm.runInContext('props.motion = false; state.velocityX = state.velocityY = 0;', sandbox)
  const pausedYaw = vm.runInContext('state.yaw', sandbox)
  vm.runInContext('draw(5040);', sandbox)
  assert.equal(vm.runInContext('state.yaw', sandbox), pausedYaw, '关闭动效时暂停自转')
  vm.runInContext('props.light = true; props.regions = ["HK"]; props.selected = "全部地区"; state.pitch = 0;', sandbox)
  const horizon = (114.2 + 90) * Math.PI / 180
  const samples = [-.25, -.001, .001, .25].map(offset => {
    leaderOpacity.length = markerOpacity.length = 0
    vm.runInContext(`state.yaw = ${horizon + offset}; paint();`, sandbox)
    return [leaderOpacity[0], markerOpacity[0]]
  })
  assert.ok(samples[0][0] > samples[3][0] && samples[3][0] > 0, '正面连线更清楚，背面方向线仍保留')
  assert.ok(Math.abs(samples[1][0] - samples[2][0]) < .01, '跨过球缘时指示线透明度连续，没有突变')
  assert.ok(Math.abs(samples[1][1] - samples[2][1]) < .01, '跨过球缘时中心点平滑变为空心圈')
  assert.equal(samples[0][1], 1)
  assert.equal(samples[3][1], 0)
  vm.runInContext('props.regions = ["HK", "JP", "SG", "TW", "US", "DE", "GB"];', sandbox)
  for (const light of [false, true]) {
    for (const selected of ['全部地区', 'HK', 'US', 'JP']) {
      greenRings.length = 0
      vm.runInContext(`props.light = ${light}; props.visitorRegion = 'JP'; props.selected = '${selected}'; state.yaw = 108 * radians; state.pitch = 15 * radians; paint();`, sandbox)
      assert.equal(greenRings.length, 1, '绿色定位只代表访客国家，筛选不会改变绿色点')
      const japan = vm.runInContext('state.markers.find(marker => marker.region === "JP")', sandbox)
      assert.ok(Math.hypot(greenRings[0][0] - japan.x, greenRings[0][1] - japan.y) < .001, '访客日本与地球上的日本地区位置一致')
    }
  }
  for (const country of ['', 'ZZ']) {
    greenRings.length = 0
    vm.runInContext(`props.visitorRegion = '${country}'; paint();`, sandbox)
    assert.equal(greenRings.length, 0, '未获取或未知访客国家时，不用服务器位置冒充')
  }
  greenRings.length = 0
  vm.runInContext('props.visitorRegion = "BR"; props.regions = []; paint();', sandbox)
  assert.equal(greenRings.length, 1, '访客所在国家没有服务器时仍有独立绿色定位')
  assert.equal(vm.runInContext('state.markers.length', sandbox), 0, '访客位置不混入服务器节点或筛选')
  greenRings.length = 0
  vm.runInContext('state.yaw = (places.BR[0] + 180) * radians; state.pitch = -places.BR[1] * radians; paint();', sandbox)
  const radius = vm.runInContext('Math.min(state.width * .36, state.height * .38, state.width / 2 - 54)', sandbox)
  assert.ok(Math.abs(Math.hypot(greenRings[0][0] - 360.5 / 2, greenRings[0][1] - 310 * .51) - radius) < .001, '访客位于背面时只在球缘提示方向')
  assert.equal(dashedLines.length, 0, '服务器指示线和访客定位圈不会随旋转切换成虚线')
  for (const light of [false, true]) {
    vm.runInContext(`props.light = ${light}; props.motion = true; props.regions = ["HK"]; props.visitorRegion = "JP"; props.selected = "全部地区"; state.yaw = 108 * radians; state.pitch = 15 * radians; state.elapsed = 300;`, sandbox)
    pulses.length = 0
    vm.runInContext('paint();', sandbox)
    assert.equal(pulses.length, 2, '服务器和绿色访客点都有独立波纹')
    const first = [...pulses]
    pulses.length = 0
    vm.runInContext('state.elapsed = 900; paint();', sandbox)
    assert.equal(pulses.length, 2)
    pulses.forEach((pulse, index) => {
      assert.deepEqual(pulse.point.slice(0, 2), first[index].point.slice(0, 2), '波纹扩散时定位中心不晃动')
      assert.ok(pulse.point[2] > first[index].point[2] && pulse.point[2] <= 13, '波纹缓慢扩散，大小保持克制')
      assert.notEqual(pulse.color, first[index].color, '扩散时透明度平滑变化')
      assert.equal(pulse.shadowBlur, 0, '波纹不新增逐帧模糊开销')
    })
    pulses.length = 0
    vm.runInContext('props.visitorRegion = "HK"; paint();', sandbox)
    assert.equal(pulses.length, 1, '访客与服务器同一国家时只画一层绿色波纹')
    pulses.length = 0
    vm.runInContext('props.motion = false; paint();', sandbox)
    assert.equal(pulses.length, 0, '关闭动效或减少动态效果时保留静态定位圈')
  }
  vm.runInContext('props.motion = false; props.visitorRegion = ""; props.regions = ["HK"]; props.selected = "全部地区"; state.width = 600; state.height = 310; state.yaw = 114.2 * radians; state.pitch = 22.3 * radians;', sandbox)
  ellipses.length = 0
  vm.runInContext('paint();', sandbox)
  assert.equal(ellipses.length, 1, '定位圈使用球面投影，不能始终绘制屏幕正圆')
  assert.ok(Math.abs(ellipses[0][2] - ellipses[0][3]) < .001, '节点朝向观察者时圆圈接近正圆')
  ellipses.length = 0
  vm.runInContext('state.yaw = (114.2 + 60) * radians; state.pitch = 0; paint();', sandbox)
  assert.ok(Math.abs(ellipses[0][3] / ellipses[0][2] - Math.cos(22.3 * Math.PI / 180) * .5) < .001, '侧面圆圈按球面法线压缩短轴')
  assert.ok(Math.abs(Math.cos(ellipses[0][4]) * (ellipses[0][0] - 300) + Math.sin(ellipses[0][4]) * (ellipses[0][1] - 310 * .51)) < .001, '椭圆长轴沿球面的切线方向，包含画布 Y 轴翻转')
  ellipses.length = 0
  vm.runInContext('props.motion = true; props.visitorRegion = "JP"; state.elapsed = 600; paint();', sandbox)
  assert.equal(ellipses.length, 4, '服务器与访客的固定圈、扩散波纹都使用球面透视')
  for (const [pulse, fixed] of [[ellipses[0], ellipses[1]], [ellipses[2], ellipses[3]]]) {
    assert.deepEqual(pulse.slice(0, 2), fixed.slice(0, 2), '扩散波纹与定位圈中心重合')
    assert.equal(pulse[4], fixed[4], '扩散波纹和定位圈方向一致')
    assert.ok(Math.abs(pulse[3] / pulse[2] - fixed[3] / fixed[2]) < .001, '扩散波纹沿相同的球面方向扩散')
  }
  ellipses.length = 0
  vm.runInContext('props.motion = false; props.visitorRegion = ""; state.yaw = (114.2 + 90) * radians; state.pitch = 0; paint();', sandbox)
  assert.ok(ellipses[0][3] <= .6, '球缘圆圈压缩为极细的方向标记')
  ellipses.length = 0
  vm.runInContext('state.yaw = (114.2 + 120) * radians; paint();', sandbox)
  assert.ok(ellipses[0][3] <= .6, '背面球缘标记不会恢复成假位置的正圆')
})
