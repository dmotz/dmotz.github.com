import {redirect} from '@sveltejs/kit'

export function load() {
  throw redirect(308, 'https://emdash.ai')
}
