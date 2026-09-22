// js/setupManager.js
// Complete Game Engine for BattleTech Alpha Strike:
// Setup Phase -> Movement Phase -> MinMax Combat Phase -> Damage Resolution -> Victory

const PHASES = {
  MAP_VIEW: 'MAP_VIEW',
  CHOICE: 'CHOICE',
  DRAFT: 'DRAFT',
  DEPLOYMENT: 'DEPLOYMENT',
  ROUND_START: 'ROUND_START',
  MOVEMENT: 'MOVEMENT',
  COMBAT: 'COMBAT',
  DAMAGE_RESOLUTION: 'DAMAGE_RESOLUTION',
  GAME_OVER: 'GAME_OVER'
};

class SetupManager {
  constructor(gameMap, mechDatabase, uiCallbacks) {
    this.map = gameMap;
    this.mechs = mechDatabase;
    this.ui = uiCallbacks;
    this.combatAI = new CombatAI(gameMap);

    // Game Setup State
    this.currentPhase = PHASES.MAP_VIEW;
    this.firstPlayer = null; // 'player' or 'computer'
    this.playerEdge = null;  // 'north' or 'south'
    this.computerEdge = null;// 'south' or 'north'

    // Draft State
    this.draftActiveDrafter = null;
    this.playerDrafted = []; // max 4 mechs
    this.computerDrafted = []; // max 4 mechs
    this.draftStatus = {};

    // Deployment State
    this.deployActivePlayer = null;
    this.playerDeployed = [];
    this.computerDeployed = [];
    this.currentDeployingMech = null;
    this.placedSpawnSquare = null;
    this.tentativeMoveSquare = null;
    this.reachableForDeploy = new Map();

    // Active Gameplay Loop State
    this.roundNumber = 1;
    this.activeMovementPlayer = null; // 'player' or 'computer'
    this.selectedMoveMech = null;
    this.tentativeTargetSquare = null;

    this.activeCombatPlayer = null; // 'player' or 'computer'
    this.selectedCombatAttacker = null;
    this.selectedCombatTarget = null;
    this.combatLegalAttacks = [];

    this.winner = null; // 'player' or 'computer' or 'draw'

    this.initHandlers();
  }

  log(message, type = 'info') {
    if (this.ui.onLog) {
      this.ui.onLog(message, type);
    }
  }

  initHandlers() {
    this.map.onCellClick = (x, y, tile) => this.handleCellClick(x, y, tile);
    this.map.onCellHover = (cell, tile) => this.handleCellHover(cell, tile);
  }

  start() {
    this.currentPhase = PHASES.MAP_VIEW;
    this.log(`Tactical map generated: 42x42 ${this.map.biome.name} biome. Obstacles: ${this.map.obstacleRatio.toFixed(1)}% (${this.map.obstacleCount} tiles).`, 'system');
    this.log("Review the map. Click 'Proceed to Advantage Choice' when ready.", 'instruction');
    this.ui.updatePhase(this.currentPhase);
  }

  regenerateMap() {
    if (this.currentPhase !== PHASES.MAP_VIEW) return;
    this.map.init();
    this.log(`Map regenerated: 42x42 ${this.map.biome.name} biome with ${this.map.obstacleRatio.toFixed(1)}% obstacles.`, 'system');
    this.ui.updateMapStats();
  }

  proceedToChoice() {
    if (this.currentPhase !== PHASES.MAP_VIEW) return;
    this.currentPhase = PHASES.CHOICE;
    this.log("Phase: Advantage Choice. Pick whether to Draft First OR choose your Spawn Edge.", 'instruction');
    this.ui.updatePhase(this.currentPhase);
    this.ui.showChoiceModal();
  }

  // --- Choice Phase Logic ---
  handlePlayerChoice(choice, edgeChoice = null) {
    if (this.currentPhase !== PHASES.CHOICE) return;

    if (choice === 'draft_first') {
      const randEdge = Math.random() < 0.5 ? 'north' : 'south';
      this.computerEdge = randEdge;
      this.playerEdge = randEdge === 'north' ? 'south' : 'north';

      this.firstPlayer = 'computer';
      this.draftActiveDrafter = 'player';

      this.log(`Player selected: Draft First!`, 'player');
      this.log(`Computer picked spawn edge: ${this.computerEdge.toUpperCase()}. (Computer is First Player)`, 'computer');
      this.log(`Player spawn edge: ${this.playerEdge.toUpperCase()}.`, 'player');
    } else if (choice === 'pick_spawn') {
      this.playerEdge = edgeChoice;
      this.computerEdge = edgeChoice === 'north' ? 'south' : 'north';

      this.firstPlayer = 'player';
      this.draftActiveDrafter = 'computer';

      this.log(`Player picked spawn edge: ${this.playerEdge.toUpperCase()}. (Player is First Player!)`, 'player');
      this.log(`Computer spawn edge: ${this.computerEdge.toUpperCase()}. Computer drafts first.`, 'computer');
    }

    this.startDraftPhase();
  }

