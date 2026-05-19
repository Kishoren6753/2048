// Wait till the browser is ready to render the game (avoids glitches)
/* global GameManager, KeyboardInputManager, HTMLActuator, LocalStorageManager */

(function () {
    'use strict';

    const PROFILE_KEY = 'userProfile';
    const SETTINGS_KEY = 'userSettings';
    const STATS_KEY = 'userStats';
    const COLOR_MODE_KEY = 'colorMode';

    const DEFAULT_PROFILE = {
        displayName: '',
        bio: ''
    };

    const DEFAULT_SETTINGS = {
        theme: 'classic',
        inputMode: 'keyboard-touch',
        reducedMotion: false,
        showTips: true
    };

    function safeJsonParse(maybeJson, fallbackValue) {
        /** @type {*} */
        let parsed = fallbackValue;
        try {
            parsed = maybeJson ? JSON.parse(maybeJson) : fallbackValue;
        } catch (e) {
            parsed = fallbackValue;
        }
        return parsed;
    }

    function loadProfile() {
        /** @type {{displayName: string, bio: string}} */
        const saved = safeJsonParse(window.localStorage.getItem(PROFILE_KEY), DEFAULT_PROFILE);
        return {
            displayName: typeof saved.displayName === 'string' ? saved.displayName : '',
            bio: typeof saved.bio === 'string' ? saved.bio : ''
        };
    }

    function saveProfile(profile) {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    }

    function loadSettings() {
        /** @type {{theme: string, inputMode: string, reducedMotion: boolean, showTips: boolean}} */
        const saved = safeJsonParse(window.localStorage.getItem(SETTINGS_KEY), DEFAULT_SETTINGS);
        return {
            theme: saved.theme === 'high-contrast' ? 'high-contrast' : 'classic',
            inputMode: saved.inputMode === 'keyboard-only' ? 'keyboard-only' : 'keyboard-touch',
            reducedMotion: Boolean(saved.reducedMotion),
            showTips: saved.showTips !== false
        };
    }

    function saveSettings(settings) {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function loadStats() {
        /** @type {{gamesPlayed: number}} */
        const saved = safeJsonParse(window.localStorage.getItem(STATS_KEY), { gamesPlayed: 0 });
        const gamesPlayed = Number(saved.gamesPlayed);
        return { gamesPlayed: Number.isFinite(gamesPlayed) && gamesPlayed >= 0 ? gamesPlayed : 0 };
    }

    function saveStats(stats) {
        window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    }

    /**
     * Loads persisted color mode preference.
     * @return {'light'|'dark'} The persisted (or default) color mode.
     */
    function loadColorMode() {
        const saved = String(window.localStorage.getItem(COLOR_MODE_KEY) || '').toLowerCase();
        return saved === 'dark' ? 'dark' : 'light';
    }

    /**
     * Persists color mode preference.
     * @param {'light'|'dark'} mode Color mode.
     */
    function saveColorMode(mode) {
        window.localStorage.setItem(COLOR_MODE_KEY, mode);
    }

    /**
     * Applies the current color mode by setting a root data attribute that CSS can style.
     * @param {'light'|'dark'} mode Color mode.
     */
    function applyColorMode(mode) {
        document.documentElement.setAttribute('data-color-mode', mode);
    }

    /**
     * Updates the toggle button to reflect the current mode.
     * @param {'light'|'dark'} mode Color mode.
     */
    function syncColorModeToggleUI(mode) {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) {
            return;
        }

        const isDark = mode === 'dark';
        toggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
        toggle.setAttribute('aria-label', isDark ? 'Disable dark mode' : 'Enable dark mode');
        toggle.textContent = isDark ? 'Light' : 'Dark';
    }

    /**
     * Initializes the dark mode toggle UI.
     */
    function wireColorModeToggle() {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) {
            return;
        }

        toggle.addEventListener('click', function () {
            const current = loadColorMode();
            const next = current === 'dark' ? 'light' : 'dark';
            saveColorMode(next);
            applyColorMode(next);
            syncColorModeToggleUI(next);
        });
    }

    function setStatusText(elementId, message) {
        const el = document.getElementById(elementId);
        if (!el) {
            return;
        }
        el.textContent = message;
    }

    function getBestScoreFromGameStorage() {
        // LocalStorageManager uses "bestScore" key (see local_storage_manager.js)
        const raw = window.localStorage.getItem('bestScore');
        const best = Number(raw);
        return Number.isFinite(best) && best >= 0 ? best : 0;
    }

    function applyTheme(settings) {
        document.documentElement.setAttribute('data-theme', settings.theme);
        // Minimal high-contrast handling via inline style hooks (kept small to avoid big CSS changes).
        if (settings.theme === 'high-contrast') {
            document.body.style.background = '#ffffff';
        } else {
            document.body.style.background = '';
        }
    }

    function applyReducedMotion(settings) {
        document.documentElement.setAttribute('data-reduced-motion', settings.reducedMotion ? 'true' : 'false');
    }

    function renderProfileView() {
        const profile = loadProfile();
        const stats = loadStats();

        const nameInput = document.getElementById('profile-display-name');
        const bioInput = document.getElementById('profile-bio');
        const bestScoreEl = document.getElementById('profile-best-score');
        const gamesPlayedEl = document.getElementById('profile-games-played');

        if (nameInput) {
            nameInput.value = profile.displayName;
        }
        if (bioInput) {
            bioInput.value = profile.bio;
        }
        if (bestScoreEl) {
            bestScoreEl.textContent = String(getBestScoreFromGameStorage());
        }
        if (gamesPlayedEl) {
            gamesPlayedEl.textContent = String(stats.gamesPlayed);
        }

        setStatusText('profile-status', '');
    }

    function renderSettingsView() {
        const settings = loadSettings();

        const themeSelect = document.getElementById('setting-theme');
        const inputModeSelect = document.getElementById('setting-input-mode');
        const reducedMotionCheckbox = document.getElementById('setting-reduced-motion');
        const showTipsCheckbox = document.getElementById('setting-show-tips');

        if (themeSelect) {
            themeSelect.value = settings.theme;
        }
        if (inputModeSelect) {
            inputModeSelect.value = settings.inputMode;
        }
        if (reducedMotionCheckbox) {
            reducedMotionCheckbox.checked = settings.reducedMotion;
        }
        if (showTipsCheckbox) {
            showTipsCheckbox.checked = settings.showTips;
        }

        applyTheme(settings);
        applyReducedMotion(settings);

        setStatusText('settings-status', '');
    }

    function getRouteFromHash() {
        const hash = window.location.hash || '#/game';
        const route = hash.replace(/^#\/?/, '').split('?')[0].trim();
        if (route === 'profile' || route === 'settings' || route === 'game') {
            return route;
        }
        return 'game';
    }

    function setActiveNav(route) {
        const links = document.querySelectorAll('.top-nav .nav-link');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const linkRoute = link.getAttribute('data-route');
            if (linkRoute === route) {
                link.classList.add('is-active');
                link.setAttribute('aria-current', 'page');
            } else {
                link.classList.remove('is-active');
                link.removeAttribute('aria-current');
            }
        }
    }

    function showView(route) {
        const views = document.querySelectorAll('.view');
        for (let i = 0; i < views.length; i++) {
            const view = views[i];
            const viewName = view.getAttribute('data-view');
            if (viewName === route) {
                view.classList.add('view-active');
            } else {
                view.classList.remove('view-active');
            }
        }

        setActiveNav(route);

        if (route === 'profile') {
            renderProfileView();
        }
        if (route === 'settings') {
            renderSettingsView();
        }
    }

    function onRouteChange() {
        const route = getRouteFromHash();
        showView(route);
    }

    function wireProfileHandlers() {
        const saveBtn = document.getElementById('profile-save');
        const resetBtn = document.getElementById('profile-reset');

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                const nameInput = document.getElementById('profile-display-name');
                const bioInput = document.getElementById('profile-bio');

                const profile = {
                    displayName: nameInput ? String(nameInput.value || '').trim() : '',
                    bio: bioInput ? String(bioInput.value || '').trim() : ''
                };

                saveProfile(profile);
                setStatusText('profile-status', 'Saved.');
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                saveProfile(DEFAULT_PROFILE);
                renderProfileView();
                setStatusText('profile-status', 'Reset to defaults.');
            });
        }
    }

    function wireSettingsHandlers() {
        const saveBtn = document.getElementById('settings-save');
        const resetBtn = document.getElementById('settings-reset');

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                const themeSelect = document.getElementById('setting-theme');
                const inputModeSelect = document.getElementById('setting-input-mode');
                const reducedMotionCheckbox = document.getElementById('setting-reduced-motion');
                const showTipsCheckbox = document.getElementById('setting-show-tips');

                const settings = {
                    theme: themeSelect && themeSelect.value === 'high-contrast' ? 'high-contrast' : 'classic',
                    inputMode: inputModeSelect && inputModeSelect.value === 'keyboard-only' ? 'keyboard-only' : 'keyboard-touch',
                    reducedMotion: Boolean(reducedMotionCheckbox && reducedMotionCheckbox.checked),
                    showTips: Boolean(showTipsCheckbox && showTipsCheckbox.checked)
                };

                saveSettings(settings);
                applyTheme(settings);
                applyReducedMotion(settings);
                setStatusText('settings-status', 'Saved.');
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                saveSettings(DEFAULT_SETTINGS);
                renderSettingsView();
                setStatusText('settings-status', 'Reset to defaults.');
            });
        }
    }

    function wireGameStats() {
        // Increment games played whenever the user starts a new game.
        const restartButton = document.querySelector('.restart-button');
        if (!restartButton) {
            return;
        }

        restartButton.addEventListener('click', function () {
            const stats = loadStats();
            stats.gamesPlayed += 1;
            saveStats(stats);
        });
    }

    function initRoutingAndUI() {
        wireProfileHandlers();
        wireSettingsHandlers();
        wireGameStats();
        wireColorModeToggle();

        window.addEventListener('hashchange', onRouteChange);

        // Default route.
        if (!window.location.hash) {
            window.location.hash = '#/game';
        } else {
            onRouteChange();
        }
    }

    window.requestAnimationFrame(function () {
        // Initialize the game as before.
        // Note: Settings like "keyboard-only" are present but not wired into KeyboardInputManager
        // to avoid altering core gameplay behavior beyond requested UI additions.
        new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);

        // Initialize added UI.
        initRoutingAndUI();
        // Apply saved settings immediately.
        const settings = loadSettings();
        applyTheme(settings);
        applyReducedMotion(settings);

        // Apply persisted dark mode immediately.
        const colorMode = loadColorMode();
        applyColorMode(colorMode);
        syncColorModeToggleUI(colorMode);
    });
}());
