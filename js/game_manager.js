function GameManager(size, InputManager, Actuator, StorageManager, soundManager, speedConfig) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;

  // Actuator is historically passed as a constructor; allow passing a factory too.
  this.actuator       = (typeof Actuator === "function") ? new Actuator : Actuator;

  this.soundManager   = soundManager || null;

  // SpeedModeFlow: per-move countdown timer configuration
  // speedConfig: { enabled:boolean, secondsPerMove:number }
  this.speed = this._normalizeSpeedConfig(speedConfig);

  this.startTiles     = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("undo", this.undo.bind(this));

  // Timer runtime
  this._speedTimerIntervalId = null;
  this._speedMoveDeadlineMs = null; // epoch ms when move expires (only when enabled and game active)

  this.setup();
}

// PUBLIC_INTERFACE
GameManager.prototype._normalizeSpeedConfig = function (speedConfig) {
  /**
   * Normalize Speed mode config into a stable internal shape.
   *
   * Inputs:
   * - speedConfig: {enabled?:boolean, secondsPerMove?:number}|null
   * Output:
   * - { enabled:boolean, secondsPerMove:number }
   * Invariants:
   * - secondsPerMove is one of [2,3,5,8,10] when enabled; otherwise stored but unused.
   */
  var cfg = speedConfig || {};
  var enabled = !!cfg.enabled;
  var secs = parseInt(cfg.secondsPerMove, 10);
  if (isNaN(secs)) secs = 5;
  if ([2, 3, 5, 8, 10].indexOf(secs) === -1) secs = 5;

  return { enabled: enabled, secondsPerMove: secs };
};

GameManager.prototype._isCompatibleUndoState = function (state) {
  // Undo snapshot must match current board size and contain the minimal required fields.
  if (!state || !state.grid) return false;
  var size = state.grid.size;
  return size === this.size;
};

GameManager.prototype._clearUndo = function () {
  // Clears both in-memory and persisted undo snapshot.
  this.undoState = null;
  if (this.storageManager && this.storageManager.clearUndoState) {
    this.storageManager.clearUndoState();
  }
};

GameManager.prototype._setUndo = function (serializedState) {
  // Store a 1-step undo snapshot (in-memory + persisted). Input is a serialized game state.
  this.undoState = serializedState;
  if (this.storageManager && this.storageManager.setUndoState) {
    this.storageManager.setUndoState(serializedState);
  }
};

// --- SpeedModeFlow: timer lifecycle helpers ---

GameManager.prototype._clearSpeedTimer = function () {
  if (this._speedTimerIntervalId) {
    clearInterval(this._speedTimerIntervalId);
    this._speedTimerIntervalId = null;
  }
  this._speedMoveDeadlineMs = null;
};

GameManager.prototype._shouldRunSpeedTimer = function () {
  // Timer runs only while playing (not terminated overlay) and when enabled.
  return !!(this.speed && this.speed.enabled) && !this.isGameTerminated();
};

GameManager.prototype._resetSpeedMoveDeadline = function () {
  if (!this.speed || !this.speed.enabled) {
    this._speedMoveDeadlineMs = null;
    return;
  }
  this._speedMoveDeadlineMs = Date.now() + (this.speed.secondsPerMove * 1000);
};

GameManager.prototype._getSpeedTimeRemainingMs = function () {
  if (!this._speedMoveDeadlineMs) return 0;
  return Math.max(0, this._speedMoveDeadlineMs - Date.now());
};

GameManager.prototype._tickSpeedTimer = function () {
  // Called on an interval to enforce timeout.
  if (!this._shouldRunSpeedTimer()) {
    this._clearSpeedTimer();
    return;
  }

  var remaining = this._getSpeedTimeRemainingMs();
  if (remaining <= 0) {
    // Time expired: terminate session as "over" and render.
    this.over = true;

    if (this.soundManager) {
      this.soundManager.playLose();
    }

    this.actuate();
    // actuation will clear persisted state for over; stop timer as well.
    this._clearSpeedTimer();
    return;
  }

  // Update UI via actuator metadata updates (actuator renders bar based on metadata).
  // We call actuate lightly by re-sending current grid + updated metadata; this is simplest and
  // keeps a single render path. requestAnimationFrame batching in actuator prevents thrash.
  this.actuate();
};

