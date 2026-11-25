import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { configureStaticHtml } from '../scripts/static-html.mjs'
import { localDemo } from '../demo/plugin.js'

const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, '')
  const apiBase = env.API_BASE || ''
  return {
    root: `${root}/theme`,
    envDir: root,
    base: './',
    define: { 'import.meta.env.AETHER_DEMO': JSON.stringify(command === 'serve' && !apiBase) },
    plugins: [vue(), ...(command === 'serve' && !apiBase ? [localDemo(root)] : []), {
      name: 'aether-api-base',
      transformIndexHtml: html => configureStaticHtml(html, env),
    }],
    server: { host: '127.0.0.1', port: 5175, strictPort: true, fs: { allow: [root] } },
    build: { outDir: `${root}/dist`, emptyOutDir: true, assetsDir: 'assets' },
  }
})
