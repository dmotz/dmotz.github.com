import {defineConfig} from 'vite'
import {sveltekit} from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-static'
import {enhancedImages} from '@sveltejs/enhanced-img'
import md from 'vite-plugin-markdown'

export default defineConfig({
  server: {port: 3333},
  plugins: [
    enhancedImages(),
    md.plugin({mode: 'html'}),
    sveltekit({adapter: adapter({fallback: '404.html'})})
  ]
})