GameManager.prototype._ensureSpeedTimerRunning = function () {
  var self = this;

  if (!this._shouldRunSpeedTimer()) {
    this._clearSpeedTimer();
    return;
  }

  if (this._speedTimerIntervalId) return;

  // Lightweight tick (12.5fps) for UI smoothness without heavy CPU.
  this._speedTimerIntervalId = setInterval(function () {
    self._tickSpeedTimer();
  }, 80);
};

GameManager.prototype._startNewTimedTurn = function () {
  // Called when a new move window should begin (game start, after valid move, after undo, keepPlaying).
  if (!this.speed || !this.speed.enabled) return;
  this._resetSpeedMoveDeadline();
  this._ensureSpeedTimerRunning();
};

// Restart the game
GameManager.prototype.restart = function () {
  this.storageManager.clearGameState();
  this._clearUndo();
  this._clearSpeedTimer();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup(true);
};

// Keep playing after winning (allows going over 2048)
GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame(); // Clear the game won/lost message

  // If Speed mode is enabled, continuing the game should resume the timer window.
  this._startNewTimedTurn();
  this.actuate();
};

// Return true if the game is lost, or has won and the user hasn't kept playing
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

GameManager.prototype._isCompatibleSavedState = function (state) {
  if (!state || !state.grid) return false;
  var savedSize = state.grid.size;
  return savedSize === this.size;
};

// Set up the game
GameManager.prototype.setup = function (forceNewGame) {
  var previousState = forceNewGame ? null : this.storageManager.getGameState();
  var previousUndoState = forceNewGame ? null : (this.storageManager.getUndoState && this.storageManager.getUndoState());

  // Reload the game from a previous game if present AND compatible with current size
  if (previousState && this._isCompatibleSavedState(previousState)) {
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells); // Reload grid
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlaying = previousState.keepPlaying;

    // Speed mode: restore deadline if present (so refresh doesn't grant extra time),
    // but clamp to "now + 0" if it's already expired.
    if (this.speed && this.speed.enabled && typeof previousState.speedMoveDeadlineMs === "number") {
      this._speedMoveDeadlineMs = previousState.speedMoveDeadlineMs;
      if (this._getSpeedTimeRemainingMs() <= 0 && !this.isGameTerminated()) {
        // Expired while away: end immediately.
        this.over = true;
      }
    }

    // Restore undo state if present and compatible; otherwise clear it.
    if (previousUndoState && this._isCompatibleUndoState(previousUndoState)) {
      this.undoState = previousUndoState;
    } else {
      this._clearUndo();
    }
  } else {
    if (previousState && !this._isCompatibleSavedState(previousState)) {
      // Saved state is not portable across sizes; clear to avoid subtle rendering/logic issues.
      this.storageManager.clearGameState();
    }

    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlaying = false;
    this._clearUndo();

    this._clearSpeedTimer();

    // Add the initial tiles
    this.addStartTiles();

    // Start first timed turn if enabled
    this._startNewTimedTurn();
  }

  // If we loaded a saved state and the game isn't terminated, ensure timer is running
  if (this._shouldRunSpeedTimer()) {
    this._ensureSpeedTimerRunning();
    // If there wasn't a restored deadline, initialize one now.
    if (!this._speedMoveDeadlineMs) this._startNewTimedTurn();
  } else {
    this._clearSpeedTimer();
  }

  // Update the actuator
  this.actuate();
};

// Set up the initial tiles to start the game with
GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Adds a tile in a random position
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

// Sends the updated grid to the actuator
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Clear the state when the game is over (game over only, not win)
  if (this.over) {
    this.storageManager.clearGameState();
    // Over ends the run: don't allow undo into a terminated session snapshot.
    this._clearUndo();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  var speedEnabled = !!(this.speed && this.speed.enabled);
  var remainingMs = speedEnabled ? this._getSpeedTimeRemainingMs() : 0;
  var totalMs = speedEnabled ? (this.speed.secondsPerMove * 1000) : 0;

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated(),
    canUndo:    !!this.undoState,

    // SpeedModeFlow metadata for UI
    speedModeEnabled: speedEnabled,
    speedSecondsPerMove: speedEnabled ? this.speed.secondsPerMove : null,
    speedTimeRemainingMs: speedEnabled ? remainingMs : null,
    speedTimeTotalMs: speedEnabled ? totalMs : null
  });

  // Stop timer if game is terminated (won without keepPlaying or over).
  if (!this._shouldRunSpeedTimer()) {
    this._clearSpeedTimer();
  }
};

// Represent the current game as an object
GameManager.prototype.serialize = function () {
  return {
    boardSize:   this.size,
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    keepPlaying: this.keepPlaying,

    // SpeedModeFlow persistence
    speedMoveDeadlineMs: this._speedMoveDeadlineMs
  };
};

