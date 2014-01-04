{abs, sqrt}   = Math
isTouchScreen = 'ontouchstart' of window
lastY         = w = h = 0
positions     = []
vendor        = transform: 'transform'
squares       = activeContent = null
testEl        = document.createElement 'div'


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
  activeContent.className = 'active'
  document.body.className = 'perma'


computePositions = ->
  positions = ([square.offsetLeft, square.offsetTop] for square in squares)


onMove = (e) ->
  for square, i in squares
    dX   = e.pageX + window.pageXOffset - positions[i][0] - w / 2
    dY   = e.pageY + window.pageYOffset - positions[i][1] - h / 2
    dist = sqrt abs(dX) + abs(dY)
    rY   =  dX / (dist or 1) / 2
    rX   = -dY / (dist or 1) / 2
    square.children[0].style[vendor.transform] = "rotateX(#{ rX }deg) rotateY(#{ rY }deg)"

  null


for key, val of vendor
  vendor[key] = do ->
    for prefix in ['Webkit', 'Moz', 'ms']
      return full if (full = prefix + capitalize val) of testEl.style
    return val if val of testEl.style
    null


document.addEventListener 'DOMContentLoaded', ->
  window.addEventListener 'hashchange', navHash
  setTimeout (-> document.documentElement.className = ''), 0
  navHash()
  squares = document.getElementById('grid').children
  w   = h = parseInt window.getComputedStyle(squares[0]).width, 10

  document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':',
                                           'd', 'a', 'n', '@', 'o', 'x', 'i',
                                           's', 'm', '.', 'c', 'o', 'm'].join ''

  unless isTouchScreen
    document.addEventListener 'keydown', (e) -> location.hash = '' if e.keyCode is 27
    return unless vendor.transform
    computePositions()
    window.addEventListener 'resize', computePositions
    document.addEventListener 'mousemove', onMove, false

, false