  // --- Draft Phase Logic ---
  startDraftPhase() {
    this.currentPhase = PHASES.DRAFT;
    this.log("Phase: Mech Draft. Each commander drafts 1 Size 4, 1 Size 3, 1 Size 2, and 1 Size 1 mech.", 'instruction');
    this.ui.updatePhase(this.currentPhase);
    this.ui.renderDraftCards();

    if (this.draftActiveDrafter === 'computer') {
      this.scheduleComputerDraftPick();
    } else {
      this.log("Your turn to draft! Click a mech card to recruit.", 'turn');
    }
  }

  hasPickedSize(owner, size) {
    const list = owner === 'player' ? this.playerDrafted : this.computerDrafted;
    return list.some(m => m.size === size);
  }

  canDraftMech(mech, drafter) {
    if (this.draftStatus[mech.code]) return false;
    return !this.hasPickedSize(drafter, mech.size);
  }

  handlePlayerCardClick(mechCode) {
    if (this.currentPhase !== PHASES.DRAFT) return;
    if (this.draftActiveDrafter !== 'player') return;

    const mech = this.mechs.find(m => m.code === mechCode);
    if (!mech) return;

    if (!this.canDraftMech(mech, 'player')) {
      if (this.hasPickedSize('player', mech.size)) {
        this.log(`You already have a Size ${mech.size} mech! Choose another size.`, 'warning');
      }
      return;
    }

    this.executeDraftPick('player', mech);

    if (this.isDraftComplete()) {
      this.startDeploymentPhase();
    } else {
      this.draftActiveDrafter = 'computer';
      this.ui.updateDraftTurn('computer');
      this.scheduleComputerDraftPick();
    }
  }

  scheduleComputerDraftPick() {
    this.ui.updateDraftTurn('computer');
    this.log("Computer is evaluating draft options...", 'turn');

    setTimeout(() => {
      if (this.currentPhase !== PHASES.DRAFT) return;

      const eligible = this.mechs.filter(m => this.canDraftMech(m, 'computer'));
      if (eligible.length === 0) return;

      const pick = eligible[Math.floor(Math.random() * eligible.length)];
      this.executeDraftPick('computer', pick);

      if (this.isDraftComplete()) {
        this.startDeploymentPhase();
      } else {
        this.draftActiveDrafter = 'player';
        this.ui.updateDraftTurn('player');
        this.log("Your turn to draft! Click an available mech card.", 'turn');
      }
    }, 800);
  }

  executeDraftPick(owner, mech) {
    const mechInstance = {
      ...mech,
      id: `${owner}_${mech.code}_${Date.now()}`,
      owner: owner,
      deployed: false,
      position: null,
      squaresMoved: 0,
      movementModifier: 0,
      hasMoved: false,
      hasAttacked: false,
      queuedDamage: 0,
      destroyed: false,
      maxArmor: mech.health.armor,
      maxStructure: mech.health.structure,
      health: {
        armor: mech.health.armor,
        structure: mech.health.structure
      }
    };

    this.draftStatus[mech.code] = { owner, mech: mechInstance };

    if (owner === 'player') {
      this.playerDrafted.push(mechInstance);
      this.log(`You drafted: ${mech.name} (${mech.code}) - Size ${mech.size}.`, 'player');
    } else {
      this.computerDrafted.push(mechInstance);
      this.log(`Computer drafted: ${mech.name} (${mech.code}) - Size ${mech.size}.`, 'computer');
    }

    this.ui.renderDraftCards();
  }

  isDraftComplete() {
    return this.playerDrafted.length === 4 && this.computerDrafted.length === 4;
  }

  // --- Deployment Phase Logic ---
  startDeploymentPhase() {
    this.currentPhase = PHASES.DEPLOYMENT;
    this.deployActivePlayer = this.firstPlayer;

    this.log("Phase: Deployment. Taking turns starting with First Player (" + (this.firstPlayer === 'player' ? 'Player' : 'Computer') + ").", 'instruction');
    this.log("During each turn: select a mech, place it touching your spawn edge, and move up to its movement value.", 'instruction');

    this.ui.updatePhase(this.currentPhase);
    this.startDeploymentTurn();
  }

  startDeploymentTurn() {
    this.placedSpawnSquare = null;
    this.tentativeMoveSquare = null;
    this.reachableForDeploy.clear();
    this.map.clearHighlights();

    const isPlayerTurn = this.deployActivePlayer === 'player';
    this.ui.updateDeploymentTurn(this.deployActivePlayer);

    if (isPlayerTurn) {
      const undeployed = this.playerDrafted.filter(m => !m.deployed);
      if (undeployed.length === 0) {
        this.checkDeploymentFinished();
        return;
      }
      this.log("Your turn to deploy! Select one of your mechs below, then click your spawn edge.", 'turn');
      this.selectMechForDeployment(undeployed[0]);
    } else {
      const undeployed = this.computerDrafted.filter(m => !m.deployed);
      if (undeployed.length === 0) {
        this.checkDeploymentFinished();
        return;
      }
      this.scheduleComputerDeployment();
    }
  }

