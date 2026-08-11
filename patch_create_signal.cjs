const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Find where createSignal starts
const startIdx = code.indexOf('  private createSignal(');
if (startIdx === -1) throw new Error('createSignal not found');

// Find where the next method or end of class starts after createSignal
const nextMethodIdx = code.indexOf('\n  private ', startIdx + 20);
const endIdx = nextMethodIdx !== -1 ? nextMethodIdx : code.lastIndexOf('}');

const replacement = `  private createSignal(
    index: string,
    strategyFamily: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION',
    signalType: 'BUY_CALL' | 'BUY_PUT',
    optType: 'CE' | 'PE',
    spot: number,
    brokenLevel: number,
    wallAbove: number,
    wallBelow: number,
    strike: number,
    premium: number,
    instrumentKey: string,
    initialConfidence: number,
    reasons: string[],
    passedFilters: string[],
    failedFilters: string[],
    confirmCandleLow?: number,
    confirmCandleHigh?: number,
    structureId?: string,
    chainRows?: any[],
    sessState?: LocalSessionState
  ): InternalSignal | null {
    
    if (!chainRows || !sessState) return null;

    const targets = this.computeSpotTargets(
      signalType === 'BUY_CALL' ? 'CALL' : 'PUT',
      spot,
      brokenLevel,
      chainRows,
      sessState
    );

    if (!targets) {
      failedFilters.push('FAILED_ROOM_TO_TARGET: exact structural stop/target levels unavailable');
      return null;
    }

    const riskSpot =
      signalType === 'BUY_CALL'
        ? spot - targets.structuralStopSpot
        : targets.structuralStopSpot - spot;
        
    if (!(riskSpot > 0)) {
      failedFilters.push('FAILED_ROOM_TO_TARGET: R is not positive');
      return null;
    }

    const reward1 =
      signalType === 'BUY_CALL'
        ? targets.target1Spot - spot
        : spot - targets.target1Spot;
        
    if (reward1 / riskSpot < 0.8) {
      failedFilters.push('FAILED_ROOM_TO_TARGET: Target 1 < 0.8R');
      return null;
    }

    const reward2 =
      signalType === 'BUY_CALL'
        ? targets.target2Spot - spot
        : spot - targets.target2Spot;

    passedFilters.push(\`Dynamic Stop & Emergency Exit Rules Enforced (Risk: \${riskSpot.toFixed(2)}, R: \${(reward1/riskSpot).toFixed(2)})\`);

    const confidence = this.calculateDeterministicConfidence({
       rewardToRiskTarget1: reward1 / riskSpot,
       rewardToRiskTarget2: targets.target2Spot > 0 ? reward2 / riskSpot : 0
       // other things can be computed if needed
    } as ProposedSetup);

    if (confidence < 50) {
      failedFilters.push(\`FAILED_CONFIDENCE: deterministic confidence \${confidence} < 50\`);
      return null;
    }

    const now = new Date();
    const timestampISO = now.toISOString();

    const sess = this.sessionStates[index];
    if (structureId && sess) {
      sess.activeStructureId = structureId;
      if (!sess.tradedStructures.includes(structureId)) {
        sess.tradedStructures.push(structureId);
      }
    }

    const signal: InternalSignal = {
      id: \`\${index}_\${timestampISO}\`,
      index,
      contract: instrumentKey,
      instrumentKey: instrumentKey,
      timestamp: timestampISO,
      signal: signalType,
      strategy_family: strategyFamily,
      direction: signalType === 'BUY_CALL' ? 'CALL' : 'PUT',
      action: 'BUY',
      strategy: \`\${strategyFamily} \${signalType === 'BUY_CALL' ? 'CE' : 'PE'}\`,
      status: 'ACTIVE',
      spot: spot,
      broken_level: brokenLevel,
      wall_above: wallAbove,
      wall_below: wallBelow,
      option_type: optType,
      strike: strike,
      entry: premium,
      entryPrice: premium,
      stoploss: targets.structuralStopSpot,
      target1: targets.target1Spot,
      target2: targets.target2Spot,
      structuralStopSpot: targets.structuralStopSpot,
      target1Spot: targets.target1Spot,
      target2Spot: targets.target2Spot,
      entrySpot: spot,
      initialRiskSpot: riskSpot,
      confidence: confidence,
      reason: reasons,
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters,
      confirmationCandleLow: confirmCandleLow,
      confirmationCandleHigh: confirmCandleHigh,
      initialRiskPoints: riskSpot,
      confirmationZonePrice: premium,
      structureId: structureId
    };

    return signal;
  }`;

code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched createSignal correctly');
