<script>
  import KineticText from '#lib/KineticText.svelte'
  import {bodyCopy, notFoundCopy, projects, sections} from '#lib/projectsData'

  const {page = 'home'} = $props()
</script>

<main>
  {#if page === '404'}
    <KineticText copy={notFoundCopy} />
  {:else}
    <KineticText copy={bodyCopy} {projects} {sections} />
  {/if}
</main>
