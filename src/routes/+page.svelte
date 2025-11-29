<script>
  import {onMount} from 'svelte'
  import {browser} from '$app/environment'
  import projects from '$lib/projects'
  import glyphs from '$lib/glyphs'
  import Project from '$lib/Project.svelte'
  import '../styles/main.css'

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
    scrollTo(0, 0)
    mail = [...'moc.msixo@nad'].reverse().join('')
  })
</script>

<svelte:head>
  <title>Dan Motzenbecker</title>
  <noscript>
    <style>
      h2 {
        opacity: 1 !important;
        transition-delay: 1ms !important;
        font-weight: bold !important;
      }

      .project {
        transform: none !important;
        padding-bottom: 0;
      }

      .project:last-child {
        padding-bottom: 33vh;
      }

      .project > button {
        cursor: default;
        user-select: text;
      }

      .content {
        position: static;
        opacity: 1;
      }

      .content hr {
        width: 100%;
      }
    </style>
  </noscript>
</svelte:head>

<svelte:window on:resize|passive={onResize} />

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
  <p class="bio">
    Dan Motzenbecker is a creative engineer and designer who has specializes in
    rapidly prototyping AI-powered applications and finding novel modes of UX.
    He has worked as a technical lead at Google Creative Lab where he built
    early AI experiments like AutoDraw, prototypes with early LLMs like Google
    LaMDA, and more recent Gemini-powered apps like Astra. He’s also built
    popular open-source libraries like oriDomi, a library for manipulating web
    elements like paper, and Trystero, a library that makes it easy to build
    instant p2p web apps.
  </p>
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
