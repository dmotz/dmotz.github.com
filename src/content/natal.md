Natal is a simple command-line utility that automates most of the process of
setting up a React Native app running on ClojureScript.

It stands firmly on the shoulders of giants, specifically those of
[Mike Fikes](http://blog.fikesfarm.com) who created
[Ambly](https://github.com/omcljs/ambly) and the
[documentation](https://github.com/omcljs/ambly/wiki/ClojureScript-React-Native-Quick-Start)
on setting up a ClojureScript React Native app.


## Usage

Before getting started, make sure you have npm, Leiningen, and CocoaPods (>=0.36.4)
installed.

Then, install the CLI using npm:

```
$ npm install -g natal
```

Then run `natal` with your app's name as the first argument:

```
$ natal FutureApp
```

If your app is more than a single word, be sure to type it in CamelCase.
A corresponding hyphenated Clojure namespace will be created.

When Xcode appears, click the play button (or ⌘-R) to run the app on the simulator.

Then run the following for an interactive workflow:

```
$ cd future-app
$ ./start.sh
```

First, choose the correct device (probably `[1]`). At the REPL prompt type this:

```clojure
(in-ns 'future-app.core)
```

Changes you make via the REPL or by changing your .cljs files should appear live.

Try this command as an example:

```clojure
(swap! app-state assoc :text "Hello Native World")
```

When the REPL starts it will print the location of its compilation log.
It's useful to tail it to see any errors, like so:

```
$ tail -f /Volumes/Ambly-81C53995/watch.log
```


## Tips
- Having `rlwrap` installed is optional but recommended since it makes the REPL
a much nicer experience with arrow keys
- Don't press ⌘-R in the simulator; code changes should be reflected automatically.
See [this issue](https://github.com/omcljs/ambly/issues/97) in Ambly for details
- Running multiple React Native apps at once can cause problems
