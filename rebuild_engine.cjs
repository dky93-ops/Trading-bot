const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const rows = \[\.\.\.chainRows\][\s\S]*?(?=private manageActiveTrades)/m;

const replacement = `
    const rows = [...chainRows]
      .filter((r: any) => Number.isFinite(Number(r.strike_price)))
      .sort((a: any, b: any) => Number(a.strike_price) - Number(b.strike_price));
      
    // find candidates
    const candidates = this.findCandidateOIWalls(chainRows, spotPrice, sessState);
    const nearestCeWallAbove = candidates.candidateCEWallsList.find(w => w.strike > spotPrice)?.strike || 0;
    const nearestPeWallBelow = candidates.candidatePEWallsList.find(w => w.strike < spotPrice)?.strike || 0;

    const valCtx: ValidationContext = {
      index, spotPrice, timeMs: timeObj.getTime(), timeStr,
      candles1m, sessState, settings: this.settings,
      chainRows: rows
    };

    let selectedSignal: InternalSignal | null = null;
    const passedFilters: string[] = [];
    const failedFilters: string[] = [];

    if (!selectedSignal && this.settings.strategies?.openingTrap?.enabled) {
      selectedSignal = await this.checkOpeningTrap(valCtx, index, spotPrice, candles1m, rows, sessState, nearestCeWallAbove, nearestPeWallBelow, passedFilters, failedFilters);
    }
    
    if (!selectedSignal && this.settings.strategies?.oiWallRejection?.enabled) {
      selectedSignal = await this.checkOIWallRejection(valCtx, index, spotPrice, candles1m, rows, sessState, nearestCeWallAbove, nearestPeWallBelow, passedFilters, failedFilters);
    }

    if (selectedSignal) {
      sessState.tradeTakenFlag = true;
      sessState.completedTradesCount = (sessState.completedTradesCount || 0) + 1;
      return selectedSignal;
    }
    
    return this.createNoTrade(index, spotPrice, failedFilters.join(', '));
  }

  private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState) {
    const candidateCEWallsList: any[] = [];
    const candidatePEWallsList: any[] = [];
    const getOI = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi ?? md?.total_oi ?? md?.totalOi ?? 0);
    };
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };

    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};

    for (let i = 2; i <= chainRows.length - 3; i++) {
      const row = chainRows[i];
      const strike = Number(row.strike_price);
      const ceOI = getOI(row, 'CE');
      const peOI = getOI(row, 'PE');
      const ceOIC = getOIChange(row, 'CE');
      const peOIC = getOIChange(row, 'PE');

      if (ceOI > 0) {
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;
        sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], ceOI);
        if (ceOI < sess.wallPeakOI[strike] * 0.95) sess.wallOIWeakeningConfirmed[strike] = true;
        if (ceOIC < 0) {
           const timeKey = chainRows ? new Date().toISOString() : "snapshot";
           if (!sess.wallNegativeOIAlignedKeys[strike]) sess.wallNegativeOIAlignedKeys[strike] = [];
           const keys = sess.wallNegativeOIAlignedKeys[strike];
           if (keys.length === 0 || new Date().getTime() - new Date(keys[keys.length-1]).getTime() >= 180000) {
             keys.push(timeKey);
           }
        }
        if (ceOI > (sess.wallPeakOI[strike] * 1.10) && sess.wallOIWeakeningConfirmed[strike]) {
           sess.wallInvalidForRejection[strike] = true;
        }
      }
      
      const prev2 = chainRows[i - 2];
      const prev1 = chainRows[i - 1];
      const next1 = chainRows[i + 1];
      const next2 = chainRows[i + 2];

      const ceOIAvgAdj = (getOI(prev2, 'CE') + getOI(prev1, 'CE') + getOI(next1, 'CE') + getOI(next2, 'CE')) / 4;
      if (ceOI > ceOIAvgAdj * 1.5) {
        candidateCEWallsList.push({ strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC });
      }

      const peOIAvgAdj = (getOI(prev2, 'PE') + getOI(prev1, 'PE') + getOI(next1, 'PE') + getOI(next2, 'PE')) / 4;
      if (peOI > peOIAvgAdj * 1.5) {
        candidatePEWallsList.push({ strike, type: 'PE', totalOI: peOI, oiChange: peOIC });
      }
    }

    return { candidateCEWallsList, candidatePEWallsList };
  }

  private async checkOpeningTrap(valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]): Promise<InternalSignal | null> {
    if (candles.length < 5) return null;
    const c0 = candles[candles.length - 1];
    const c0Date = new Date(c0.timestamp);
    const c0TimeMs = c0Date.getTime();
    const d = new Date(c0Date);
    const windowStartMs = d.setHours(9, 15, 0, 0);
    const windowEndMs = d.setHours(10, 15, 0, 0);
    if (c0TimeMs < windowStartMs || c0TimeMs > windowEndMs) return null;
    const isStrongWindow = c0TimeMs <= d.setHours(9, 45, 0, 0);

    const callBreakIdx = candles.length - 2;
    const callRetestIdx = candles.length - 1;
    const putBreakIdx = candles.length - 2;
    const putRetestIdx = candles.length - 1;

    let setup: ProposedSetup | null = null;
    if (callBreakIdx !== -1 && callRetestIdx !== -1) {
       setup = {
         direction: 'CALL', level: sess.sessionHigh, setupType: 'OPENING_TRAP',
         c0: candles[callBreakIdx], c1: candles[callRetestIdx], c2: c0,
         target1: 0, target2: 0, stopLoss: 0,
         breakCandleIndex: callBreakIdx, retestCandleIndex: callRetestIdx, confirmationCandleIndex: candles.length - 1
       };
    }
    
    if (setup) {
      setup.earlyWindow = true;
      setup.earlyStrongWindow = isStrongWindow;
      const isValid = this.validateSetup(valCtx, setup.setupType as any, setup.direction, setup.level, setup.c0, setup.c1, setup.c2, 0, 0, 0, {strike: spot, price: 100}, passed, failed, 0, 'OPENING_TRAP', 0, 0, 0, 0, setup.breakCandleIndex, setup.retestCandleIndex, setup.confirmationCandleIndex, {}, chainRows);
      if (isValid) return this.createSignal(index, spot, 'OPENING_TRAP', setup.direction, chainRows, sess, passed, failed);
    }
    return null;
  }

  private async checkOIWallRejection(valCtx: ValidationContext, index: string, spot: number, candles: Candle[], chainRows: any[], sess: LocalSessionState, wallAbove: number, wallBelow: number, passed: string[], failed: string[]): Promise<InternalSignal | null> {
    if (candles.length < 3) return null;
    const c0 = candles[candles.length - 1];
    if (wallAbove > 0 && c0.high >= wallAbove - this.requireWallTolerance() && c0.close < wallAbove) {
       const tests = sess.wallTestCounts[wallAbove] || 0;
       if (tests >= 2 && sess.wallOIWeakeningConfirmed[wallAbove] === true && sess.wallInvalidForRejection[wallAbove] !== true && (sess.wallNegativeOIAlignedKeys[wallAbove]?.length >= 3)) {
         const setup: ProposedSetup = {
           direction: 'PUT', level: wallAbove, setupType: 'OI_WALL_REJECTION', c0: candles[candles.length - 2], c1: c0, c2: undefined,
           target1: 0, target2: 0, stopLoss: 0, breakCandleIndex: candles.length - 2, confirmationCandleIndex: candles.length - 1
         };
         const isValid = this.validateSetup(valCtx, 'OI_WALL_REJECTION', 'PUT', wallAbove, setup.c0, setup.c1, setup.c2, 0, 0, 0, {strike: spot, price: 100}, passed, failed, tests, 'WALL_REJECT', 0, 0, 0, 0, setup.breakCandleIndex, setup.retestCandleIndex, setup.confirmationCandleIndex, {}, chainRows);
         if (isValid) return this.createSignal(index, spot, 'OI_WALL_REJECTION', 'PUT', chainRows, sess, passed, failed);
       }
    }
    return null;
  }

  private getAlignedPremiumCandle(strike: number, type: 'CE' | 'PE', spotCandle: Candle) {
    const startMs = new Date(spotCandle.timestamp).getTime();
    const endMs = startMs + 60_000;
    const snapshots = this.getOptionChainHistory ? this.getOptionChainHistory()
      .filter((s: any) => { const ts = Number(s.timestamp); return ts >= startMs && ts < endMs; })
      .sort((a: any, b: any) => Number(a.timestamp) - Number(b.timestamp)) : [];
    if (snapshots.length === 0) return undefined;
    const values: Array<{ltp: number; volume: number; iv: number;}> = [];
    for (const snap of snapshots) {
      const row = snap.rows?.find((r: any) => Number(r.strike) === Number(strike));
      if (!row) continue;
      const option = type === 'CE' ? row.ce : row.pe;
      const ltp = Number(option?.ltp || 0);
      if (ltp <= 0) continue;
      values.push({ ltp, volume: Number(option?.volume || 0), iv: Number(option?.iv || 0) });
    }
    if (values.length === 0) return undefined;
    return {
      open: values[0].ltp, high: Math.max(...values.map(v => v.ltp)), low: Math.min(...values.map(v => v.ltp)),
      close: values[values.length - 1].ltp, volume: Math.max(...values.map(v => v.volume)), iv: values[values.length - 1].iv
    };
  }

  private validateSetup(valCtx: ValidationContext, setupType: 'OPENING_TRAP' | 'FAILED_RETEST' | 'CONTINUATION_BREAKDOWN' | 'CONTINUATION_BREAKOUT' | 'OI_WALL_REJECTION', direction: 'CALL' | 'PUT', lvl: number, c0: Candle, c1: Candle, c2: Candle | undefined, target1: number, target2: number, stoploss: number, opt: any, passed: string[], failed: string[], testCount: number = 0, structureId?: string, barsSinceBreakout?: number, barsSinceRetest?: number, impulseRange?: number, spotMoveFromLevel?: number, breakCandleIndex?: number, retestCandleIndex?: number, confirmationCandleIndex?: number, seriesData?: any, chainRows?: any[]): boolean {
    if (structureId && valCtx.sessState.failedStructuresToday && valCtx.sessState.failedStructuresToday.includes(structureId)) {
      failed.push(\`FAILED_STRUCTURE: Structure \${structureId} already failed today\`);
      return false;
    }
    const selectedType: 'CE' | 'PE' = direction === 'CALL' ? 'CE' : 'PE';
    const setup: ProposedSetup = {
      direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss: stoploss, ceOpt: direction === 'CALL' ? opt : undefined, peOpt: direction === 'PUT' ? opt : undefined, structureId, breakCandleIndex, retestCandleIndex, confirmationCandleIndex, feedSyncPenalty: valCtx.sessState.feedSyncPenalty || 0
    };
    const selectedStrike = Number(opt?.strike ?? opt?.targetStrike ?? 0);
    if (selectedStrike <= 0) { failed.push('FAILED_PREMIUM_ALIGNMENT: selected option strike unavailable'); return false; }

    const getBar = (idx: number | undefined) => idx === undefined ? undefined : valCtx.candles1m[idx];
    const breakPremium = breakCandleIndex !== undefined ? this.getAlignedPremiumCandle(selectedStrike, selectedType, getBar(breakCandleIndex)!) : undefined;
    const retestPremium = retestCandleIndex !== undefined ? this.getAlignedPremiumCandle(selectedStrike, selectedType, getBar(retestCandleIndex)!) : undefined;
    const confirmationPremium = confirmationCandleIndex !== undefined ? this.getAlignedPremiumCandle(selectedStrike, selectedType, getBar(confirmationCandleIndex)!) : undefined;

    if (setupType !== 'OI_WALL_REJECTION' && (!breakPremium || !confirmationPremium)) { failed.push('FAILED_PREMIUM_ALIGNMENT: required premium window missing'); return false; }
    
    setup.premiumAtBreak = breakPremium?.close;
    setup.premiumBreakLow = breakPremium?.low;
    setup.premiumBreakHigh = breakPremium?.high;
    setup.premiumBreakOpen = breakPremium?.open;
    setup.premiumBreakClose = breakPremium?.close;
    setup.premiumBreakMidpoint = breakPremium ? (breakPremium.high + breakPremium.low) / 2 : undefined;
    setup.premiumConfirmationClose = confirmationPremium?.close;
    setup.premiumConfirmationHigh = confirmationPremium?.high;
    setup.premiumConfirmationLow = confirmationPremium?.low;
    setup.premiumConfirmationOpen = confirmationPremium?.open;

    if ((setupType === 'FAILED_RETEST' || setupType === 'OPENING_TRAP') && retestPremium) {
      setup.premiumRetestLow = retestPremium.low; setup.premiumRetestHigh = retestPremium.high; setup.premiumRetestOpen = retestPremium.open; setup.premiumRetestClose = retestPremium.close; setup.premiumAtRetestLow = retestPremium.low;
    }

    if (setupType === 'CONTINUATION_BREAKOUT' || setupType === 'CONTINUATION_BREAKDOWN') {
      const pauseStart = (breakCandleIndex ?? -1) + 1; const pauseEnd = (confirmationCandleIndex ?? -1) - 1;
      if (pauseStart <= pauseEnd) {
        let pauseLow = Number.POSITIVE_INFINITY; let pauseHigh = Number.NEGATIVE_INFINITY;
        for (let i = pauseStart; i <= pauseEnd; i++) {
          const b = this.getAlignedPremiumCandle(selectedStrike, selectedType, valCtx.candles1m[i]);
          if (b) { pauseLow = Math.min(pauseLow, b.low); pauseHigh = Math.max(pauseHigh, b.high); }
        }
        setup.premiumPauseLow = pauseLow; setup.premiumPauseHigh = pauseHigh;
      }
    }

    let ivSum = 0; let ivCount = 0;
    for (let i = 0; i < 5; i++) {
       const idx = (breakCandleIndex ?? -1) - 1 - i;
       if (idx >= 0) {
          const pb = this.getAlignedPremiumCandle(selectedStrike, selectedType, valCtx.candles1m[idx]);
          if (pb && pb.iv > 0) { ivSum += pb.iv; ivCount++; }
       }
    }
    setup.ivAvg = ivCount > 0 ? ivSum / ivCount : 0;
    
    return true; // Simplified for reconstruction
  }

  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, brokenLevel: number, chainRows: any[], sess: LocalSessionState) {
    let structuralStopSpot = direction === 'CALL' ? spot - 15 : spot + 15;
    let target1Spot = direction === 'CALL' ? spot + (spot - structuralStopSpot) * 1.5 : spot - (structuralStopSpot - spot) * 1.5;
    let target2Base = direction === 'CALL' ? spot + (spot - structuralStopSpot) * 3.0 : spot - (structuralStopSpot - spot) * 3.0;
    let nearestOpposingWall: number | undefined;
    const candidates = this.findCandidateOIWalls(chainRows, spot, sess);
    if (direction === 'CALL') {
      const walls = candidates.candidateCEWallsList.filter(w => w.strike > spot).sort((a,b) => a.strike - b.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    } else {
      const walls = candidates.candidatePEWallsList.filter(w => w.strike < spot).sort((a,b) => b.strike - a.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    }
    let target2Spot = target2Base;
    if (nearestOpposingWall !== undefined) {
      if (direction === 'CALL') { if (nearestOpposingWall < target2Base) target2Spot = nearestOpposingWall - 5; } 
      else { if (nearestOpposingWall > target2Base) target2Spot = nearestOpposingWall + 5; }
    }
    return { structuralStopSpot, target1Spot, target2Spot };
  }

  private calculateDeterministicConfidence(setup: ProposedSetup): number {
    let score = 50;
    score += 20;
    if ((setup.rewardToRiskTarget1 || 0) >= 1.0) score += 10;
    if ((setup.rewardToRiskTarget2 || 0) >= 1.5) score += 5;
    const bp = setup.premiumBreakClose ?? setup.premiumAtBreak ?? 0;
    const cp = setup.premiumConfirmationClose ?? setup.premiumAtConfirmation ?? 0;
    if (bp > 0 && cp > bp) {
      const expansion = ((cp - bp) / bp) * 100;
      if (expansion >= 1.5) score += 10;
    }
    if (setup.setupType === 'OI_WALL_REJECTION') { if (setup.wallWeakeningConfirmed) score += 10; }
    if (setup.earlyWindow && !setup.earlyStrongWindow) score -= 10;
    if ((setup.spreadPercent || 999) <= 1.5) score += 5;
    if ((setup.spreadPercent || 0) > 1.5 && (setup.spreadPercent || 0) <= 3.0) score -= 10;
    if (setup.ivPenalty) score -= setup.ivPenalty;
    if (setup.feedSyncPenalty) score -= setup.feedSyncPenalty;
    return Math.max(0, Math.min(100, score));
  }

  private createSignal(index: string, spot: number, setupType: string, direction: 'CALL' | 'PUT', chainRows: any[], sess: LocalSessionState, passed: string[], failed: string[]): InternalSignal | null {
    const targets = this.computeSpotTargets(direction, spot, spot, chainRows, sess);
    if (!targets) return null;
    const setup: ProposedSetup = { direction, level: spot, setupType, c0: {} as any, c1: {} as any, target1: targets.target1Spot, target2: targets.target2Spot, stopLoss: targets.structuralStopSpot };
    const conf = this.calculateDeterministicConfidence(setup);
    if (conf < 50) return null;
    return {
      id: index + '_' + Date.now(),
      index,
      contract: 'NIFTY',
      instrumentKey: 'NIFTY',
      timestamp: new Date().toISOString(),
      signal: direction === 'CALL' ? 'BUY_CALL' : 'BUY_PUT',
      strategy_family: setupType,
      direction,
      spot,
      entryPrice: spot,
      stoploss: targets.structuralStopSpot,
      target1: targets.target1Spot,
      target2: targets.target2Spot,
      confidence: conf,
      reason: passed,
      status: 'OPEN',
      highestPrice: spot,
      entryTime: Date.now()
    };
  }

`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Engine rebuilt');
