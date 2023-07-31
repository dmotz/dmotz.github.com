import adapter from '@sveltejs/adapter-static'
import {importAssets} from 'svelte-preprocess-import-assets'

const config = {
  kit: {
    adapter: adapter({fallback: '404.html'})
  },
  preprocess: [importAssets()]
}

export default config