  selectMechForDeployment(mech) {
    if (this.currentPhase !== PHASES.DEPLOYMENT) return;
    if (this.deployActivePlayer !== 'player') return;
    if (mech.deployed) return;

    this.currentDeployingMech = mech;
    this.placedSpawnSquare = null;
    this.tentativeMoveSquare = null;
    this.reachableForDeploy.clear();

    this.map.setHighlightEdge(this.playerEdge);
    this.map.setReachableTiles(null);

    const edgeRow = this.playerEdge === 'north' ? 1 : MAP_SIZE;
    this.log(`Deploying ${mech.name} (${mech.code}): Click an open square along Row ${edgeRow} to place touching edge.`, 'instruction');
    this.ui.renderDeploymentDock();
  }

  calculateMovementModifier(squaresMoved, totalMove) {
    if (squaresMoved === 0) return 0;
    const pct = squaresMoved / totalMove;
    if (pct <= 0.25) return 1;
    if (pct <= 0.50) return 2;
    if (pct <= 0.75) return 3;
    return 4;
  }

  resetCurrentDeployment() {
    if (!this.placedSpawnSquare) return;
    this.placedSpawnSquare = null;
    this.tentativeMoveSquare = null;
    this.reachableForDeploy.clear();
    this.map.previewPlacement = null;
    this.map.clearHighlights();
    this.map.setHighlightEdge(this.playerEdge);
    this.log("Placement reset. Click an open square along your map edge.", 'info');
    this.ui.renderDeploymentDock();
  }

  confirmPlayerDeployment() {
    if (!this.placedSpawnSquare || !this.tentativeMoveSquare) return;
    const mech = this.currentDeployingMech;
    const finalPos = this.tentativeMoveSquare;

    mech.deployed = true;
    mech.position = { x: finalPos.x, y: finalPos.y };
    mech.squaresMoved = finalPos.cost;
    mech.movementModifier = this.calculateMovementModifier(finalPos.cost, mech.move_value);

    this.map.tiles[finalPos.y][finalPos.x].mech = mech;
    this.playerDeployed.push(mech);

    this.map.previewPlacement = null;
    this.map.clearHighlights();
    this.map.render();

    this.log(`Deployed ${mech.name} at (${finalPos.x + 1}, ${finalPos.y + 1}). Moved ${finalPos.cost} squares (MM: +${mech.movementModifier}).`, 'player');

    this.currentDeployingMech = null;
    this.placedSpawnSquare = null;
    this.tentativeMoveSquare = null;

    if (this.ui.updateSideComponents) this.ui.updateSideComponents();
    this.advanceDeploymentTurn();
  }

  scheduleComputerDeployment() {
    this.log("Computer is deploying a mech...", 'turn');

    setTimeout(() => {
      if (this.currentPhase !== PHASES.DEPLOYMENT) return;

      const undeployed = this.computerDrafted.filter(m => !m.deployed);
      if (undeployed.length === 0) {
        this.advanceDeploymentTurn();
        return;
      }

      const mech = undeployed[0];
      const targetRow = this.computerEdge === 'north' ? 0 : MAP_SIZE - 1;

      const validEdgeCols = [];
      for (let c = 0; c < MAP_SIZE; c++) {
        const tile = this.map.tiles[targetRow][c];
        if (!tile.isObstacle && !tile.mech) {
          validEdgeCols.push(c);
        }
      }

      if (validEdgeCols.length === 0) return;

      const col = validEdgeCols[Math.floor(Math.random() * validEdgeCols.length)];
      const spawnX = col;
      const spawnY = targetRow;

      const reachable = this.map.getReachableCells(spawnX, spawnY, mech.move_value, mech.id);

      let bestDest = { x: spawnX, y: spawnY, cost: 0 };
      let maxAdvance = 0;
      const centerY = MAP_SIZE / 2;

      reachable.forEach((entry) => {
        const distToCenter = Math.abs(entry.y - centerY);
        const spawnDistToCenter = Math.abs(spawnY - centerY);
        const advance = spawnDistToCenter - distToCenter;

        if (advance > maxAdvance || (advance === maxAdvance && entry.cost > bestDest.cost)) {
          maxAdvance = advance;
          bestDest = entry;
        }
      });

      mech.deployed = true;
      mech.position = { x: bestDest.x, y: bestDest.y };
      mech.squaresMoved = bestDest.cost;
      mech.movementModifier = this.calculateMovementModifier(bestDest.cost, mech.move_value);

      this.map.tiles[bestDest.y][bestDest.x].mech = mech;
      this.computerDeployed.push(mech);

      this.map.render();
      this.log(`Computer deployed ${mech.name} (${mech.code}) at (${bestDest.x + 1}, ${bestDest.y + 1}) [Spawn: (${spawnX + 1}, ${spawnY + 1})]. Moved ${bestDest.cost} squares (MM: +${mech.movementModifier}).`, 'computer');

      this.advanceDeploymentTurn();
    }, 900);
  }

