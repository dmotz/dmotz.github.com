CLOSED      = 15
OPEN        = 70
sections    = ['intro', 'oridomi', 'pozaic', 'chaincal', 'hexaflip', 'maskew', 'etc']
pushSupport = window.history?.pushState

if (ls = window.localStorage)? and config = ls.getItem 'oxism'
  try
    config = JSON.parse config
  catch
    config = {}
else
  config   = {}


document.addEventListener 'DOMContentLoaded', ->
  if OriDomi.isSupported
    document.documentElement.className = ''

    for section in sections then do (section) ->
      el    = document.getElementById section
      cover = el.getElementsByClassName('cover')[0]
      ori   = new OriDomi cover, vPanels: 8, hPanels: 1, touchEnabled: false, speed: 0
      setTimeout (-> ori.setSpeed 300), 100

      if config[section]
        ori.stairs OPEN
        el.classList.add 'open'
      else
        ori.stairs CLOSED

      el.addEventListener 'click', (e) ->

        if config[section]
          return unless e.target is el
          ori.stairs CLOSED
        else
          ori.stairs OPEN
          if pushSupport
            hash = if section is 'intro' then '#' else '#' + section
            history.pushState null, null, hash

        el.classList.toggle 'open'
        config[section] = !config[section]

        if ls
          setTimeout ->
            ls.setItem 'oxism', JSON.stringify config
          , 500

      , false

  document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':',
                                           'd', 'a', 'n', '@', 'o', 'x', 'i',
                                           's', 'm', '.', 'c', 'o', 'm'].join ''

