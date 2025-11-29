<script>
  import '../styles/main.css'
</script>

<svelte:head>
  <title>4️⃣0️⃣4️⃣</title>
</svelte:head>

<section class="e404">
  <h1>
    {#each '404'.split('') as char, i (i)}
      <span style:animation-delay="{i * 0.2}s">{char}</span>
    {/each}
  </h1>
  <a href="/">return to /</a>
</section>
