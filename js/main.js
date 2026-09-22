// js/main.js
// Main Application Controller linking Map, Mechs, MinMax AI, Setup & Gameplay State Machine, and Edge Docks

document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('map-canvas');
  const logContainer = document.getElementById('log-messages');
  const phaseTitle = document.getElementById('phase-title');
  const phaseSubtitle = document.getElementById('phase-subtitle');
  const turnBanner = document.getElementById('turn-banner');
  const roundTrackerTag = document.getElementById('round-tracker-tag');

  // Panels
  const mapControlsPanel = document.getElementById('map-controls-panel');
  const draftPanel = document.getElementById('draft-panel');
  const deploymentPanel = document.getElementById('deployment-panel');
  const movementPanel = document.getElementById('movement-panel');
  const combatPanel = document.getElementById('combat-panel');
  const damagePanel = document.getElementById('damage-panel');
  const gameOverPanel = document.getElementById('game-over-panel');
  const choiceModal = document.getElementById('choice-modal');

  // 1. Initialize Map
  const gameMap = new GameMap(canvas);

  // 2. Load Mech Database
  const mechs = await MechDataModule.loadMechDatabase();

  // Helper: Append log message
  function addLog(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-text">${msg}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  // Helper: Hide all dynamic action panels
  function hideAllPanels() {
    mapControlsPanel?.classList.add('hidden');
    draftPanel?.classList.add('hidden');
    deploymentPanel?.classList.add('hidden');
    movementPanel?.classList.add('hidden');
    combatPanel?.classList.add('hidden');
    damagePanel?.classList.add('hidden');
    gameOverPanel?.classList.add('hidden');
  }

  // UI Callback Object for SetupManager / GameEngine
  const uiCallbacks = {
    onLog: addLog,

    updatePhase: (phase) => {
      document.querySelectorAll('.step-item').forEach(el => el.classList.remove('active', 'completed'));
      hideAllPanels();

      if (roundTrackerTag) {
        roundTrackerTag.textContent = `Round ${setupManager.roundNumber}`;
      }

      if (phase === PHASES.MAP_VIEW) {
        document.getElementById('step-map')?.classList.add('active');
        phaseTitle.textContent = "PHASE 1: MAP GENERATION";
        phaseSubtitle.textContent = "A 42x42 tactical grid has been generated with cover obstacles.";
        mapControlsPanel?.classList.remove('hidden');
        turnBanner.className = 'turn-banner info';
        turnBanner.textContent = "Explore the battlefield. When satisfied, proceed to Advantage Choice.";
        uiCallbacks.updateMapStats();
      } else if (phase === PHASES.CHOICE) {
        document.getElementById('step-map')?.classList.add('completed');
        document.getElementById('step-choice')?.classList.add('active');
        phaseTitle.textContent = "PHASE 2: ADVANTAGE SELECTION";
        phaseSubtitle.textContent = "Choose whether to Draft First or select your Spawn Edge.";
      } else if (phase === PHASES.DRAFT) {
        document.getElementById('step-map')?.classList.add('completed');
        document.getElementById('step-choice')?.classList.add('completed');
        document.getElementById('step-draft')?.classList.add('active');
        phaseTitle.textContent = "PHASE 3: MECH DRAFT";
        phaseSubtitle.textContent = "Draft 4 mechs: exactly 1 of Size 1, Size 2, Size 3, and Size 4.";
        draftPanel?.classList.remove('hidden');
        uiCallbacks.renderDraftCards();
      } else if (phase === PHASES.DEPLOYMENT) {
        document.getElementById('step-map')?.classList.add('completed');
        document.getElementById('step-choice')?.classList.add('completed');
        document.getElementById('step-draft')?.classList.add('completed');
        document.getElementById('step-deploy')?.classList.add('active');
        phaseTitle.textContent = "PHASE 4: FORCE DEPLOYMENT";
        phaseSubtitle.textContent = "Place mechs along your designated map edge and move up to movement value.";
        deploymentPanel?.classList.remove('hidden');
        uiCallbacks.renderDeploymentDock();
      } else if (phase === PHASES.MOVEMENT) {
        document.getElementById('step-map')?.classList.add('completed');
        document.getElementById('step-choice')?.classList.add('completed');
        document.getElementById('step-draft')?.classList.add('completed');
        document.getElementById('step-deploy')?.classList.add('completed');
        document.getElementById('step-movement')?.classList.add('active');
        phaseTitle.textContent = `ROUND ${setupManager.roundNumber}: MOVEMENT PHASE`;
        phaseSubtitle.textContent = "Maneuver mechs across the 42x42 battlefield. Movement generates Defense Modifiers.";
        movementPanel?.classList.remove('hidden');
        uiCallbacks.renderMovementControls();
      } else if (phase === PHASES.COMBAT) {
        document.getElementById('step-map')?.classList.add('completed');
        document.getElementById('step-choice')?.classList.add('completed');
        document.getElementById('step-draft')?.classList.add('completed');
        document.getElementById('step-deploy')?.classList.add('completed');
        document.getElementById('step-movement')?.classList.add('completed');
        document.getElementById('step-combat')?.classList.add('active');
        phaseTitle.textContent = `ROUND ${setupManager.roundNumber}: COMBAT PHASE`;
        phaseSubtitle.textContent = "Select targets in Line of Sight & Range (or Melee if adjacent). Damage is queued.";
        combatPanel?.classList.remove('hidden');
        uiCallbacks.renderCombatControls();
      } else if (phase === PHASES.DAMAGE_RESOLUTION) {
        document.getElementById('step-combat')?.classList.add('completed');
        document.getElementById('step-damage')?.classList.add('active');
        phaseTitle.textContent = `ROUND ${setupManager.roundNumber}: DAMAGE RESOLUTION`;
        phaseSubtitle.textContent = "Queued damage is simultaneously subtracted from Armor, then Structure.";
        damagePanel?.classList.remove('hidden');
      } else if (phase === PHASES.GAME_OVER) {
        document.getElementById('step-damage')?.classList.add('completed');
        phaseTitle.textContent = "MISSION COMPLETE: GAME OVER";
        phaseSubtitle.textContent = setupManager.winner === 'player' ? "All enemy mechs destroyed! Victory!" : "All player forces destroyed.";
        gameOverPanel?.classList.remove('hidden');
      }

      uiCallbacks.updateSideComponents();
    },

    updateMapStats: () => {
      const biomeTag = document.getElementById('map-biome-tag');
      const obstacleTag = document.getElementById('map-obstacle-tag');
      if (biomeTag) biomeTag.textContent = `Biome: ${gameMap.biome.name}`;
      if (obstacleTag) obstacleTag.textContent = `Obstacles: ${gameMap.obstacleRatio.toFixed(1)}% (${gameMap.obstacleCount} tiles)`;
    },

    showChoiceModal: () => {
      choiceModal.classList.remove('hidden');
      document.getElementById('choice-spawn-options').classList.add('hidden');
      document.getElementById('choice-main-buttons').classList.remove('hidden');
    },

    updateDraftTurn: (drafter) => {
      if (drafter === 'player') {
        turnBanner.className = 'turn-banner player-turn';
        turnBanner.textContent = "Your Turn to Draft! Select an available mech card.";
      } else {
        turnBanner.className = 'turn-banner cpu-turn';
        turnBanner.textContent = "Computer is evaluating draft choices...";
      }
      uiCallbacks.renderDraftCards();
    },

    renderDraftCards: () => {
      const container = document.getElementById('cards-grid');
      if (!container) return;
      container.innerHTML = '';

      const isPlayerTurn = setupManager.draftActiveDrafter === 'player';
      const sorted = [...mechs].sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));

      sorted.forEach(mech => {
        const status = setupManager.draftStatus[mech.code];
        const isDrafted = !!status;
        const playerHasSize = setupManager.hasPickedSize('player', mech.size);
        const canPick = isPlayerTurn && !isDrafted && !playerHasSize;

        const card = document.createElement('div');
        card.className = `mech-card ${isDrafted ? 'drafted' : ''} ${canPick ? 'clickable' : ''}`;
        if (isDrafted) {
          card.classList.add(status.owner === 'player' ? 'drafted-player' : 'drafted-cpu');
        } else if (playerHasSize && isPlayerTurn) {
          card.classList.add('size-blocked');
        }

        const sizeNames = { 1: 'Light', 2: 'Medium', 3: 'Heavy', 4: 'Assault' };

        card.innerHTML = `
          <div class="card-header">
            <span class="card-size-badge size-${mech.size}">Size ${mech.size} (${sizeNames[mech.size]})</span>
            <span class="card-code-badge">${mech.code}</span>
          </div>
          <div class="card-img-wrap">
            <img src="${mech.cardImage}" alt="${mech.name}" loading="lazy" />
            ${isDrafted ? `<div class="draft-badge ${status.owner}">${status.owner === 'player' ? 'DRAFTED BY YOU' : 'DRAFTED BY CPU'}</div>` : ''}
          </div>
          <div class="card-body">
            <h4 class="card-name">${mech.name}</h4>
            <div class="stats-grid">
              <div class="stat-box"><span class="stat-lbl">MOVE</span><span class="stat-val">${mech.move_value}"</span></div>
              <div class="stat-box"><span class="stat-lbl">TMM</span><span class="stat-val">${mech.TMM}</span></div>
              <div class="stat-box"><span class="stat-lbl">ARMOR</span><span class="stat-val">${mech.health.armor}</span></div>
              <div class="stat-box"><span class="stat-lbl">STRUCT</span><span class="stat-val">${mech.health.structure}</span></div>
            </div>
            <div class="dmg-bar">
              <span>DMG:</span>
              <span title="Short">S: <strong>${mech.damage.short}</strong></span>
              <span title="Medium">M: <strong>${mech.damage.medium}</strong></span>
              <span title="Long">L: <strong>${mech.damage.long}</strong></span>
            </div>
          </div>
        `;

        if (canPick) {
          card.addEventListener('click', () => {
            setupManager.handlePlayerCardClick(mech.code);
          });
        }

        container.appendChild(card);
      });

      renderRosterSummary();
    },

    updateDeploymentTurn: (deployer) => {
      const isPlayer = deployer === 'player';
      if (isPlayer) {
        turnBanner.className = 'turn-banner player-turn';
        turnBanner.textContent = "Your Turn to Deploy! Place a mech touching your map edge.";
      } else {
        turnBanner.className = 'turn-banner cpu-turn';
        turnBanner.textContent = "Computer is deploying forces...";
      }
      uiCallbacks.renderDeploymentDock();
    },

    renderDeploymentDock: () => {
      const container = document.getElementById('deployment-controls');
      if (!container) return;

      const isPlayerTurn = setupManager.deployActivePlayer === 'player';
      const curMech = setupManager.currentDeployingMech;
      const placed = setupManager.placedSpawnSquare;
      const targetMove = setupManager.tentativeMoveSquare;

      let html = `
        <div class="deploy-info-box">
          <div class="deploy-edges">
            <span>Your Edge: <strong class="edge-${setupManager.playerEdge}">${setupManager.playerEdge?.toUpperCase()} (Row ${setupManager.playerEdge === 'north' ? 1 : MAP_SIZE})</strong></span>
            <span>Enemy Edge: <strong class="edge-${setupManager.computerEdge}">${setupManager.computerEdge?.toUpperCase()} (Row ${setupManager.computerEdge === 'north' ? 1 : MAP_SIZE})</strong></span>
          </div>
        </div>
      `;

      html += `<h4 class="section-subheading">Your Undeployed Mechs:</h4><div class="undeployed-list">`;
      setupManager.playerDrafted.forEach(m => {
        const isSelected = curMech && curMech.code === m.code;
        const statusText = m.deployed ? `Deployed at (${m.position.x + 1}, ${m.position.y + 1})` : 'Ready to Deploy';
        html += `
          <div class="deploy-mech-item ${isSelected ? 'selected' : ''} ${m.deployed ? 'deployed' : ''}" data-code="${m.code}">
            <div class="token-preview ${m.deployed ? 'deployed-tok' : ''}">${m.code}</div>
            <div class="deploy-mech-details">
              <span class="deploy-name">${m.name} (Size ${m.size})</span>
              <span class="deploy-sub">Move: ${m.move_value} | ${statusText}</span>
            </div>
            ${!m.deployed && isPlayerTurn ? `<button class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'} select-deploy-btn" data-code="${m.code}">${isSelected ? 'Active' : 'Select'}</button>` : ''}
          </div>
        `;
      });
      html += `</div>`;

      if (isPlayerTurn && curMech && !curMech.deployed) {
        html += `
          <div class="active-deploy-panel">
            <h4>Deploying: <span class="highlight-cyan">${curMech.name} (${curMech.code})</span></h4>
            <p class="instruction-text">
              ${!placed 
                ? `👉 <strong>Step 1:</strong> Click an open square on Row ${setupManager.playerEdge === 'north' ? 1 : MAP_SIZE} to place touching your edge.` 
                : `👉 <strong>Step 2:</strong> Click a highlighted square to move (moved ${targetMove ? targetMove.cost : 0} / ${curMech.move_value} squares).`}
            </p>
            ${placed ? `
              <div class="deploy-action-buttons">
                <button id="btn-confirm-deploy" class="btn btn-primary">Confirm Placement & Move</button>
                <button id="btn-reset-deploy" class="btn btn-secondary">Reset to Edge</button>
              </div>
            ` : ''}
          </div>
        `;
      }

      container.innerHTML = html;

      container.querySelectorAll('.select-deploy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const code = e.target.getAttribute('data-code');
          const m = setupManager.playerDrafted.find(x => x.code === code);
          if (m) setupManager.selectMechForDeployment(m);
        });
      });

      const confirmBtn = document.getElementById('btn-confirm-deploy');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => setupManager.confirmPlayerDeployment());
      }
      const resetBtn = document.getElementById('btn-reset-deploy');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => setupManager.resetCurrentDeployment());
      }
    },

    // --- Movement Phase Controls ---
    updateMovementTurn: (mover) => {
      if (mover === 'player') {
        turnBanner.className = 'turn-banner player-turn';
        turnBanner.textContent = "Your Turn to Move! Select an unmoved mech.";
      } else {
        turnBanner.className = 'turn-banner cpu-turn';
        turnBanner.textContent = "Computer is maneuvering forces...";
      }
      uiCallbacks.renderMovementControls();
    },

    renderMovementControls: () => {
      const container = document.getElementById('movement-controls');
      if (!container) return;

      const isPlayerTurn = setupManager.activeMovementPlayer === 'player';
      const curMech = setupManager.selectedMoveMech;
      const targetSq = setupManager.tentativeTargetSquare;

      let html = `<div class="gameplay-action-panel">`;

      if (isPlayerTurn && curMech) {
        const movedCost = targetSq ? targetSq.cost : 0;
        const mm = setupManager.calculateMovementModifier(movedCost, curMech.move_value);

        html += `
          <h3>Maneuvering: <span class="highlight-cyan">${curMech.name} [${curMech.code}]</span></h3>
          <p>Click any highlighted square on the map to path there, or choose to stay in place.</p>
          <div class="combat-formula-box">
            <div class="formula-line"><span>Current Position:</span> <strong>(${curMech.position.x + 1}, ${curMech.position.y + 1})</strong></div>
            <div class="formula-line"><span>Selected Destination:</span> <strong>(${targetSq ? targetSq.x + 1 : '--'}, ${targetSq ? targetSq.y + 1 : '--'})</strong></div>
            <div class="formula-line"><span>Squares Moved:</span> <strong>${movedCost} / ${curMech.move_value}</strong></div>
            <div class="formula-line"><span>Generated Movement Modifier (Defense):</span> <strong class="formula-highlight">+${mm}</strong></div>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 6px;">
            <button id="btn-confirm-move" class="btn btn-primary">Confirm Move</button>
            <button id="btn-stay-move" class="btn btn-outline">Stay In Place (0 Move)</button>
          </div>
        `;
      } else if (isPlayerTurn) {
        html += `
          <h3>Movement Phase</h3>
          <p>Select an unmoved mech from your dock below or click its token on the map to activate it.</p>
        `;
      } else {
        html += `
          <h3>Computer Movement</h3>
          <p>Computer is calculating optimal tactical positioning...</p>
        `;
      }

      html += `</div>`;
      container.innerHTML = html;

      document.getElementById('btn-confirm-move')?.addEventListener('click', () => {
        setupManager.confirmPlayerMovement();
      });

      document.getElementById('btn-stay-move')?.addEventListener('click', () => {
        if (curMech) {
          setupManager.tentativeTargetSquare = { x: curMech.position.x, y: curMech.position.y, cost: 0 };
          setupManager.confirmPlayerMovement();
        }
      });
    },

    // --- Combat Phase Controls ---
    updateCombatTurn: (combatant) => {
      if (combatant === 'player') {
        turnBanner.className = 'turn-banner player-turn';
        turnBanner.textContent = "Your Turn to Attack! Select a target and fire.";
      } else {
        turnBanner.className = 'turn-banner cpu-turn';
        turnBanner.textContent = "Computer is selecting targets (MinMax)...";
      }
      uiCallbacks.renderCombatControls();
    },

    renderCombatControls: () => {
      const container = document.getElementById('combat-controls');
      if (!container) return;

      const isPlayerTurn = setupManager.activeCombatPlayer === 'player';
      const attacker = setupManager.selectedCombatAttacker;
      const targetOption = setupManager.selectedCombatTarget;
      const legalAttacks = setupManager.combatLegalAttacks;

      let html = `<div class="gameplay-action-panel">`;

      if (isPlayerTurn && attacker) {
        html += `
          <h3>Combat Action: <span class="highlight-cyan">${attacker.name} [${attacker.code}]</span></h3>
        `;

        if (targetOption) {
          const tgt = targetOption.target;
          const modeStr = targetOption.isMelee ? 'MELEE (Base Contact)' : `RANGED (${targetOption.rangeBracket.toUpperCase()})`;
          const rangeModStr = targetOption.isMelee ? 'N/A' : (targetOption.rangeDist <= 6 ? '+0 (Short)' : targetOption.rangeDist <= 12 ? '+2 (Med)' : '+4 (Long)');

          html += `
            <div class="combat-targeting-box">
              <div class="combat-duel-header">
                <div class="duel-unit attacker">
                  <span class="tok blue-tok">${attacker.code}</span> <strong>${attacker.name}</strong>
                  <div style="font-size:0.7rem; color:#9ca3af;">MM: +${attacker.movementModifier || 0} | Size ${attacker.size}</div>
                </div>
                <span class="duel-vs">VS</span>
                <div class="duel-unit target">
                  <span class="tok red-tok">${tgt.code}</span> <strong>${tgt.name}</strong>
                  <div style="font-size:0.7rem; color:#9ca3af;">TMM: ${tgt.TMM} | Armor: ${tgt.health.armor} | Str: ${tgt.health.structure}</div>
                </div>
              </div>

              <div class="combat-formula-box">
                <div class="formula-line"><span>Attack Mode:</span> <strong>${modeStr}</strong></div>
                <div class="formula-line"><span>Range Distance:</span> <strong>${targetOption.rangeDist.toFixed(1)} squares</strong></div>
                ${targetOption.isMelee 
                  ? `<div class="formula-line"><span>Melee Formula:</span> <span>(Att Size ${attacker.size} - Tgt Size ${tgt.size}) + Tgt MM ${tgt.movementModifier||0} + TMM ${tgt.TMM}</span></div>`
                  : `<div class="formula-line"><span>Ranged Formula:</span> <span>Att MM (+${attacker.movementModifier||0}) + Range (+${rangeModStr}) + Target TMM (+${tgt.TMM})</span></div>`}
                <div class="formula-line"><span>Required To-Hit:</span> <strong class="formula-highlight">Roll d12 > ${targetOption.toHit}</strong></div>
                <div class="formula-line"><span>Hit Probability:</span> <strong>${(targetOption.pHit * 100).toFixed(1)}%</strong></div>
                <div class="formula-line"><span>Potential Damage:</span> <strong style="color:#fbbf24;">${targetOption.damage} damage</strong></div>
              </div>

              <div style="display: flex; gap: 10px; margin-top: 6px;">
                <button id="btn-fire-attack" class="btn btn-primary btn-block">💥 Fire Weapons (Roll d12)</button>
                <button id="btn-pass-attack" class="btn btn-outline">Pass</button>
              </div>
            </div>
          `;
        } else if (legalAttacks.length > 0) {
          html += `
            <p>Select a target from the available enemy mechs in Line of Sight:</p>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${legalAttacks.map(atk => `
                <button class="btn btn-outline select-target-btn" data-target-id="${atk.target.id}" style="justify-content:space-between;">
                  <span><span class="tok red-tok">${atk.target.code}</span> ${atk.target.name} (${atk.rangeBracket})</span>
                  <span>To-Hit: >${atk.toHit} | DMG: ${atk.damage}</span>
                </button>
              `).join('')}
            </div>
            <button id="btn-pass-attack" class="btn btn-secondary" style="margin-top:8px;">Pass Combat Action</button>
          `;
        } else {
          html += `
            <p class="log-warning">No enemy targets are within Line of Sight or weapon range.</p>
            <button id="btn-pass-attack" class="btn btn-secondary">Pass Combat Action</button>
          `;
        }
      } else if (isPlayerTurn) {
        html += `
          <h3>Combat Phase</h3>
          <p>Select one of your active mechs to acquire targets and attack.</p>
        `;
      } else {
        html += `
          <h3>Computer Combat Phase</h3>
          <p>Computer is evaluating MinMax weapon targeting and combat engagement...</p>
        `;
      }

      html += `</div>`;
      container.innerHTML = html;

      document.getElementById('btn-fire-attack')?.addEventListener('click', () => {
        setupManager.executePlayerCombatAttack();
      });

      document.getElementById('btn-pass-attack')?.addEventListener('click', () => {
        setupManager.passPlayerCombatAction();
      });

      container.querySelectorAll('.select-target-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tgtId = btn.getAttribute('data-target-id');
          const atk = legalAttacks.find(a => a.target.id === tgtId);
          if (atk) setupManager.selectTargetForCombat(atk);
        });
      });
    },

    // --- Damage Resolution Controls ---
    renderDamageResolutionControls: () => {
      const container = document.getElementById('damage-controls');
      if (!container) return;

      const allMechs = [...setupManager.playerDrafted, ...setupManager.computerDrafted];

      let html = `
        <div class="gameplay-action-panel">
          <h3>Damage Resolution Complete</h3>
          <p>Queued attacks have landed simultaneously. Review the battlefield damage status below:</p>
          <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
            ${allMechs.map(m => `
              <div class="roster-slot ${m.destroyed ? 'empty' : 'filled'}" style="justify-content:space-between; align-items:center;">
                <span style="display:flex; align-items:center; gap:6px;">
                  <span class="tok ${m.owner === 'player' ? 'blue-tok' : 'red-tok'}">${m.code}</span>
                  <strong>${m.name}</strong> ${m.destroyed ? '<span style="color:#ef4444;">[DESTROYED]</span>' : ''}
                </span>
                <span>Armor: ${m.health.armor}/${m.maxArmor} | Struct: ${m.health.structure}/${m.maxStructure}</span>
              </div>
            `).join('')}
          </div>
          <button id="btn-next-round" class="btn btn-primary btn-block">Proceed to Round ${setupManager.roundNumber + 1} &rarr;</button>
        </div>
      `;

      container.innerHTML = html;

      document.getElementById('btn-next-round')?.addEventListener('click', () => {
        setupManager.proceedFromDamageResolution();
      });
    },

    // --- Game Over Screen ---
    renderGameOver: () => {
      const container = document.getElementById('game-over-controls');
      if (!container) return;

      const isWin = setupManager.winner === 'player';
      const isDraw = setupManager.winner === 'draw';

      let html = `
        <div class="action-card" style="text-align:center; padding:24px;">
          <h2 style="font-size:1.4rem; color:${isWin ? '#34d399' : isDraw ? '#fbbf24' : '#ef4444'}; margin-bottom:8px;">
            ${isWin ? '🏆 VICTORY ACHIEVED!' : isDraw ? '⚖️ MUTUAL DESTRUCTION' : '💀 MISSION FAILED'}
          </h2>
          <p style="margin-bottom:16px;">
            ${isWin 
              ? 'Outstanding tactical command! All computer mechs were successfully neutralized.' 
              : isDraw 
              ? 'Both battle lances eliminated each other in fierce combat.' 
              : 'All player battlemechs were destroyed. The computer forces claim the battlefield.'}
          </p>
          <button id="btn-restart-game" class="btn btn-primary">Start New Game</button>
        </div>
      `;

      container.innerHTML = html;

      document.getElementById('btn-restart-game')?.addEventListener('click', () => {
        location.reload();
      });
    },

    // --- Update Small Mech Components on North & South Docks ---
    // User requirement: "Add small components that represent each mech. Player mechs appear on the player side of map and computerr mechs appear on the computer side of map.
    // The component should contain: Name of mech, code of mech, Movement modifier, TMM and remaining armor and structure."
    updateSideComponents: () => {
      const northDock = document.getElementById('north-mech-dock');
      const southDock = document.getElementById('south-mech-dock');
      const northLabel = document.getElementById('north-dock-label');
      const southLabel = document.getElementById('south-dock-label');

      if (!northDock || !southDock) return;

      // Determine who is North and who is South
      const playerIsNorth = setupManager.playerEdge === 'north';
      const northMechs = playerIsNorth ? setupManager.playerDrafted : setupManager.computerDrafted;
      const southMechs = playerIsNorth ? setupManager.computerDrafted : setupManager.playerDrafted;

      if (northLabel) {
        northLabel.textContent = playerIsNorth ? "NORTH EDGE (ROW 1) - PLAYER LANCE" : "NORTH EDGE (ROW 1) - COMPUTER LANCE";
        northLabel.style.color = playerIsNorth ? "#60a5fa" : "#f87171";
      }
      if (southLabel) {
        southLabel.textContent = playerIsNorth ? `SOUTH EDGE (ROW ${MAP_SIZE}) - COMPUTER LANCE` : `SOUTH EDGE (ROW ${MAP_SIZE}) - PLAYER LANCE`;
        southLabel.style.color = playerIsNorth ? "#f87171" : "#60a5fa";
      }

      function renderDock(container, mechList) {
        container.innerHTML = '';
        if (!mechList || mechList.length === 0) {
          container.innerHTML = `<div style="grid-column: 1 / -1; font-size:0.75rem; color:#6b7280; padding:4px;">Pending Draft & Deployment...</div>`;
          return;
        }

        mechList.forEach(m => {
          const isPlayer = m.owner === 'player';
          const isDestroyed = !!m.destroyed;
          const isSelectedAttacker = setupManager.selectedCombatAttacker && setupManager.selectedCombatAttacker.id === m.id;
          const isSelectedTarget = setupManager.selectedCombatTarget && setupManager.selectedCombatTarget.target.id === m.id;
          const isSelectedMover = setupManager.selectedMoveMech && setupManager.selectedMoveMech.id === m.id;

          const card = document.createElement('div');
          card.className = `mech-mini-card ${isPlayer ? 'player-card' : 'cpu-card'}`;
          if (isDestroyed) card.classList.add('destroyed-card');
          if (isSelectedAttacker || isSelectedMover) card.classList.add('active-selected');
          if (isSelectedTarget) card.classList.add('target-selected');

          // Status determination
          let statusText = 'READY';
          let statusClass = 'status-ready';

          if (isDestroyed) {
            statusText = 'WRECK';
            statusClass = 'status-dead';
          } else if (setupManager.currentPhase === PHASES.MOVEMENT) {
            statusText = m.hasMoved ? 'MOVED' : 'READY';
            statusClass = m.hasMoved ? 'status-done' : 'status-ready';
          } else if (setupManager.currentPhase === PHASES.COMBAT) {
            statusText = m.hasAttacked ? 'FIRED' : 'READY';
            statusClass = m.hasAttacked ? 'status-done' : 'status-ready';
          }

          const armorPct = m.maxArmor > 0 ? (m.health.armor / m.maxArmor) * 100 : 0;
          const structPct = m.maxStructure > 0 ? (m.health.structure / m.maxStructure) * 100 : 0;

          card.innerHTML = `
            <div class="mini-top-row">
              <span class="mini-token ${isDestroyed ? 'grey' : isPlayer ? 'blue' : 'red'}">${m.code}</span>
              <span class="mini-name" title="${m.name}">${m.name}</span>
              <span class="mini-status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="mini-stats-row">
              <span>MM: <strong>+${m.movementModifier || 0}</strong></span>
              <span>TMM: <strong>${m.TMM}</strong></span>
              <span>SZ: <strong>${m.size}</strong></span>
            </div>
            <div class="mini-health-row">
              <div class="health-meter-wrap">
                <span class="meter-lbl">ARM</span>
                <div class="meter-bar-outer"><div class="meter-bar-inner armor" style="width:${armorPct}%;"></div></div>
                <span class="meter-val">${m.health.armor}/${m.maxArmor}</span>
              </div>
              <div class="health-meter-wrap">
                <span class="meter-lbl">STR</span>
                <div class="meter-bar-outer"><div class="meter-bar-inner struct" style="width:${structPct}%;"></div></div>
                <span class="meter-val">${m.health.structure}/${m.maxStructure}</span>
              </div>
            </div>
          `;

          // Interactive clicking on mini component
          card.addEventListener('click', () => {
            if (isDestroyed) return;

            if (setupManager.currentPhase === PHASES.MOVEMENT && setupManager.activeMovementPlayer === 'player') {
              if (isPlayer && !m.hasMoved) {
                setupManager.selectMechForMovement(m);
              }
            } else if (setupManager.currentPhase === PHASES.COMBAT && setupManager.activeCombatPlayer === 'player') {
              if (isPlayer && !m.hasAttacked) {
                setupManager.selectAttackerForCombat(m);
              } else if (!isPlayer) {
                const atk = setupManager.combatLegalAttacks.find(a => a.target.id === m.id);
                if (atk) setupManager.selectTargetForCombat(atk);
              }
            }
          });

          container.appendChild(card);
        });
      }

      renderDock(northDock, northMechs);
      renderDock(southDock, southMechs);
    },

    onCellHover: (cell, tile) => {
      const coordEl = document.getElementById('hover-coordinates');
      const terrainEl = document.getElementById('hover-terrain');
      const mechEl = document.getElementById('hover-mech');

      if (!cell || !tile) {
        if (coordEl) coordEl.textContent = "Col: --, Row: --";
        if (terrainEl) terrainEl.textContent = "Terrain: --";
        if (mechEl) mechEl.textContent = "Unit: None";
        return;
      }

      if (coordEl) coordEl.textContent = `Col: ${cell.x + 1}, Row: ${cell.y + 1}`;
      if (terrainEl) {
        if (tile.isObstacle) {
          terrainEl.innerHTML = '<span class="obstacle-tag">Impassable Obstacle (Cover)</span>';
        } else {
          terrainEl.textContent = `Open Ground (${gameMap.biome.name})`;
        }
      }

      if (mechEl) {
        if (tile.mech) {
          const m = tile.mech;
          const ownerBadge = m.owner === 'player' ? '<span class="owner-player">PLAYER</span>' : '<span class="owner-cpu">COMPUTER</span>';
          const wreckBadge = m.destroyed ? ' <span style="color:#ef4444; font-weight:bold;">[WRECK]</span>' : '';
          mechEl.innerHTML = `${ownerBadge} <strong>${m.name}</strong> [${m.code}]${wreckBadge} (Size ${m.size}, MM: +${m.movementModifier||0}, ARM: ${m.health.armor}, STR: ${m.health.structure})`;
        } else {
          mechEl.textContent = "Unit: None";
        }
      }
    },

    onDeploymentCellClick: (x, y, tile) => {
      setupManager.handleCellClick(x, y, tile);
    }
  };

  function renderRosterSummary() {
    const pContainer = document.getElementById('player-roster-slots');
    const cContainer = document.getElementById('cpu-roster-slots');
    if (!pContainer || !cContainer) return;

    pContainer.innerHTML = [1, 2, 3, 4].map(size => {
      const m = setupManager.playerDrafted.find(x => x.size === size);
      return `<div class="roster-slot ${m ? 'filled' : 'empty'}">
        <span class="slot-size">Size ${size}:</span>
        <span class="slot-name">${m ? `${m.name} (${m.code})` : 'Pending...'}</span>
      </div>`;
    }).join('');

    cContainer.innerHTML = [1, 2, 3, 4].map(size => {
      const m = setupManager.computerDrafted.find(x => x.size === size);
      return `<div class="roster-slot ${m ? 'filled' : 'empty'}">
        <span class="slot-size">Size ${size}:</span>
        <span class="slot-name">${m ? `${m.name} (${m.code})` : 'Pending...'}</span>
      </div>`;
    }).join('');
  }

  // 3. Initialize SetupManager
  const setupManager = new SetupManager(gameMap, mechs, uiCallbacks);

  // 4. Bind Global DOM Events
  document.getElementById('btn-regen-map')?.addEventListener('click', () => {
    setupManager.regenerateMap();
  });

  document.getElementById('btn-proceed-choice')?.addEventListener('click', () => {
    setupManager.proceedToChoice();
  });

  // Choice modal events
  document.getElementById('btn-choose-draft-first')?.addEventListener('click', () => {
    choiceModal.classList.add('hidden');
    setupManager.handlePlayerChoice('draft_first');
  });

  document.getElementById('btn-choose-pick-spawn')?.addEventListener('click', () => {
    document.getElementById('choice-main-buttons').classList.add('hidden');
    document.getElementById('choice-spawn-options').classList.remove('hidden');
  });

  document.getElementById('btn-spawn-north')?.addEventListener('click', () => {
    choiceModal.classList.add('hidden');
    setupManager.handlePlayerChoice('pick_spawn', 'north');
  });

  document.getElementById('btn-spawn-south')?.addEventListener('click', () => {
    choiceModal.classList.add('hidden');
    setupManager.handlePlayerChoice('pick_spawn', 'south');
  });

  document.getElementById('btn-back-to-choices')?.addEventListener('click', () => {
    document.getElementById('choice-spawn-options').classList.add('hidden');
    document.getElementById('choice-main-buttons').classList.remove('hidden');
  });

  // Zoom controls
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    gameMap.scale = Math.min(2.5, gameMap.scale + 0.2);
    gameMap.render();
  });

  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    gameMap.scale = Math.max(0.6, gameMap.scale - 0.2);
    gameMap.render();
  });

  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    gameMap.scale = 1.0;
    gameMap.panX = 0;
    gameMap.panY = 0;
    gameMap.render();
  });

  // Start the setup phase!
  gameMap.init();
  setupManager.start();
});
