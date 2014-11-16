gulp   = require 'gulp'
gutil  = require 'gulp-util'
srcMap = require 'gulp-sourcemaps'
jade   = require 'gulp-jade'
coffee = require 'gulp-coffee'
stylus = require 'gulp-stylus'
uglify = require 'gulp-uglify'
lr     = require 'gulp-livereload'
nib    = require 'nib'


gulp.task 'templates', ->
  gulp.src 'src/index.jade'
    .pipe jade().on 'error', gutil.log
    .pipe gulp.dest '.'


gulp.task 'scripts', ->
  gulp.src 'src/oxism.coffee'
    .pipe srcMap.init()
    .pipe coffee().on 'error', gutil.log
    .pipe uglify()
    .pipe srcMap.write '.'
    .pipe gulp.dest 'js/'


gulp.task 'styles', ->
  gulp.src 'src/oxism.styl'
    .pipe stylus(use: nib(), compress: true).on 'error', gutil.log
    .pipe gulp.dest 'css/'


gulp.task 'watch', ->
  lr.listen()
  gulp.watch 'src/*.jade',   ['templates']
  gulp.watch 'src/*.coffee', ['scripts']
  gulp.watch 'src/*.styl',   ['styles']
  for path in ['index.html', 'js/oxism.js', 'css/oxism.css']
    gulp.watch(path).on 'change', lr.changed


gulp.task 'default', ['templates', 'scripts', 'styles']

