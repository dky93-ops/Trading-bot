const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private updateWallOIWeakening[\s\S]*?private manageActiveTrades/m;

const replacement = `private findCandidateOIWalls(
    chainRows: any[],
    spot: number,
    step: number,
    sess: LocalSessionState
  ): { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] } {
    const candidateCEWallsList: OIWall[] = [];
    const candidatePEWallsList: OIWall[] = [];
    if (!chainRows || chainRows.length < 5) {
      return { candidateCEWallsList, candidatePEWallsList };
    }
    const rows = [...chainRows]
      .filter(r => Number.isFinite(Number(r.strike_price)))
      .sort((a, b) => Number(a.strike_price) - Number(b.strike_price));
    const getOI = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi ?? md?.total_oi ?? md?.totalOi ?? 0);
    };
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };
    for (let i = 2; i <= rows.length - 3; i++) {
      const row = rows[i];
      const strike = Number(row.strike_price);
      const surrounding = [rows[i - 2], rows[i - 1], rows[i + 1], rows[i + 2]];
      const checkSide = (side: 'CE' | 'PE') => {
        const totalOI = getOI(row, side);
        const oiChange = getOIChange(row, side);
        const surroundingOI = surrounding.map(r => getOI(r, side));
        if (surroundingOI.some(v => !Number.isFinite(v))) return;
        const averageOI = surroundingOI.reduce((a, b) => a + b, 0) / surroundingOI.length;
        if (averageOI <= 0 || totalOI <= 0) return;
        const ratio = totalOI / averageOI;
        if (ratio < 1.5) return;
        const wall: OIWall = {
          strike,
          totalOI,
          avgSurroundingOI: averageOI,
          oiRatio: ratio,
          type: side,
          oiChange
        };
        if (side === 'CE' && strike > spot) {
          candidateCEWallsList.push(wall);
          sess.candidateCEWalls[strike] = true;
        }
        if (side === 'PE' && strike < spot) {
          candidatePEWallsList.push(wall);
          sess.candidatePEWalls[strike] = true;
        }
      };
      checkSide('CE');
      checkSide('PE');
    }
    return { candidateCEWallsList, candidatePEWallsList };
  }

  private recordWallReactions(
    candidates: { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] },
    candles: Candle[],
    step: number,
    sess: LocalSessionState
  ): void {
    if (!candles || candles.length === 0) return;
    const candle = candles[candles.length - 1];
    const candleKey = new Date(candle.timestamp).toISOString();
    const tolerance = step * 0.25;

    if (!sess.wallReactionCandleKeys) sess.wallReactionCandleKeys = {};
    if (!sess.wallTestCandleKeys) sess.wallTestCandleKeys = {};
    if (!sess.wallTestCounts) sess.wallTestCounts = {};

    const record = (strike: number, isReaction: boolean) => {
      if (!isReaction) return;
      if (!sess.wallReactionCandleKeys[strike]) {
        sess.wallReactionCandleKeys[strike] = [];
      }
      if (!sess.wallReactionCandleKeys[strike].includes(candleKey)) {
        sess.wallReactionCandleKeys[strike].push(candleKey);
      }
      if (!sess.wallTestCandleKeys[strike]) {
        sess.wallTestCandleKeys[strike] = [];
      }
      if (!sess.wallTestCandleKeys[strike].includes(candleKey)) {
        sess.wallTestCandleKeys[strike].push(candleKey);
        sess.wallTestCounts[strike] = sess.wallTestCandleKeys[strike].length;
      }
    };

    for (const wall of candidates.candidateCEWallsList) {
      const isReaction =
        candle.high >= wall.strike - tolerance &&
        candle.close < wall.strike;
      record(wall.strike, isReaction);
    }

    for (const wall of candidates.candidatePEWallsList) {
      const isReaction =
        candle.low <= wall.strike + tolerance &&
        candle.close > wall.strike;
      record(wall.strike, isReaction);
    }
  }

  private getValidatedOIWalls(
    candidates: { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] },
    sess: LocalSessionState
  ): { wallsAbove: OIWall[]; wallsBelow: OIWall[] } {
    const wallsAbove = candidates.candidateCEWallsList.filter(w => {
      const reactions = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactions >= 1;
    });
    const wallsBelow = candidates.candidatePEWallsList.filter(w => {
      const reactions = sess.wallReactionCandleKeys?.[w.strike]?.length || 0;
      return reactions >= 1;
    });
    
    wallsAbove.sort((a, b) => a.strike - b.strike);
    wallsBelow.sort((a, b) => b.strike - a.strike);
    
    return { wallsAbove, wallsBelow };
  }

  private updateWallOIWeakening(
    candidates: { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] },
    snapshotKey: string,
    sess: LocalSessionState
  ): void {
    if (!sess.wallLastSeenOI) sess.wallLastSeenOI = {};
    if (!sess.wallLastProcessedSnapshotKey) sess.wallLastProcessedSnapshotKey = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};
    if (!sess.wallNegativeOICounts) sess.wallNegativeOICounts = {};

    const process = (wall: OIWall) => {
      if (sess.wallLastProcessedSnapshotKey[wall.strike] === snapshotKey) return;
      sess.wallLastProcessedSnapshotKey[wall.strike] = snapshotKey;

      if (sess.wallLastSeenOI[wall.strike] === undefined) {
        sess.wallLastSeenOI[wall.strike] = wall.totalOI;
      }

      const refOI = sess.wallLastSeenOI[wall.strike];

      if (wall.totalOI <= refOI * 0.95) {
        sess.wallOIWeakeningConfirmed[wall.strike] = true;
      }

      if ((wall.oiChange || 0) < 0) {
        sess.wallNegativeOICounts[wall.strike] = (sess.wallNegativeOICounts[wall.strike] || 0) + 1;
        if (sess.wallNegativeOICounts[wall.strike] >= 2) {
          sess.wallOIWeakeningConfirmed[wall.strike] = true;
        }
      } else {
        sess.wallNegativeOICounts[wall.strike] = 0;
      }
    };

    candidates.candidateCEWallsList.forEach(process);
    candidates.candidatePEWallsList.forEach(process);
  }

  private manageActiveTrades`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('patched');
