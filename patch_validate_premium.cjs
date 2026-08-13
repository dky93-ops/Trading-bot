const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const setup: ProposedSetup = \{[\s\S]*?oppCallOiSeriesLast3: seriesData\?\.oppCallOiSeriesLast3 \|\| \[\]\n\s*\};/;

const replacement = `const setup: ProposedSetup = {
      direction, level: lvl, setupType, c0, c1, c2, target1, target2, stopLoss: stoploss,
      ceOpt: direction === 'CALL' ? opt : undefined,
      peOpt: direction === 'PUT' ? opt : undefined,
      structureId,
      barsSinceBreakout,
      barsSinceRetest,
      impulseRange,
      spotMoveFromLevel,
      breakCandleIndex,
      retestCandleIndex,
      confirmationCandleIndex,
      spotSeriesLast3: seriesData?.spotSeriesLast3 || [],
      callPremiumSeriesLast3: seriesData?.callPremiumSeriesLast3 || [],
      putPremiumSeriesLast3: seriesData?.putPremiumSeriesLast3 || [],
      callOiSeriesLast3: seriesData?.callOiSeriesLast3 || [],
      putOiSeriesLast3: seriesData?.putOiSeriesLast3 || [],
      oppCallOiSeriesLast3: seriesData?.oppCallOiSeriesLast3 || []
    };

    const selectedType: 'CE' | 'PE' = direction === 'CALL' ? 'CE' : 'PE';
    const selectedStrike = Number(opt?.strike ?? opt?.targetStrike ?? 0);
    
    if (selectedStrike <= 0) {
      failed.push('FAILED_PREMIUM_ALIGNMENT: selected option strike unavailable');
      return false;
    }

    const getBar = (idx: number | undefined) => idx === undefined ? undefined : valCtx.candles1m[idx];
    const breakBar = getBar(breakCandleIndex);
    const retestBar = getBar(retestCandleIndex);
    const confirmationBar = getBar(confirmationCandleIndex);

    const breakPremium = breakBar ? this.getAlignedPremiumCandle(selectedStrike, selectedType, breakBar) : undefined;
    const retestPremium = retestBar ? this.getAlignedPremiumCandle(selectedStrike, selectedType, retestBar) : undefined;
    const confirmationPremium = confirmationBar ? this.getAlignedPremiumCandle(selectedStrike, selectedType, confirmationBar) : undefined;

    if (setupType !== 'OI_WALL_REJECTION' && (!breakPremium || !confirmationPremium)) {
      failed.push('FAILED_PREMIUM_ALIGNMENT: required completed 1-minute premium window missing');
      return false;
    }

    setup.premiumAtBreak = breakPremium?.close;
    setup.premiumAtRetestLow = retestPremium?.low;
    setup.premiumBreakLow = breakPremium?.low;
    setup.premiumBreakHigh = breakPremium?.high;
    setup.premiumBreakOpen = breakPremium?.open;
    setup.premiumBreakClose = breakPremium?.close;
    setup.premiumBreakMidpoint = breakPremium ? (breakPremium.high + breakPremium.low) / 2 : undefined;
    setup.premiumConfirmationClose = confirmationPremium?.close;
    setup.premiumConfirmationHigh = confirmationPremium?.high;
    setup.premiumConfirmationLow = confirmationPremium?.low;
    setup.premiumConfirmationOpen = confirmationPremium?.open;
    setup.premiumAtConfirmation = confirmationPremium?.close; // fallback?

    if (setupType === 'FAILED_RETEST' || setupType === 'OPENING_TRAP') {
      if (!retestPremium) {
        failed.push('FAILED_PREMIUM_ALIGNMENT: retest premium candle missing');
        return false;
      }
      setup.premiumRetestLow = retestPremium?.low;
      setup.premiumRetestHigh = retestPremium?.high;
      setup.premiumRetestOpen = retestPremium?.open;
      setup.premiumRetestClose = retestPremium?.close;
    }

    if (setupType === 'CONTINUATION_BREAKOUT' || setupType === 'CONTINUATION_BREAKDOWN') {
      const pauseStart = (breakCandleIndex ?? -1) + 1;
      const pauseEnd = (confirmationCandleIndex ?? -1) - 1;
      if (pauseStart > pauseEnd) {
        failed.push('FAILED_PREMIUM_ALIGNMENT: continuation pause window missing');
        return false;
      }
      let pauseLow = Number.POSITIVE_INFINITY;
      let pauseHigh = Number.NEGATIVE_INFINITY;
      for (let i = pauseStart; i <= pauseEnd; i++) {
        const b = this.getAlignedPremiumCandle(selectedStrike, selectedType, valCtx.candles1m[i]);
        if (!b) {
          failed.push('FAILED_PREMIUM_ALIGNMENT: continuation pause premium candle missing');
          return false;
        }
        pauseLow = Math.min(pauseLow, b.low);
        pauseHigh = Math.max(pauseHigh, b.high);
      }
      setup.premiumPauseLow = pauseLow;
      setup.premiumPauseHigh = pauseHigh;
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 2 validateSetup premium logic complete');
