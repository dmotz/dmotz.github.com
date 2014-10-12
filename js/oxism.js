// Generated by CoffeeScript 1.8.0
(function() {
  var abs, activeContent, capitalize, colorN, colors, computePositions, dampen, debouncer, h, isTouchScreen, key, lastY, navHash, onMove, permaDiv, positions, saveColor, sqrt, squares, testEl, val, vendor, w;

  abs = Math.abs, sqrt = Math.sqrt;

  isTouchScreen = 'ontouchstart' in window;

  colors = 2;

  lastY = colorN = w = h = 0;

  positions = [];

  vendor = {
    transform: 'transform'
  };

  squares = activeContent = permaDiv = null;

  testEl = document.createElement('div');

  saveColor = (function() {
    if (window.localStorage) {
      colorN = localStorage.getItem('n') || 0;
      document.documentElement.className = 'color' + colorN;
      return function() {
        return localStorage.setItem('n', colorN);
      };
    } else {
      return function() {};
    }
  })();

  capitalize = function(s) {
    return s[0].toUpperCase() + s.slice(1);
  };

  navHash = function() {
    var hash;
    hash = location.hash.slice(1);
    if (hash === '') {
      window.scrollTo(0, lastY);
      return document.body.className = '';
    }
    lastY = window.pageYOffset;
    if (activeContent) {
      activeContent.className = '';
    }
    activeContent = document.getElementById('content-' + hash);
    permaDiv.scrollTop = 0;
    activeContent.className = 'active';
    return document.body.className = 'perma';
  };

  computePositions = function() {
    var i, left, square, top, _i, _len, _ref;
    for (i = _i = 0, _len = squares.length; _i < _len; i = ++_i) {
      square = squares[i];
      _ref = square.getBoundingClientRect(), left = _ref.left, top = _ref.top;
      positions[i] = [left, top];
    }
    return null;
  };

  debouncer = (function() {
    var timer;
    timer = null;
    return function() {
      clearTimeout(timer);
      return timer = setTimeout(computePositions, 333);
    };
  })();

  dampen = 10;

  onMove = function(e) {
    var dX, dY, dist, i, rX, rY, square, _i, _len;
    for (i = _i = 0, _len = squares.length; _i < _len; i = ++_i) {
      square = squares[i];
      dX = e.pageX - positions[i][0] - w / 2;
      dY = e.pageY - positions[i][1] - h / 2;
      dist = sqrt(Math.pow(abs(dX), 2) + Math.pow(abs(dY), 2));
      rY = dX / ((dist || 1) / dampen);
      rX = -dY / ((dist || 1) / dampen);
      square.children[0].style[vendor.transform] = "rotateX(" + rX + "deg) rotateY(" + rY + "deg)";
    }
    return null;
  };

  for (key in vendor) {
    val = vendor[key];
    vendor[key] = (function() {
      var full, prefix, _i, _len, _ref;
      _ref = ['Webkit', 'Moz', 'ms'];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        prefix = _ref[_i];
        if ((full = prefix + capitalize(val)) in testEl.style) {
          return full;
        }
      }
      if (val in testEl.style) {
        return val;
      }
      return null;
    })();
  }

  document.addEventListener('DOMContentLoaded', function() {
    var touchClass;
    touchClass = isTouchScreen ? ' touch' : '';
    setTimeout((function() {
      return document.documentElement.className = 'color' + colorN + touchClass;
    }), 0);
    squares = document.getElementById('grid').children;
    permaDiv = document.getElementById('perma');
    w = h = parseInt(window.getComputedStyle(squares[0]).width, 10);
    document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':', 'd', 'a', 'n', '@', 'o', 'x', 'i', 's', 'm', '.', 'c', 'o', 'm'].join('');
    setInterval(function() {
      if (++colorN > colors) {
        colorN = 0;
      }
      document.documentElement.className = 'color' + colorN + touchClass;
      return saveColor();
    }, 8000);
    if (!isTouchScreen) {
      document.addEventListener('keydown', function(e) {
        if (e.keyCode === 27) {
          return location.hash = '';
        }
      });
      if (!vendor.transform) {
        return;
      }
      computePositions();
      window.addEventListener('resize', debouncer);
      document.addEventListener('mousemove', onMove, false);
    }
    window.addEventListener('hashchange', navHash);
    return navHash();
  }, false);

}).call(this);

//# sourceMappingURL=oxism.js.map
