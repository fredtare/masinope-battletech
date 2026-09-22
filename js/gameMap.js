// js/gameMap.js
// Handles 42x42 Map Generation, Biomes, Obstacles, Canvas Rendering, Line of Sight, and Attack Lines

const MAP_SIZE = 42;

const BIOMES = {
  GRASS: {
    id: 'grass',
    name: 'Grassy Field',
    bg: '#254e20',
    grid: '#31632a',
    cellEven: '#2a5624',
    cellOdd: '#285322',
    obstacle: '#12230e',
    obstacleBorder: '#0b1609',
    edgeNorth: 'rgba(59, 130, 246, 0.35)',
    edgeSouth: 'rgba(239, 68, 68, 0.35)'
  },
  DESERT: {
    id: 'desert',
    name: 'Desert Dunes',
    bg: '#b58b4c',
    grid: '#a0783b',
    cellEven: '#bc9252',
    cellOdd: '#b78d4e',
    obstacle: '#543b1c',
    obstacleBorder: '#382611',
    edgeNorth: 'rgba(59, 130, 246, 0.35)',
    edgeSouth: 'rgba(239, 68, 68, 0.35)'
  },
  URBAN: {
    id: 'urban',
    name: 'Urban Ruins',
    bg: '#374151',
    grid: '#4b5563',
    cellEven: '#3e495a',
    cellOdd: '#3a4454',
    obstacle: '#181e28',
    obstacleBorder: '#0e1219',
    edgeNorth: 'rgba(59, 130, 246, 0.35)',
    edgeSouth: 'rgba(239, 68, 68, 0.35)'
  }
};

class GameMap {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.size = MAP_SIZE;
    this.biome = null;
    this.tiles = []; // 2D array [row][col] -> { x, y, isObstacle: bool, mech: null }
    this.obstacleCount = 0;
    this.obstacleRatio = 0;

    // Viewport & Zoom
    this.cellSize = 20; // base cell size in px
    this.offsetX = 30;  // margin for coordinates
    this.offsetY = 30;
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Interactive Highlights
    this.hoverCell = null; // { x, y }
    this.highlightEdge = null; // 'north' or 'south'
    this.reachableTiles = new Map(); // key "x,y" => { x, y, cost, path }
    this.previewPlacement = null; // { x, y, mech }
    this.targetableMechs = []; // list of target mech objects
    this.selectedAttacker = null; // mech currently aiming

    // Attack Lines
    // Array of { from: {x,y}, to: {x,y}, color: 'blue'|'red', hit: bool, damage: number, label: string }
    this.attackLines = [];

    this.onCellClick = null;
    this.onCellHover = null;

