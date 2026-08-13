const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const checkOpeningTrapRegex = /private async checkOpeningTrap\([\s\S]*?return null;\n\s*\}/m;

const newCheckOpeningTrap = `private async checkOpeningTrap(
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    wallAbove: number,
    wallBelow: number,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    const openingRangeBars = Math.ceil(
      (this.settings.OPENING_RANGE_MINUTES || 15) /
      (this.settings.DECISION_TIMEFRAME_MINUTES || 5),
    );
    if (candles.length <= openingRangeBars + 1) return null;
    const opening = candles.slice(0, openingRangeBars);
    const orHigh = Math.max(...opening.map((c) => c.high));
    const orLow = Math.min(...opening.map((c) => c.low));
    sess.openingRangeHigh = orHigh;
    sess.openingRangeLow = orLow;
    sess.openingRangeComplete = true;

    const buffer = Math.max(2, Number(this.settings.WALL_TOLERANCE_POINTS || 5));

    for (let breakIndex = openingRangeBars; breakIndex < candles.length - 2; breakIndex++) {
      const breakCandle = candles[breakIndex];
      
      for (
        let confirmationIndex = breakIndex + 2;
        confirmationIndex < candles.length;
        confirmationIndex++
      ) {
        if (confirmationIndex - breakIndex > 3) continue;

        const retestIndex = confirmationIndex - 1;
        const retestCandle = candles[retestIndex];
        const confirmationCandle = candles[confirmationIndex];

        const isCall =
          breakCandle.low < orLow &&
          confirmationCandle.close > orLow &&
          retestCandle.low <= orLow + buffer &&
          retestCandle.close > orLow;

        const isPut =
          breakCandle.high > orHigh &&
          confirmationCandle.close < orHigh &&
          retestCandle.high >= orHigh - buffer &&
          retestCandle.close < orHigh;

        if (!isCall && !isPut) continue;

        const direction = isCall ? 'CALL' : 'PUT';
        const level = isCall ? orLow : orHigh;
        const option = this.selectStrike(direction, spot, chainRows);
        if (!option) continue;

        const type = direction === 'CALL' ? 'CE' : 'PE';
        const breakPremium = this.getHistoricalPremium(option.strike, type, new Date(breakCandle.timestamp).toISOString());
        const retestPremium = this.getHistoricalPremium(option.strike, type, new Date(retestCandle.timestamp).toISOString());
        const confirmationPremium = this.getHistoricalPremium(option.strike, type, new Date(confirmationCandle.timestamp).toISOString());
        
        if (breakPremium === undefined || retestPremium === undefined || confirmationPremium === undefined) {
          failed.push('FAILED_PREMIUM_ALIGNMENT: opening-trap history incomplete');
          continue;
        }

        const targets = this.computeSpotTargets(direction, spot, level, chainRows, sess);
        if (!targets) continue;

        const setup: ProposedSetup = {
          direction,
          level,
          setupType: 'OPENING_TRAP',
          c0: confirmationCandle,
          c1: retestCandle,
          c2: breakCandle,
          target1: targets.target1Spot,
          target2: targets.target2Spot,
          stopLoss: targets.structuralStopSpot,
          breakCandleIndex: breakIndex,
          retestCandleIndex: retestIndex,
          confirmationCandleIndex: confirmationIndex,
          premiumAtBreak: breakPremium,
          premiumAtRetestLow: retestPremium,
          premiumAtConfirmation: confirmationPremium,
          ceOpt: direction === 'CALL' ? option : undefined,
          peOpt: direction === 'PUT' ? option : undefined,
        };

        if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
        return this.createSignal(
          index,
          spot,
          'OPENING_TRAP',
          direction,
          level,
          chainRows,
          sess,
          passed,
          failed,
        );
      }
    }
    return null;
  }`;

code = code.replace(checkOpeningTrapRegex, newCheckOpeningTrap);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
