const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const cutoffRegex = /const setup: ProposedSetup = \{ direction, level: spot[\s\S]*/;
const replacement = `private createSignal(
  index: string,
  spot: number,
  setupType: string,
  direction: 'CALL' | 'PUT',
  brokenLevel: number,
  chainRows: any[],
  sess: LocalSessionState,
  passed: string[],
  failed: string[],
): InternalSignal | null {
  const targets = this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess);
  if (!targets) return null;

  const opt = this.selectStrike(direction, spot, chainRows);
  if (!opt) {
    failed.push('FAILED_NO_STRIKE');
    return null;
  }
  const optionEntry = Number(opt.price);
  const lossPercent = this.settings.MAX_OPTION_LOSS_PERCENT || 35;
  const optionStoploss = Number(
    (optionEntry * (1 - lossPercent / 100)).toFixed(2),
  );
  const optionRisk = optionEntry - optionStoploss;
  if (!(optionEntry > 0) || !(optionRisk > 0)) return null;

  const prices = {
    spotEntry: spot,
    spotInvalidation: targets.structuralStopSpot,
    spotTarget1: targets.target1Spot,
    spotTarget2: targets.target2Spot,
    optionEntry,
    optionStoploss,
    optionTarget1: Number((optionEntry + optionRisk).toFixed(2)),
    optionTarget2: Number((optionEntry + optionRisk * 1.5).toFixed(2)),
  };

  const riskSpot = Math.abs(prices.spotEntry - prices.spotInvalidation);
  const rewardSpot = Math.abs(prices.spotTarget1 - prices.spotEntry);
  if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
    failed.push('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
    return null;
  }

  const conf = 85;

  return {
    id: index + '_' + Date.now(),
    index,
    contract: 'NIFTY',
    instrumentKey: opt.instrumentKey,
    timestamp: new Date().toISOString(),
    signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
    strategy_family: setupType as any,
    direction,
    prices,
    spotEntry: prices.spotEntry,
    spotInvalidation: prices.spotInvalidation,
    spotTarget1: prices.spotTarget1,
    spotTarget2: prices.spotTarget2,
    entry: prices.optionEntry,
    entryPrice: prices.optionEntry,
    stoploss: prices.optionStoploss,
    target1: prices.optionTarget1,
    target2: prices.optionTarget2,
    broken_level: brokenLevel,
    optionEntry: prices.optionEntry,
    optionStoploss: prices.optionStoploss,
    optionTarget1: prices.optionTarget1,
    optionTarget2: prices.optionTarget2,
    spot,
    confidence: conf,
    reason: passed,
    status: 'ACTIVE',
    highestPrice: optionEntry,
    latestSpot: spot,
    latestSpotTimestamp: Date.now(),
    latestOptionTimestamp: Date.now()
  } as any;
}

private manageActiveTrades(newSignals: InternalSignal[]) {
  for (const [id, signal] of this.activeSignals.entries()) {
    if (signal.status === 'CLOSED') {
      this.activeSignals.delete(id);
      continue;
    }

    const currentOptPrice = Number(signal.latestPrice ?? signal.optionEntry);
    const currentSpot = Number(this.state.nifty50.lastPrice);
    const isCall = signal.direction === 'CALL';
    const spotInvalidation = signal.spotInvalidation;

    const structuralInvalidation = isCall
      ? currentSpot <= spotInvalidation
      : currentSpot >= spotInvalidation;
    
    if (structuralInvalidation) {
      this.closeSignal(signal, currentOptPrice, 'SPOT STRUCTURAL INVALIDATION');
      newSignals.push(signal);
      continue;
    }

    if (currentOptPrice <= signal.optionStoploss) {
      this.closeSignal(signal, signal.optionStoploss, 'OPTION PREMIUM STOPLOSS');
      newSignals.push(signal);
      continue;
    }

    if (
      !signal.firstTargetHitFlag &&
      currentOptPrice >= signal.optionTarget1
    ) {
      signal.firstTargetHitFlag = true;
      signal.optionStoploss = Math.max(signal.optionStoploss, signal.optionEntry);
      signal.stoploss = signal.optionStoploss;
    }

    if (currentOptPrice >= signal.optionTarget2) {
      this.closeSignal(signal, currentOptPrice, 'OPTION PREMIUM TARGET 2');
      newSignals.push(signal);
      continue;
    }

    const optionRisk = signal.optionEntry - signal.optionStoploss;
    if (
      signal.firstTargetHitFlag &&
      optionRisk > 0 &&
      signal.highestPrice > signal.optionEntry
    ) {
      const candidate = Number(
        (signal.highestPrice - optionRisk * 0.5).toFixed(2),
      );
      if (candidate > signal.optionStoploss) {
        signal.optionStoploss = candidate;
        signal.stoploss = candidate;
      }
    }
  }
}

private closeSignal(signal: InternalSignal, exitPrice: number, reason: string) {
  const sess = this.sessionStates[signal.index || 'NIFTY'];
  if (sess) {
    sess.tradeTakenFlag = false;
    if (reason.includes("SL TRIGGERED") || reason.includes("INVALIDATION") || reason.includes("EMERGENCY")) {
      sess.last_failed_setup_level = signal.broken_level;
    }
  }

  signal.status = 'CLOSED';
  signal.latestPrice = exitPrice;
  signal.realizedPnL = (exitPrice - (signal.optionEntry || signal.entryPrice));
  signal.exitReason = reason;
  
  this.realizedPnL += signal.realizedPnL;
  
  this.history.set(signal.id, signal);
  this.activeSignals.delete(signal.id);
}

private mapToPublicDecision(sig: InternalSignal | any): EngineDecision {
  return {
    timestamp: sig.timestamp || new Date().toISOString(),
    signal: sig.signal || 'NO_TRADE',
    strategy_family: (sig.strategy_family || 'NONE') as any,
    direction: (sig.direction || 'NONE') as any,
    entry: sig.optionEntry || sig.entry || 0,
    stoploss: sig.optionStoploss || sig.stoploss || 0,
    target1: sig.optionTarget1 || sig.target1 || 0,
    target2: sig.optionTarget2 || sig.target2 || 0,
    spot_entry: sig.spotEntry,
    spot_invalidation: sig.spotInvalidation,
    spot_target1: sig.spotTarget1,
    spot_target2: sig.spotTarget2,
    option_entry: sig.optionEntry,
    option_stoploss: sig.optionStoploss,
    option_target1: sig.optionTarget1,
    option_target2: sig.optionTarget2,
    confidence: sig.confidence || 0,
    reason: (sig.reason || []).join(' | '),
    instrumentKey: sig.instrumentKey || ''
  };
}

private createNoTrade(index: string, spot: number, failReason: string): EngineDecision {
  return {
    timestamp: new Date().toISOString(),
    signal: 'NO_TRADE',
    strategy_family: 'NONE' as any,
    direction: 'NONE' as any,
    prices: {
      spotEntry: spot,
      spotInvalidation: 0,
      spotTarget1: 0,
      spotTarget2: 0,
      optionEntry: 0,
      optionStoploss: 0,
      optionTarget1: 0,
      optionTarget2: 0,
    },
    spotEntry: spot,
    spotInvalidation: 0,
    spotTarget1: 0,
    spotTarget2: 0,
    optionEntry: 0,
    optionStoploss: 0,
    optionTarget1: 0,
    optionTarget2: 0,
    entry: 0,
    stoploss: 0,
    target1: 0,
    target2: 0,
    confidence: 0,
    reason: failReason,
    instrumentKey: ''
  };
}

public exitAllActiveTrades(reason: string) {
  for (const [id, signal] of this.activeSignals.entries()) {
    if (signal.status === 'ACTIVE') {
      const curPrice = signal.latestPrice || signal.optionEntry || signal.entryPrice;
      this.closeSignal(signal, curPrice, reason);
    }
  }
}

public reset() {
  this.sessionStates = {};
  this.activeSignals.clear();
  this.history.clear();
}
}
`;

code = code.replace(cutoffRegex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
