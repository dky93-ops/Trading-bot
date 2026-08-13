const fs = require('fs');

const original = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const splitIndex = original.indexOf('private async checkOpeningTrap(');
if (splitIndex === -1) {
    console.error("Could not find checkOpeningTrap");
    process.exit(1);
}

const header = original.substring(0, splitIndex);

const remainder = `private async checkOpeningTrap(
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
  }

  private async checkOIWallRejection(
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
    if (candles.length < 3) return null;
    const confirmation = candles[candles.length - 1];
    
    for (const wall of [wallAbove, wallBelow]) {
      if (!wall) continue;
      const isCeWall = wall === wallAbove;
      const direction = isCeWall ? 'PUT' : 'CALL';
      const key = this.wallHistoryKey(isCeWall ? 'CE' : 'PE', wall);
      const history = sess.wallOiHistory?.[key] || [];
      const recentPeak = history.length ? Math.max(...history) : NaN;
      
      const currentOi = this.readRequiredOi(
        chainRows.find((row: any) => Number(row.strike_price) === wall),
        isCeWall ? 'CE' : 'PE'
      );
      
      const wallStable =
        Number.isFinite(currentOi) &&
        Number.isFinite(recentPeak) &&
        (currentOi as number) >= (recentPeak as number) * 0.95;
      
      const tests = sess.wallTestCounts[wall] || 0;
      
      if (
        tests < 2 ||
        (sess.wallReactionCandleKeys[wall] || []).length < 1 ||
        !wallStable
      ) {
        continue;
      }
      
      const option = this.selectStrike(direction, spot, chainRows);
      if (!option) continue;
      const type = direction === 'CALL' ? 'CE' : 'PE';
      const premiumAtConfirmation = this.getHistoricalPremium(option.strike, type, new Date(confirmation.timestamp).toISOString());
      
      const breakPremium = this.getHistoricalPremium(option.strike, type, new Date(candles[candles.length - 2].timestamp).toISOString());

      if (premiumAtConfirmation === undefined || breakPremium === undefined) {
          failed.push('FAILED_PREMIUM_ALIGNMENT: wall-rejection history incomplete');
          continue;
      }

      const targets = this.computeSpotTargets(direction, spot, wall, chainRows, sess);
      if (!targets) continue;

      const setup: ProposedSetup = {
        direction,
        level: wall,
        setupType: 'OI_WALL_REJECTION',
        c0: confirmation,
        c1: candles[candles.length - 2],
        c2: candles[candles.length - 3],
        target1: targets.target1Spot,
        target2: targets.target2Spot,
        stopLoss: targets.structuralStopSpot,
        premiumAtBreak: breakPremium,
        premiumAtConfirmation: premiumAtConfirmation,
        wallStable: true,
        ceOpt: direction === 'CALL' ? option : undefined,
        peOpt: direction === 'PUT' ? option : undefined,
        wallTestCount: tests
      };

      if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
      return this.createSignal(
        index,
        spot,
        'OI_WALL_REJECTION',
        direction,
        wall,
        chainRows,
        sess,
        passed,
        failed,
      );
    }
    return null;
  }

  private async checkContinuation(
    setupType: string,
    direction: 'CALL' | 'PUT',
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
    if (candles.length < 3) return null;
    const levels = this.validStructureLevels(sess);

    for (let breakIndex = Math.max(0, candles.length - 6); breakIndex < candles.length - 2; breakIndex++) {
      const breakCandle = candles[breakIndex];
      for (const level of levels) {
        const isBreak =
          direction === 'CALL'
            ? breakCandle.close > level
            : breakCandle.close < level;
        
        if (!isBreak) continue;

        for (
          let confirmationIndex = breakIndex + 1;
          confirmationIndex < candles.length;
          confirmationIndex++
        ) {
          const confirmation = candles[confirmationIndex];
          const staysBeyond = candles
            .slice(breakIndex + 1, confirmationIndex + 1)
            .every((candle) =>
              direction === 'CALL'
                ? candle.close > level
                : candle.close < level,
            );
          
          const firstImpulseRange = breakCandle.high - breakCandle.low;
          const moveFromLevel = Math.abs(confirmation.close - level);
          if (!staysBeyond || moveFromLevel > firstImpulseRange * 1.5) {
            continue;
          }

          const option = this.selectStrike(direction, spot, chainRows);
          if (!option) continue;
          const type = direction === 'CALL' ? 'CE' : 'PE';
          const breakPremium = this.getHistoricalPremium(option.strike, type, new Date(breakCandle.timestamp).toISOString());
          const confirmationPremium = this.getHistoricalPremium(option.strike, type, new Date(confirmation.timestamp).toISOString());
          
          if (breakPremium === undefined || confirmationPremium === undefined) {
            failed.push('FAILED_PREMIUM_ALIGNMENT: continuation history incomplete');
            continue;
          }

          const targets = this.computeSpotTargets(direction, spot, level, chainRows, sess);
          if (!targets) continue;

          const setup: ProposedSetup = {
            direction,
            level,
            setupType: setupType as any,
            c0: confirmation,
            c1: candles[confirmationIndex - 1],
            c2: breakCandle,
            target1: targets.target1Spot,
            target2: targets.target2Spot,
            stopLoss: targets.structuralStopSpot,
            breakCandleIndex: breakIndex,
            confirmationCandleIndex: confirmationIndex,
            barsSinceBreakout: confirmationIndex - breakIndex,
            premiumAtBreak: breakPremium,
            premiumAtConfirmation: confirmationPremium,
            ceOpt: direction === 'CALL' ? option : undefined,
            peOpt: direction === 'PUT' ? option : undefined,
          };

          if (!this.validateCandidate(valCtx, setup, passed, failed)) continue;
          return this.createSignal(
            index,
            spot,
            setupType,
            direction,
            level,
            chainRows,
            sess,
            passed,
            failed,
          );
        }
      }
    }
    return null;
  }

  private validateCandidate(
    valCtx: ValidationContext,
    setup: ProposedSetup,
    passed: string[],
    failed: string[],
  ): boolean {
    const selected = setup.direction === 'CALL' ? setup.ceOpt : setup.peOpt;
    const price = Number(selected?.price);
    const bid = Number(selected?.bidPrice);
    const ask = Number(selected?.askPrice);
    if (!(price > 0)) {
      failed.push('FAILED_LIQUIDITY: selected option premium unavailable');
      return false;
    }
    if (bid > 0 && ask >= bid) {
      const spreadPercent = ((ask - bid) / price) * 100;
      if (spreadPercent > (this.settings.MAX_OPTION_SPREAD_PERCENT || 1.5)) {
        failed.push(\`FAILED_LIQUIDITY: spread \${spreadPercent.toFixed(2)}% too large\`);
        return false;
      }
      setup.spreadPercent = spreadPercent;
    } else {
      failed.push('FAILED_LIQUIDITY: valid bid/ask unavailable');
      return false;
    }

    const levels = this.validStructureLevels(valCtx.sessState);
    const result = runSetupValidation(
      valCtx,
      setup,
      [...levels, setup.level],
      setup.wallTestCount || 0,
    );
    if (!result.passed) {
      failed.push(result.reason || 'FAILED_SETUP_VALIDATION');
      return false;
    }
    passed.push(\`Validated \${setup.setupType} with real premium/OI history\`);
    return true;
  }
  
  private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    let closestRow = chainRows[0];
    let minDiff = Infinity;
    for (const row of chainRows) {
        const diff = Math.abs(Number(row.strike_price) - spot);
        if (diff < minDiff) {
            minDiff = diff;
            closestRow = row;
        }
    }
    if (!closestRow) return undefined;
    const opt = direction === 'CALL' ? closestRow.call_options : closestRow.put_options;
    if (!opt) return undefined;
    
    return {
        strike: Number(closestRow.strike_price),
        price: Number(opt.market_data?.ltp || opt.market_data?.last_price || 0),
        bidPrice: Number(opt.market_data?.bid_price || opt.market_data?.bid || 0),
        askPrice: Number(opt.market_data?.ask_price || opt.market_data?.ask || 0),
        instrumentKey: opt.instrument_key || ''
    };
  }
  
  private getHistoricalPremium(strike: number, type: 'CE' | 'PE', timestamp: string): number | undefined {
    const history = this.getOptionChainHistory ? this.getOptionChainHistory() : [];
    const targetMs = new Date(timestamp).getTime();
    
    let bestSnap = undefined;
    for (const snap of history) {
        if (snap.timestamp <= targetMs && targetMs - snap.timestamp <= 90000) {
            if (!bestSnap || snap.timestamp > bestSnap.timestamp) {
                bestSnap = snap;
            }
        }
    }
    if (!bestSnap) return undefined;
    
    const row = bestSnap.data.find((r: any) => Number(r.strike_price) === strike);
    if (!row) return undefined;
    
    const opt = type === 'CE' ? row.call_options : row.put_options;
    const price = Number(opt?.market_data?.ltp || opt?.market_data?.last_price);
    return Number.isFinite(price) && price > 0 ? price : undefined;
  }
  
  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, level: number, chainRows: any[], sess: LocalSessionState) {
    const risk = this.settings.WALL_TOLERANCE_POINTS || 10;
    const reward = risk * 2;
    
    return {
        target1Spot: direction === 'CALL' ? spot + reward : spot - reward,
        target2Spot: direction === 'CALL' ? spot + reward * 2 : spot - reward * 2,
        structuralStopSpot: direction === 'CALL' ? Math.min(spot, level) - risk : Math.max(spot, level) + risk
    };
  }

  private createSignal(
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
      reason: [(sig.reason || []).join(' | ')] as any,
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
      reason: [failReason] as any,
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

fs.writeFileSync('src/backend/strategy-engine.ts', header + remainder);
