{spawn, exec} = require 'child_process'

startWatcher = (bin, args) ->
  watcher = spawn bin, args?.split ' '
  watcher.stdout.pipe process.stdout
  watcher.stderr.pipe process.stderr


task 'watch', 'watch it', ->
  startWatcher 'coffee', '-mwc js/oxism.coffee'
  startWatcher 'stylus', '-u nib -w css/oxism.styl'
  startWatcher 'jade',   '-Pw index.jade'


task 'build', 'build it', ->
  exec 'monocat index.html index.html'

