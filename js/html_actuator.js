function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.gridContainer    = document.querySelector(".grid-container");
  this.gameContainer    = document.querySelector(".game-container");

  this.score = 0;

  this.soundManager = null;
  this._lastTerminationState = null; // "won" | "over" | null

  // Render config cache
  this._renderedGridSize = null;

  // Dedicated <style> tag for dynamic board sizing/positioning rules
  this._dynamicStyleEl = document.getElementById("dynamic-board-style");
  if (!this._dynamicStyleEl) {
    this._dynamicStyleEl = document.createElement("style");
    this._dynamicStyleEl.id = "dynamic-board-style";
    document.head.appendChild(this._dynamicStyleEl);
  }
}

// PUBLIC_INTERFACE
HTMLActuator.prototype.setSoundManager = function (soundManager) {
  /** Attach a SoundManager used for win/lose sounds triggered by UI message display. */
  this.soundManager = soundManager || null;
};

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;

  // Ensure background grid + positioning CSS matches grid size.
  self.ensureBoardRendered(grid.size);

  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell);
        }
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    if (metadata.terminated) {
      if (metadata.over) {
        self.message(false); // You lose
        if (self.soundManager && self._lastTerminationState !== "over") {
          self.soundManager.playLose();
        }
        self._lastTerminationState = "over";
      } else if (metadata.won) {
        self.message(true); // You win!
        if (self.soundManager && self._lastTerminationState !== "won") {
          self.soundManager.playWin();
        }
        self._lastTerminationState = "won";
      }
    } else {
      self._lastTerminationState = null;
    }

  });
};

// PUBLIC_INTERFACE
HTMLActuator.prototype.ensureBoardRendered = function (size) {
  /**
   * Ensure the DOM background grid and dynamic CSS reflect the provided board size.
   *
   * Contract:
   * - Input: size:number (integer >= 3)
   * - Output: void
   * - Side effects:
   *   - Mutates .grid-container children to N rows × N cells
   *   - Injects CSS for:
   *     - .grid-cell size
   *     - .tile size + line-height
   *     - .tile-position-x-y translate() rules for 1..N
   * - Errors: does not throw; logs warnings if inputs are unexpected.
   */
  var n = parseInt(size, 10);
  if (isNaN(n) || n < 3) {
    console.warn("[BoardRenderFlow] Invalid size; using 4:", size);
    n = 4;
  }

  if (this._renderedGridSize === n) return;

  this._renderedGridSize = n;

  // 1) Rebuild background grid markup
  this.clearContainer(this.gridContainer);

  for (var y = 0; y < n; y++) {
    var row = document.createElement("div");
    row.className = "grid-row";

    for (var x = 0; x < n; x++) {
      var cell = document.createElement("div");
      cell.className = "grid-cell";
      row.appendChild(cell);
    }

    this.gridContainer.appendChild(row);
  }

  // 2) Compute geometry based on existing container dimensions & CSS padding
  // We derive numbers from runtime layout so we don't have to regenerate the SCSS.
  var gameRect = this.gameContainer.getBoundingClientRect();
  var computed = window.getComputedStyle(this.gameContainer);

  var paddingLeft = parseFloat(computed.paddingLeft) || 0;
  var paddingTop = parseFloat(computed.paddingTop) || 0;

  // "Inner" size available for the grid/tile translations
  var innerWidth = Math.max(0, gameRect.width - paddingLeft * 2);
  var innerHeight = Math.max(0, gameRect.height - paddingTop * 2);
  var innerSize = Math.min(innerWidth, innerHeight);

  // The original game uses spacing 15px desktop / 10px mobile; we infer via the existing CSS gap
  // by reading the current .grid-row margin-bottom. If absent (first render), use a sensible fallback.
  var tmpRow = document.createElement("div");
  tmpRow.className = "grid-row";
  tmpRow.style.visibility = "hidden";
  this.gridContainer.appendChild(tmpRow);
  var rowStyle = window.getComputedStyle(tmpRow);
  var spacing = parseFloat(rowStyle.marginBottom) || 15;
  this.gridContainer.removeChild(tmpRow);

  // Tile size formula: (innerSize - spacing*(n+1)) / n
  var tileSize = (innerSize - spacing * (n + 1)) / n;
  if (tileSize < 10) {
    // Defensive clamp for extreme viewports
    tileSize = 10;
  }

  // Translation step between tile origins
  var step = tileSize + spacing;

  // 3) Inject CSS rules for this board size (scoped by a class on the game container)
  // This avoids global collisions and keeps old 4x4 CSS harmless.
  var scopeClass = "board-size-" + n;
  this.gameContainer.className = this.gameContainer.className
    .split(/\s+/)
    .filter(function (c) { return c && c.indexOf("board-size-") !== 0; })
    .concat([scopeClass])
    .join(" ");

  var css = [];

  css.push(".game-container." + scopeClass + " .grid-cell { width: " + tileSize + "px; height: " + tileSize + "px; }");
  css.push(".game-container." + scopeClass + " .tile, .game-container." + scopeClass + " .tile .tile-inner { width: " + Math.ceil(tileSize) + "px; height: " + Math.ceil(tileSize) + "px; line-height: " + Math.ceil(tileSize) + "px; }");

  // Position classes (1-indexed in the DOM class naming scheme)
  for (var px = 1; px <= n; px++) {
    for (var py = 1; py <= n; py++) {
      var xPos = Math.floor(step * (px - 1));
      var yPos = Math.floor(step * (py - 1));
      css.push(
        ".game-container." + scopeClass + " .tile.tile-position-" + px + "-" + py + " {" +
          "-webkit-transform: translate(" + xPos + "px, " + yPos + "px);" +
          "-moz-transform: translate(" + xPos + "px, " + yPos + "px);" +
          "-ms-transform: translate(" + xPos + "px, " + yPos + "px);" +
          "transform: translate(" + xPos + "px, " + yPos + "px);" +
        "}"
      );
    }
  }

  this._dynamicStyleEl.textContent = css.join("\n");
};

