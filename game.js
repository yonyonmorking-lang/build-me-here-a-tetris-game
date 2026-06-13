(() => {
  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;
  const MINI = 22;
  const COLORS = {
    I: "#27c9ff",
    J: "#4d7cff",
    L: "#ff9f1c",
    O: "#ffd166",
    S: "#06d6a0",
    T: "#b56dff",
    Z: "#ef476f",
    R: "#f6f1de",
  };
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  };
  const SCORE_TABLE = [0, 100, 300, 500, 800];
  const PIECE_TYPES = Object.keys(SHAPES);
  const RESCUE_COLOR = "#f6f1de";
  const boardCanvas = document.querySelector("#board");
  const boardCtx = boardCanvas.getContext("2d");
  const nextCanvas = document.querySelector("#next");
  const nextCtx = nextCanvas.getContext("2d");
  const holdCanvas = document.querySelector("#hold");
  const holdCtx = holdCanvas.getContext("2d");
  const scoreEl = document.querySelector("#score");
  const linesEl = document.querySelector("#lines");
  const levelEl = document.querySelector("#level");
  const speedEl = document.querySelector("#speed");
  const bestScoreEl = document.querySelector("#best-score");
  const pauseButton = document.querySelector("#pause");
  const restartButton = document.querySelector("#restart");
  const overlay = document.querySelector("#overlay");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");

  let grid;
  let active;
  let nextQueue;
  let normalBag;
  let holdPiece;
  let holdLocked;
  let score;
  let bestScore;
  let lines;
  let level;
  let dropCounter;
  let dropInterval;
  let lastTime;
  let running;
  let paused;
  let gameOver;
  let clearingRows;
  let clearingStartedAt;
  let clearToken = 0;
  let lastGeneratedKey;
  let generatedStreak;
  let audio;
  let animationId;

  function updateMobileLayout() {
    const isMobile = window.matchMedia("(max-width: 560px)").matches;
    if (!isMobile) {
      document.documentElement.style.removeProperty("--mobile-board-width");
      document.documentElement.style.removeProperty("--mobile-board-height");
      return;
    }

    const verticalControls = window.innerHeight <= 700 ? 102 : 128;
    const widthLimit = window.innerWidth - 20;
    const heightLimit = window.innerHeight - verticalControls;
    const boardWidth = Math.max(160, Math.min(300, widthLimit, heightLimit / 2));
    document.documentElement.style.setProperty("--mobile-board-width", `${boardWidth}px`);
    document.documentElement.style.setProperty("--mobile-board-height", `${boardWidth * 2}px`);
  }

  function createGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function shuffleBag() {
    const bag = PIECE_TYPES.slice();
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function pieceKey(entry) {
    const definition = normalizePiece(entry);
    return `${definition.type}:${definition.matrix.map((row) => row.join("")).join("/")}`;
  }

  function rememberGeneratedPiece(entry) {
    const key = pieceKey(entry);
    if (key === lastGeneratedKey) {
      generatedStreak += 1;
    } else {
      lastGeneratedKey = key;
      generatedStreak = 1;
    }
    return entry;
  }

  function repeatedTooMuch(entry) {
    return pieceKey(entry) === lastGeneratedKey && generatedStreak >= 5;
  }

  function nextNormalPiece(excludeKey = null) {
    if (!normalBag.length) normalBag = shuffleBag();
    let index = normalBag.findIndex((type) => pieceKey(type) !== excludeKey);
    if (index === -1) {
      normalBag = shuffleBag();
      index = normalBag.findIndex((type) => pieceKey(type) !== excludeKey);
    }
    return normalBag.splice(Math.max(0, index), 1)[0];
  }

  function fillQueue() {
    while (nextQueue.length < 5) {
      nextQueue.push(rememberGeneratedPiece(chooseAdaptivePiece()));
    }
  }

  function normalizePiece(entry) {
    if (typeof entry === "string") {
      return { type: entry, matrix: SHAPES[entry], rescue: false };
    }
    return entry;
  }

  function cloneMatrix(matrix) {
    return matrix.map((row) => row.slice());
  }

  function spawnPiece(entry = nextQueue.shift()) {
    fillQueue();
    const definition = normalizePiece(entry);
    const matrix = cloneMatrix(definition.matrix);
    return {
      type: definition.type,
      matrix,
      baseMatrix: cloneMatrix(definition.matrix),
      rescue: Boolean(definition.rescue),
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: definition.type === "I" ? -1 : 0,
    };
  }

  function rotateMatrix(matrix) {
    return matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse());
  }

  function uniqueRotations(matrix) {
    const rotations = [];
    let current = matrix;
    for (let i = 0; i < 4; i += 1) {
      const key = current.map((row) => row.join("")).join("/");
      if (!rotations.some((rotation) => rotation.key === key)) {
        rotations.push({ key, matrix: current });
      }
      current = rotateMatrix(current);
    }
    return rotations.map((rotation) => rotation.matrix);
  }

  function collides(piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix[y].length; x += 1) {
        if (!matrix[y][x]) continue;
        const boardX = piece.x + x + offsetX;
        const boardY = piece.y + y + offsetY;
        if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
        if (boardY >= 0 && grid[boardY][boardX]) return true;
      }
    }
    return false;
  }

  function mergePiece() {
    active.matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value && active.y + y >= 0) {
          grid[active.y + y][active.x + x] = active.type;
        }
      });
    });
  }

  function clearLines() {
    const rowsToClear = [];
    for (let y = ROWS - 1; y >= 0; y -= 1) {
      if (grid[y].every(Boolean)) {
        rowsToClear.push(y);
      }
    }

    if (!rowsToClear.length) return false;

    clearingRows = rowsToClear;
    clearingStartedAt = performance.now();
    active = null;
    playLineClearSound(rowsToClear.length);
    clearToken += 1;
    const token = clearToken;
    window.setTimeout(() => finishLineClear(rowsToClear, token), 320);
    return true;
  }

  function finishLineClear(rowsToClear, token) {
    if (token !== clearToken) return;
    rowsToClear.sort((a, b) => b - a).forEach((rowIndex) => {
      grid.splice(rowIndex, 1);
      grid.unshift(Array(COLS).fill(null));
    });

    lines += rowsToClear.length;
    level = Math.floor(lines / 10) + 1;
    score += SCORE_TABLE[rowsToClear.length] * level;
    refreshDifficulty();
    updateStats();
    clearingRows = [];
    clearingStartedAt = 0;
    active = spawnPiece();
    holdLocked = false;

    if (collides(active)) {
      finishGame();
    }
  }

  function lockPiece() {
    mergePiece();
    if (clearLines()) return;
    refreshDifficulty();
    if (isDangerBoard() || buildLineBreakerPieces().length) {
      nextQueue.unshift(rememberGeneratedPiece(chooseAdaptivePiece()));
    }
    active = spawnPiece();
    holdLocked = false;
    if (collides(active)) {
      finishGame();
    }
  }

  function move(dx) {
    if (!canPlay()) return;
    if (!collides(active, dx, 0)) active.x += dx;
  }

  function softDrop() {
    if (!canPlay()) return;
    if (!collides(active, 0, 1)) {
      active.y += 1;
      score += 1;
      refreshDifficulty();
      updateStats();
    } else {
      lockPiece();
    }
    dropCounter = 0;
  }

  function hardDrop() {
    if (!canPlay()) return;
    let distance = 0;
    while (!collides(active, 0, 1)) {
      active.y += 1;
      distance += 1;
    }
    score += distance * 2;
    refreshDifficulty();
    updateStats();
    playDropSound();
    lockPiece();
    dropCounter = 0;
  }

  function rotateActive() {
    if (!canPlay()) return;
    const rotated = rotateMatrix(active.matrix);
    const kicks = [0, -1, 1, -2, 2];
    for (const kick of kicks) {
      if (!collides(active, kick, 0, rotated)) {
        active.x += kick;
        active.matrix = rotated;
        return;
      }
    }
  }

  function hold() {
    if (!canPlay() || holdLocked) return;
    const current = {
      type: active.type,
      matrix: cloneMatrix(active.baseMatrix),
      rescue: active.rescue,
    };
    if (holdPiece) {
      active = spawnPiece(holdPiece);
    } else {
      active = spawnPiece();
    }
    holdPiece = current;
    holdLocked = true;
    drawMini(holdCtx, holdPiece);
  }

  function boardMetrics(board) {
    const heights = Array(COLS).fill(0);
    let holes = 0;
    let highestBlock = ROWS;

    for (let x = 0; x < COLS; x += 1) {
      let blockSeen = false;
      for (let y = 0; y < ROWS; y += 1) {
        if (board[y][x]) {
          if (!blockSeen) {
            heights[x] = ROWS - y;
            highestBlock = Math.min(highestBlock, y);
          }
          blockSeen = true;
        } else if (blockSeen) {
          holes += 1;
        }
      }
    }

    const aggregateHeight = heights.reduce((total, height) => total + height, 0);
    const bumpiness = heights.slice(1).reduce((total, height, index) => {
      return total + Math.abs(height - heights[index]);
    }, 0);
    const topPressure = Math.max(0, 8 - highestBlock);

    return { aggregateHeight, bumpiness, holes, topPressure };
  }

  function boardDanger() {
    if (!grid) return 0;
    const { aggregateHeight, holes, topPressure } = boardMetrics(grid);
    return Math.min(1, aggregateHeight / 120 + holes / 45 + topPressure / 6);
  }

  function highestOccupiedRow() {
    if (!grid) return ROWS;
    for (let y = 0; y < ROWS; y += 1) {
      if (grid[y].some(Boolean)) return y;
    }
    return ROWS;
  }

  function isEmergencyBoard() {
    return highestOccupiedRow() <= 7;
  }

  function isDangerBoard() {
    return highestOccupiedRow() <= 7;
  }

  function columnHeights() {
    return Array.from({ length: COLS }, (_, x) => {
      for (let y = 0; y < ROWS; y += 1) {
        if (grid[y][x]) return ROWS - y;
      }
      return 0;
    });
  }

  function simulatedCollision(board, piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix[y].length; x += 1) {
        if (!matrix[y][x]) continue;
        const boardX = piece.x + x + offsetX;
        const boardY = piece.y + y + offsetY;
        if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
        if (boardY >= 0 && board[boardY][boardX]) return true;
      }
    }
    return false;
  }

  function scorePieceFit(typeOrDefinition) {
    const definition = normalizePiece(typeOrDefinition);
    let bestScore = -Infinity;
    const rotations = uniqueRotations(definition.matrix);

    rotations.forEach((matrix) => {
      for (let x = -2; x <= COLS - 1; x += 1) {
        const piece = { type: definition.type, matrix, x, y: -2 };
        if (simulatedCollision(grid, piece)) continue;
        while (!simulatedCollision(grid, piece, 0, 1)) piece.y += 1;

        const testGrid = grid.map((row) => row.slice());
        matrix.forEach((row, rowIndex) => {
          row.forEach((value, colIndex) => {
            const boardY = piece.y + rowIndex;
            const boardX = piece.x + colIndex;
            if (value && boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
              testGrid[boardY][boardX] = definition.type;
            }
          });
        });

        let cleared = 0;
        for (let y = ROWS - 1; y >= 0; y -= 1) {
          if (testGrid[y].every(Boolean)) {
            testGrid.splice(y, 1);
            testGrid.unshift(Array(COLS).fill(null));
            cleared += 1;
            y += 1;
          }
        }

        const metrics = boardMetrics(testGrid);
        const fitScore = cleared * 120 - metrics.holes * 18 - metrics.aggregateHeight * 2 - metrics.bumpiness * 3 - metrics.topPressure * 22;
        bestScore = Math.max(bestScore, fitScore);
      }
    });

    return bestScore;
  }

  function bestClearCountForPiece(entry) {
    const definition = normalizePiece(entry);
    let bestCleared = 0;

    uniqueRotations(definition.matrix).forEach((matrix) => {
      for (let x = -2; x <= COLS - 1; x += 1) {
        const piece = { type: definition.type, matrix, x, y: -2 };
        if (simulatedCollision(grid, piece)) continue;
        while (!simulatedCollision(grid, piece, 0, 1)) piece.y += 1;

        const testGrid = grid.map((row) => row.slice());
        matrix.forEach((row, rowIndex) => {
          row.forEach((value, colIndex) => {
            const boardY = piece.y + rowIndex;
            const boardX = piece.x + colIndex;
            if (value && boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
              testGrid[boardY][boardX] = definition.type;
            }
          });
        });

        const cleared = testGrid.reduce((total, row) => total + (row.every(Boolean) ? 1 : 0), 0);
        bestCleared = Math.max(bestCleared, cleared);
      }
    });

    return bestCleared;
  }

  function trimMatrix(cells) {
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    const matrix = Array.from({ length: maxY - minY + 1 }, () => Array(maxX - minX + 1).fill(0));
    cells.forEach((cell) => {
      matrix[cell.y - minY][cell.x - minX] = 1;
    });
    return matrix;
  }

  function matrixIsConnected(matrix) {
    const blocks = [];
    matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) blocks.push({ x, y });
      });
    });
    if (!blocks.length) return false;

    const seen = new Set([`${blocks[0].x},${blocks[0].y}`]);
    const queue = [blocks[0]];
    while (queue.length) {
      const cell = queue.shift();
      [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x, y: cell.y - 1 },
      ].forEach((neighbor) => {
        const key = `${neighbor.x},${neighbor.y}`;
        if (seen.has(key)) return;
        if (matrix[neighbor.y]?.[neighbor.x]) {
          seen.add(key);
          queue.push(neighbor);
        }
      });
    }

    return seen.size === blocks.length;
  }

  function missingCellsForAlmostClearRows() {
    const rows = [];
    for (let y = ROWS - 1; y >= 0; y -= 1) {
      const missing = [];
      for (let x = 0; x < COLS; x += 1) {
        if (!grid[y][x]) missing.push({ x, y });
      }
      if (missing.length > 0 && missing.length <= 2) rows.push({ y, missing });
    }
    return rows;
  }

  function buildLineBreakerPieces() {
    const almostRows = missingCellsForAlmostClearRows();
    if (!almostRows.length) return [];

    const candidates = [];
    for (let start = 0; start < almostRows.length; start += 1) {
      const cells = [];
      for (let index = start; index < almostRows.length && cells.length < 5; index += 1) {
        almostRows[index].missing.forEach((cell) => {
          if (cells.length < 5) cells.push(cell);
        });
        if (cells.length >= 3) {
          const matrix = trimMatrix(cells);
          if (!matrixIsConnected(matrix)) continue;
          const testPiece = { type: "R", matrix, x: Math.floor((COLS - matrix[0].length) / 2), y: -2 };
          const candidate = { type: "R", matrix, rescue: true, color: RESCUE_COLOR };
          if (!simulatedCollision(grid, testPiece) && bestClearCountForPiece(candidate) > 0 && !candidates.some((piece) => pieceKey(piece) === pieceKey(candidate))) {
            candidates.push(candidate);
          }
        }
      }
    }

    almostRows.forEach((row) => {
      row.missing.forEach((cell) => {
        [
          [{ x: cell.x, y: cell.y }, { x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y - 1 }],
          [{ x: cell.x, y: cell.y }, { x: cell.x - 1, y: cell.y }, { x: cell.x, y: cell.y - 1 }],
          [{ x: cell.x, y: cell.y }, { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y - 2 }],
          [{ x: cell.x, y: cell.y }, { x: cell.x + 1, y: cell.y }, { x: cell.x - 1, y: cell.y }],
        ].forEach((shapeCells) => {
          if (shapeCells.some((shapeCell) => shapeCell.x < 0 || shapeCell.x >= COLS || shapeCell.y < 0 || shapeCell.y >= ROWS)) return;
          if (shapeCells.some((shapeCell) => grid[shapeCell.y][shapeCell.x])) return;
          const matrix = trimMatrix(shapeCells);
          if (!matrixIsConnected(matrix)) return;
          const testPiece = { type: "R", matrix, x: Math.floor((COLS - matrix[0].length) / 2), y: -2 };
          const candidate = { type: "R", matrix, rescue: true, color: RESCUE_COLOR };
          if (!simulatedCollision(grid, testPiece) && bestClearCountForPiece(candidate) > 0 && !candidates.some((piece) => pieceKey(piece) === pieceKey(candidate))) {
            candidates.push(candidate);
          }
        });
      });
    });

    return candidates;
  }

  function collectPocketCells() {
    const heights = columnHeights();
    const candidates = [];

    for (let x = 0; x < COLS; x += 1) {
      const left = x > 0 ? heights[x - 1] : heights[x];
      const right = x < COLS - 1 ? heights[x + 1] : heights[x];
      const wallHeight = Math.min(left, right);
      const depth = wallHeight - heights[x];
      if (depth >= 2) {
        for (let i = 0; i < Math.min(depth, 4); i += 1) {
          candidates.push({ x, y: ROWS - heights[x] - 1 - i });
        }
      }
    }

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (grid[y][x]) continue;
        const hasFloor = y === ROWS - 1 || grid[y + 1][x];
        const hasLeftWall = x === 0 || grid[y][x - 1];
        const hasRightWall = x === COLS - 1 || grid[y][x + 1];
        const hasCeilingPressure = y > 0 && (grid[y - 1][x] || grid[y - 1][x - 1] || grid[y - 1][x + 1]);
        if (hasFloor && (hasLeftWall || hasRightWall || hasCeilingPressure)) {
          candidates.push({ x, y });
        }
      }
    }

    return candidates.filter((cell) => cell.y >= 0 && cell.y < ROWS);
  }

  function buildRescuePieces() {
    const pocketCells = collectPocketCells();
    if (pocketCells.length < 3) return [];

    const sorted = pocketCells.slice().sort((a, b) => {
      const byDepth = b.y - a.y;
      return byDepth || a.x - b.x;
    });
    const candidates = [];

    for (const start of sorted.slice(0, 12)) {
      const picked = [start];
      const queue = [start];
      const seen = new Set([`${start.x},${start.y}`]);

      const targetSize = 3 + Math.floor(Math.random() * 3);
      while (queue.length && picked.length < targetSize) {
        const cell = queue.shift();
        const neighbors = [
          { x: cell.x + 1, y: cell.y },
          { x: cell.x - 1, y: cell.y },
          { x: cell.x, y: cell.y + 1 },
          { x: cell.x, y: cell.y - 1 },
        ].sort(() => Math.random() - 0.5);

        neighbors.forEach((neighbor) => {
          const key = `${neighbor.x},${neighbor.y}`;
          const match = pocketCells.some((candidate) => candidate.x === neighbor.x && candidate.y === neighbor.y);
          if (!seen.has(key) && match && picked.length < targetSize) {
            seen.add(key);
            picked.push(neighbor);
            queue.push(neighbor);
          }
        });
      }

      if (picked.length >= 3) {
        const matrix = trimMatrix(picked);
        if (!matrixIsConnected(matrix)) continue;
        const testPiece = { type: "R", matrix, x: Math.floor((COLS - matrix[0].length) / 2), y: -2 };
        if (!simulatedCollision(grid, testPiece)) {
          const candidate = { type: "R", matrix, rescue: true, color: RESCUE_COLOR };
          if (!candidates.some((piece) => pieceKey(piece) === pieceKey(candidate))) {
            candidates.push(candidate);
          }
        }
      }
    }

    return candidates;
  }

  function chooseAdaptivePiece() {
    if (!grid) return nextNormalPiece();

    const lineBreakerPieces = buildLineBreakerPieces().filter((piece) => !repeatedTooMuch(piece));
    if (lineBreakerPieces.length && Math.random() < 0.82) {
      return lineBreakerPieces[Math.floor(Math.random() * lineBreakerPieces.length)];
    }

    if (isEmergencyBoard()) {
      const rescuePieces = buildRescuePieces().filter((piece) => !repeatedTooMuch(piece));
      if (rescuePieces.length && Math.random() < 0.9) {
        return rescuePieces[Math.floor(Math.random() * rescuePieces.length)];
      }

      const pool = PIECE_TYPES
        .filter((type) => !repeatedTooMuch(type))
        .map((type) => ({
          type,
          score: scorePieceFit(type),
        }));
      pool.sort((a, b) => b.score - a.score);

      const choices = pool.slice(0, 4);
      return choices[Math.floor(Math.random() * choices.length)]?.type || nextNormalPiece();
    }

    return nextNormalPiece(generatedStreak >= 5 ? lastGeneratedKey : null);
  }

  function refreshDifficulty() {
    const lineSpeed = 780 - (level - 1) * 48;
    const cappedScore = Math.min(score, 30000);
    const scoreSpeed = Math.max(0, Math.floor(cappedScore / 1000)) * 18;
    dropInterval = Math.max(45, lineSpeed - scoreSpeed);
  }

  function ghostPiece() {
    if (!active) return null;
    const ghost = {
      type: active.type,
      matrix: active.matrix,
      x: active.x,
      y: active.y,
    };
    while (!collides(ghost, 0, 1)) ghost.y += 1;
    return ghost;
  }

  function ensureAudio() {
    if (audio || !window.AudioContext && !window.webkitAudioContext) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    const context = new Audio();
    const master = context.createGain();
    master.gain.value = 0.055;
    master.connect(context.destination);
    audio = {
      context,
      master,
      musicTimer: 0,
      noteIndex: 0,
      playing: false,
      notes: [330, 392, 440, 392, 330, 294, 330, 247, 294, 330, 392, 330],
    };
  }

  function playTone(frequency, duration, type = "square", volume = 0.4) {
    ensureAudio();
    if (!audio) return;
    const now = audio.context.currentTime;
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audio.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function scheduleMusic() {
    if (!audio || !audio.playing) return;
    const note = audio.notes[audio.noteIndex % audio.notes.length];
    playTone(note, 0.09, "square", 0.28);
    if (audio.noteIndex % 4 === 0) playTone(note / 2, 0.12, "triangle", 0.14);
    audio.noteIndex += 1;
    const tempo = Math.max(78, dropInterval * 0.32);
    audio.musicTimer = window.setTimeout(scheduleMusic, tempo);
  }

  function startMusic() {
    ensureAudio();
    if (!audio) return;
    audio.context.resume();
    if (audio.playing) return;
    audio.playing = true;
    scheduleMusic();
  }

  function stopMusic() {
    if (!audio) return;
    audio.playing = false;
    window.clearTimeout(audio.musicTimer);
  }

  function playLineClearSound(count) {
    [523, 659, 784, 1046].slice(0, count + 1).forEach((frequency, index) => {
      window.setTimeout(() => playTone(frequency, 0.1, "square", 0.55), index * 45);
    });
  }

  function playDropSound() {
    playTone(110, 0.055, "sawtooth", 0.18);
  }

  function drawCell(ctx, x, y, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x + 2, y + 2, size - 4, 4);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.32)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    ctx.restore();
  }

  function drawMatrix(ctx, matrix, type, originX, originY, size, alpha = 1) {
    matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) drawCell(ctx, originX + x * size, originY + y * size, size, COLORS[type] || RESCUE_COLOR, alpha);
      });
    });
  }

  function drawBoardBackground() {
    boardCtx.fillStyle = "#0d1015";
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardCtx.strokeStyle = "rgba(255,255,255,0.06)";
    boardCtx.lineWidth = 1;
    for (let x = 0; x <= COLS; x += 1) {
      boardCtx.beginPath();
      boardCtx.moveTo(x * CELL + 0.5, 0);
      boardCtx.lineTo(x * CELL + 0.5, ROWS * CELL);
      boardCtx.stroke();
    }
    for (let y = 0; y <= ROWS; y += 1) {
      boardCtx.beginPath();
      boardCtx.moveTo(0, y * CELL + 0.5);
      boardCtx.lineTo(COLS * CELL, y * CELL + 0.5);
      boardCtx.stroke();
    }
  }

  function draw() {
    drawBoardBackground();
    grid.forEach((row, y) => {
      row.forEach((type, x) => {
        if (type) drawCell(boardCtx, x * CELL, y * CELL, CELL, COLORS[type] || RESCUE_COLOR);
      });
    });
    if (clearingRows.length) {
      const pulse = Math.floor((performance.now() - clearingStartedAt) / 55) % 2 === 0;
      boardCtx.save();
      boardCtx.globalAlpha = pulse ? 0.72 : 0.28;
      boardCtx.fillStyle = "#ffffff";
      clearingRows.forEach((row) => boardCtx.fillRect(0, row * CELL, COLS * CELL, CELL));
      boardCtx.restore();
    }
    if (active) {
      const ghost = ghostPiece();
      if (ghost) drawMatrix(boardCtx, ghost.matrix, ghost.type, ghost.x * CELL, ghost.y * CELL, CELL, 0.22);
      drawMatrix(boardCtx, active.matrix, active.type, active.x * CELL, active.y * CELL, CELL);
    }
    drawNext();
  }

  function drawMini(ctx, entry) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = "#15191f";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!entry) return;
    const definition = normalizePiece(entry);
    const matrix = definition.matrix;
    const width = matrix[0].length * MINI;
    const height = matrix.length * MINI;
    const x = (ctx.canvas.width - width) / 2;
    const y = (ctx.canvas.height - height) / 2;
    drawMatrix(ctx, matrix, definition.type, x, y, MINI);
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.fillStyle = "#15191f";
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextQueue.slice(0, 4).forEach((entry, index) => {
      const definition = normalizePiece(entry);
      const matrix = definition.matrix;
      const width = matrix[0].length * MINI;
      const x = (nextCanvas.width - width) / 2;
      const y = 14 + index * 66;
      drawMatrix(nextCtx, matrix, definition.type, x, y, MINI);
    });
  }

  function updateStats() {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem("arcade-stack-best-score", String(bestScore));
    }
    scoreEl.textContent = score.toLocaleString();
    linesEl.textContent = lines.toString();
    levelEl.textContent = level.toString();
    speedEl.textContent = `${(780 / dropInterval).toFixed(1)}x`;
    bestScoreEl.textContent = bestScore.toLocaleString();
  }

  function setOverlay(title, copy, show = true) {
    overlayTitle.textContent = title;
    overlayCopy.textContent = copy;
    overlay.classList.toggle("hidden", !show);
  }

  function canPlay() {
    return running && !paused && !gameOver && !clearingRows.length;
  }

  function tick(time = 0) {
    const delta = time - lastTime;
    lastTime = time;
    if (canPlay()) {
      dropCounter += delta;
      if (dropCounter > dropInterval) softDrop();
    }
    draw();
    animationId = requestAnimationFrame(tick);
  }

  function startGame() {
    running = true;
    paused = false;
    gameOver = false;
    startMusic();
    setOverlay("", "", false);
  }

  function togglePause() {
    if (gameOver) return;
    if (!running) {
      startGame();
      return;
    }
    paused = !paused;
    if (paused) {
      stopMusic();
    } else {
      startMusic();
    }
    setOverlay("Paused", "Press P to resume", paused);
  }

  function finishGame() {
    gameOver = true;
    running = false;
    stopMusic();
    setOverlay("Game Over", "Press Restart or Space");
  }

  function resetGame() {
    grid = createGrid();
    nextQueue = [];
    normalBag = [];
    lastGeneratedKey = "";
    generatedStreak = 0;
    score = 0;
    bestScore = Number(localStorage.getItem("arcade-stack-best-score")) || 0;
    lines = 0;
    level = 1;
    fillQueue();
    active = spawnPiece();
    holdPiece = null;
    holdLocked = false;
    dropCounter = 0;
    dropInterval = 760;
    refreshDifficulty();
    lastTime = 0;
    running = false;
    paused = false;
    gameOver = false;
    clearingRows = [];
    clearingStartedAt = 0;
    clearToken += 1;
    updateStats();
    drawMini(holdCtx, null);
    setOverlay("Ready?", "Press Space or any control");
  }

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(key)) {
      event.preventDefault();
    }
    if (key === " " && (!running || gameOver)) {
      resetGame();
      startGame();
      return;
    }
    if (key === "p") togglePause();
    if (!running && !gameOver && key !== "p") startGame();
    if (key === "arrowleft") move(-1);
    if (key === "arrowright") move(1);
    if (key === "arrowup" || key === "x") rotateActive();
    if (key === "arrowdown") softDrop();
    if (key === " ") hardDrop();
    if (key === "c" || key === "shift") hold();
  });

  document.querySelector(".touch-pad").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (!running && !gameOver) startGame();
    const action = button.dataset.action;
    if (action === "left") move(-1);
    if (action === "right") move(1);
    if (action === "rotate") rotateActive();
    if (action === "down") softDrop();
    if (action === "drop") hardDrop();
    if (action === "hold") hold();
  });

  pauseButton.addEventListener("click", togglePause);
  restartButton.addEventListener("click", () => {
    resetGame();
    startGame();
  });
  window.addEventListener("resize", updateMobileLayout);
  window.addEventListener("orientationchange", updateMobileLayout);

  updateMobileLayout();
  resetGame();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(tick);
})();
