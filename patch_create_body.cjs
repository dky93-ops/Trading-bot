const fs = require('fs');

const code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const targetBody = `    const targets = this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess);
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
    
    const timeWindow = this.getTimeWindow(Date.now());
    const conf = calculateConfidence({
      rewardRiskRatio: rewardSpot / riskSpot,
      premiumExpansion: 1.0,
      oiState: 1.0,
      spreadPercent: 1.0, // TODO: Use real spread
      ivRegime: 1.0,
      momentum: 1.0,
      gapState: 0,
      timeWindow,
      isExpiryAfter14: false, // TODO
      feedSyncPenalty: sess.feedSyncPenalty || 0
    });

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
    } as any;`;

const newBody = `    const targets = this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess);
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

    const riskSpot = Math.abs(spot - targets.structuralStopSpot);
    const rewardSpot = Math.abs(targets.target1Spot - spot);
    if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
      failed.push('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
      return null;
    }
    
    const timeWindow = this.getTimeWindow(Date.now());
    const conf = calculateConfidence({
      rewardRiskRatio: rewardSpot / riskSpot,
      premiumExpansion: 1.0,
      oiState: 1.0,
      spreadPercent: 1.0, // TODO: Use real spread
      ivRegime: 1.0,
      momentum: 1.0,
      gapState: 0,
      timeWindow,
      isExpiryAfter14: false, // TODO
      feedSyncPenalty: sess.feedSyncPenalty || 0
    });

    const optionData = {
      price: opt.price,
      instrumentKey: opt.instrumentKey,
    };

    let signal: InternalSignal | null = null;
    switch (setupType) {
      case 'OPENING_TRAP':
        signal = StrategySignalsGenerator.generateOpeningTrapSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
      case 'FAILED_RETEST':
        signal = StrategySignalsGenerator.generateFailedRetestSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
      case 'CONTINUATION_BREAKOUT':
      case 'CONTINUATION_BREAKDOWN':
        signal = StrategySignalsGenerator.generateContinuationSignal(
          index, spot, brokenLevel, direction, setupType as any, candles, setup, optionData, conf, passed
        );
        break;
      case 'OI_WALL_REJECTION':
        signal = StrategySignalsGenerator.generateWallRejectionSignal(
          index, spot, brokenLevel, direction, candles, setup, optionData, conf, passed
        );
        break;
    }

    if (signal) {
      return signal;
    }

    // Fallback if not matched
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

    return {
      id: index + '_' + Date.now(),
      index,
      contract: 'NIFTY',
      instrumentKey: opt.instrumentKey,
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: setupType as any,
      strategy: setupType,
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
    } as any;`;

const newCode = code.replace(targetBody, newBody);

if (newCode === code) {
  console.log("Failed to replace");
} else {
  fs.writeFileSync('src/backend/strategy-engine.ts', newCode);
  console.log('patched body');
}