    this.initEventListeners();
  }

  init(biomeOverride = null) {
    // 1. Pick Random Biome
    const biomeKeys = Object.keys(BIOMES);
    const chosenKey = biomeOverride || biomeKeys[Math.floor(Math.random() * biomeKeys.length)];
    this.biome = BIOMES[chosenKey];

    // 2. Initialize Empty Grid
    this.tiles = [];
    for (let r = 0; r < this.size; r++) {
      const row = [];
      for (let c = 0; c < this.size; c++) {
        row.push({
          x: c,
          y: r,
          isObstacle: false,
          mech: null
        });
      }
      this.tiles.push(row);
    }

    // 3. Generate 10-25% Obstacles (Darkened background squares)
    const totalTiles = this.size * this.size; // 1764
    const targetRatio = 0.12 + Math.random() * 0.10; // ~12% - 22%
    const targetObstacles = Math.floor(totalTiles * targetRatio);

    let placed = 0;
    const seeds = 25 + Math.floor(Math.random() * 15);
    for (let s = 0; s < seeds && placed < targetObstacles; s++) {
      const seedX = 1 + Math.floor(Math.random() * (this.size - 2));
      const seedY = 1 + Math.floor(Math.random() * (this.size - 2));
      const clusterSize = 3 + Math.floor(Math.random() * 7);

      let currX = seedX;
      let currY = seedY;
      for (let c = 0; c < clusterSize && placed < targetObstacles; c++) {
        if (currX >= 0 && currX < this.size && currY >= 0 && currY < this.size) {
          const isEdge = (currY === 0 || currY === this.size - 1);
          if (!this.tiles[currY][currX].isObstacle && (!isEdge || Math.random() < 0.15)) {
            this.tiles[currY][currX].isObstacle = true;
            placed++;
          }
        }
        currX += Math.floor(Math.random() * 3) - 1;
        currY += Math.floor(Math.random() * 3) - 1;
      }
    }

    while (placed < targetObstacles) {
      const rx = Math.floor(Math.random() * this.size);
      const ry = Math.floor(Math.random() * this.size);
      const isEdge = (ry === 0 || ry === this.size - 1);
      if (!this.tiles[ry][rx].isObstacle && (!isEdge || Math.random() < 0.15)) {
        this.tiles[ry][rx].isObstacle = true;
        placed++;
      }
    }

    this.ensureEdgeClearance(0);
    this.ensureEdgeClearance(this.size - 1);

    this.obstacleCount = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.tiles[r][c].isObstacle) this.obstacleCount++;
      }
    }
    this.obstacleRatio = (this.obstacleCount / totalTiles) * 100;

    this.attackLines = [];
    this.fitCanvas();
    this.render();
  }

  ensureEdgeClearance(row) {
    let clearCount = 0;
    for (let c = 0; c < this.size; c++) {
      if (!this.tiles[row][c].isObstacle) clearCount++;
    }
    if (clearCount < 25) {
      for (let c = 0; c < this.size && clearCount < 25; c++) {
        if (this.tiles[row][c].isObstacle) {
          this.tiles[row][c].isObstacle = false;
          clearCount++;
        }
      }
    }
  }

  fitCanvas() {
    const parent = this.canvas.parentElement;
    const needed = this.offsetX + this.size * this.cellSize + 20;
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = needed * dpr;
    this.canvas.height = needed * dpr;
    this.canvas.style.width = `${needed}px`;
    this.canvas.style.height = `${needed}px`;
    
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }

  initEventListeners() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isPanning) {
        this.panX += mx - this.lastMouseX;
        this.panY += my - this.lastMouseY;
        this.lastMouseX = mx;
        this.lastMouseY = my;
        this.render();
        return;
      }

      const cell = this.pixelToCell(mx, my);
      if (cell) {
        if (!this.hoverCell || this.hoverCell.x !== cell.x || this.hoverCell.y !== cell.y) {
          this.hoverCell = cell;
          this.render();
          if (this.onCellHover) this.onCellHover(cell, this.tiles[cell.y][cell.x]);
        }
      } else if (this.hoverCell) {
        this.hoverCell = null;
        this.render();
        if (this.onCellHover) this.onCellHover(null, null);
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverCell = null;
      this.isPanning = false;
      this.render();
      if (this.onCellHover) this.onCellHover(null, null);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.isPanning = true;
        this.lastMouseX = e.clientX - this.canvas.getBoundingClientRect().left;
        this.lastMouseY = e.clientY - this.canvas.getBoundingClientRect().top;
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cell = this.pixelToCell(mx, my);
      if (cell && this.onCellClick) {
        this.onCellClick(cell.x, cell.y, this.tiles[cell.y][cell.x]);
      }
    });
  }

  pixelToCell(px, py) {
    const gx = px - this.offsetX - this.panX;
    const gy = py - this.offsetY - this.panY;
    const col = Math.floor(gx / (this.cellSize * this.scale));
    const row = Math.floor(gy / (this.cellSize * this.scale));

    if (col >= 0 && col < this.size && row >= 0 && row < this.size) {
      return { x: col, y: row };
    }
    return null;
  }

  cellToPixel(col, row) {
    return {
      x: this.offsetX + this.panX + col * (this.cellSize * this.scale),
      y: this.offsetY + this.panY + row * (this.cellSize * this.scale)
    };
  }

  // --- Line of Sight (LoS) Raycasting ---
  // Rule 23-24: "If you can draw a line from the center of your mechs square to the enemy mechs square you have line of sight."
  // Rule 2: Impassable obstacles act as cover and cannot be shot through.
  // Rule 57: Destroyed mechs act as obstacles.
  hasLineOfSight(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist <= 1.0) return true; // Adjacent squares always have LoS

    const steps = Math.ceil(dist * 8) + 8;
    const p1x = x1 + 0.5;
    const p1y = y1 + 0.5;
    const p2x = x2 + 0.5;
    const p2y = y2 + 0.5;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      // Exclude immediately adjacent margins to prevent false hits on origin/dest cell
      if (t < 0.02 || t > 0.98) continue;

      const sx = p1x + t * (p2x - p1x);
      const sy = p1y + t * (p2y - p1y);
      const cx = Math.floor(sx);
      const cy = Math.floor(sy);

      // If at start or end square, continue
      if ((cx === x1 && cy === y1) || (cx === x2 && cy === y2)) continue;

      if (cx >= 0 && cx < this.size && cy >= 0 && cy < this.size) {
        const tile = this.tiles[cy][cx];
        if (tile.isObstacle) return false;
        if (tile.mech && tile.mech.destroyed) return false;
      }
    }
    return true;
  }

  // Measure range in square lengths from center to center
  getRange(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  // Check if two cells are adjacent (base contact / melee)
  isAdjacent(x1, y1, x2, y2) {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    return Math.max(dx, dy) === 1;
  }

  // --- Pathfinding & Reachable Cells ---
  getReachableCells(startX, startY, maxMove, currentMechId = null) {
    const reachable = new Map();
    const queue = [{ x: startX, y: startY, cost: 0, path: [{ x: startX, y: startY }] }];
    const visited = new Map();
    visited.set(`${startX},${startY}`, 0);
    reachable.set(`${startX},${startY}`, { x: startX, y: startY, cost: 0, path: [{ x: startX, y: startY }] });

    const deltas = [
      { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
      { dx: 1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];

    while (queue.length > 0) {
      const { x, y, cost, path } = queue.shift();
      if (cost >= maxMove) continue;

      for (const d of deltas) {
        const nx = x + d.dx;
        const ny = y + d.dy;

        if (nx < 0 || nx >= this.size || ny < 0 || ny >= this.size) continue;

        const destTile = this.tiles[ny][nx];
        // Cannot move onto or through obstacles or destroyed mechs (acting as obstacles)
        if (destTile.isObstacle || (destTile.mech && destTile.mech.destroyed)) continue;

        // Diagonal corner check
        if (d.dx !== 0 && d.dy !== 0) {
          const t1 = this.tiles[y][nx];
          const t2 = this.tiles[ny][x];
          const obs1 = t1.isObstacle || (t1.mech && t1.mech.destroyed);
          const obs2 = t2.isObstacle || (t2.mech && t2.mech.destroyed);
          if (obs1 && obs2) continue;
        }

        // Mech blocking check: cannot move through or land on another alive mech
        const existingMech = destTile.mech;
        if (existingMech && (!currentMechId || existingMech.id !== currentMechId)) {
          continue;
        }

        const nextCost = cost + 1;
        const key = `${nx},${ny}`;

        if (!visited.has(key) || visited.get(key) > nextCost) {
          visited.set(key, nextCost);
          const nextPath = [...path, { x: nx, y: ny }];
          const entry = { x: nx, y: ny, cost: nextCost, path: nextPath };
          reachable.set(key, entry);
          queue.push(entry);
        }
      }
    }

    return reachable;
  }

  // --- Attack Lines ---
  addAttackLine(fromX, fromY, toX, toY, color, hit, damage, label = '') {
    this.attackLines.push({
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      color: color, // 'blue' or 'red'
      hit: hit,
      damage: damage,
      label: label
    });
    this.render();
  }

  clearAttackLines() {
    this.attackLines = [];
    this.render();
  }

  setHighlightEdge(edge) {
    this.highlightEdge = edge;
    this.render();
  }

  setReachableTiles(reachableMap) {
    this.reachableTiles = reachableMap || new Map();
    this.render();
  }

  setTargetableMechs(targets, attacker = null) {
    this.targetableMechs = targets || [];
    this.selectedAttacker = attacker;
    this.render();
  }

  clearHighlights() {
    this.highlightEdge = null;
    this.reachableTiles.clear();
    this.previewPlacement = null;
    this.targetableMechs = [];
    this.selectedAttacker = null;
    this.render();
  }

  // --- Rendering Engine ---
  render() {
    const ctx = this.ctx;
    const cSize = this.cellSize * this.scale;
    const totalW = this.offsetX + this.size * cSize + 20;
    const totalH = this.offsetY + this.size * cSize + 20;

    // Clear background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, totalW, totalH);

    // Render Axis Header background
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, totalW, this.offsetY);
    ctx.fillRect(0, 0, this.offsetX, totalH);

    // Axis labels: 1 to 42
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < this.size; i++) {
      const cx = this.offsetX + this.panX + (i + 0.5) * cSize;
      const cy = this.offsetY + this.panY + (i + 0.5) * cSize;
      if (cx >= this.offsetX && cx <= totalW - 10) {
        ctx.fillText(String(i + 1), cx, this.offsetY / 2);
      }
      if (cy >= this.offsetY && cy <= totalH - 10) {
        ctx.fillText(String(i + 1), this.offsetX / 2, cy);
      }
    }

    // Clip to board area
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offsetX, this.offsetY, this.size * cSize, this.size * cSize);
    ctx.clip();

    // Fill Board Terrain
    ctx.fillStyle = this.biome.bg;
    ctx.fillRect(this.offsetX + this.panX, this.offsetY + this.panY, this.size * cSize, this.size * cSize);

    // Render Grid Squares
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const tile = this.tiles[r][c];
        const px = this.offsetX + this.panX + c * cSize;
        const py = this.offsetY + this.panY + r * cSize;

        if (tile.isObstacle) {
          ctx.fillStyle = this.biome.obstacle;
          ctx.fillRect(px, py, cSize, cSize);
          ctx.strokeStyle = this.biome.obstacleBorder;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cSize - 1, cSize - 1);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(px + 2, py + 2, cSize - 4, cSize - 4);
        } else {
          ctx.fillStyle = (r + c) % 2 === 0 ? this.biome.cellEven : this.biome.cellOdd;
          ctx.fillRect(px, py, cSize, cSize);
        }

        ctx.strokeStyle = this.biome.grid;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, cSize, cSize);
      }
    }

    // Render Highlight Edge
    if (this.highlightEdge === 'north') {
      const edgeY = this.offsetY + this.panY;
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
      ctx.fillRect(this.offsetX + this.panX, edgeY, this.size * cSize, cSize);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.offsetX + this.panX, edgeY, this.size * cSize, cSize);
    } else if (this.highlightEdge === 'south') {
      const edgeY = this.offsetY + this.panY + (this.size - 1) * cSize;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.fillRect(this.offsetX + this.panX, edgeY, this.size * cSize, cSize);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.offsetX + this.panX, edgeY, this.size * cSize, cSize);
    }

    // Render Reachable Movement Range Overlay
    if (this.reachableTiles.size > 0) {
      this.reachableTiles.forEach((entry) => {
        const px = this.offsetX + this.panX + entry.x * cSize;
        const py = this.offsetY + this.panY + entry.y * cSize;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.fillRect(px + 1, py + 1, cSize - 2, cSize - 2);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 1.5, py + 1.5, cSize - 3, cSize - 3);

        if (cSize >= 16) {
          ctx.fillStyle = '#ecfdf5';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(entry.cost), px + cSize / 2, py + cSize / 2);
        }
      });
    }

    // Render Targetable Mechs Reticle Highlights
    if (this.targetableMechs.length > 0) {
      this.targetableMechs.forEach((tgt) => {
        if (!tgt.position) return;
        const px = this.offsetX + this.panX + tgt.position.x * cSize;
        const py = this.offsetY + this.panY + tgt.position.y * cSize;
        ctx.strokeStyle = '#f59e0b'; // Amber target reticle
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 0.5, py + 0.5, cSize - 1, cSize - 1);

        // Crosshairs in corners
        const cornerLen = 5;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        // Top-left
        ctx.beginPath();
        ctx.moveTo(px, py + cornerLen); ctx.lineTo(px, py); ctx.lineTo(px + cornerLen, py);
        // Top-right
        ctx.moveTo(px + cSize - cornerLen, py); ctx.lineTo(px + cSize, py); ctx.lineTo(px + cSize, py + cornerLen);
        // Bottom-left
        ctx.moveTo(px, py + cSize - cornerLen); ctx.lineTo(px, py + cSize); ctx.lineTo(px + cornerLen, py + cSize);
        // Bottom-right
        ctx.moveTo(px + cSize - cornerLen, py + cSize); ctx.lineTo(px + cSize, py + cSize); ctx.lineTo(px + cSize, py + cSize - cornerLen);
        ctx.stroke();
      });
    }

    // Render Selected Attacker Outline
    if (this.selectedAttacker && this.selectedAttacker.position) {
      const px = this.offsetX + this.panX + this.selectedAttacker.position.x * cSize;
      const py = this.offsetY + this.panY + this.selectedAttacker.position.y * cSize;
      ctx.strokeStyle = '#38bdf8'; // Cyan attacker aura
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px + 0.5, py + 0.5, cSize - 1, cSize - 1);
    }

    // Render Hover Cell
    if (this.hoverCell) {
      const px = this.offsetX + this.panX + this.hoverCell.x * cSize;
      const py = this.offsetY + this.panY + this.hoverCell.y * cSize;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, cSize - 2, cSize - 2);
    }

    // Render Mechs on Map
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const tile = this.tiles[r][c];
        if (tile.mech) {
          this.renderMechCircle(tile.mech, c, r, cSize);
        }
      }
    }

    // Render Preview Placement (ghost mech)
    if (this.previewPlacement) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      this.renderMechCircle(this.previewPlacement.mech, this.previewPlacement.x, this.previewPlacement.y, cSize);
      ctx.restore();
    }

    // Render Attack Lines
    // "Combat phase should draw a line between attacker and target when attack is completed to indicate end of combat action.. Computer draws a red line and player draws a blue line."
    if (this.attackLines.length > 0) {
      this.attackLines.forEach(line => {
        this.renderAttackLine(line, cSize);
      });
    }

    ctx.restore();
  }

  renderAttackLine(line, cSize) {
    const ctx = this.ctx;
    const x1 = this.offsetX + this.panX + (line.from.x + 0.5) * cSize;
    const y1 = this.offsetY + this.panY + (line.from.y + 0.5) * cSize;
    const x2 = this.offsetX + this.panX + (line.to.x + 0.5) * cSize;
    const y2 = this.offsetY + this.panY + (line.to.y + 0.5) * cSize;

    const strokeColor = line.color === 'blue' ? '#3b82f6' : '#ef4444';
    const glowColor = line.color === 'blue' ? 'rgba(59, 130, 246, 0.6)' : 'rgba(239, 68, 68, 0.6)';

    ctx.save();
    // Glow effect
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;

    // Draw main attack line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // End marker / crosshair at target
    ctx.beginPath();
    ctx.arc(x2, y2, cSize * 0.3, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Damage / Outcome badge along the line
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const badgeText = line.hit ? `HIT (-${line.damage})` : 'MISS';

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.font = 'bold 10px sans-serif';
    const textMetrics = ctx.measureText(badgeText);
    const boxW = textMetrics.width + 10;
    const boxH = 16;

    ctx.fillStyle = line.hit ? (line.color === 'blue' ? '#1e3a8a' : '#7f1d1d') : '#374151';
    ctx.fillRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(midX - boxW / 2, midY - boxH / 2, boxW, boxH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, midX, midY);

    ctx.restore();
  }

  renderMechCircle(mech, col, row, cSize) {
    const ctx = this.ctx;
    const cx = this.offsetX + this.panX + (col + 0.5) * cSize;
    const cy = this.offsetY + this.panY + (row + 0.5) * cSize;
    const radius = cSize * 0.42;

    const isPlayer = mech.owner === 'player';
    const isDestroyed = !!mech.destroyed;

    // Circle Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Draw Mech Circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);

    if (isDestroyed) {
      // Destroyed mechs become greyed out and act as obstacles
      ctx.fillStyle = '#374151';
    } else {
      ctx.fillStyle = isPlayer ? '#2563eb' : '#dc2626';
    }
    ctx.fill();

    // Circle Border
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, cSize * 0.08);

    if (isDestroyed) {
      ctx.strokeStyle = '#6b7280';
    } else {
      ctx.strokeStyle = isPlayer ? '#93c5fd' : '#fca5a5';
    }
    ctx.stroke();

    // Mech Code in center
    ctx.fillStyle = isDestroyed ? '#9ca3af' : '#ffffff';
    ctx.font = `bold ${Math.max(9, Math.floor(cSize * 0.42))}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mech.code, cx, cy);

    // If destroyed, draw small diagonal slash
    if (isDestroyed) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.6, cy - radius * 0.6);
      ctx.lineTo(cx + radius * 0.6, cy + radius * 0.6);
      ctx.stroke();
    }
  }
}

window.GameMap = GameMap;
window.BIOMES = BIOMES;
