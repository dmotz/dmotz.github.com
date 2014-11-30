gulp    = require 'gulp'
gutil   = require 'gulp-util'
srcMap  = require 'gulp-sourcemaps'
jade    = require 'gulp-jade'
coffee  = require 'gulp-coffee'
stylus  = require 'gulp-stylus'
uglify  = require 'gulp-uglify'
htmlMin = require 'gulp-minify-html'
lr      = require 'gulp-livereload'
nib     = require 'nib'
getMap  = require './map'

onErr = (err) ->
  gutil.log gutil.colors.red err
  gutil.beep()
  @emit 'end'


gulp.task 'templates', ->
  getMap (err, map) ->
    gulp.src 'src/index.jade'
      .pipe jade(locals: map).on 'error', gutil.log
      .pipe htmlMin quotes: true
      .pipe gulp.dest '.'


gulp.task 'scripts', ->
  gulp.src 'src/oxism.coffee'
    .pipe srcMap.init()
    .pipe coffee().on 'error', onErr
    .pipe uglify()
    .pipe srcMap.write '.'
    .pipe gulp.dest 'js/'


gulp.task 'styles', ->
  gulp.src 'src/oxism.styl'
    .pipe stylus(use: nib(), compress: true).on 'error', onErr
    .pipe gulp.dest 'css/'


gulp.task 'watch', ->
  lr.listen()
  gulp.watch 'src/*.jade',   ['templates']
  gulp.watch 'src/*.coffee', ['scripts']
  gulp.watch 'src/*.styl',   ['styles']
  for path in ['index.html', 'js/oxism.js', 'css/oxism.css']
    gulp.watch(path).on 'change', lr.changed


gulp.task 'default', ['templates', 'scripts', 'styles']

