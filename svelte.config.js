import adapter from '@sveltejs/adapter-static'
import {importAssets} from 'svelte-preprocess-import-assets'

const config = {
  kit: {
    adapter: adapter({pages: 'docs'})
  },
  preprocess: [importAssets()]
}

export default config
