<script>
  import '../styles/main.sass'
</script>

<section class="e404">
  <h1>
    {#each '404'.split('') as char, i}
      <span style:animation-delay="{i * 0.2}s">{char}</span>
    {/each}
  </h1>
  <a href="/">return to /</a>
</section>
