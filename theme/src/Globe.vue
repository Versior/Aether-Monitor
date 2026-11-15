<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import world from '../../public/files/world.zh.json'
import { createEarthSurface } from './earthSurface.js'
import { flag, regionName } from './data.js'

const props = defineProps({ motion: Boolean, light: Boolean, regions: { type: Array, required: true }, selected: String, visitorRegion: String })
const emit = defineEmits(['select'])
const canvas = ref(null)
const dragging = ref(false)
const globeError = ref('')
const flagInset = ref(8)
const radians = Math.PI / 180
const vector = ([longitude, latitude]) => [Math.cos(latitude * radians) * Math.sin(longitude * radians), Math.sin(latitude * radians), Math.cos(latitude * radians) * Math.cos(longitude * radians)]
const places = Object.fromEntries(world.features.map(feature => {
  const contours = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map(polygon => polygon[0])
  const points = contours.reduce((largest, polygon) => polygon.length > largest.length ? polygon : largest, [])
  const sum = points.reduce((result, [lon, lat]) => [result[0] + Math.cos(lat * radians) * Math.cos(lon * radians), result[1] + Math.cos(lat * radians) * Math.sin(lon * radians), result[2] + Math.sin(lat * radians)], [0, 0, 0])
  return [feature.properties.iso_a2, [Math.atan2(sum[1], sum[0]) / radians, Math.atan2(sum[2], Math.hypot(sum[0], sum[1])) / radians]]
}))
Object.assign(places, { HK: [114.2, 22.3], SG: [103.8, 1.3], TW: [121, 24], JP: [138, 37], KR: [127.5, 36.5] })
const markerPalette = [
  ['49,138,199', '109,198,255'],
  ['121,85,196', '188,157,255'],
  ['196,76,92', '255,146,166'],
  ['170,116,23', '242,196,105'],
  ['19,128,155', '104,219,246'],
  ['171,65,140', '235,145,212'],
  ['88,104,192', '156,178,255'],
]
const regionCodes = computed(() => props.regions.join(','))
const located = computed(() => regionCodes.value.split(',').filter(region => places[region]).map((region, index) => ({ region, point: vector(places[region]), colors: markerPalette[index % markerPalette.length] })))
const visitorLocation = computed(() => places[props.visitorRegion] ? vector(places[props.visitorRegion]) : null)
const labels = computed(() => located.value.map((place, index) => ({
  region: place.region,
  right: index % 2 === 1,
  top: located.value.length <= 2 ? .5 : .22 + Math.floor(index / 2) * .56 / (Math.ceil(located.value.length / 2) - 1),
})))
const connections = computed(() => {
  const source = located.value.find(place => place.region === props.selected) || located.value[0]
  return located.value.filter(target => target !== source).map(target => {
    const dot = source.point.reduce((sum, value, axis) => sum + value * target.point[axis], 0)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
    const axis = Math.abs(source.point[1]) < .9 ? [0, 1, 0] : [1, 0, 0]
    const tangent = dot < -.9999 ? [source.point[1] * axis[2] - source.point[2] * axis[1], source.point[2] * axis[0] - source.point[0] * axis[2], source.point[0] * axis[1] - source.point[1] * axis[0]] : null
    const tangentLength = tangent ? Math.hypot(...tangent) : 1
    return Array.from({ length: 65 }, (_, step) => {
      const progress = step / 64
      const altitude = 1 + Math.sin(progress * Math.PI) * (.04 + angle * .025)
      return source.point.map((value, axis) => {
        if (angle < .0001) return value * altitude
        if (tangent) return (value * Math.cos(progress * Math.PI) + tangent[axis] / tangentLength * Math.sin(progress * Math.PI)) * altitude
        return (value * Math.sin((1 - progress) * angle) + target.point[axis] * Math.sin(progress * angle)) / Math.sin(angle) * altitude
      })
    })
  })
})
const state = { yaw: 108 * radians, pitch: 15 * radians, width: 0, height: 0, frame: 0, last: 0, elapsed: 0, markers: [], visible: true, pointer: null, x: 0, y: 0, startX: 0, startY: 0, pointerTime: 0, velocityX: 0, velocityY: 0, moved: false, released: -5000 }
let context
let backdrop
let surface
let visibleObserver