  advanceDeploymentTurn() {
    if (this.checkDeploymentFinished()) return;

    const playerHasUndeployed = this.playerDrafted.some(m => !m.deployed);
    const computerHasUndeployed = this.computerDrafted.some(m => !m.deployed);

    if (this.deployActivePlayer === 'player') {
      if (computerHasUndeployed) {
        this.deployActivePlayer = 'computer';
      }
    } else {
      if (playerHasUndeployed) {
        this.deployActivePlayer = 'player';
      }
    }

    this.startDeploymentTurn();
  }

  checkDeploymentFinished() {
    const totalDeployed = this.playerDeployed.length + this.computerDeployed.length;
    if (totalDeployed === 8) {
      this.finishSetupPhase();
      return true;
    }
    return false;
  }

  finishSetupPhase() {
    this.map.clearHighlights();
    this.log("🎉 SETUP PHASE COMPLETE! All 8 mechs deployed. Commencing Round 1!", 'system');
    this.startRound(1);
  }

  // =========================================================================
  // CORE GAME LOOP: Movement -> Combat -> Damage Resolution
  // =========================================================================

  startRound(roundNum) {
    this.roundNumber = roundNum;
    this.map.clearAttackLines();

    // Reset round status on all surviving mechs
    [...this.playerDrafted, ...this.computerDrafted].forEach(m => {
      if (!m.destroyed) {
        m.hasMoved = false;
        m.hasAttacked = false;
        m.queuedDamage = 0;
      }
    });

    this.log(`========== ROUND ${this.roundNumber} START ==========`, 'system');
    this.startMovementPhase();
  }

  // --- 1. MOVEMENT PHASE ---
  startMovementPhase() {
    this.currentPhase = PHASES.MOVEMENT;
    this.activeMovementPlayer = this.firstPlayer;
    this.selectedMoveMech = null;
    this.tentativeTargetSquare = null;
    this.map.clearHighlights();

    this.log(`--- MOVEMENT PHASE (Round ${this.roundNumber}) ---`, 'instruction');
    this.log(`Taking turns starting with First Player (${this.firstPlayer === 'player' ? 'Player' : 'Computer'}).`, 'instruction');

    this.ui.updatePhase(this.currentPhase);
    this.startMovementTurn();
  }

  startMovementTurn() {
    this.selectedMoveMech = null;
    this.tentativeTargetSquare = null;
    this.map.clearHighlights();
    this.ui.updateSideComponents();

    // Check if movement phase is finished
    const playerUnmoved = this.playerDrafted.filter(m => !m.destroyed && !m.hasMoved);
    const computerUnmoved = this.computerDrafted.filter(m => !m.destroyed && !m.hasMoved);

    if (playerUnmoved.length === 0 && computerUnmoved.length === 0) {
      this.log("All units have completed movement. Moving to Combat Phase!", 'system');
      this.startCombatPhase();
      return;
    }

    // Check if active player has units left to move
    if (this.activeMovementPlayer === 'player') {
      if (playerUnmoved.length === 0) {
        this.activeMovementPlayer = 'computer';
        this.startMovementTurn();
        return;
      }
      this.ui.updateMovementTurn('player');
      this.log("Your Turn to Move! Select an unmoved mech to position.", 'turn');
      // Auto-select first unmoved mech
      this.selectMechForMovement(playerUnmoved[0]);
    } else {
      if (computerUnmoved.length === 0) {
        this.activeMovementPlayer = 'player';
        this.startMovementTurn();
        return;
      }
      this.ui.updateMovementTurn('computer');
      this.scheduleComputerMovement();
    }
  }

  selectMechForMovement(mech) {
    if (this.currentPhase !== PHASES.MOVEMENT) return;
    if (this.activeMovementPlayer !== 'player') return;
    if (mech.destroyed || mech.hasMoved) return;

    this.selectedMoveMech = mech;
    this.tentativeTargetSquare = { x: mech.position.x, y: mech.position.y, cost: 0 };

    const reachable = this.map.getReachableCells(mech.position.x, mech.position.y, mech.move_value, mech.id);
    this.map.setReachableTiles(reachable);
    this.map.previewPlacement = { x: mech.position.x, y: mech.position.y, mech };
    this.map.render();

    this.log(`Selected ${mech.name} (${mech.code}) [Move: ${mech.move_value}]. Click a highlighted square to move there, or Confirm to stay.`, 'instruction');
    this.ui.renderMovementControls();
    this.ui.updateSideComponents();
  }

