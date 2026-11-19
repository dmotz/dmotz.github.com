import {defineConfig} from 'vite'
import {sveltekit} from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-static'
import {enhancedImages} from '@sveltejs/enhanced-img'

export default defineConfig({
  server: {port: 3333, allowedHosts: true},
  plugins: [
    enhancedImages(),
    sveltekit({adapter: adapter({fallback: '404.html'})})
  ]
})