function paint() {
  const { width, height } = state
  const cx = width / 2
  const cy = height * .51
  const radius = Math.min(width * .36, height * .38, width / 2 - 54)
  const cosYaw = Math.cos(state.yaw)
  const sinYaw = Math.sin(state.yaw)
  const cosPitch = Math.cos(state.pitch)
  const sinPitch = Math.sin(state.pitch)
  const rotate = ([x, y, z]) => {
    const horizontal = x * cosYaw - z * sinYaw
    const depth = x * sinYaw + z * cosYaw
    return [horizontal, y * cosPitch - depth * sinPitch, y * sinPitch + depth * cosPitch]
  }
  const screen = point => [cx + point[0] * radius, cy - point[1] * radius]
  const surfaceRing = (px, py, point, size) => context.ellipse(px, py, size, Math.max(.5, size * point[2]), Math.atan2(-point[1], point[0]) + Math.PI / 2, 0, Math.PI * 2)
  const visible = point => point[2] >= 0 || Math.hypot(point[0], point[1]) > 1.005
  context.clearRect(0, 0, width, height)
  context.drawImage(backdrop, 0, 0, width, height)
  surface.paint(state.yaw, state.pitch, props.light)
  context.drawImage(surface.canvas, cx - radius, cy - radius, radius * 2, radius * 2)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const [index, connection] of connections.value.entries()) {
    const points = connection.map(rotate)
    const color = props.light ? '7,121,171' : '67,215,249'
    context.beginPath()
    points.forEach((point, step) => {
      if (!visible(point)) return
      context[step && visible(points[step - 1]) ? 'lineTo' : 'moveTo'](...screen(point))
    })
    context.lineWidth = 1.8
    context.strokeStyle = props.light ? 'rgba(244,252,255,.45)' : 'rgba(25,111,155,.2)'
    context.stroke()
    context.lineWidth = .8
    context.shadowColor = `rgba(${color},.5)`
    context.shadowBlur = props.light ? 3 : 5
    context.strokeStyle = `rgba(${color},${props.light ? .7 : .6})`
    context.stroke()
    context.shadowBlur = 0
    const progress = (state.elapsed / (4000 + index % 3 * 700) + index * .173) % 1
    const pointAt = progress => {
      const position = progress * 64
      const step = Math.floor(position)
      const fraction = position - step
      return points[step].map((value, axis) => value + (points[step + 1][axis] - value) * fraction)
    }
    for (let tail = 15; tail >= 0; tail--) {
      const end = progress - tail * .004
      if (end <= .004) continue
      const point = pointAt(end)
      const previous = pointAt(end - .004)
      if (!visible(point) || !visible(previous)) continue
      context.strokeStyle = `rgba(${color},${(1 - tail / 16) * .95})`
      context.lineWidth = .5 + (1 - tail / 16) * .8
      context.beginPath()
      context.moveTo(...screen(previous))
      context.lineTo(...screen(point))
      context.stroke()
    }
    const head = pointAt(progress)
    if (visible(head)) {
      context.shadowBlur = props.light ? 3 : 5
      context.fillStyle = props.light ? '#0c88b9' : '#d9faff'
      context.beginPath()
      context.arc(...screen(head), 1.1, 0, Math.PI * 2)
      context.fill()
    }
    context.shadowBlur = 0
  }
  context.restore()

  context.save()
  context.lineCap = 'round'
  context.setLineDash([])
  const markerOutline = props.light ? 'rgba(248,251,255,.35)' : 'rgba(9,18,31,.5)'
  state.markers = []
  for (const [index, place] of located.value.entries()) {
    const point = rotate(place.point)
    const front = point[2] >= 0
    const visibility = Math.max(0, Math.min(1, (point[2] + .18) / .36))
    const prominence = visibility * visibility * (3 - 2 * visibility)
    const selected = place.region === props.selected
    const markerColor = selected ? props.light ? '30,109,190' : '124,185,255' : place.colors[props.light ? 0 : 1]
    const label = labels.value[index]
    const projectedLength = Math.hypot(point[0], point[1])
    const [px, py] = screen(front ? point : projectedLength > .0001 ? [point[0] / projectedLength, point[1] / projectedLength, 0] : [label.right ? 1 : -1, 0, 0])
    const labelX = label.right ? width - flagInset.value - 30 : flagInset.value + 30
    const labelY = height * label.top
    const lineColor = context.createLinearGradient(labelX, labelY, px, py)
    lineColor.addColorStop(0, `rgba(${markerColor},${selected ? .5 : .25})`)
    lineColor.addColorStop(1, `rgba(${markerColor},${selected ? .4 + prominence * .4 : .28 + prominence * .32})`)
    context.beginPath()
    context.moveTo(labelX, labelY)
    context.lineTo(px, py)
    context.strokeStyle = markerOutline
    context.lineWidth = 1.3
    context.stroke()
    context.strokeStyle = lineColor
    context.lineWidth = .7
    context.stroke()
    if (props.motion && place.region !== props.visitorRegion) {
      const pulse = (state.elapsed / 2400 + index * .19) % 1
      context.beginPath()
      surfaceRing(px, py, point, (selected ? 7.5 : 6.5) + pulse * 4.5)
      context.strokeStyle = `rgba(${markerColor},${Math.sin(pulse * Math.PI) ** 2 * (selected ? .5 : .32) * (.35 + prominence * .65)})`
      context.lineWidth = .7
      context.stroke()
    }
    context.beginPath()
    surfaceRing(px, py, point, selected ? 6 : 4)
    context.strokeStyle = markerOutline
    context.lineWidth = 1.8
    context.stroke()
    context.strokeStyle = `rgba(${markerColor},${.65 + prominence * .35})`
    context.lineWidth = selected ? 1 : .8
    context.stroke()
    context.fillStyle = `rgba(${markerColor},${prominence})`
    context.beginPath()
    context.arc(px, py, selected ? 2 : 1.5, 0, Math.PI * 2)
    context.fill()
    state.markers.push({ region: place.region, x: px, y: py })
  }
  if (visitorLocation.value) {
    const point = rotate(visitorLocation.value)
    const front = point[2] >= 0
    const visibility = Math.max(0, Math.min(1, (point[2] + .18) / .36))
    const prominence = visibility * visibility * (3 - 2 * visibility)
    const projectedLength = Math.hypot(point[0], point[1])
    const [px, py] = screen(front ? point : projectedLength > .0001 ? [point[0] / projectedLength, point[1] / projectedLength, 0] : [1, 0, 0])
    const color = props.light ? '20,128,88' : '123,235,186'
    if (props.motion) {
      const pulse = (state.elapsed / 2400 + .35) % 1
      context.beginPath()
      surfaceRing(px, py, point, 8 + pulse * 5)
      context.strokeStyle = `rgba(${color},${Math.sin(pulse * Math.PI) ** 2 * .55 * (.35 + prominence * .65)})`
      context.lineWidth = .9
      context.stroke()
    }
    context.beginPath()
    surfaceRing(px, py, point, 6)
    context.strokeStyle = markerOutline
    context.lineWidth = 2.5
    context.stroke()
    context.strokeStyle = `rgba(${color},${.65 + prominence * .35})`
    context.lineWidth = 1.2
    context.stroke()
    context.fillStyle = `rgba(${color},${prominence})`
    context.beginPath()
    context.arc(px, py, 2.3, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function draw(time) {
  const delta = state.last ? Math.min(time - state.last, 40) : 0
  state.last = time
  if (props.motion) state.elapsed += delta
  if (!dragging.value) {
    state.yaw += state.velocityX * delta
    state.pitch = Math.max(-1.15, Math.min(1.15, state.pitch + state.velocityY * delta))
    const friction = Math.exp(-delta / 280)
    state.velocityX *= friction
    state.velocityY *= friction
    if (props.motion && time - state.released > 3500) state.yaw += delta * .00009
  }
  paint()
  if (state.visible && !document.hidden && (props.motion || dragging.value || Math.abs(state.velocityX) + Math.abs(state.velocityY) > .00001)) state.frame = requestAnimationFrame(draw)
}
function restart() {
  cancelAnimationFrame(state.frame)
  if (globeError.value) return
  state.last = 0
  if (!context || !state.width) return
  if (!state.visible || document.hidden) return
  state.frame = requestAnimationFrame(draw)
}
function prepareScene() {
  if (globeError.value) return
  const { width, height } = state
  const cx = width / 2
  const cy = height * .51
  const radius = Math.min(width * .36, height * .38, width / 2 - 54)
  flagInset.value = Math.max(8, cx - radius - 44)
  const scale = Math.min(window.devicePixelRatio, 2)
  canvas.value.width = Math.round(width * scale)
  canvas.value.height = Math.round(height * scale)
  context = canvas.value.getContext('2d')
  context.setTransform(scale, 0, 0, scale, 0, 0)
  backdrop = document.createElement('canvas')
  backdrop.width = canvas.value.width
  backdrop.height = canvas.value.height
  const background = backdrop.getContext('2d')
  background.scale(scale, scale)
  const glow = background.createRadialGradient(cx, cy, radius * .85, cx, cy, radius * 1.38)
  glow.addColorStop(0, '#779dbb00')
  glow.addColorStop(.35, props.light ? '#7e9ab610' : '#7a9dbf18')
  glow.addColorStop(.55, props.light ? '#7e9ab606' : '#6e91b00a')
  glow.addColorStop(1, '#779dbb00')
  background.fillStyle = glow
  background.fillRect(0, 0, width, height)
  surface.resize(Math.round(radius * 2 * scale))
  paint()
  restart()
}
function pointerDown(event) {
  if (event.button !== 0 || state.pointer !== null) return
  state.pointer = event.pointerId
  state.startX = state.x = event.clientX
  state.startY = state.y = event.clientY
  state.pointerTime = performance.now()
  state.velocityX = state.velocityY = 0
  state.moved = false
  dragging.value = true
  canvas.value.setPointerCapture(event.pointerId)
  restart()
}
function pointerMove(event) {
  if (event.pointerId !== state.pointer) return
  const delta = Math.max(8, performance.now() - state.pointerTime)
  const dx = event.clientX - state.x
  const dy = event.clientY - state.y
  const sensitivity = 2.6 / Math.min(state.width, state.height)
  state.yaw -= dx * sensitivity
  state.pitch = Math.max(-1.15, Math.min(1.15, state.pitch + dy * sensitivity))
  state.velocityX = -.65 * dx * sensitivity / delta + state.velocityX * .35
  state.velocityY = .65 * dy * sensitivity / delta + state.velocityY * .35
  state.x = event.clientX
  state.y = event.clientY
  state.pointerTime = performance.now()
  if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 4) state.moved = true
}
function pointerUp(event) {
  if (event.pointerId !== state.pointer) return
  dragging.value = false
  state.pointer = null
  state.released = performance.now()
  canvas.value.releasePointerCapture(event.pointerId)
  if (!state.moved && event.type !== 'pointercancel') {
    const bounds = canvas.value.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const marker = state.markers.find(marker => Math.hypot(marker.x - x, marker.y - y) < 12)
    if (marker) emit('select', marker.region)
  }
  if (!props.motion || performance.now() - state.pointerTime > 100) state.velocityX = state.velocityY = 0
  restart()
}
function keyboardRotate(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  state.yaw += event.key === 'ArrowLeft' ? -.13 : event.key === 'ArrowRight' ? .13 : 0
  state.pitch = Math.max(-1.15, Math.min(1.15, state.pitch + (event.key === 'ArrowUp' ? .13 : event.key === 'ArrowDown' ? -.13 : 0)))
  state.released = performance.now()
  restart()
}
const observer = new ResizeObserver(entries => {
  state.width = entries[0].contentRect.width
  state.height = entries[0].contentRect.height
  prepareScene()
})
onMounted(() => {
  try { surface = createEarthSurface(restart, message => { globeError.value = message; cancelAnimationFrame(state.frame) }) }
  catch (cause) { globeError.value = cause.message; return }
  observer.observe(canvas.value)
  visibleObserver = new IntersectionObserver(entries => { state.visible = entries[0].isIntersecting; restart() })
  visibleObserver.observe(canvas.value)
  document.addEventListener('visibilitychange', restart)
})
watch(() => props.light, prepareScene)
watch([() => props.motion, regionCodes, () => props.selected, () => props.visitorRegion], restart)
onUnmounted(() => {
  surface?.dispose()
  observer.disconnect()
  visibleObserver?.disconnect()
  cancelAnimationFrame(state.frame)
  document.removeEventListener('visibilitychange', restart)
})
</script>

<template>
  <div class="globe-visual" :style="{ '--flag-inset': flagInset + 'px' }">
    <canvas ref="canvas" v-show="!globeError" class="globe-canvas" :class="{ dragging }" :title="visitorLocation ? '绿色点：访客 IP 归属国家 · ' + regionName(visitorRegion) + '（国家级示意）' : ''" aria-label="全球服务器分布，可拖动或使用方向键旋转，绿色点代表访客 IP 归属国家" role="img" tabindex="0" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @keydown="keyboardRotate" />
    <p v-if="globeError" class="globe-error" role="status">{{ globeError }}</p>
    <div v-else class="globe-locations" aria-label="地球地区标识">
      <button v-for="label in labels" :key="label.region" class="globe-location" :class="{ right: label.right, selected: label.region === selected }" :style="{ top: label.top * 100 + '%' }" :title="regionName(label.region)" :aria-label="'地球地区：' + regionName(label.region)" :aria-pressed="selected === label.region" @click="emit('select', label.region)"><img v-if="flag(label.region)" :src="flag(label.region)" alt=""></button>
    </div>
  </div>
</template>
