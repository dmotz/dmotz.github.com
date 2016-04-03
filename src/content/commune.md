Commune.js makes it easy to run computationally heavy functions in a separate
thread and retrieve the results asynchronously. By delegating these functions
to a separate thread, you can avoid slowing down the main thread that affects
the UI. Think of it as a way to leverage the web workers API without ever having
to think about the web workers API.

Using straightforward syntax, you can add web worker support to your app's
functions without the need to create separate files (as web workers typically
require) and without the need to change the syntax of your functions. Best of
all, everything will work without problems on browsers that do not support web
workers.


### Usage
Here's an example where the first argument is the function to thread, the second
argument is an array of arguments to pass to it, and the third is a callback to
handle the result once it comes through:

```javascript
var heavyFunction = function(a, b, c){
    // do some work 100 million times
    for(var i = 0; i < 1e9; i++){
        a++;
        b++;
        c++;
    }
    // return arguments modified
    return [a, b, c];
}

commune(heavyFunction, [1, 2, 3], function(result){
    console.log(result); // [100000001, 100000002, 100000003]
});

//go ahead and continue with more work in the main thread without being held up:
console.log('I will appear before the loop finishes.');

setTimeout(function(){
    console.log('I probably will too, depending on how fast your CPU is.');
}, 500);

```

In a browser that supports worker threads, the above will output:

```
I will appear before the loop finishes.
I probably will too, depending on how fast your CPU is.
[100000001, 100000002, 100000003]
```

In a browser without web worker support, everything still works, just in a
different order:

```
[100000001, 100000002, 100000003]
I will appear before the loop finishes.
I probably will too, depending on how fast your CPU is.
```

With Commune.js, we could proceed with our work in the main thread without
waiting to loop 100 million times.

Further proof:

```javascript
commune(heavyFunction, [1, 2, 3], function(result){
    console.log(result); // [100000001, 100000002, 100000003]
});

commune(heavyFunction, [50, 60, 70], function(result){
    console.log(result); // [100000050, 100000060, 100000070]
});

commune(heavyFunction, [170, 180, 190], function(result){
    console.log(result); // [100000170, 100000180, 100000190]
});
```

Running the above in a browser with worker support, you'll see the results of
each function call appear simultaneously, meaning that none of these large loops
had to wait for the others to finish before starting. Using Commune.js with
care, you can bring asynchronicity and parallelism to previously inapplicable
areas.

To simplify things more, you can DRY up your syntax with the help of
`communify()` which transforms your vanilla function into a Commune-wrapped
version:

```javascript
var abcs = function(n){
    var s = '';
    for(var i = 0; i < n; i++){
        s += 'abc';
    }
    return s;
}

// Communify the function for future calls:
abcs = communify(abcs);

// Or designate some partial application:
abcs = communify(abcs, [5]);

// Then call it later in a simplified manner:
abcs(function(s){
    console.log('my opus:', s);
});

// Even cleaner with named functions:
abcs(alert);

// If you didn't use partial application with the original communify call:
abcs([10], alert);
```


### How It Works
When you pass a new function to Commune.js, it creates a modified version of the
function using web worker syntax. Commune.js memoizes the result so additional
calls using the same function don't have to be rewritten.

Just write your functions as you normally would using return statements.

Commune.js automatically creates binary blobs from your functions that can be
used as worker scripts.


### Caveats
Since web workers operate in a different context, you can't reference any
variables outside of the function's scope (including the DOM) and you can't
use references to `this` since it will refer to the worker itself. For functions
you want to use Commune.js with, use a functional style where they return a
modified version of their input.

Also, since this is an abstraction designed for ease-of-use and flexibility,
it does not work exactly as web workers do -- namely you can't have multiple
return events from a single worker.
