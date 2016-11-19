{sqrt}        = Math
isTouchScreen = 'ontouchstart' of window
lastY         = w = h = 0
positions     = []
vendor        = transform: 'transform'
squares       = activeContent = permaDiv = null
testEl        = document.createElement 'div'
byId          = document.getElementById.bind document
docOn         = document.addEventListener.bind document
route         = '/works/'
defaultTitle  = 'Dan Motzenbecker'
bendStrength  = 10


capitalize = (s) ->
  s[0].toUpperCase() + s[1...]


getUrlTarget = ->
  path = document.location.pathname
  if path is '/'
    null
  else
    path.split(route)[1].replace '/', ''


onNav = ->
  if target = getUrlTarget()
    lastY = window.pageYOffset
    activeContent.className = '' if activeContent
    activeContent = byId 'content-' + target
    permaDiv.scrollTop      = 0
    activeContent.className = 'active'
    document.body.className = 'perma'
    document.title          = jsonMap[target]
  else
    scrollTo 0, lastY
    document.title = defaultTitle
    document.body.className = ''

  ga 'send', 'pageview'


handleLink = (link) ->
  link.addEventListener 'click', (e) ->
    e.preventDefault()
    history.pushState null, null, link.href
    onNav()
  , true


computePositions = ->
  for square, i in squares
    {left, top}  = square.getBoundingClientRect()
    positions[i] = [left, top + scrollY]
  null


debouncer = do ->
  timer = null
  ->
    clearTimeout timer
    timer = setTimeout computePositions, 333


onMove = ({pageX, pageY}) ->
  for square, i in squares
    dX   = pageX - positions[i][0] - w / 2
    dY   = pageY - positions[i][1] - h / 2
    dist = (sqrt(dX ** 2 + dY ** 2) or 1) / bendStrength
    square.children[0].style[vendor.transform] =
      "rotateX(#{-dY / dist}deg) rotateY(#{dX / dist}deg)"

  null


for key, val of vendor
  vendor[key] = do ->
    for prefix in ['Webkit', 'Moz', 'ms']
      return full if (full = prefix + capitalize val) of testEl.style
    return val if val of testEl.style
    null


docOn 'DOMContentLoaded', ->
  setTimeout ->
    hasPointerEvents = do ->
      el = document.createElement 'div'
      el.style.cssText = 'pointer-events:auto'
      el.style.pointerEvents is 'auto'

    document.documentElement.className = [
      if isTouchScreen then 'touch' else ''
      if hasPointerEvents then '' else 'no-pe'
    ].join ' '
  , 0

  squares  = byId('grid').children
  permaDiv = byId 'perma'
  w    = h = parseInt getComputedStyle(squares[0]).width, 10

  byId('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':',
                        'd', 'a', 'n', '@', 'o', 'x', 'i',
                        's', 'm', '.', 'c', 'o', 'm'].join ''


  unless isTouchScreen
    docOn 'keydown', (e) ->
      if e.keyCode is 27 and getUrlTarget()
        history.pushState null, null, '/'
        onNav()

    return unless vendor.transform
    computePositions()
    addEventListener 'resize', debouncer
    docOn 'mousemove', onMove, false


  if window.history.pushState
    onNav()
    handleLink link for link in document.querySelectorAll '#grid > a'
    handleLink byId 'x'
    addEventListener 'popstate', onNav

, false
