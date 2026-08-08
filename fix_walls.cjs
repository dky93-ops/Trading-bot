const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const updateWallStr = /private updateWallTestCounts\([\s\S]*?private manageActiveTrades/m;

const newUpdateWall = `private updateWallTestCounts(spot: number, step: number, sess: LocalSessionState, candles: Candle[], wallsAbove: OIWall[], wallsBelow: OIWall[]) {
    if (candles.length === 0) return;
    const c0 = candles[candles.length - 1];
    const c0Time = new Date(c0.timestamp).toISOString();
    
    // Only process a completed candle once for wall testing
    if (sess.lastProcessedCandleTimestamp === c0Time) return;
    sess.lastProcessedCandleTimestamp = c0Time;

    const tolerance = step * 0.25;

    for (const wall of wallsAbove) {
      if (c0.high >= wall.strike - tolerance && c0.close < wall.strike) {
        sess.wallTestCandleKeys[wall.strike] = sess.wallTestCandleKeys[wall.strike] || [];
        if (!sess.wallTestCandleKeys[wall.strike].includes(c0Time)) {
          sess.wallTestCandleKeys[wall.strike].push(c0Time);
          sess.wallTestCounts[wall.strike] = sess.wallTestCandleKeys[wall.strike].length;
        }
      }
      
      const currentOI = wall.totalOI;
      const prevOI = sess.prevWallTotalOI[wall.strike];
      
      if (prevOI !== undefined && currentOI < prevOI * 0.95) {
        sess.wallOIWeakeningConfirmed[wall.strike] = true;
      }
      if (prevOI !== undefined && currentOI < prevOI) {
        sess.wallNegativeOICounts[wall.strike] = (sess.wallNegativeOICounts[wall.strike] || 0) + 1;
      } else {
        sess.wallNegativeOICounts[wall.strike] = 0;
      }
      sess.prevWallTotalOI[wall.strike] = currentOI;
      sess.wallLastSeenOI[wall.strike] = currentOI;
    }
    
    for (const wall of wallsBelow) {
      if (c0.low <= wall.strike + tolerance && c0.close > wall.strike) {
        sess.wallTestCandleKeys[wall.strike] = sess.wallTestCandleKeys[wall.strike] || [];
        if (!sess.wallTestCandleKeys[wall.strike].includes(c0Time)) {
          sess.wallTestCandleKeys[wall.strike].push(c0Time);
          sess.wallTestCounts[wall.strike] = sess.wallTestCandleKeys[wall.strike].length;
        }
      }
      
      const currentOI = wall.totalOI;
      const prevOI = sess.prevWallTotalOI[wall.strike];
      
      if (prevOI !== undefined && currentOI < prevOI * 0.95) {
        sess.wallOIWeakeningConfirmed[wall.strike] = true;
      }
      if (prevOI !== undefined && currentOI < prevOI) {
        sess.wallNegativeOICounts[wall.strike] = (sess.wallNegativeOICounts[wall.strike] || 0) + 1;
      } else {
        sess.wallNegativeOICounts[wall.strike] = 0;
      }
      sess.prevWallTotalOI[wall.strike] = currentOI;
      sess.wallLastSeenOI[wall.strike] = currentOI;
    }
  }

  private manageActiveTrades`;

engine = engine.replace(updateWallStr, newUpdateWall);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
