const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const replacement = `  private selectStrike(direction: 'CALL' | 'PUT', spot: number, chainRows: any[]) {
    if (!chainRows || chainRows.length === 0) return null;
    const sorted = [...chainRows].sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
    
    // Find closest ATM strike
    let closestRow = sorted[0];
    let minDiff = Math.abs(Number(closestRow.strike_price) - spot);
    let atmIndex = 0;
    
    for (let i = 1; i < sorted.length; i++) {
      const diff = Math.abs(Number(sorted[i].strike_price) - spot);
      if (diff < minDiff) {
        minDiff = diff;
        closestRow = sorted[i];
        atmIndex = i;
      }
    }

    // Select ITM strike (1 strike ITM for better delta)
    let selectedRow = closestRow;
    if (direction === 'CALL' && atmIndex > 0) {
      selectedRow = sorted[atmIndex - 1]; // Lower strike for CALL is ITM
    } else if (direction === 'PUT' && atmIndex < sorted.length - 1) {
      selectedRow = sorted[atmIndex + 1]; // Higher strike for PUT is ITM
    }

    const type = direction === 'CALL' ? 'CE' : 'PE';
    const optData = direction === 'CALL' ? selectedRow.call_options : selectedRow.put_options;
    const ltp = Number(optData?.market_data?.ltp);

    if (!Number.isFinite(ltp) || ltp <= 0) return null;

    return {
      strike: Number(selectedRow.strike_price),
      type,
      price: ltp,
      instrumentKey: String(optData?.instrument_key || ''),
      iv: Number(optData?.option_greeks?.iv || 0),
      delta: Number(optData?.option_greeks?.delta || 0)
    };
  }

  private createSignal(index: string, spot: number, setupType: string, direction: 'CALL' | 'PUT', chainRows: any[], sess: LocalSessionState, passed: string[], failed: string[]): InternalSignal | null {
    const targets = this.computeSpotTargets(direction, spot, spot, chainRows, sess);
    if (!targets) return null;
    
    const opt = this.selectStrike(direction, spot, chainRows);
    if (!opt) {
      // return this.createNoTrade(index, spot, 'FAILED_STRIKE_SELECTION: No suitable option found');
      return null;
    }
    
    const setup: ProposedSetup = { direction, level: spot, setupType: setupType as any, c0: {} as any, c1: {} as any, target1: targets.target1Spot, target2: targets.target2Spot, stopLoss: targets.structuralStopSpot };
    const conf = this.calculateDeterministicConfidence(setup);
    if (conf < 50) return null;
    
    const optionRiskPercent = this.settings.MAX_OPTION_SPREAD_PERCENT || 10;
    const optionRisk = opt.price * (optionRiskPercent / 100);
    const prices = {
      spotEntry: spot,
      spotInvalidation: targets.structuralStopSpot,
      spotTarget1: targets.target1Spot,
      spotTarget2: targets.target2Spot,
      optionEntry: opt.price,
      optionStoploss: opt.price - optionRisk,
      optionTarget1: opt.price + (optionRisk * 2),
      optionTarget2: opt.price + (optionRisk * 4)
    };

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
      optionEntry: prices.optionEntry,
      optionStoploss: prices.optionStoploss,
      optionTarget1: prices.optionTarget1,
      optionTarget2: prices.optionTarget2,
      spot, // legacy
      entryPrice: opt.price, // legacy
      stoploss: targets.structuralStopSpot, // legacy
      target1: targets.target1Spot, // legacy
      target2: targets.target2Spot, // legacy
      confidence: conf,
      reason: passed,
      status: 'ACTIVE',
      highestPrice: opt.price,
      latestSpot: spot,
      latestSpotTimestamp: Date.now(),
      latestOptionTimestamp: Date.now()
    } as any;
  }`;

const regex = /private createSignal[\s\S]*?\} as any;\n  \}/;
code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched createSignal');