// Save all tile positions and remove merger info
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

// Move a tile and its representation
GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move tiles on the grid in the specified direction
GameManager.prototype.move = function (direction) {
  // 0: up, 1: right, 2: down, 3: left
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  // UndoFlow (1-step) - capture pre-move state snapshot.
  // Contract:
  // - Captured only for actual moves (i.e., when at least one tile position changes).
  // - Snapshot includes grid + score + termination flags to restore deterministically.
  var undoCandidate = this.serialize();

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;
  var mergedAny  = false;

  var wasWon = this.won;
  var wasOver = this.over;

  // Save the current tile positions and remove merger information
  this.prepareTiles();

  // Traverse the grid in the right direction and move tiles
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Only one merger per row traversal?
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Converge the two tiles' positions
          tile.updatePosition(positions.next);

          // Update the score
          self.score += merged.value;
          mergedAny = true;

          // The mighty 2048 tile
          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  if (moved) {
    // Persist the "before move" snapshot as the one-step undo.
    this._setUndo(undoCandidate);

    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    // SpeedModeFlow: after a successful move (whether merge or not), reset the per-move deadline.
    // (If the move ended the game, actuate() will clear/stop timer.)
    this._startNewTimedTurn();

    // SFX: basic event sounds (only for actual moves).
    if (this.soundManager) {
      if (mergedAny) {
        this.soundManager.playMerge();
      } else {
        this.soundManager.playMove();
      }

      // Note: win/lose are handled here too for immediate feedback.
      if (!wasWon && this.won) this.soundManager.playWin();
      if (!wasOver && this.over) this.soundManager.playLose();
    }

    this.actuate();
  }
};

// PUBLIC_INTERFACE
GameManager.prototype.undo = function () {
  /**
   * UndoFlow (1-step) - restore previous game state + score for the current board size.
   *
   * Inputs: none (uses in-memory undoState or falls back to persisted undoState).
   * Outputs: void
   * Invariants:
   * - Undo is scoped to current board size; incompatible snapshots are discarded.
   * - After undo, there is no further undo available until another successful move.
   * Errors: no throws; logs warnings and safely no-ops on invalid states.
   * Side effects:
   * - Mutates grid/score/flags
   * - Updates persistence via LocalStorageManager.setGameState/clearUndoState
   * - Updates UI via actuator.actuate
   */
  var snapshot = this.undoState || (this.storageManager.getUndoState && this.storageManager.getUndoState());
  if (!snapshot) return;

  if (!this._isCompatibleUndoState(snapshot)) {
    console.warn("[UndoFlow] Incompatible undo snapshot; clearing.");
    this._clearUndo();
    this.actuate();
    return;
  }

  this.grid        = new Grid(snapshot.grid.size, snapshot.grid.cells);
  this.score       = snapshot.score;
  this.over        = snapshot.over;
  this.won         = snapshot.won;
  this.keepPlaying = snapshot.keepPlaying;

  // Restore speed timer deadline from snapshot (so undo doesn't grant extra time),
  // but if speed mode is enabled we still ensure the timer is running.
  if (this.speed && this.speed.enabled) {
    this._speedMoveDeadlineMs = snapshot.speedMoveDeadlineMs || null;
    // If no deadline was saved (older snapshot), start a fresh turn now.
    if (!this._speedMoveDeadlineMs) this._startNewTimedTurn();
    this._ensureSpeedTimerRunning();
  } else {
    this._clearSpeedTimer();
  }

  // One-step: consume it immediately.
  this._clearUndo();

  // Ensure UI message state is consistent after undo.
  // If we undid out of a terminated state, clear the message overlay.
  if (!this.isGameTerminated()) {
    this.actuator.continueGame();
  }

  // Persist restored state and re-render
  this.actuate();
};

// Get the vector representing the chosen direction
GameManager.prototype.getVector = function (direction) {
  // Vectors representing tile movement
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Build a list of positions to traverse in the right order
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var pos = 0; pos < this.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  // Always traverse from the farthest cell in the chosen direction
  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Progress towards the vector direction until an obstacle is found
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) &&
           this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // Used to check if a merge is required
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Check for available matches between tiles (more expensive check)
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;

  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };

          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