// Continues the game (both restart and keep playing)
HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
  this._lastTerminationState = null;
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;

  var wrapper   = document.createElement("div");
  var inner     = document.createElement("div");
  var position  = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(position);

  // We can't use classlist because it somehow glitches when replacing classes
  var classes = ["tile", "tile-" + tile.value, positionClass];

  if (tile.value > 2048) classes.push("tile-super");

  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;

  if (tile.previousPosition) {
    // Make sure that the tile gets rendered in the previous position first
    window.requestAnimationFrame(function () {
      classes[2] = self.positionClass({ x: tile.x, y: tile.y });
      self.applyClasses(wrapper, classes); // Update the position
    });
  } else if (tile.mergedFrom) {
    classes.push("tile-merged");
    this.applyClasses(wrapper, classes);

    // Render the tiles that merged
    tile.mergedFrom.forEach(function (merged) {
      self.addTile(merged);
    });
  } else {
    classes.push("tile-new");
    this.applyClasses(wrapper, classes);
  }

  // Add the inner part of the tile to the wrapper
  wrapper.appendChild(inner);

  // Put the tile on the board
  this.tileContainer.appendChild(wrapper);
};

HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

HTMLActuator.prototype.normalizePosition = function (position) {
  return { x: position.x + 1, y: position.y + 1 };
};

HTMLActuator.prototype.positionClass = function (position) {
  position = this.normalizePosition(position);
  return "tile-position-" + position.x + "-" + position.y;
};

HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);

  var difference = score - this.score;
  this.score = score;

  this.scoreContainer.textContent = this.score;

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;

    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  this.bestContainer.textContent = bestScore;
};

HTMLActuator.prototype.message = function (won) {
  var type    = won ? "game-won" : "game-over";
  var message = won ? "You win!" : "Game over!";

  this.messageContainer.classList.add(type);
  this.messageContainer.getElementsByTagName("p")[0].textContent = message;
};

HTMLActuator.prototype.clearMessage = function () {
  // IE only takes one value to remove at a time.
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
};