  confirmPlayerMovement() {
    if (!this.selectedMoveMech || !this.tentativeTargetSquare) return;
    const mech = this.selectedMoveMech;
    const dest = this.tentativeTargetSquare;

    // Move mech on grid
    this.map.tiles[mech.position.y][mech.position.x].mech = null;
    mech.position = { x: dest.x, y: dest.y };
    this.map.tiles[dest.y][dest.x].mech = mech;

    mech.squaresMoved = dest.cost;
    mech.movementModifier = this.calculateMovementModifier(dest.cost, mech.move_value);
    mech.hasMoved = true;

    this.log(`Player moved ${mech.name} to (${dest.x + 1}, ${dest.y + 1}). Moved ${dest.cost} squares (MM: +${mech.movementModifier}).`, 'player');

    this.selectedMoveMech = null;
    this.tentativeTargetSquare = null;
    this.map.clearHighlights();
    this.map.render();
    this.ui.updateSideComponents();

    this.advanceMovementTurn();
  }

  scheduleComputerMovement() {
    this.log("Computer is maneuvering forces...", 'turn');

    setTimeout(() => {
      if (this.currentPhase !== PHASES.MOVEMENT) return;

      const unmoved = this.computerDrafted.filter(m => !m.destroyed && !m.hasMoved);
      if (unmoved.length === 0) {
        this.advanceMovementTurn();
        return;
      }

      const mech = unmoved[0];
      const reachable = this.map.getReachableCells(mech.position.x, mech.position.y, mech.move_value, mech.id);

      // Computer tactical movement:
      // Finds closest player mech and moves towards desirable combat range
      const alivePlayerMechs = this.playerDrafted.filter(m => !m.destroyed);
      let bestTile = { x: mech.position.x, y: mech.position.y, cost: 0 };
      let bestScore = -Infinity;

      reachable.forEach(entry => {
        let tileScore = 0;

        if (alivePlayerMechs.length > 0) {
          // Measure distance to closest player mech
          let minDist = Infinity;
          let closestPlayer = alivePlayerMechs[0];
          for (const p of alivePlayerMechs) {
            const d = Math.hypot(entry.x - p.position.x, entry.y - p.position.y);
            if (d < minDist) {
              minDist = d;
              closestPlayer = p;
            }
          }

          // Desired range depends on mech's weapon profile
          let desiredRange = 5; // Default short/medium
          if (mech.damage.long >= 2 && mech.damage.short <= 2) desiredRange = 12; // Sniper (Archer)
          else if (mech.size >= 3) desiredRange = 2; // Assault/Brawler (Atlas, Highlander)

          const distDiff = Math.abs(minDist - desiredRange);
          tileScore -= distDiff * 4;

          // Bonus for moving enough to generate movement modifier (+TMM defense)
          const mm = this.calculateMovementModifier(entry.cost, mech.move_value);
          tileScore += mm * 6;

          // Check if destination has Line of Sight to enemy
          if (this.map.hasLineOfSight(entry.x, entry.y, closestPlayer.position.x, closestPlayer.position.y)) {
            tileScore += 15;
          }
        }

        if (tileScore > bestScore) {
          bestScore = tileScore;
          bestTile = entry;
        }
      });

      // Move computer mech
      this.map.tiles[mech.position.y][mech.position.x].mech = null;
      mech.position = { x: bestTile.x, y: bestTile.y };
      this.map.tiles[bestTile.y][bestTile.x].mech = mech;

      mech.squaresMoved = bestTile.cost;
      mech.movementModifier = this.calculateMovementModifier(bestTile.cost, mech.move_value);
      mech.hasMoved = true;

      this.map.render();
      this.log(`Computer moved ${mech.name} (${mech.code}) to (${bestTile.x + 1}, ${bestTile.y + 1}). Moved ${bestTile.cost} squares (MM: +${mech.movementModifier}).`, 'computer');
      this.ui.updateSideComponents();

      this.advanceMovementTurn();
    }, 850);
  }

  advanceMovementTurn() {
    const playerUnmoved = this.playerDrafted.some(m => !m.destroyed && !m.hasMoved);
    const computerUnmoved = this.computerDrafted.some(m => !m.destroyed && !m.hasMoved);

    if (this.activeMovementPlayer === 'player') {
      if (computerUnmoved) {
        this.activeMovementPlayer = 'computer';
      }
    } else {
      if (playerUnmoved) {
        this.activeMovementPlayer = 'player';
      }
    }

    this.startMovementTurn();
  }

  // --- 2. COMBAT PHASE ---
  startCombatPhase() {
    this.currentPhase = PHASES.COMBAT;
    this.activeCombatPlayer = this.firstPlayer;
    this.selectedCombatAttacker = null;
    this.selectedCombatTarget = null;
    this.combatLegalAttacks = [];
    this.map.clearHighlights();

    this.log(`--- COMBAT PHASE (Round ${this.roundNumber}) ---`, 'instruction');
    this.log("Starting with First Player, commanders activate mechs for combat actions.", 'instruction');

    this.ui.updatePhase(this.currentPhase);
    this.startCombatTurn();
  }

