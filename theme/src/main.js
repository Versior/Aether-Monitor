import { createApp } from 'vue'
import { initConfig } from '../../src/frontend/utils/config.js'
import App from './App.vue'
import './style.css'

// Resolve installed vs. static origin before constructing the dashboard and its admin link.
initConfig().then(() => createApp(App).mount('#app'))
