{sqrt, min, max} = Math
doc              = document
win              = window
{body}           = doc
isTouchScreen    = 'ontouchstart' of win
lastY            = w = h = 0
positions        = []
vendor           = transform: 'transform'
squares          = activeContent = permaDiv = null
testEl           = doc.createElement 'div'
byId             = doc.getElementById.bind doc
docOn            = doc.addEventListener.bind doc
winOn            = win.addEventListener.bind win
route            = '/works/'
defaultTitle     = 'Dan Motzenbecker'
bendStrength     = 10
motionDampen     = 2


capitalize = (s) ->
  s[0].toUpperCase() + s[1...]


getUrlTarget = ->
  path = doc.location.pathname
  if path is '/'
    null
  else
    path.split(route)[1].replace '/', ''


onNav = ->
  if target = getUrlTarget()
    lastY = win.pageYOffset
    activeContent.className = '' if activeContent
    activeContent           = byId 'content-' + target
    permaDiv.scrollTop      = 0
    activeContent.className = 'active'
    body.className          = 'perma'
    doc.title               = jsonMap[target]
  else
    scrollTo 0, lastY
    doc.title      = defaultTitle
    body.className = ''

  ga 'send', 'pageview'


handleLink = (link) ->
  link.addEventListener 'click', (e) ->
    e.preventDefault()
    history.pushState null, null, link.href
    onNav()


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


transformSquare = (square, x, y) ->
  square.children[0].style[vendor.transform] = "rotateX(#{x}deg) rotateY(#{y}deg)"


onMove = ({pageX, pageY}) ->
  for square, i in squares
    dX   = pageX - positions[i][0] - w / 2
    dY   = pageY - positions[i][1] - h / 2
    dist = (sqrt(dX ** 2 + dY ** 2) or 1) / bendStrength
    transformSquare square, -dY / dist, dX / dist

  null


constrain = (range, n) ->
  max min(n, range), -range


onMotion = ({beta, gamma}) ->
  return if beta is null
  x = constrain(12, beta / motionDampen / 2) - 10
  y = constrain 12, -gamma / motionDampen

  [x, y] = [y, x] if win.innerWidth > win. innerHeight

  for square in squares
    transformSquare square, x, y

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
      el               = doc.createElement 'div'
      el.style.cssText = 'pointer-events:auto'
      el.style.pointerEvents is 'auto'

    doc.documentElement.className = [
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

  if isTouchScreen
    winOn 'deviceorientation', onMotion
  else
    docOn 'keydown', (e) ->
      if e.keyCode is 27 and getUrlTarget()
        history.pushState null, null, '/'
        onNav()

    return unless vendor.transform
    computePositions()
    winOn 'resize', debouncer
    docOn 'mousemove', onMove


  if win.history.pushState
    onNav()
    handleLink link for link in doc.querySelectorAll '#grid > a'
    handleLink byId 'x'
    winOn 'popstate', onNav