  startCombatTurn() {
    this.selectedCombatAttacker = null;
    this.selectedCombatTarget = null;
    this.combatLegalAttacks = [];
    this.map.clearHighlights();
    this.ui.updateSideComponents();

    // Check if combat phase is finished
    const playerUnacted = this.playerDrafted.filter(m => !m.destroyed && !m.hasAttacked);
    const computerUnacted = this.computerDrafted.filter(m => !m.destroyed && !m.hasAttacked);

    if (playerUnacted.length === 0 && computerUnacted.length === 0) {
      this.log("All units have completed combat actions. Proceeding to Damage Resolution!", 'system');
      this.startDamageResolutionPhase();
      return;
    }

    if (this.activeCombatPlayer === 'player') {
      if (playerUnacted.length === 0) {
        this.activeCombatPlayer = 'computer';
        this.startCombatTurn();
        return;
      }
      this.ui.updateCombatTurn('player');
      this.log("Your Turn to Attack! Select an active mech to target the enemy.", 'turn');
      this.selectAttackerForCombat(playerUnacted[0]);
    } else {
      if (computerUnacted.length === 0) {
        this.activeCombatPlayer = 'player';
        this.startCombatTurn();
        return;
      }
      this.ui.updateCombatTurn('computer');
      this.scheduleComputerCombatAction();
    }
  }

  selectAttackerForCombat(mech) {
    if (this.currentPhase !== PHASES.COMBAT) return;
    if (this.activeCombatPlayer !== 'player') return;
    if (mech.destroyed || mech.hasAttacked) return;

    this.selectedCombatAttacker = mech;
    this.selectedCombatTarget = null;

    const aliveComputer = this.computerDrafted.filter(m => !m.destroyed);
    this.combatLegalAttacks = this.combatAI.getLegalAttacksForMech(mech, aliveComputer);

    const targetMechs = this.combatLegalAttacks.map(a => a.target);
    this.map.setTargetableMechs(targetMechs, mech);

    if (this.combatLegalAttacks.length > 0) {
      // Auto-select first legal target for convenience
      this.selectTargetForCombat(this.combatLegalAttacks[0]);
      this.log(`${mech.name} (${mech.code}) selected. Found ${this.combatLegalAttacks.length} valid target(s). Click a highlighted target to attack.`, 'instruction');
    } else {
      this.log(`${mech.name} (${mech.code}) has no enemies in Line of Sight or Range! You may pass action.`, 'warning');
      this.ui.renderCombatControls();
    }
    this.ui.updateSideComponents();
  }

  selectTargetForCombat(attackOption) {
    this.selectedCombatTarget = attackOption;
    this.ui.renderCombatControls();
  }

  passPlayerCombatAction() {
    if (!this.selectedCombatAttacker) return;
    const mech = this.selectedCombatAttacker;
    mech.hasAttacked = true;
    this.log(`Player passed combat action for ${mech.name} (${mech.code}).`, 'player');

    this.selectedCombatAttacker = null;
    this.selectedCombatTarget = null;
    this.map.clearHighlights();
    this.ui.updateSideComponents();
    this.advanceCombatTurn();
  }

  executePlayerCombatAttack() {
    if (!this.selectedCombatAttacker || !this.selectedCombatTarget) return;

    const attacker = this.selectedCombatAttacker;
    const attack = this.selectedCombatTarget;
    const target = attack.target;

    // Roll d12
    const roll = Math.floor(Math.random() * 12) + 1;
    const isHit = roll > attack.toHit;
    const dmg = isHit ? attack.damage : 0;

    if (isHit) {
      target.queuedDamage = (target.queuedDamage || 0) + dmg;
    }

    // Draw Blue line for Player attack
    // "Combat phase should draw a line between attacker and target when attack is completed to indicate end of combat action.. Computer draws a red line and player draws a blue line."
    this.map.addAttackLine(
      attacker.position.x, attacker.position.y,
      target.position.x, target.position.y,
      'blue', isHit, dmg,
      `${isHit ? `HIT (-${dmg})` : 'MISS'} [d12: ${roll} vs ${attack.toHit}]`
    );

    const modeText = attack.isMelee ? 'MELEE' : `RANGED (${attack.rangeBracket.toUpperCase()})`;
    this.log(
      `🎲 Player ${attacker.name} -> ${target.name} [${modeText}]: Rolled ${roll} (Needed > ${attack.toHit}) -> ${isHit ? `HIT! Queued ${dmg} damage.` : 'MISS!'}`,
      'player'
    );

    attacker.hasAttacked = true;
    this.selectedCombatAttacker = null;
    this.selectedCombatTarget = null;
    this.map.clearHighlights();
    this.ui.updateSideComponents();

    this.advanceCombatTurn();
  }

