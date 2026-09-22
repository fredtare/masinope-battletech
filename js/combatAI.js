// js/combatAI.js
// MinMax Combat AI for Alpha Strike combat decision making

class CombatAI {
  constructor(gameMap) {
    this.map = gameMap;
  }

  // Calculate hit probability for d12 > toHit
  calculateHitProbability(toHit) {
    if (toHit < 1) return 1.0;  // Any roll 1-12 succeeds
    if (toHit >= 12) return 0.0; // Max roll 12 cannot beat >= 12
    return (12 - toHit) / 12.0;
  }

  // Get all legal attack options for an attacker against target mechs
  getLegalAttacksForMech(attacker, targets) {
    const attacks = [];
    const aPos = attacker.position;
    if (!aPos) return attacks;

    // Check if attacker is adjacent to any enemy (Base Contact / Melee rule)
    const adjacentTargets = targets.filter(t => 
      !t.destroyed && t.position && this.map.isAdjacent(aPos.x, aPos.y, t.position.x, t.position.y)
    );

    if (adjacentTargets.length > 0) {
      // Rule 41: "if mechs are in base contact... then instead combat is resolved as thus"
      // Must engage in melee against adjacent enemy
      for (const target of adjacentTargets) {
        const toHit = (attacker.size - target.size) + (target.movementModifier || 0) + target.TMM;
        const damage = Math.max(1, (attacker.size - target.size) + attacker.size + (attacker.movementModifier || 0));
        const pHit = this.calculateHitProbability(toHit);

        attacks.push({
          attacker,
          target,
          isMelee: true,
          rangeBracket: 'melee',
          rangeDist: 1,
          toHit,
          damage,
          pHit,
          expectedDamage: pHit * damage
        });
      }
      return attacks;
    }

    // Ranged Combat
    for (const target of targets) {
      if (target.destroyed || !target.position) continue;
      const tPos = target.position;

      // Rule 23-24: Line of Sight check
      if (!this.map.hasLineOfSight(aPos.x, aPos.y, tPos.x, tPos.y)) {
        continue;
      }

      // Rule 26-30: Range check
      const dist = this.map.getRange(aPos.x, aPos.y, tPos.x, tPos.y);
      let rangeBracket = null;
      let rangeMod = 0;

      if (dist <= 6.0) {
        rangeBracket = 'short';
        rangeMod = 0;
      } else if (dist <= 12.0) {
        rangeBracket = 'medium';
        rangeMod = 2;
      } else if (dist <= 24.0) {
        rangeBracket = 'long';
        rangeMod = 4;
      } else {
        continue; // Beyond 24 squares: Out of range
      }

      const rawDamage = attacker.damage ? (attacker.damage[rangeBracket] || 0) : 0;
      if (rawDamage <= 0) continue; // Weapon profile deals 0 damage at this range

      // Rule 34: to_hit = attacker movement modifier + range modifier + target mechs TMM
      const toHit = (attacker.movementModifier || 0) + rangeMod + target.TMM;
      const pHit = this.calculateHitProbability(toHit);

      attacks.push({
        attacker,
        target,
        isMelee: false,
        rangeBracket,
        rangeDist: dist,
        toHit,
        damage: rawDamage,
        pHit,
        expectedDamage: pHit * rawDamage
      });
    }

    return attacks;
  }

  // Evaluates a state from Computer's perspective
  // Higher score = Better for Computer
  evaluateAction(attack, allComputerMechs, allPlayerMechs) {
    if (!attack) return 0;

    let score = 0;
    const target = attack.target;
    const expDmg = attack.expectedDamage;

    // 1. Direct Expected Damage value weighted by target size
    score += expDmg * (10 + target.size * 3);

    // 2. Kill potential bonus
    const remainingHp = (target.health.armor + target.health.structure) - (target.queuedDamage || 0);
    if (remainingHp <= expDmg) {
      // High reward for eliminating an enemy unit
      score += 60 + target.size * 20;
    } else if (target.health.armor <= expDmg) {
      // Bonus for puncturing armor and exposing internal structure
      score += 20;
    }

    // 3. High probability bonus (reliability)
    score += attack.pHit * 15;

    // 4. Melee bonus if favorable size match
    if (attack.isMelee && attack.attacker.size >= target.size) {
      score += 15;
    }

    return score;
  }

  // MinMax Decision Search
  // Computer chooses best attack (MAX), considering Player's best counter-response (MIN)
  findBestCombatAction(computerMechs, playerMechs) {
    const activeComputerMechs = computerMechs.filter(m => !m.destroyed && !m.hasAttacked);
    const activePlayerMechs = playerMechs.filter(m => !m.destroyed && !m.hasAttacked);
    const alivePlayerMechs = playerMechs.filter(m => !m.destroyed);
    const aliveComputerMechs = computerMechs.filter(m => !m.destroyed);

    if (activeComputerMechs.length === 0 || alivePlayerMechs.length === 0) {
      return { pass: true, reason: 'No active combatants' };
    }

    // Generate all candidate attacks for Computer
    const candidateAttacks = [];
    for (const cMech of activeComputerMechs) {
      const attacks = this.getLegalAttacksForMech(cMech, alivePlayerMechs);
      candidateAttacks.push(...attacks);
    }

    if (candidateAttacks.length === 0) {
      // No targets in range or LoS for any computer mech
      return { pass: true, reason: 'No valid targets in LoS or range' };
    }

    let bestScore = -Infinity;
    let bestAttack = candidateAttacks[0];

    // MAX Node: Iterate over Computer's attack choices
    for (const cAttack of candidateAttacks) {
      const immediateScore = this.evaluateAction(cAttack, aliveComputerMechs, alivePlayerMechs);

      // MIN Node: Simulate Player's best counter-attack from remaining active player mechs
      let minCounterScore = 0;

      if (activePlayerMechs.length > 0) {
        let maxPlayerResponse = 0;
        for (const pMech of activePlayerMechs) {
          const counterAttacks = this.getLegalAttacksForMech(pMech, aliveComputerMechs);
          for (const pAttack of counterAttacks) {
            // Player's perspective value of attacking Computer
            const pVal = this.evaluateAction(pAttack, alivePlayerMechs, aliveComputerMechs);
            if (pVal > maxPlayerResponse) {
              maxPlayerResponse = pVal;
            }
          }
        }
        minCounterScore = maxPlayerResponse * 0.5; // discount factor for counter-ply
      }

      const netScore = immediateScore - minCounterScore;

      if (netScore > bestScore) {
        bestScore = netScore;
        bestAttack = cAttack;
      }
    }

    return {
      pass: false,
      ...bestAttack,
      score: bestScore
    };
  }
}

window.CombatAI = CombatAI;