Explanation: Render Speed timer UI in the actuator based on metadata (single canonical render path) and support a distinct "Time's up!" message.
````patch file="2048/js/html_actuator.js"
@@
 function HTMLActuator() {
   this.tileContainer    = document.querySelector(".tile-container");
   this.scoreContainer   = document.querySelector(".score-container");
   this.bestContainer    = document.querySelector(".best-container");
   this.messageContainer = document.querySelector(".game-message");
   this.gridContainer    = document.querySelector(".grid-container");
   this.gameContainer    = document.querySelector(".game-container");
   this.undoButton       = document.querySelector(".undo-button");
+  this.speedTimerEl     = document.querySelector(".speed-timer");
+  this.speedTimerFillEl = document.querySelector(".speed-timer-bar-fill");
+  this.speedTimerSecondsEl = document.querySelector(".speed-timer-seconds");
+  this.speedTimerBarEl  = document.querySelector(".speed-timer-bar");
 
   this.score = 0;
 
   this.soundManager = null;
   this._lastTerminationState = null; // "won" | "over" | null
@@
 HTMLActuator.prototype.actuate = function (grid, metadata) {
   var self = this;
 
   // Ensure background grid + positioning CSS matches grid size.
   self.ensureBoardRendered(grid.size);
 
   window.requestAnimationFrame(function () {
     self.clearContainer(self.tileContainer);
@@
     self.updateScore(metadata.score);
     self.updateBestScore(metadata.bestScore);
     self.updateUndoAvailability(!!metadata.canUndo);
+    self.updateSpeedTimer(metadata);
 
     if (metadata.terminated) {
       if (metadata.over) {
-        self.message(false); // You lose
+        // Timeouts are communicated as a special-case message for clarity.
+        // If the timer hit 0, remainingMs is 0 and speedModeEnabled is true.
+        var isTimeout = !!(metadata.speedModeEnabled && typeof metadata.speedTimeRemainingMs === "number" && metadata.speedTimeRemainingMs <= 0);
+        self.message(false, isTimeout ? "Time's up!" : null); // You lose
         if (self.soundManager && self._lastTerminationState !== "over") {
           self.soundManager.playLose();
         }
         self._lastTerminationState = "over";
       } else if (metadata.won) {
         self.message(true); // You win!
@@
 
   });
 };
+
+// PUBLIC_INTERFACE
+HTMLActuator.prototype.updateSpeedTimer = function (metadata) {
+  /**
+   * SpeedModeFlow UI rendering.
+   *
+   * Inputs:
+   * - metadata.speedModeEnabled:boolean
+   * - metadata.speedTimeRemainingMs:number|null
+   * - metadata.speedTimeTotalMs:number|null
+   * Output: void
+   * Side effects: updates timer bar + label; hides UI when disabled.
+   */
+  if (!this.speedTimerEl) return;
+
+  var enabled = !!(metadata && metadata.speedModeEnabled);
+  this.speedTimerEl.hidden = !enabled;
+  if (!enabled) return;
+
+  var remainingMs = typeof metadata.speedTimeRemainingMs === "number" ? metadata.speedTimeRemainingMs : 0;
+  var totalMs = typeof metadata.speedTimeTotalMs === "number" ? metadata.speedTimeTotalMs : 1;
+
+  var pct = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
+  var pct100 = Math.round(pct * 100);
+
+  if (this.speedTimerFillEl) {
+    this.speedTimerFillEl.style.width = String(pct100) + "%";
+    // Mild urgency color shift near end.
+    if (pct <= 0.2) {
+      this.speedTimerFillEl.style.background = "#d9480f";
+    } else if (pct <= 0.4) {
+      this.speedTimerFillEl.style.background = "#e67700";
+    } else {
+      this.speedTimerFillEl.style.background = "";
+    }
+  }
+
+  if (this.speedTimerSecondsEl) {
+    // Display as 1 decimal place seconds (e.g., 3.2)
+    var secs = remainingMs / 1000;
+    this.speedTimerSecondsEl.textContent = secs.toFixed(1);
+  }
+
+  if (this.speedTimerBarEl) {
+    this.speedTimerBarEl.setAttribute("aria-valuenow", String(pct100));
+  }
+};
@@
-HTMLActuator.prototype.message = function (won) {
+HTMLActuator.prototype.message = function (won, overrideText) {
   var type    = won ? "game-won" : "game-over";
-  var message = won ? "You win!" : "Game over!";
+  var message = overrideText || (won ? "You win!" : "Game over!");
 
   this.messageContainer.classList.add(type);
   this.messageContainer.getElementsByTagName("p")[0].textContent = message;
 };
