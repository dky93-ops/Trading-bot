const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex1 = /private getAlignedPremiumCandle[\s\S]*?private validateSetup/m;

const replacement1 = `private getSnapshotAtOrBefore(
    targetMs: number,
    maxAgeMs = 90_000,
  ): OptionChainSnapshot | undefined {
    const history = (this.getOptionChainHistory?.() || [])
      .filter((s: any) => Number.isFinite(Number(s.timestamp)))
      .filter((s: any) => Number(s.timestamp) <= targetMs)
      .sort((a: any, b: any) => Number(b.timestamp) - Number(a.timestamp));

    const snapshot = history[0] as OptionChainSnapshot | undefined;
    if (!snapshot) return undefined;
    if (targetMs - Number(snapshot.timestamp) > maxAgeMs) return undefined;
    return snapshot;
  }

  private getHistoricalPremium(
    strike: number,
    type: 'CE' | 'PE',
    targetTime: string,
  ): number | undefined {
    const snapshot = this.getSnapshotAtOrBefore(new Date(targetTime).getTime());
    const row = snapshot?.rows?.find((r: any) => Number(r.strike) === Number(strike));
    const option = type === 'CE' ? row?.ce : row?.pe;
    const value = Number(option?.ltp);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private validateSetup`;

code = code.replace(regex1, replacement1);

const regex2 = /const getBar =[\s\S]*?return true; \/\/ Simplified for reconstruction/m;

const replacement2 = `const breakPremium = breakCandleIndex !== undefined && valCtx.candles1m[breakCandleIndex] 
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[breakCandleIndex].timestamp) 
      : undefined;
    
    const retestPremium = retestCandleIndex !== undefined && valCtx.candles1m[retestCandleIndex]
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[retestCandleIndex].timestamp)
      : undefined;
      
    const confirmationPremium = confirmationCandleIndex !== undefined && valCtx.candles1m[confirmationCandleIndex]
      ? this.getHistoricalPremium(selectedStrike, selectedType, valCtx.candles1m[confirmationCandleIndex].timestamp)
      : undefined;

    if (setupType !== 'OI_WALL_REJECTION' && (breakPremium === undefined || confirmationPremium === undefined)) { 
      failed.push('FAILED_PREMIUM_ALIGNMENT: required premium window missing'); 
      return false; 
    }
    
    setup.premiumAtBreak = breakPremium;
    setup.premiumAtConfirmation = confirmationPremium;

    if ((setupType === 'FAILED_RETEST' || setupType === 'OPENING_TRAP') && retestPremium !== undefined) {
      setup.premiumAtRetestLow = retestPremium;
    }
    
    return true; // Simplified for reconstruction`;

code = code.replace(regex2, replacement2);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Patched historical premium lookup');
