<script>
  import KineticText from '#lib/KineticText.svelte'

  const copy = [
    'Four-o-four: not found. ',
    {text: 'Go home', href: '/'},
    ' or ',
    {text: 'send an email', href: 'mailto:dan@oxism.com'},
    '.'
  ]
</script>

<svelte:head>
  <title>Four-o-four</title>
</svelte:head>

<main>
  <KineticText {copy} />
</main>
