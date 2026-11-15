import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { localDemo } from '../demo/plugin.js'

const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '')
  const apiBase = env.API_BASE || ''
  if (apiBase && new URL(apiBase).protocol !== 'https:' && new URL(apiBase).protocol !== 'http:') throw new Error('API_BASE must be an HTTP(S) URL')
  return {
    root: `${root}/theme`,
    envDir: root,
    base: './',
    define: { 'import.meta.env.AETHER_DEMO': JSON.stringify(command === 'serve' && !apiBase) },
    plugins: [vue(), ...(command === 'serve' && !apiBase ? [localDemo(root)] : []), {
      name: 'aether-api-base',
      transformIndexHtml: () => apiBase ? [{ tag: 'meta', attrs: { name: 'apiBase', content: apiBase }, injectTo: 'head' }] : [],
    }],
    server: { host: '127.0.0.1', port: 5175, strictPort: true, fs: { allow: [root] } },
    build: { outDir: `${root}/dist`, emptyOutDir: true, assetsDir: 'assets' },
  }
})
