import {defineConfig} from 'vite'
import {sveltekit} from '@sveltejs/kit/vite'
import {enhancedImages} from '@sveltejs/enhanced-img'
import md from 'vite-plugin-markdown'

export default defineConfig({
  server: {port: 3333},
  plugins: [enhancedImages(), md.plugin({mode: 'html'}), sveltekit()],
  css: {preprocessorOptions: {scss: {api: 'modern'}}}
})