  scheduleComputerCombatAction() {
    this.log("Computer is executing combat targeting (MinMax)...", 'turn');

    setTimeout(() => {
      if (this.currentPhase !== PHASES.COMBAT) return;

      const unacted = this.computerDrafted.filter(m => !m.destroyed && !m.hasAttacked);
      if (unacted.length === 0) {
        this.advanceCombatTurn();
        return;
      }

      // MinMax decision
      const action = this.combatAI.findBestCombatAction(this.computerDrafted, this.playerDrafted);

      if (action.pass) {
        // Computer passes first unacted mech
        const passMech = unacted[0];
        passMech.hasAttacked = true;
        this.log(`Computer passed combat action for ${passMech.name} (${action.reason}).`, 'computer');
      } else {
        const attacker = action.attacker;
        const target = action.target;

        const roll = Math.floor(Math.random() * 12) + 1;
        const isHit = roll > action.toHit;
        const dmg = isHit ? action.damage : 0;

        if (isHit) {
          target.queuedDamage = (target.queuedDamage || 0) + dmg;
        }

        // Draw Red line for Computer attack
        this.map.addAttackLine(
          attacker.position.x, attacker.position.y,
          target.position.x, target.position.y,
          'red', isHit, dmg,
          `${isHit ? `HIT (-${dmg})` : 'MISS'} [d12: ${roll} vs ${action.toHit}]`
        );

        const modeText = action.isMelee ? 'MELEE' : `RANGED (${action.rangeBracket.toUpperCase()})`;
        this.log(
          `🎲 Computer ${attacker.name} -> ${target.name} [${modeText}]: Rolled ${roll} (Needed > ${action.toHit}) -> ${isHit ? `HIT! Queued ${dmg} damage.` : 'MISS!'}`,
          'computer'
        );

        attacker.hasAttacked = true;
      }

      this.ui.updateSideComponents();
      this.advanceCombatTurn();
    }, 950);
  }

  advanceCombatTurn() {
    const playerUnacted = this.playerDrafted.some(m => !m.destroyed && !m.hasAttacked);
    const computerUnacted = this.computerDrafted.some(m => !m.destroyed && !m.hasAttacked);

    if (this.activeCombatPlayer === 'player') {
      if (computerUnacted) {
        this.activeCombatPlayer = 'computer';
      }
    } else {
      if (playerUnacted) {
        this.activeCombatPlayer = 'player';
      }
    }

    this.startCombatTurn();
  }

  // --- 3. DAMAGE RESOLUTION PHASE ---
  // Rule 52-58:
  // "All damage qued is now subtracted from mechs health.
  // First mechs lose that damage from their armor then they lose that damage from their structure.
  // Once structure is reduced to 0, the mech is destroyed. Destroyed mechs become greyed out and act as obstacles."
  // Rule clarification: "When damage is resolved any damage that is left over after reducing armor to 0 is carried over to structure."
  startDamageResolutionPhase() {
    this.currentPhase = PHASES.DAMAGE_RESOLUTION;
    this.log(`--- DAMAGE RESOLUTION PHASE (Round ${this.roundNumber}) ---`, 'instruction');
    this.ui.updatePhase(this.currentPhase);

    // Apply damage simultaneously to all mechs
    const allMechs = [...this.playerDrafted, ...this.computerDrafted];
    let damagedCount = 0;

    allMechs.forEach(mech => {
      if (mech.destroyed) return;
      const queued = mech.queuedDamage || 0;
      if (queued > 0) {
        damagedCount++;
        const prevArmor = mech.health.armor;
        const prevStruct = mech.health.structure;

        // 1. Subtract from armor
        const armorLoss = Math.min(queued, mech.health.armor);
        mech.health.armor -= armorLoss;

        // 2. Leftover carries over to structure
        const leftover = queued - armorLoss;
        const structLoss = Math.min(leftover, mech.health.structure);
        mech.health.structure -= structLoss;

        mech.queuedDamage = 0;

        const roleTag = mech.owner === 'player' ? 'Player' : 'Computer';
        this.log(
          `💥 ${roleTag} ${mech.name} takes ${queued} damage! (Armor: ${prevArmor} -> ${mech.health.armor}, Structure: ${prevStruct} -> ${mech.health.structure})`,
          mech.owner === 'player' ? 'player' : 'computer'
        );

        // 3. Destruction check
        if (mech.health.structure <= 0) {
          mech.health.structure = 0;
          mech.destroyed = true;
          this.log(`☠️ ${roleTag} ${mech.name} (${mech.code}) is DESTROYED! Wreckage acts as impassable cover.`, 'warning');
        }
      }
    });

    if (damagedCount === 0) {
      this.log("No damage was sustained this round.", 'info');
    }

    this.map.render();
    this.ui.updateSideComponents();
    this.ui.renderDamageResolutionControls();
  }

  proceedFromDamageResolution() {
    // Clear attack lines from map
    this.map.clearAttackLines();

    // Check Victory condition
    const alivePlayer = this.playerDrafted.filter(m => !m.destroyed);
    const aliveComputer = this.computerDrafted.filter(m => !m.destroyed);

    if (alivePlayer.length === 0 && aliveComputer.length === 0) {
      this.endGame('draw');
      return;
    }
    if (alivePlayer.length === 0) {
      this.endGame('computer');
      return;
    }
    if (aliveComputer.length === 0) {
      this.endGame('player');
      return;
    }

    // Start next round!
    this.startRound(this.roundNumber + 1);
  }

