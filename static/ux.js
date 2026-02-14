(function () {
  var STORAGE = { largeText: 'carepilot-large-text', highContrast: 'carepilot-high-contrast', lang: 'carepilot-lang' };

  function get(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v !== null ? v : def;
    } catch (e) { return def; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function apply() {
    var large = get(STORAGE.largeText, '0') === '1';
    var contrast = get(STORAGE.highContrast, '0') === '1';
    var lang = get(STORAGE.lang, 'en');
    document.body.classList.toggle('large-text', large);
    document.body.classList.toggle('high-contrast', contrast);
    document.documentElement.lang = lang === 'ar' ? 'ar' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    // Update button states
    var btnLarge = document.getElementById('a11y-large');
    var btnContrast = document.getElementById('a11y-contrast');
    if (btnLarge) btnLarge.setAttribute('aria-pressed', large ? 'true' : 'false');
    if (btnContrast) btnContrast.setAttribute('aria-pressed', contrast ? 'true' : 'false');
    document.querySelectorAll('.lang-toggle button[data-lang]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
  }

  function init() {
    apply();
    var btnLarge = document.getElementById('a11y-large');
    var btnContrast = document.getElementById('a11y-contrast');
    if (btnLarge) {
      btnLarge.addEventListener('click', function () {
        set(STORAGE.largeText, get(STORAGE.largeText, '0') === '1' ? '0' : '1');
        apply();
      });
    }
    if (btnContrast) {
      btnContrast.addEventListener('click', function () {
        set(STORAGE.highContrast, get(STORAGE.highContrast, '0') === '1' ? '0' : '1');
        apply();
      });
    }
    document.querySelectorAll('.lang-toggle button[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () {
        set(STORAGE.lang, b.getAttribute('data-lang'));
        apply();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.CarePilotUX = { apply: apply, init: init };
})();
