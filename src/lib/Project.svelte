<script>
  import {onMount} from 'svelte'
  import glyphs from '$lib/glyphs'
  import * as media from '$lib/media'

  export let height = 0
  export let info
  export let body
  export let active
  export let index
  export let onOpen
  export let yOffset
  export let transMs
  export let isTouch

  const {name} = info
  const {max} = Math
  const displayName = name.split('')
  const frameTime = 1000 / 60
  const minWeight = 300
  const maxWeight = 700
  const minOpacity = 0.3
  const maxOpacity = 1

  let domY = 0
  let lastMouseY = 250
  let weight = minWeight
  let opacity = minOpacity
  let didMount = false
  let titleEl
  let contentEl

  const calcPos = () => {
    const box = titleEl.getBoundingClientRect()
    domY = box.y + scrollY + box.height / 2
    height = contentEl.getBoundingClientRect().height
  }

  const onMouseMove = ({clientY}) => {
    updateStyle(clientY + scrollY)
    lastMouseY = clientY
  }

  const onScroll = () => updateStyle(lastMouseY + scrollY)

  const updateStyle = mouseY => {
    const dY = Math.abs(mouseY - domY) * (isTouch ? 3 : 1.2)

    weight = max(minWeight, maxWeight - dY)
    opacity = max(minOpacity, maxOpacity - dY / 1000)
  }

  const calcAndUpdate = () => {
    calcPos()
    updateStyle(lastMouseY + scrollY)
  }

  const decoChar = i => {
    if (!glyphs[name[i]]) {
      return
    }

    const newChar =
      glyphs[name[i]][Math.floor(Math.random() * glyphs[name[i]].length)]

    if (displayName[i] === newChar) {
      return decoChar(i)
    }

    displayName[i] = newChar
  }

  const onMove = () => {
    const slices = (transMs / frameTime) * 2

    Array(Math.ceil(slices))
      .fill()
      .forEach((_, i) => setTimeout(calcAndUpdate, slices * (i + 1)))
  }

  $: if (titleEl) {
    calcPos()
    onScroll()
    setTimeout(() => (didMount = true), 333)
  }

  onMount(() =>
    displayName.forEach((_, i) => {
      let n = 0

      const f = () => {
        decoChar(i)

        if (n++ < 3) {
          setTimeout(f, Math.random() * 333)
        } else {
          displayName[i] = name[i]
        }
      }

      f()
    })
  )
</script>

<svelte:window
  on:focus={calcPos}
  on:resize|passive={calcPos}
  on:mousemove|passive={!isTouch && onMouseMove}
  on:scroll|passive={onScroll}
/>

<section
  class="project"
  style:transform="translateY(calc({index * -100}vh + {yOffset}px))"
  style:transition-duration="{didMount ? transMs : 0}ms"
  on:transitionstart={onMove}
>
  <button on:click={() => onOpen(index)}>
    <h2
      style:font-weight={weight}
      style:opacity={active ? 1 : opacity}
      style:transition-delay="{didMount ? 0 : (index * 0.2).toFixed(1)}s"
      class:active
      class:tween={!didMount}
      bind:this={titleEl}
    >
      {#each displayName as char, i (i)}
        <span
          on:mouseover={() => decoChar(i)}
          on:focus={() => {}}
          role="presentation">{char}</span
        >
      {/each}
    </h2>
  </button>

  <div
    bind:this={contentEl}
    class="content"
    class:active
    inert={didMount && !active}
  >
    <h3>{info.headline || ''}</h3>

    {#if info.links}
      <div class="links">
        {#each Object.entries(info.links) as [title, href] (href)}
          <a {href} rel="external" target="_blank">{title}</a>
        {/each}
      </div>
    {/if}

    {#if info.images}
      <div class="images">
        {#each info.images as src (src)}
          <div>
            {#if media[src].sources}
              <enhanced:img src={media[src]} alt={name} />
            {:else}
              <video src={media[src]} loop muted autoplay playsinline></video>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- eslint-disable svelte/no-at-html-tags -->
    {@html body}
  </div>
</section>
