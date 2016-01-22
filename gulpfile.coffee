gulp    = require 'gulp'
gutil   = require 'gulp-util'
srcMap  = require 'gulp-sourcemaps'
jade    = require 'gulp-jade'
coffee  = require 'gulp-coffee'
stylus  = require 'gulp-stylus'
uglify  = require 'gulp-uglify'
htmlMin = require 'gulp-htmlmin'
lr      = require 'gulp-livereload'
nib     = require 'nib'
http    = require 'http'
connect = require 'connect'
staticS = require 'serve-static'
getMap  = require './map'
port    = 3333

onErr = (err) ->
  gutil.log gutil.colors.red err
  gutil.beep()
  @emit 'end'


gulp.task 'templates', ->
  getMap (err, map) ->
    titleMap = new ->
      @[key] = val.display + ' - ' + val.line for key, val of map
      @

    jsonMap = JSON.stringify titleMap

    for key in Object.keys(map).concat null
      gulp.src 'src/index.jade'
        .pipe jade(locals: {map, jsonMap, target: key, title: titleMap[key]}).on 'error', onErr
        .pipe htmlMin quotes: true
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
  http.createServer(connect().use staticS '.').listen port
  console.log "\nlistening on port #{ port }\n"


gulp.task 'watch', ['server'], ->
  lr.listen()
  gulp.watch 'src/*.jade', ['templates']
  gulp.watch 'src/content/*.md', ['templates']
  gulp.watch 'map.coffee', ['templates']
  gulp.watch 'src/*.coffee', ['scripts']
  gulp.watch 'src/*.styl', ['styles']
  for path in ['index.html', 'assets/js/oxism.js', 'assets/css/oxism.css']
    gulp.watch(path).on 'change', lr.changed


gulp.task 'default', ['templates', 'scripts', 'styles']
