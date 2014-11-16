{abs, sqrt}   = Math
isTouchScreen = 'ontouchstart' of window
colors        = 2
lastY         = colorN = w = h = 0
positions     = []
vendor        = transform: 'transform'
squares       = activeContent = permaDiv = null
testEl        = document.createElement 'div'


saveColor = do ->
  if window.localStorage
    colorN = localStorage.getItem('n') or 0
    document.documentElement.className = 'color' + colorN
    ->
      localStorage.setItem 'n', colorN
  else
    ->


capitalize = (s) ->
  s[0].toUpperCase() + s[1...]


navHash = ->
  hash = location.hash[1...]
  if hash is ''
    window.scrollTo 0, lastY
    return document.body.className = ''

  lastY = window.pageYOffset
  activeContent.className = '' if activeContent
  activeContent = document.getElementById 'content-' + hash
  permaDiv.scrollTop      = 0
  activeContent.className = 'active'
  document.body.className = 'perma'


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
  touchClass = if isTouchScreen then ' touch' else ''
  setTimeout (-> document.documentElement.className = 'color' + colorN + touchClass), 0
  squares  = document.getElementById('grid').children
  permaDiv = document.getElementById 'perma'
  w    = h = parseInt window.getComputedStyle(squares[0]).width, 10

  document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':',
                                           'd', 'a', 'n', '@', 'o', 'x', 'i',
                                           's', 'm', '.', 'c', 'o', 'm'].join ''

  setInterval ->
    colorN = 0 if ++colorN > colors
    document.documentElement.className = 'color' + colorN + touchClass
    saveColor()
  , 8000

  unless isTouchScreen
    document.addEventListener 'keydown', (e) -> location.hash = '' if e.keyCode is 27
    return unless vendor.transform
    computePositions()
    window.addEventListener 'resize', debouncer
    document.addEventListener 'mousemove', onMove, false

  window.addEventListener 'hashchange', navHash
  navHash()


, false
