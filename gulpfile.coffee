gulp   = require 'gulp'
gutil  = require 'gulp-util'
srcMap = require 'gulp-sourcemaps'
jade   = require 'gulp-jade'
coffee = require 'gulp-coffee'
stylus = require 'gulp-stylus'
uglify = require 'gulp-uglify'
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
  gulp.watch 'src/*.jade',   -> gulp.run 'templates'
  gulp.watch 'src/*.coffee', -> gulp.run 'scripts'
  gulp.watch 'src/*.styl',   -> gulp.run 'styles'


gulp.task 'default', ['templates', 'scripts', 'styles']

