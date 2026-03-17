(function () {
  var THEME_STORAGE_KEY = "themePreference";
  var DARK_THEME_VALUE = "dark";

  function storageAvailable() {
    try {
      var x = "__storage_test__";
      window.localStorage.setItem(x, x);
      window.localStorage.removeItem(x);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getStoredTheme() {
    if (!storageAvailable()) return null;
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  }

  function setStoredTheme(theme) {
    if (!storageAvailable()) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  function getPreferredTheme() {
    // Respect previously stored preference; otherwise use system preference if available.
    var stored = getStoredTheme();
    if (stored) return stored;

    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return DARK_THEME_VALUE;
    }

    return "light";
  }

  function applyTheme(theme) {
    var isDark = theme === DARK_THEME_VALUE;
    document.body.classList.toggle("theme-dark", isDark);

    var checkbox = document.getElementById("theme-toggle");
    if (checkbox) checkbox.checked = isDark;
  }

  // PUBLIC_INTERFACE
  function initThemeToggle() {
    /** Initialize dark-mode toggle, apply preferred theme, and persist changes. */
    var checkbox = document.getElementById("theme-toggle");
    var initialTheme = getPreferredTheme();
    applyTheme(initialTheme);

    if (!checkbox) return;

    checkbox.addEventListener("change", function () {
      var theme = checkbox.checked ? DARK_THEME_VALUE : "light";
      applyTheme(theme);
      setStoredTheme(theme);
    });
  }

  // Wait till the browser is ready to render the game (avoids glitches)
  window.requestAnimationFrame(function () {
    initThemeToggle();
    new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  });
})();
