{abs, sqrt}   = Math
isTouchScreen = 'ontouchstart' of window
lastY         = w = h = 0
positions     = []
vendor        = transform: 'transform'
squares       = activeContent = permaDiv = null
testEl        = document.createElement 'div'
route         = '/works/'


capitalize = (s) ->
  s[0].toUpperCase() + s[1...]


getUrlTarget = ->
  path = document.location.pathname
  if path is '/'
    null
  else
    path.split(route)[1].replace '/', ''


onNav = ->
  target = getUrlTarget()
  unless target
    window.scrollTo 0, lastY
    return document.body.className = ''

  lastY = window.pageYOffset
  activeContent.className = '' if activeContent
  activeContent = document.getElementById 'content-' + getUrlTarget()
  permaDiv.scrollTop      = 0
  activeContent.className = 'active'
  document.body.className = 'perma'


handleLink = (link) ->
  link.addEventListener 'click', (e) ->
    e.preventDefault()
    history.pushState null, null, link.href
    onNav()
  , true


computePositions = ->
  for square, i in squares
    {left, top}  = square.getBoundingClientRect()
    positions[i] = [left, top]
  null


debouncer = do ->
  timer = null
  ->
    clearTimeout timer
    timer = setTimeout computePositions, 333


dampen = 10

onMove = (e) ->
  for square, i in squares
    dX   = e.pageX - positions[i][0] - w / 2
    dY   = e.pageY - positions[i][1] - h / 2
    dist = sqrt abs(dX) ** 2 + abs(dY) ** 2
    rY   =  dX / ((dist or 1) / dampen)
    rX   = -dY / ((dist or 1) / dampen)
    square.children[0].style[vendor.transform] = "rotateX(#{ rX }deg) rotateY(#{ rY }deg)"

  null


for key, val of vendor
  vendor[key] = do ->
    for prefix in ['Webkit', 'Moz', 'ms']
      return full if (full = prefix + capitalize val) of testEl.style
    return val if val of testEl.style
    null


document.addEventListener 'DOMContentLoaded', ->
  setTimeout ->
    document.documentElement.className = if isTouchScreen then 'touch' else ''
  , 0

  squares  = document.getElementById('grid').children
  permaDiv = document.getElementById 'perma'
  w    = h = parseInt window.getComputedStyle(squares[0]).width, 10

  document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':',
                                           'd', 'a', 'n', '@', 'o', 'x', 'i',
                                           's', 'm', '.', 'c', 'o', 'm'].join ''


  unless isTouchScreen
    document.addEventListener 'keydown', (e) ->
      if e.keyCode is 27 and getUrlTarget()
        history.pushState null, null, '/'
        onNav()

    return unless vendor.transform
    computePositions()
    window.addEventListener 'resize', debouncer
    document.addEventListener 'mousemove', onMove, false


  if window.history.pushState
    onNav()
    handleLink link for link in document.querySelectorAll '#grid > a'
    handleLink document.getElementById 'x'
    addEventListener 'popstate', onNav


, false

