const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const missingMethods = `
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
`;

code = code.replace(/export class StrategyEngine \{/, 'export class StrategyEngine {\n' + missingMethods);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
