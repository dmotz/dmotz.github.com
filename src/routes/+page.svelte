<script>
  import KineticText from '#lib/KineticText.svelte'
  import {projects, sections, bodyCopy} from '#lib/projectsData'
</script>

<svelte:head>
  <title>Dan Motzenbecker</title>
</svelte:head>

<main>
  <KineticText copy={bodyCopy} {projects} {sections} />
</main>
