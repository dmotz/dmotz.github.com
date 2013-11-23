// Generated by CoffeeScript 1.6.3
(function() {
  var CLOSED, OPEN, config, ls, pushSupport, sections, _ref;

  CLOSED = 15;

  OPEN = 70;

  sections = ['intro', 'oridomi', 'pozaic', 'chaincal', 'hexaflip', 'maskew', 'etc'];

  pushSupport = (_ref = window.history) != null ? _ref.pushState : void 0;

  if (((ls = window.localStorage) != null) && (config = ls.getItem('oxism'))) {
    try {
      config = JSON.parse(config);
    } catch (_error) {
      config = {};
    }
  } else {
    config = {};
  }

  document.addEventListener('DOMContentLoaded', function() {
    var section, _fn, _i, _len;
    if (OriDomi.isSupported) {
      document.documentElement.className = '';
      _fn = function(section) {
        var cover, el, ori;
        el = document.getElementById(section);
        cover = el.getElementsByClassName('cover')[0];
        ori = new OriDomi(cover, {
          vPanels: 8,
          hPanels: 1,
          touchEnabled: false,
          speed: 0
        });
        setTimeout((function() {
          return ori.setSpeed(300);
        }), 100);
        if (config[section]) {
          ori.stairs(OPEN);
          el.classList.add('open');
        } else {
          ori.stairs(CLOSED);
        }
        return el.addEventListener('click', function(e) {
          var hash;
          if (config[section]) {
            if (e.target !== el) {
              return;
            }
            ori.stairs(CLOSED);
          } else {
            ori.stairs(OPEN);
            if (pushSupport) {
              hash = section === 'intro' ? '#' : '#' + section;
              history.pushState(null, null, hash);
            }
          }
          el.classList.toggle('open');
          config[section] = !config[section];
          if (ls) {
            return setTimeout(function() {
              return ls.setItem('oxism', JSON.stringify(config));
            }, 500);
          }
        }, false);
      };
      for (_i = 0, _len = sections.length; _i < _len; _i++) {
        section = sections[_i];
        _fn(section);
      }
    }
    return document.getElementById('email').href = ['m', 'a', 'i', 'l', 't', 'o', ':', 'd', 'a', 'n', '@', 'o', 'x', 'i', 's', 'm', '.', 'c', 'o', 'm'].join('');
  });

}).call(this);

/*
//@ sourceMappingURL=oxism.map
*/
