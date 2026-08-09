const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regexFindWalls = /private findValidOIWalls\([\s\S]*?wallsBelow\.sort\(\(a, b\) => b\.strike - a\.strike\);\s*\n\s*return \{ wallsAbove, wallsBelow \};\s*\n\s*\}/;

const newFindWalls = `private findValidOIWalls(chainRows: any[], spot: number, step: number, sess: LocalSessionState, snapshotKey: string) {
    const rawWallsAbove: OIWall[] = [];
    const rawWallsBelow: OIWall[] = [];

    if (!chainRows || chainRows.length < 5) return { wallsAbove: [], wallsBelow: [] };

    const sortedRows = [...chainRows].sort((a, b) => a.strike_price - b.strike_price);

    for (let i = 2; i < sortedRows.length - 2; i++) {
      const row = sortedRows[i];
      const strike = row.strike_price;
      const surr = [sortedRows[i - 2], sortedRows[i - 1], sortedRows[i + 1], sortedRows[i + 2]];

      const callOI = row.call_options?.market_data?.oi || 0;
      const callOIChange = row.call_options?.market_data?.oi_change || 0;
      const surrCallOI = surr.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0) / 4;
      if (surrCallOI > 0 && callOI >= 1.5 * surrCallOI && callOIChange >= -0.05 * callOI) {
        if (strike > spot) {
          rawWallsAbove.push({ strike, totalOI: callOI, avgSurroundingOI: surrCallOI, oiRatio: callOI / surrCallOI, type: 'CE', oiChange: callOIChange });
        }
      }

      const putOI = row.put_options?.market_data?.oi || 0;
      const putOIChange = row.put_options?.market_data?.oi_change || 0;
      const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
      if (surrPutOI > 0 && putOI >= 1.5 * surrPutOI && putOIChange >= -0.05 * putOI) {
        if (strike < spot) {
          rawWallsBelow.push({ strike, totalOI: putOI, avgSurroundingOI: surrPutOI, oiRatio: putOI / surrPutOI, type: 'PE', oiChange: putOIChange });
        }
      }
    }

    if (!sess.wallLastSeenOI) sess.wallLastSeenOI = {};
    if (!sess.wallLastProcessedSnapshotKey) sess.wallLastProcessedSnapshotKey = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};
    if (!sess.wallNegativeOICounts) sess.wallNegativeOICounts = {};

    const processWeakening = (strike: number, currentOI: number, oiChange: number) => {
      if (sess.wallLastProcessedSnapshotKey[strike] === snapshotKey) return;
      sess.wallLastProcessedSnapshotKey[strike] = snapshotKey;

      if (!sess.wallLastSeenOI[strike]) {
        sess.wallLastSeenOI[strike] = currentOI;
      }

      const refOI = sess.wallLastSeenOI[strike];
      
      if (currentOI <= refOI * 0.95) {
        sess.wallOIWeakeningConfirmed[strike] = true;
      }

      if (oiChange < 0) {
        sess.wallNegativeOICounts[strike] = (sess.wallNegativeOICounts[strike] || 0) + 1;
        if (sess.wallNegativeOICounts[strike] >= 2) {
          sess.wallOIWeakeningConfirmed[strike] = true;
        }
      } else {
        sess.wallNegativeOICounts[strike] = 0;
      }
    };

    const wallsAbove = rawWallsAbove.filter(w => {
      processWeakening(w.strike, w.totalOI, w.oiChange || 0);
      const reactionCount = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactionCount >= 1;
    });

    const wallsBelow = rawWallsBelow.filter(w => {
      processWeakening(w.strike, w.totalOI, w.oiChange || 0);
      const reactionCount = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactionCount >= 1;
    });

    wallsAbove.sort((a, b) => a.strike - b.strike);
    wallsBelow.sort((a, b) => b.strike - a.strike);

    return { wallsAbove, wallsBelow };
  }`;

engine = engine.replace(regexFindWalls, newFindWalls);

// Update call site
engine = engine.replace(/const \{ wallsAbove, wallsBelow \} = this\.findValidOIWalls\(chainRows, spotPrice, step, sessState\);/,
  "const snapshotKey = candles1m.length > 0 ? new Date(candles1m[candles1m.length - 1].timestamp).toISOString() : '';\n    const { wallsAbove, wallsBelow } = this.findValidOIWalls(chainRows, spotPrice, step, sessState, snapshotKey);"
);

// We must also ensure updateWallTestCounts receives the RAW mathematically dominant walls, otherwise it won't be able to log a reaction for a new wall!
// In evaluateIndex, updateWallTestCounts is called with wallsAbove and wallsBelow, which are now FILTERED by reactions.
// We must extract raw walls!

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
