{readFile} = require 'fs'
async      = require 'async'
marked     = require 'marked'

map =
  oridomi:
    display: 'OriDomi'
    isMajor: true
    line:    'Fold the DOM up like paper'
    images:  ['oridomi1.jpg', 'oridomi2.jpg']
    tags:    ['CoffeeScript / JavaScript', 'CSS3']
    links:
      'oridomi.com':      'http://oridomi.com'
      github:             'https://github.com/dmotz/oriDomi'
      'annotated source': 'http://oridomi.com/docs/oridomi.html'


  pozaic:
    display: 'Pozaic'
    isMajor: true
    line:    'Capture one second moments as animated gif mosaics'
    images:  ['pozaic1.jpg', 'pozaic2.gif']
    tags:    ['Node.js', 'WebRTC', 'WebSockets', 'web workers']
    links:
      'pozaic.com': 'http://pozaic.com'


  exifexodus:
    display:  'ExifExodus'
    gridName: 'Exif Exodus'
    isMajor:  true
    line:     'Remove GPS data from your photos before you upload them'
    tags:     ['CoffeeScript / JavaScript', 'web workers']
    links:
      'exifexodus.com': 'http://exifexodus.com'
      github:           'https://github.com/dmotz/ExifExodus'


  cellf:
    display:  'Cellf'
    isMajor:  true
    line:     'A game of reflection'
    tags:     ['Clojure', 'React', 'Om', 'core.async']
    links:
      play:   'http://oxism.com/cellf'
      github: 'https://github.com/dmotz/cellf'


  chaincal:
    display: 'ChainCal'
    isMajor: true
    line:    'The simple habit building app for iPhone'
    images:  ['chaincal1.jpg', 'chaincal2.jpg']
    tags:    ['CoffeeScript / JavaScript', 'Apache Cordova', 'CSS3', 'Objective-C']
    links:
      'chaincalapp.com':       'http://chaincalapp.com'
      'download on app store': 'http://itunes.apple.com/us/app/chaincal/id499195302'


  hexaflip:
    display: 'HexaFlip'
    isMajor: true
    line:    'Visualize arrays as cubes'
    images:  ['hexaflip1.jpg', 'hexaflip2.jpg']
    tags:    ['CoffeeScript / JavaScript', 'CSS3']
    links:
      'demo / docs':     'http://oxism.com/hexaflip'
      github:            'https://github.com/dmotz/hexaflip'
      'codrops article': 'http://tympanus.net/codrops/2013/03/07/hexaflip-a-flexible-3d-cube-plugin/'


  maskew:
    display: 'Maskew'
    isMajor: true
    line:    'Add some diagonal rhythm to your elements'
    images:  ['maskew1.jpg', 'maskew2.jpg']
    tags:    ['CoffeeScript / JavaScript', 'CSS3']
    links:
      'demo / docs': 'http://oxism.com/maskew'
      github:        'https://github.com/dmotz/maskew'


  turingtype:
    display: 'TuringType'
    isMajor: true
    line:    'A naïve human typing simulation effect'
    tags:    ['CoffeeScript / JavaScript']
    links:
      'demo / docs': 'http://oxism.com/TuringType'
      github:        'https://github.com/dmotz/TuringType'


  natal:
    display: 'Natal'
    line:    'Bootstrap ClojureScript-based React Native apps'
    tags:    ['Clojure', 'CoffeeScript / JavaScript']
    links:
      github: 'https://github.com/dmotz/natal'


  'natal-shell':
    display: 'Natal Shell'
    line:    'A thin ClojureScript wrapper around the React Native API'
    tags:    ['Clojure']
    links:
      github: 'https://github.com/dmotz/natal-shell'


  taxa:
    display:  'Taxa'
    gridName: 'ταξα'
    line:     'A tiny language inside JavaScript to enforce type signatures'
    tags:     ['CoffeeScript / JavaScript']
    links:
      github: 'https://github.com/dmotz/taxa'


  'stream-snitch':
    display: 'stream-snitch'
    line:    'Event emitter for watching text streams with regex patterns'
    tags:    ['Node.js']
    links:
      github: 'https://github.com/dmotz/stream-snitch'


  'ear-pipe':
    display: 'ear-pipe'
    line:    'Pipe audio streams to your ears'
    tags:    ['Node.js']
    links:
      github: 'https://github.com/dmotz/ear-pipe'


  statmap:
    display: 'statmap'
    line:    'Output recursive directory stats as JSON for visualization and analysis'
    tags:    ['Node.js']
    links:
      github: 'https://github.com/dmotz/statmap'


  commune:
    display: 'Commune'
    line:    'Web workers lose their chains: Easy threads without separate function files'
    tags:    ['CoffeeScript / JavaScript', 'web workers']
    links:
      github: 'https://github.com/dmotz/commune.js'


  'express-spa-router':
    display: 'Express SPA Router'
    line:    'Internally reroute non-AJAX requests to your client-side single page app router'
    tags:    ['Node.js']
    links:
      github: 'https://github.com/dmotz/express-spa-router'


  monocat:
    display: 'Monocat'
    line:    'Automated asset inlining'
    tags:    ['Node.js']
    links:
      github: 'https://github.com/dmotz/monocat'


marked.setOptions
  smartypants: true


module.exports = (cb) ->
  fns = for key, val of map then do (key, val) ->
    (cb) ->
      readFile "./src/content/#{ key }.md", 'utf8', (err, md) ->
        val.md = marked md
        cb err

  async.parallel fns, (err) -> cb err, map
