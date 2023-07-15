import adapter from '@sveltejs/adapter-static'
import {importAssets} from 'svelte-preprocess-import-assets'

const config = {
  kit: {
    adapter: adapter()
  },
  preprocess: [importAssets()]
}

export default config
