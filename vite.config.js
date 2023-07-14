import {defineConfig} from 'vite'
import {sveltekit} from '@sveltejs/kit/vite'
import md from 'vite-plugin-markdown'

export default defineConfig({
  server: {port: 3333},
  plugins: [md.plugin({mode: 'html'}), sveltekit()]
})
