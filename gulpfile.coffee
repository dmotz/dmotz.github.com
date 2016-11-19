gulp    = require 'gulp'
gutil   = require 'gulp-util'
srcMap  = require 'gulp-sourcemaps'
jade    = require 'gulp-jade'
coffee  = require 'gulp-coffee'
stylus  = require 'gulp-stylus'
uglify  = require 'gulp-uglify'
htmlMin = require 'gulp-htmlmin'
nib     = require 'nib'
http    = require 'http'
crypto  = require 'crypto'
fs      = require 'fs'
async   = require 'async'
ls      = require 'live-server'
marked  = require 'marked'
cson    = require 'cson'
port    = 3333

marked.setOptions smartypants: true

onErr = (err) ->
  gutil.log gutil.colors.red err
  gutil.beep()
  @emit 'end'


hash = (file, cb) ->
  fs.readFile file, (err, data) ->
    return cb err if err
    cb null, crypto.createHash('md5').update(data).digest 'hex'


readMap = (cb) ->
  map = cson.parseCSFile './map.coffee'
  fns = for k, v of map then do (k, v) ->
    (cb) ->
      fs.readFile "./src/content/#{ k }.md", 'utf8', (err, md) ->
        v.md = marked md
        cb err

  async.parallel fns, (err) -> cb err, map


gulp.task 'templates', ->
  readMap (err, map) ->
    titleMap = new ->
      @[key] = val.display + ' - ' + val.line for key, val of map
      @

    jsonMap = JSON.stringify titleMap

    async.parallel
      script: hash.bind @, './src/oxism.coffee'
      style:  hash.bind @, './src/oxism.styl'
    , (err, hashes) ->
      throw err if err
      for key in Object.keys(map).concat null
        gulp.src 'src/index.jade'
          .pipe jade(locals: {map, jsonMap, hashes, target: key, title: titleMap[key]}).on 'error', onErr
          .pipe htmlMin quotes: true, removeComments: true
          .pipe gulp.dest if key then "./works/#{ key }" else '.'


gulp.task 'scripts', ->
  gulp.src 'src/oxism.coffee'
    .pipe srcMap.init()
    .pipe coffee().on 'error', onErr
    .pipe uglify()
    .pipe srcMap.write '.'
    .pipe gulp.dest 'assets/js/'


gulp.task 'styles', ->
  gulp.src 'src/oxism.styl'
    .pipe stylus(use: nib(), compress: true).on 'error', onErr
    .pipe gulp.dest 'assets/css/'


gulp.task 'server', ->
  ls.start {port, open: false}


gulp.task 'watch', ['server'], ->
  gulp.watch 'src/*.jade', ['templates']
  gulp.watch 'src/content/*.md', ['templates']
  gulp.watch 'map.coffee', ['templates']
  gulp.watch 'src/*.coffee', ['scripts']
  gulp.watch 'src/*.styl', ['styles']


gulp.task 'default', ['templates', 'scripts', 'styles']
