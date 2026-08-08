const fs = require('fs');
let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix createNoTrade
const createNoTradeRegex = /private createNoTrade\([\s\S]*?\} as InternalSignal;\s*return internalSig;\s*\}/m;
engine = engine.replace(createNoTradeRegex, `private createNoTrade(index: string, spot: number, reason: string): InternalSignal {
    return {
      timestamp: new Date().toISOString(),
      signal: 'NO_TRADE',
      strategy_family: 'NONE',
      direction: 'NONE',
      spot: spot,
      broken_level: 0,
      wall_above: 0,
      wall_below: 0,
      option_type: 'NONE',
      strike: 0,
      entry: 0,
      stoploss: 0,
      target1: 0,
      target2: 0,
      confidence: 0,
      reason: [reason],
      fake_signal_filters_passed: [],
      fake_signal_filters_failed: []
    } as InternalSignal;
  }`);

// Fix createSignal
const createSignalRegex = /private createSignal\([\s\S]*?\} as InternalSignal;\s*(return internalSig;\s*)?\}/m;
engine = engine.replace(createSignalRegex, `private createSignal(
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
    structureId?: string
  ): InternalSignal {
    const spotSLDistance = Math.max(15, Math.abs(spot - brokenLevel));
    const deltaLinkedOptPoints = Math.round(spotSLDistance * 0.50);
    const slPts = Math.max(12, Math.min(25, deltaLinkedOptPoints));
    const slPrice = Number(Math.max(1, premium - slPts).toFixed(2));

    const target1Price = Number((premium + Math.max(15, Math.round(premium * 0.35))).toFixed(2));
    const target2Price = Number((premium + Math.max(30, Math.round(premium * 0.60))).toFixed(2));

    const risk = premium - slPrice;
    const reward2 = target2Price - premium;
    const rrTarget2 = risk > 0 ? reward2 / risk : 0;

    let finalConfidence = initialConfidence;
    if (rrTarget2 < 1.5) {
      failedFilters.push(\`Reward-to-risk to Target 2 (\${rrTarget2.toFixed(2)}R) is < 1.5R (confidence reduced)\`);
      finalConfidence = Math.max(10, finalConfidence - 20);
    } else {
      passedFilters.push(\`Reward-to-risk to Target 2 is \${rrTarget2.toFixed(2)}R (>= 1.5R threshold passed)\`);
    }

    passedFilters.push(\`Dual SL Active: Primary Spot Level (\${brokenLevel}) + Secondary Option Premium SL (₹\${slPrice})\`);
    passedFilters.push(\`Dynamic Stop & Emergency Exit Rules Enforced\`);

    const now = new Date();
    const timestampISO = now.toISOString();

    const sess = this.sessionStates[index];
    if (structureId && sess) {
      sess.activeStructureId = structureId;
      if (!sess.tradedStructures.includes(structureId)) {
        sess.tradedStructures.push(structureId);
      }
    }

    return {
      id: crypto.randomUUID(),
      index,
      contract: instrumentKey,
      instrumentKey,
      action: 'BUY',
      strategy: strategyFamily,
      entryPrice: premium,
      stoploss: slPrice,
      target1: target1Price,
      target2: target2Price,
      status: 'ACTIVE',
      timestamp: timestampISO,
      confidence: finalConfidence,
      reason: reasons,
      direction: signalType === 'BUY_CALL' ? 'CALL' : 'PUT',
      fake_signal_filters_passed: passedFilters,
      fake_signal_filters_failed: failedFilters,
      signal: signalType,
      strategy_family: strategyFamily,
      spot: spot,
      broken_level: brokenLevel,
      wall_above: wallAbove,
      wall_below: wallBelow,
      option_type: optType,
      strike: strike,
      entry: premium
    } as InternalSignal;
  }`);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