  endGame(winner) {
    this.currentPhase = PHASES.GAME_OVER;
    this.winner = winner;

    if (winner === 'player') {
      this.log("🏆 VICTORY! You have eliminated all enemy forces! Outstanding commander!", 'player');
    } else if (winner === 'computer') {
      this.log("💀 DEFEAT! All your mechs were destroyed. The computer prevails!", 'computer');
    } else {
      this.log("⚖️ DRAW! Both forces were mutually destroyed in battle.", 'system');
    }

    this.ui.updatePhase(this.currentPhase);
    this.ui.renderGameOver();
  }

  // --- Grid Click / Hover Delegation ---
  handleDeploymentCellClick(x, y, tile) {
    if (this.deployActivePlayer !== 'player') return;
    if (!this.currentDeployingMech) return;

    const mech = this.currentDeployingMech;
    const targetRow = this.playerEdge === 'north' ? 0 : MAP_SIZE - 1;

    // Step 1: Placing on Edge
    if (!this.placedSpawnSquare) {
      if (y !== targetRow) {
        this.log(`You must place your mech touching your map edge (Row ${targetRow + 1})!`, 'warning');
        return;
      }
      if (tile.isObstacle) {
        this.log("That square is an impassable obstacle! Choose an open square.", 'warning');
        return;
      }
      if (tile.mech) {
        this.log("A mech already occupies that square!", 'warning');
        return;
      }

      // Valid edge placement!
      this.placedSpawnSquare = { x, y };
      this.tentativeMoveSquare = { x, y, cost: 0, path: [{ x, y }] };

      // Calculate reachable movement squares from spawn
      this.reachableForDeploy = this.map.getReachableCells(x, y, mech.move_value, mech.id);
      this.map.setReachableTiles(this.reachableForDeploy);
      this.map.previewPlacement = { x, y, mech };
      this.map.render();

      this.log(`${mech.name} placed at (${x + 1}, ${y + 1}). Now click a highlighted square to move (up to ${mech.move_value} squares), or Confirm to stay.`, 'instruction');
      this.ui.renderDeploymentDock();
      return;
    }

    // Step 2: Moving from Edge
    const key = `${x},${y}`;
    if (this.reachableForDeploy.has(key)) {
      const reach = this.reachableForDeploy.get(key);
      this.tentativeMoveSquare = reach;
      this.map.previewPlacement = { x, y, mech };
      this.map.render();

      this.log(`Destination selected: (${x + 1}, ${y + 1}) [${reach.cost} / ${mech.move_value} squares moved]. Click 'Confirm Placement & Move' to finalize.`, 'info');
      this.ui.renderDeploymentDock();
    } else {
      this.log(`Square (${x + 1}, ${y + 1}) is out of movement range or blocked!`, 'warning');
    }
  }

  handleCellClick(x, y, tile) {
    if (this.currentPhase === PHASES.DEPLOYMENT) {
      this.handleDeploymentCellClick(x, y, tile);
      return;
    }

    if (this.currentPhase === PHASES.MOVEMENT && this.activeMovementPlayer === 'player') {
      if (!this.selectedMoveMech) {
        if (tile.mech && tile.mech.owner === 'player' && !tile.mech.destroyed && !tile.mech.hasMoved) {
          this.selectMechForMovement(tile.mech);
        }
        return;
      }

      // Check if clicking reachable square
      const key = `${x},${y}`;
      if (this.map.reachableTiles.has(key)) {
        const reach = this.map.reachableTiles.get(key);
        this.tentativeTargetSquare = reach;
        this.map.previewPlacement = { x, y, mech: this.selectedMoveMech };
        this.map.render();
        this.log(`Destination set to (${x + 1}, ${y + 1}) [${reach.cost} / ${this.selectedMoveMech.move_value} moved]. Click 'Confirm Move' to finalize.`, 'info');
        this.ui.renderMovementControls();
      }
      return;
    }

    if (this.currentPhase === PHASES.COMBAT && this.activeCombatPlayer === 'player') {
      if (tile.mech) {
        // If clicking own unacted mech, switch attacker
        if (tile.mech.owner === 'player' && !tile.mech.destroyed && !tile.mech.hasAttacked) {
          this.selectAttackerForCombat(tile.mech);
          return;
        }

        // If clicking an enemy mech, check if it's in targetable list
        if (tile.mech.owner === 'computer' && !tile.mech.destroyed) {
          const match = this.combatLegalAttacks.find(a => a.target.id === tile.mech.id);
          if (match) {
            this.selectTargetForCombat(match);
          } else {
            this.log(`Target ${tile.mech.name} is not in Line of Sight or is out of range!`, 'warning');
          }
        }
      }
    }
  }

  handleCellHover(cell, tile) {
    if (this.ui.onCellHover) {
      this.ui.onCellHover(cell, tile);
    }
  }
}

window.SetupManager = SetupManager;
window.PHASES = PHASES;
