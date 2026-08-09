const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regexFindWalls = /private findValidOIWalls\([\s\S]*?private updateWallTestCounts\([\s\S]*?for \(const wall of wallsBelow\) recordWallEvent\(wall, false\);\s*\n\s*\}/;

const newWallLogic = `private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState, snapshotKey: string) {
    const candidateCEWallsList: OIWall[] = [];
    const candidatePEWallsList: OIWall[] = [];

    if (!chainRows || chainRows.length < 5) return { candidateCEWallsList, candidatePEWallsList };

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
          candidateCEWallsList.push({ strike, totalOI: callOI, avgSurroundingOI: surrCallOI, oiRatio: callOI / surrCallOI, type: 'CE', oiChange: callOIChange });
          sess.candidateCEWalls[strike] = true;
        }
      }

      const putOI = row.put_options?.market_data?.oi || 0;
      const putOIChange = row.put_options?.market_data?.oi_change || 0;
      const surrPutOI = surr.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0) / 4;
      if (surrPutOI > 0 && putOI >= 1.5 * surrPutOI && putOIChange >= -0.05 * putOI) {
        if (strike < spot) {
          candidatePEWallsList.push({ strike, totalOI: putOI, avgSurroundingOI: surrPutOI, oiRatio: putOI / surrPutOI, type: 'PE', oiChange: putOIChange });
          sess.candidatePEWalls[strike] = true;
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

    candidateCEWallsList.forEach(w => processWeakening(w.strike, w.totalOI, w.oiChange || 0));
    candidatePEWallsList.forEach(w => processWeakening(w.strike, w.totalOI, w.oiChange || 0));

    return { candidateCEWallsList, candidatePEWallsList };
  }

  private recordWallReactions(
    candidates: { candidateCEWallsList: OIWall[], candidatePEWallsList: OIWall[] },
    candles: Candle[],
    step: number,
    sess: LocalSessionState
  ) {
    if (!candles || candles.length === 0) return;

    const c0 = candles[candles.length - 1];
    const candleKey = new Date(c0.timestamp).toISOString();
    const tolerance = step * 0.25;

    const recordWallEvent = (wall: OIWall, isAbove: boolean) => {
      const strike = wall.strike;

      if (!sess.wallTestCandleKeys[strike]) sess.wallTestCandleKeys[strike] = [];
      if (!sess.wallReactionCandleKeys[strike]) sess.wallReactionCandleKeys[strike] = [];

      const touchedWall = isAbove
        ? c0.high >= strike - tolerance && c0.close < strike
        : c0.low <= strike + tolerance && c0.close > strike;

      if (!touchedWall) return;

      if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
        sess.wallTestCandleKeys[strike].push(candleKey);
        sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
      }

      if (!sess.wallReactionCandleKeys[strike].includes(candleKey)) {
        sess.wallReactionCandleKeys[strike].push(candleKey);
      }
    };

    for (const wall of candidates.candidateCEWallsList) recordWallEvent(wall, true);
    for (const wall of candidates.candidatePEWallsList) recordWallEvent(wall, false);
  }

  private getValidatedOIWalls(
    candidates: { candidateCEWallsList: OIWall[], candidatePEWallsList: OIWall[] },
    sess: LocalSessionState
  ) {
    const wallsAbove = candidates.candidateCEWallsList.filter(w => {
      const reactionCount = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactionCount >= 1;
    });

    const wallsBelow = candidates.candidatePEWallsList.filter(w => {
      const reactionCount = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactionCount >= 1;
    });

    wallsAbove.sort((a, b) => a.strike - b.strike);
    wallsBelow.sort((a, b) => b.strike - a.strike);

    return { wallsAbove, wallsBelow };
  }`;

engine = engine.replace(regexFindWalls, newWallLogic);

engine = engine.replace(/const snapshotKey = candles1m\.length > 0 \? new Date\(candles1m\[candles1m\.length - 1\]\.timestamp\)\.toISOString\(\) : '';\s*\n\s*const \{ wallsAbove, wallsBelow, rawWallsAbove, rawWallsBelow \} = this\.findValidOIWalls\(chainRows, spotPrice, step, sessState, snapshotKey\);\s*\n\s*const nearestCeWallAbove = wallsAbove\.length > 0 \? wallsAbove\[0\]\.strike : 0;\s*\n\s*const nearestPeWallBelow = wallsBelow\.length > 0 \? wallsBelow\[0\]\.strike : 0;\s*\n\s*this\.updateWallTestCounts\(spotPrice, step, sessState, todayCandles, rawWallsAbove \|\| \[\], rawWallsBelow \|\| \[\]\);/,
  `const snapshotKey = candles1m.length > 0 ? new Date(candles1m[candles1m.length - 1].timestamp).toISOString() : '';
    const candidates = this.findCandidateOIWalls(chainRows, spotPrice, sessState, snapshotKey);
    this.recordWallReactions(candidates, todayCandles, step, sessState);
    const { wallsAbove, wallsBelow } = this.getValidatedOIWalls(candidates, sessState);
    const nearestCeWallAbove = wallsAbove.length > 0 ? wallsAbove[0].strike : 0;
    const nearestPeWallBelow = wallsBelow.length > 0 ? wallsBelow[0].strike : 0;`
);

fs.writeFileSync('src/backend/strategy-engine.ts', engine);
