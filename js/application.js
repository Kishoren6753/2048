(function () {
  var THEME_STORAGE_KEY = "themePreference";
  var DARK_THEME_VALUE = "dark";

  var BOARD_SIZE_STORAGE_KEY = "boardSize";
  var DEFAULT_BOARD_SIZE = 4;
  var ALLOWED_BOARD_SIZES = [3, 4, 5, 6];

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

  function normalizeBoardSize(value) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return DEFAULT_BOARD_SIZE;
    return ALLOWED_BOARD_SIZES.indexOf(n) !== -1 ? n : DEFAULT_BOARD_SIZE;
  }

  function getStoredBoardSize() {
    if (!storageAvailable()) return null;
    return window.localStorage.getItem(BOARD_SIZE_STORAGE_KEY);
  }

  function setStoredBoardSize(size) {
    if (!storageAvailable()) return;
    window.localStorage.setItem(BOARD_SIZE_STORAGE_KEY, String(size));
  }

  function createGameManager(boardSize, actuator, soundManager) {
    // Keep creation centralized so the app has one canonical place for wiring.
    return new GameManager(boardSize, KeyboardInputManager, function () { return actuator; }, LocalStorageManager, soundManager);
  }

  // PUBLIC_INTERFACE
  function initBoardSizeSelector(options) {
    /**
     * BoardSizeFlow (Maintainable, Non-Patchy) - single entrypoint
     *
     * Contract:
     * - Inputs:
     *   - options.selectEl: HTMLSelectElement (required)
     *   - options.storageManager: LocalStorageManager (required; adapter for persisted game state)
     *   - options.actuator: HTMLActuator (required; rendering adapter)
     *   - options.soundManager: SoundManager|null (optional)
     * - Outputs:
     *   - returns { getSize(): number, setSize(size:number): void }
     * - Errors:
     *   - No throws; invalid size values are normalized to DEFAULT_BOARD_SIZE.
     * - Side effects:
     *   - Persists size in localStorage key "boardSize"
     *   - Clears saved game state when size changes (prevents incompatible restore)
     *   - Recreates the GameManager with the new size
     *
     * Debuggability:
     * - Logs to console with a consistent prefix so issues can be traced.
     */
    var selectEl = options && options.selectEl;
    var storageManager = options && options.storageManager;
    var actuator = options && options.actuator;
    var soundManager = (options && options.soundManager) || null;

    if (!selectEl || !storageManager || !actuator) {
      // Boundary guard: app should still run with default behavior.
      console.warn("[BoardSizeFlow] Missing required dependencies; falling back to default size:", DEFAULT_BOARD_SIZE);
      return {
        getSize: function () { return DEFAULT_BOARD_SIZE; },
        setSize: function () {}
      };
    }

    var currentSize = DEFAULT_BOARD_SIZE;
    var gameManager = null;

    function applySize(nextSize, source) {
      var normalized = normalizeBoardSize(nextSize);
      if (normalized !== nextSize) {
        console.warn("[BoardSizeFlow] Normalized invalid size:", nextSize, "->", normalized);
      }

      if (normalized === currentSize && gameManager) {
        return;
      }

      console.info("[BoardSizeFlow] Applying board size:", normalized, "source:", source || "unknown");

      currentSize = normalized;
      selectEl.value = String(currentSize);
      setStoredBoardSize(currentSize);

      // Invariant: game state is not portable across board sizes.
      storageManager.clearGameState();

      // Create a fresh manager (new grid + tiles); actuator UI is reused.
      gameManager = createGameManager(currentSize, actuator, soundManager);
    }

    // Initialize from stored preference (if any) or from current select value.
    var storedRaw = getStoredBoardSize();
    var initialSize = storedRaw !== null ? storedRaw : selectEl.value;
    applySize(initialSize, "init");

    selectEl.addEventListener("change", function () {
      applySize(selectEl.value, "ui");
    });

    return {
      getSize: function () { return currentSize; },
      setSize: function (size) { applySize(size, "api"); }
    };
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

    var storageManager = new LocalStorageManager();
    var selectEl = document.getElementById("board-size-select");
    initBoardSizeSelector({
      selectEl: selectEl,
      storageManager: storageManager,
      actuator: actuator,
      soundManager: soundManager
    });
  });
})();
