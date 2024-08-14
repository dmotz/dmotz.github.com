<script>
  import {onMount} from 'svelte'
  import {browser} from '$app/environment'
  import projects from '$lib/projects'
  import glyphs from '$lib/glyphs'
  import Project from '$lib/Project.svelte'
  import '../styles/main.sass'

  const isTouch = browser && 'ontouchstart' in window
  const opened = Array(projects.length).fill(false)
  const heights = []

  let yOffsets = Array(projects.length).fill(0)
  let isResizing = false
  let transMs = 333
  let mail = ''
  let resizeTimeout

  const onOpen = i => {
    opened[i] = !opened[i]
    transMs = Math.max(333, heights[i] * (opened[i] ? 0.5 : 0.3))
    updateOffsets()
  }

  const updateOffsets = () =>
    ([yOffsets] = heights.reduce(
      ([xs, a], _, i) => {
        const next = a + (opened[i - 1] ? heights[i - 1] : 0)
        return [[...xs, next], next]
      },
      [[], 0]
    ))

  const onResize = () => {
    isResizing = true
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => (isResizing = false), 333)
    updateOffsets()
  }

  onMount(() => {
    window.scrollTo(0, 0)
    mail = [...'moc.msixo@nad'].reverse().join('')
  })
</script>

<svelte:head>
  <title>Dan Motzenbecker</title>
  <noscript>
    <style>
      .content {
        position: static;
        opacity: 1;
      }

      h2 {
        opacity: 1 !important;
        transition-delay: 0s !important;
        font-weight: bold !important;
      }

      .project > button {
        cursor: default;
        user-select: text;
      }

      .content hr {
        width: 100%;
      }
    </style>
  </noscript>
</svelte:head>

<svelte:window on:resize={onResize} />

<header>
  <h1>Dan Motzenbecker</h1>
  <h2>selected open-source works</h2>
  <p>a.d. 0x{new Date().getFullYear().toString(16)}</p>
  <br />
  <div>
    <a href="mailto:{mail}">email</a>
    <a href="https://github.com/dmotz" target="_blank">repos</a>
  </div>
</header>

<main class:isResizing>
  {#each projects as { attributes, html }, i (attributes.name)}
    <Project
      info={attributes}
      body={html}
      index={i}
      active={opened[i]}
      onOpen={() => onOpen(i)}
      yOffset={yOffsets[i]}
      bind:height={heights[i]}
      {transMs}
      {isTouch}
    />
  {/each}
</main>

{#if browser}
  <div class="fontCache" aria-hidden="true">
    {Object.values(glyphs)[0].join('')}
  </div>
{/if}
