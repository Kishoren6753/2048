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

  // PUBLIC_INTERFACE
  function initSoundToggle(soundManager) {
    /** Initialize sound toggle (checked = sound on), apply persisted preference, and persist changes. */
    var checkbox = document.getElementById("sound-toggle");
    if (!checkbox) return;

    // UI uses "checked means sound enabled", while SoundManager stores muted.
    checkbox.checked = !soundManager.getMuted();

    checkbox.addEventListener("change", function () {
      // Unlock audio on interaction; some browsers require it.
      soundManager.unlock();
      soundManager.setMuted(!checkbox.checked);
    });
  }

  function setupAudioUnlock(soundManager) {
    // Ensure audio can start after the first user interaction anywhere in the game.
    function unlockOnce() {
      soundManager.unlock();
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
      window.removeEventListener("touchend", unlockOnce);
    }

    window.addEventListener("pointerdown", unlockOnce, { passive: true });
    window.addEventListener("keydown", unlockOnce);
    window.addEventListener("touchend", unlockOnce, { passive: true });
  }

  // Wait till the browser is ready to render the game (avoids glitches)
  window.requestAnimationFrame(function () {
    initThemeToggle();

    var soundManager = new SoundManager({ volume: 0.25 });
    initSoundToggle(soundManager);
    setupAudioUnlock(soundManager);

    var actuator = new HTMLActuator();

    // Provide sound hooks to the actuator so it can play win/lose based on metadata.
    actuator.setSoundManager(soundManager);

    new GameManager(4, KeyboardInputManager, function () { return actuator; }, LocalStorageManager, soundManager);
  });
})();
