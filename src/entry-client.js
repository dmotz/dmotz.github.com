import {hydrate} from 'svelte'
import App from './App.svelte'

const target = document.getElementById('app')
const page = target?.dataset.page === '404' ? '404' : 'home'

// Safety fallback if font loading ever stalls beyond 2.5s
const fallbackTimer = setTimeout(() => {
  document.body.classList.add('fonts-loaded')
}, 2500)

window.addEventListener(
  'oxism:ready',
  () => {
    clearTimeout(fallbackTimer)
  },
  {once: true}
)

hydrate(App, {
  target,
  props: {page}
})
