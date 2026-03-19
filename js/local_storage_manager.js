window.fakeStorage = {
  _data: {},

  setItem: function (id, val) {
    return this._data[id] = String(val);
  },

  getItem: function (id) {
    return this._data.hasOwnProperty(id) ? this._data[id] : undefined;
  },

  removeItem: function (id) {
    return delete this._data[id];
  },

  clear: function () {
    return this._data = {};
  }
};

function LocalStorageManager() {
  this.bestScoreKeyBase = "bestScore";
  this.gameStateKeyBase = "gameState";
  this.undoStateKeyBase = "undoState";
  this.boardSizeKey = "boardSize";

  var supported = this.localStorageSupported();
  this.storage = supported ? window.localStorage : window.fakeStorage;
}

LocalStorageManager.prototype.localStorageSupported = function () {
  var testKey = "test";

  try {
    var storage = window.localStorage;
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
};

LocalStorageManager.prototype._normalizeBoardSize = function (raw) {
  var n = parseInt(raw, 10);
  if (isNaN(n)) return 4;
  return (n === 3 || n === 4 || n === 5 || n === 6) ? n : 4;
};

LocalStorageManager.prototype._getStoredBoardSize = function () {
  return this.storage.getItem(this.boardSizeKey);
};

LocalStorageManager.prototype._scopedKey = function (baseKey) {
  // Invariant: both best score and game state are scoped per board size.
  // This prevents mixing scores/states across incompatible grid dimensions.
  var size = this._normalizeBoardSize(this._getStoredBoardSize());
  return baseKey + "_" + String(size);
};

// PUBLIC_INTERFACE
LocalStorageManager.prototype.getBoardSize = function () {
  /** Get persisted board size (normalized), defaulting to 4. */
  return this._normalizeBoardSize(this._getStoredBoardSize());
};

// PUBLIC_INTERFACE
LocalStorageManager.prototype.setBoardSize = function (size) {
  /** Persist board size; does not automatically clear game state. */
  var normalized = this._normalizeBoardSize(size);
  this.storage.setItem(this.boardSizeKey, String(normalized));
};

// Best score getters/setters
LocalStorageManager.prototype.getBestScore = function () {
  return this.storage.getItem(this._scopedKey(this.bestScoreKeyBase)) || 0;
};

LocalStorageManager.prototype.setBestScore = function (score) {
  this.storage.setItem(this._scopedKey(this.bestScoreKeyBase), score);
};

// Game state getters/setters and clearing
LocalStorageManager.prototype.getGameState = function () {
  var stateJSON = this.storage.getItem(this._scopedKey(this.gameStateKeyBase));
  return stateJSON ? JSON.parse(stateJSON) : null;
};

LocalStorageManager.prototype.setGameState = function (gameState) {
  this.storage.setItem(this._scopedKey(this.gameStateKeyBase), JSON.stringify(gameState));
};

LocalStorageManager.prototype.clearGameState = function () {
  this.storage.removeItem(this._scopedKey(this.gameStateKeyBase));
};

// PUBLIC_INTERFACE
LocalStorageManager.prototype.getUndoState = function () {
  /** Get the persisted 1-step undo snapshot for the current board size (or null). */
  var stateJSON = this.storage.getItem(this._scopedKey(this.undoStateKeyBase));
  return stateJSON ? JSON.parse(stateJSON) : null;
};

// PUBLIC_INTERFACE
LocalStorageManager.prototype.setUndoState = function (undoState) {
  /** Persist the 1-step undo snapshot for the current board size. */
  this.storage.setItem(this._scopedKey(this.undoStateKeyBase), JSON.stringify(undoState));
};

// PUBLIC_INTERFACE
LocalStorageManager.prototype.clearUndoState = function () {
  /** Clear the persisted 1-step undo snapshot for the current board size. */
  this.storage.removeItem(this._scopedKey(this.undoStateKeyBase));
};
