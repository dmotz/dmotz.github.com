import {render} from 'svelte/server'
import App from './App.svelte'

export const renderPage = page => render(App, {props: {page}})
