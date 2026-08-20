const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const importStatement = `import { computeEMA, computeSMA, computeRSI, computeMACD, computeBollinger, computeATR, computeSuperTrend } from './technical-indicators';\n`;

// insert import 
code = importStatement + code;

const newStrategy = `
  private async checkTechnicalConfluence(
    valCtx: ValidationContext,
    index: string,
    spot: number,
    candles: Candle[],
    chainRows: any[],
    sess: LocalSessionState,
    passed: string[],
    failed: string[],
  ): Promise<InternalSignal | null> {
    if (candles.length < 50) return null; // Need enough history for EMA50
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const rsiArr = computeRSI(closes, 14);
    const { macdLine, signalLine } = computeMACD(closes);
    const ema9 = computeEMA(closes, 9);
    const ema21 = computeEMA(closes, 21);
    const { upper, lower } = computeBollinger(closes);
    const { stLine, direction: stDir } = computeSuperTrend(highs, lows, closes);
    
    const lastIdx = closes.length - 1;
    const rsi = rsiArr[lastIdx];
    const macd = macdLine[lastIdx];
    const macdSig = signalLine[lastIdx];
    const e9 = ema9[lastIdx];
    const e21 = ema21[lastIdx];
    const bbUpper = upper[lastIdx];
    const bbLower = lower[lastIdx];
    const stDirection = stDir[lastIdx];
    const close = closes[lastIdx];
    
    let buyVotes = 0;
    let sellVotes = 0;
    let totalVotes = 5; // RSI, MACD, EMA, BB, SuperTrend
    
    if (!isNaN(rsi)) {
      if (rsi < 30) buyVotes++;
      else if (rsi > 70) sellVotes++;
    }
    
    if (!isNaN(macd) && !isNaN(macdSig)) {
      if (macd > macdSig) buyVotes++;
      else sellVotes++;
    }
    
    if (!isNaN(e9) && !isNaN(e21)) {
      if (e9 > e21) buyVotes++;
      else sellVotes++;
    }
    
    if (!isNaN(bbUpper) && !isNaN(bbLower)) {
      if (close < bbLower) buyVotes++;
      else if (close > bbUpper) sellVotes++;
    }
    
    if (!isNaN(stDirection)) {
      if (stDirection === 1) buyVotes++;
      else sellVotes++;
    }
    
    let signalDirection: 'CALL' | 'PUT' | null = null;
    
    if (buyVotes > sellVotes && buyVotes >= 3) {
      signalDirection = 'CALL';
    } else if (sellVotes > buyVotes && sellVotes >= 3) {
      signalDirection = 'PUT';
    }
    
    if (!signalDirection) return null;
    
    const type = signalDirection === 'CALL' ? 'CE' : 'PE';
    const option = this.selectStrike(signalDirection, spot, chainRows);
    if (!option) return null;
    
    const level = close; // Using current spot as reference level
    
    const targets = this.computeSpotTargets(signalDirection, spot, level, chainRows, sess);
    if (!targets) return null;
    
    const setup: ProposedSetup = {
      direction: signalDirection,
      level,
      setupType: 'TECHNICAL_CONFLUENCE',
      c0: candles[lastIdx],
      c1: candles[lastIdx - 1],
      c2: candles[lastIdx - 2],
      target1: targets.target1Spot,
      target2: targets.target2Spot,
      stopLoss: targets.structuralStopSpot,
      breakCandleIndex: lastIdx,
      retestCandleIndex: lastIdx,
      confirmationCandleIndex: lastIdx,
      premiumAtBreak: Number(option.price) || 0,
      premiumAtRetestLow: Number(option.price) || 0,
      premiumAtConfirmation: Number(option.price) || 0,
      ceOpt: signalDirection === 'CALL' ? option : undefined,
      peOpt: signalDirection === 'PUT' ? option : undefined,
    };
    
    if (!this.validateCandidate(valCtx, setup, passed, failed)) return null;
    
    passed.push("TECHNICAL_CONFLUENCE: Buy Votes " + buyVotes + ", Sell Votes " + sellVotes);
    
    return this.createSignal(
      index,
      spot,
      'TECHNICAL_CONFLUENCE',
      signalDirection,
      level,
      chainRows,
      sess,
      passed,
      failed,
    );
  }
`;

code = code.replace(/private async checkOpeningTrap\(/, newStrategy + '\n  private async checkOpeningTrap(');

// Replace the specific evaluation start point:
const searchTarget = "selectedSignal = await this.checkOpeningTrap(";
const replacement = `selectedSignal = await this.checkTechnicalConfluence(valCtx, index, spotPrice, candles, chainRows, sessState, passed, failed);
      if (!selectedSignal) {
        selectedSignal = await this.checkOpeningTrap(`;
code = code.replace(searchTarget, replacement);

// We need to add the closing brace for the new if block at the end of the chain.
// The easiest way is to find where the fallback happens, or just append it right after the final else-if for OI wall rejection.
// Wait, replacing `selectedSignal = await this.checkOpeningTrap(` with an opening brace means we need a closing brace.
// Let's look at the original code structure to find the end of the block.
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('patched strategy logic');
