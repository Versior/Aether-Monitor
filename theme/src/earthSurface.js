import dayUrl from './assets/earth-day.webp'
import normalUrl from './assets/earth-normal.webp'
import waterUrl from './assets/earth-water.webp'

export function createEarthSurface(onReady, onError) {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('当前浏览器未启用 WebGL，无法绘制地球纹理')
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault()
    onError('地球图形上下文已丢失，请刷新页面重新加载。')
  })
  const program = gl.createProgram()
  const shaders = [
    [gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 screen;
      void main() {
        screen = position;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `],
    [gl.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 screen;
      uniform sampler2D dayMap;
      uniform sampler2D normalMap;
      uniform sampler2D waterMap;
      uniform vec2 rotation;
      uniform float lightMode;
      vec3 rotate(vec3 point) {
        float x = point.x * cos(rotation.x) - point.z * sin(rotation.x);
        float z = point.x * sin(rotation.x) + point.z * cos(rotation.x);
        return vec3(x, point.y * cos(rotation.y) - z * sin(rotation.y), point.y * sin(rotation.y) + z * cos(rotation.y));
      }
      void main() {
        float distance = dot(screen, screen);
        if (distance >= 1.0) discard;
        vec3 normal = vec3(screen, sqrt(1.0 - distance));
        vec3 upright = vec3(normal.x, normal.y * cos(rotation.y) + normal.z * sin(rotation.y), -normal.y * sin(rotation.y) + normal.z * cos(rotation.y));
        vec3 world = vec3(upright.x * cos(rotation.x) + upright.z * sin(rotation.x), upright.y, -upright.x * sin(rotation.x) + upright.z * cos(rotation.x));
        vec2 uv = vec2(atan(world.x, world.z) / 6.2831853 + 0.5, asin(world.y) / 3.1415927 + 0.5);
        vec3 detail = texture2D(normalMap, uv).rgb * 2.0 - 1.0;
        vec3 east = normalize(vec3(world.z, 0.0, -world.x));
        vec3 north = cross(world, east);
        vec3 relief = rotate(normalize(world + east * detail.x * 0.28 + north * detail.y * 0.28));
        vec3 sun = normalize(vec3(-0.75, 0.4, 0.65));
        float diffuse = max(dot(relief, sun), 0.0);
        vec3 terrain = texture2D(dayMap, uv).rgb;
        float luminance = dot(terrain, vec3(0.299, 0.587, 0.114));
        float water = texture2D(waterMap, uv).r;
        vec3 land = mix(vec3(0.16, 0.24, 0.32), vec3(0.74, 0.82, 0.88), luminance);
        vec3 ocean = mix(vec3(0.055, 0.12, 0.19), vec3(0.16, 0.27, 0.36), luminance);
        vec3 daylightLand = mix(vec3(0.59, 0.70, 0.78), vec3(0.94, 0.97, 0.98), luminance);
        vec3 daylightOcean = mix(vec3(0.34, 0.52, 0.68), vec3(0.58, 0.73, 0.84), luminance);
        land = mix(land, daylightLand, lightMode);
        ocean = mix(ocean, daylightOcean, lightMode);
        float illumination = mix(0.055 + diffuse * 1.3, 0.68 + diffuse * 0.42, lightMode);
        vec3 color = mix(land, ocean, water * 0.85) * illumination;
        float specular = pow(max(dot(reflect(-sun, relief), vec3(0.0, 0.0, 1.0)), 0.0), 42.0) * water;
        color += vec3(0.48, 0.7, 0.84) * specular * mix(0.22, 0.08, lightMode);
        float rim = pow(1.0 - normal.z, 3.5);
        color += vec3(0.20, 0.43, 0.64) * rim * (0.13 + diffuse * mix(0.5, 0.15, lightMode));
        gl_FragColor = vec4(color, smoothstep(0.0, 0.008, 1.0 - distance));
      }
    `],
  ].map(([type, source]) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
    gl.attachShader(program, shader)
    return shader
  })
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const rotation = gl.getUniformLocation(program, 'rotation')
  const lightMode = gl.getUniformLocation(program, 'lightMode')
  const images = []
  const textures = [dayUrl, normalUrl, waterUrl].map((url, index) => {
    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + index)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, ['dayMap', 'normalMap', 'waterMap'][index]), index)
    const image = new Image()
    image.onload = () => {
      gl.activeTexture(gl.TEXTURE0 + index)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
      if (images.every(image => image.complete && image.naturalWidth)) onReady()
    }
    image.onerror = () => onError('地球纹理加载失败，请刷新页面重试。')
    image.src = url
    images.push(image)
    return texture
  })
  return {
    canvas,
    resize(size) {
      canvas.width = canvas.height = size
      gl.viewport(0, 0, size, size)
    },
    paint(yaw, pitch, light) {
      gl.uniform2f(rotation, yaw, pitch)
      gl.uniform1f(lightMode, light ? 1 : 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      images.forEach(image => { image.onload = image.onerror = null })
      textures.forEach(texture => gl.deleteTexture(texture))
      shaders.forEach(shader => gl.deleteShader(shader))
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
