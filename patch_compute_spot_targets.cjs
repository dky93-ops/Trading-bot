const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const oldComputeSpotTargets = `  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, level: number, chainRows: any[], sess: LocalSessionState) {
    const buffer = this.settings.WALL_TOLERANCE_POINTS || 10;
    
    const stopLossSpot = direction === 'CALL' 
      ? Math.min(spot, level) - buffer 
      : Math.max(spot, level) + buffer;
      
    const risk = Math.max(buffer, Math.abs(spot - stopLossSpot));
    const reward = risk * 2;
    
    return {
        target1Spot: direction === 'CALL' ? spot + reward : spot - reward,
        target2Spot: direction === 'CALL' ? spot + reward * 2 : spot - reward * 2,
        structuralStopSpot: stopLossSpot
    };
  }`;

const newComputeSpotTargets = `  private computeSpotTargets(direction: 'CALL' | 'PUT', spot: number, level: number, chainRows: any[], sess: LocalSessionState, candles: Candle[]) {
    let buffer = this.settings.WALL_TOLERANCE_POINTS || 10;
    
    const atrPeriod = this.settings.CHOP_ATR_PERIOD || 14;
    const atrMultiplier = this.settings.SL_BUFFER_ATR_MULTIPLIER || 0.5;
    
    if (candles && candles.length >= atrPeriod) {
      const atrArray = computeATR(
        candles.map((c) => c.high),
        candles.map((c) => c.low),
        candles.map((c) => c.close),
        atrPeriod
      );
      const currentAtr = atrArray[atrArray.length - 1];
      if (!isNaN(currentAtr)) {
        buffer = currentAtr * atrMultiplier;
      }
    }
    
    const stopLossSpot = direction === 'CALL' 
      ? Math.min(spot, level) - buffer 
      : Math.max(spot, level) + buffer;
      
    const risk = Math.max(buffer, Math.abs(spot - stopLossSpot));
    const reward = risk * 2;
    
    return {
        target1Spot: direction === 'CALL' ? spot + reward : spot - reward,
        target2Spot: direction === 'CALL' ? spot + reward * 2 : spot - reward * 2,
        structuralStopSpot: stopLossSpot
    };
  }`;

if (code.includes('private computeSpotTargets(direction: \'CALL\' | \'PUT\', spot: number, level: number, chainRows: any[], sess: LocalSessionState) {')) {
  code = code.replace(oldComputeSpotTargets, newComputeSpotTargets);
  // Now I must also replace calls to computeSpotTargets to pass candles.
  code = code.replace(/this\.computeSpotTargets\(direction, spot, level, chainRows, sess\)/g, 'this.computeSpotTargets(direction, spot, level, chainRows, sess, candles)');
  code = code.replace(/this\.computeSpotTargets\(direction, spot, wall, chainRows, sess\)/g, 'this.computeSpotTargets(direction, spot, wall, chainRows, sess, candles)');
  code = code.replace(/this\.computeSpotTargets\(\s*direction,\s*spot,\s*level,\s*chainRows,\s*sess,\s*\)/g, 'this.computeSpotTargets(direction, spot, level, chainRows, sess, candles)');
  code = code.replace(/this\.computeSpotTargets\(direction, spot, brokenLevel, chainRows, sess\)/g, 'this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess, candles)');

  fs.writeFileSync('src/backend/strategy-engine.ts', code);
  console.log('patched computeSpotTargets');
} else {
  console.log('Could not find computeSpotTargets');
}
