(function () {
  var SOUND_STORAGE_KEY = "soundMuted";

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

  function getStoredMuted() {
    if (!storageAvailable()) return null;
    var raw = window.localStorage.getItem(SOUND_STORAGE_KEY);
    if (raw === null) return null;
    return raw === "true";
  }

  function setStoredMuted(muted) {
    if (!storageAvailable()) return;
    window.localStorage.setItem(SOUND_STORAGE_KEY, muted ? "true" : "false");
  }

  function createAudioContext() {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    return new AudioContextCtor();
  }

  function safeNow(ctx) {
    return (ctx && typeof ctx.currentTime === "number") ? ctx.currentTime : 0;
  }

  // PUBLIC_INTERFACE
  function SoundManager(options) {
    /** Manage simple game SFX (move/merge/win/lose) with a persisted mute preference. */
    options = options || {};

    this.enabled = true;
    this.muted = false;

    // Lazily created on first use, but can be eager.
    this._audioCtx = null;

    this._masterVolume = typeof options.volume === "number" ? options.volume : 0.25;

    var stored = getStoredMuted();
    if (stored !== null) {
      this.muted = stored;
    } else if (typeof options.initialMuted === "boolean") {
      this.muted = options.initialMuted;
    }
  }

  SoundManager.prototype._ensureContext = function () {
    if (this._audioCtx) return this._audioCtx;
    this._audioCtx = createAudioContext();
    return this._audioCtx;
  };

  SoundManager.prototype._resumeIfNeeded = function () {
    var ctx = this._ensureContext();
    if (!ctx) return;

    // Some browsers require user interaction before audio starts.
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      ctx.resume().catch(function () {
        // Ignore; audio will remain unavailable until user gesture.
      });
    }
  };

  SoundManager.prototype._beep = function (frequency, durationMs, type, volume) {
    if (!this.enabled || this.muted) return;

    var ctx = this._ensureContext();
    if (!ctx) return;

    this._resumeIfNeeded();

    try {
      var oscillator = ctx.createOscillator();
      var gainNode = ctx.createGain();

      oscillator.type = type || "sine";
      oscillator.frequency.value = frequency;

      var now = safeNow(ctx);
      var duration = Math.max(0.01, (durationMs || 80) / 1000);
      var vol = Math.max(0, Math.min(1, (typeof volume === "number" ? volume : 1) * this._masterVolume));

      // Short envelope to avoid clicks.
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch (e) {
      // Fail silently (e.g., audio not allowed).
    }
  };

  SoundManager.prototype._chord = function (frequencies, durationMs, type, volume) {
    if (!this.enabled || this.muted) return;

    var ctx = this._ensureContext();
    if (!ctx) return;

    this._resumeIfNeeded();

    var now = safeNow(ctx);
    var duration = Math.max(0.01, (durationMs || 180) / 1000);
    var vol = Math.max(0, Math.min(1, (typeof volume === "number" ? volume : 1) * this._masterVolume));

    // Shared gain envelope for chord
    try {
      var gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      gainNode.connect(ctx.destination);

      frequencies.forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = type || "triangle";
        o.frequency.value = f;
        o.connect(gainNode);
        o.start(now);
        o.stop(now + duration + 0.02);
      });
    } catch (e) {
      // Fail silently
    }
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.setMuted = function (muted) {
    /** Set mute state (persisted). */
    this.muted = !!muted;
    setStoredMuted(this.muted);
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.getMuted = function () {
    /** Get current mute state. */
    return !!this.muted;
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.unlock = function () {
    /** Attempt to unlock audio (should be called on a user gesture). */
    this._resumeIfNeeded();
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.playMove = function () {
    /** Play the "move" sound. */
    this._beep(260, 45, "sine", 0.6);
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.playMerge = function () {
    /** Play the "merge" sound. */
    this._beep(440, 70, "square", 0.9);
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.playWin = function () {
    /** Play the "win" sound. */
    this._chord([523.25, 659.25, 783.99], 220, "triangle", 0.9);
  };

  // PUBLIC_INTERFACE
  SoundManager.prototype.playLose = function () {
    /** Play the "lose" sound. */
    this._beep(155, 220, "sawtooth", 0.8);
  };

  window.SoundManager = SoundManager;
})();
