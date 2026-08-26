const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const oldFindCandidate = `  private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState) {
    const candidateCEWallsList: any[] = [];
    const candidatePEWallsList: any[] = [];

    const getOI = (row: any, side: 'CE' | 'PE'): number | undefined => this.readRequiredOi(row, side);
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };

    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};

    for (let i = 2; i <= chainRows.length - 3; i++) {
      const row = chainRows[i];
      const strike = Number(row.strike_price);
      const ceOI = getOI(row, 'CE');
      const peOI = getOI(row, 'PE');
      const ceOIC = getOIChange(row, 'CE');
      const peOIC = getOIChange(row, 'PE');

      if (ceOI !== undefined && ceOI > 0) {
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;
        sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], ceOI);
        if (ceOI < sess.wallPeakOI[strike] * 0.95) sess.wallOIWeakeningConfirmed[strike] = true;
        if (ceOIC < 0) {
           const timeKey = chainRows ? new Date().toISOString() : "snapshot";
           if (!sess.wallNegativeOIAlignedKeys[strike]) sess.wallNegativeOIAlignedKeys[strike] = [];
           const keys = sess.wallNegativeOIAlignedKeys[strike];
           if (keys.length === 0 || new Date().getTime() - new Date(keys[keys.length-1]).getTime() >= 180000) {
             keys.push(timeKey);
           }
        }
        if (sess.wallNegativeOIAlignedKeys[strike]?.length >= 2) {
           sess.wallInvalidForRejection[strike] = true;
        }
        if (ceOI > (sess.wallPeakOI[strike] * 1.10) && sess.wallOIWeakeningConfirmed[strike]) {
           sess.wallInvalidForRejection[strike] = true;
        }
      }

      const ceSurrounding = [
        getOI(chainRows[i - 2], 'CE'),
        getOI(chainRows[i - 1], 'CE'),
        getOI(chainRows[i + 1], 'CE'),
        getOI(chainRows[i + 2], 'CE'),
      ];
      const peSurrounding = [
        getOI(chainRows[i - 2], 'PE'),
        getOI(chainRows[i - 1], 'PE'),
        getOI(chainRows[i + 1], 'PE'),
        getOI(chainRows[i + 2], 'PE'),
      ];

      if (
        ceOI === undefined ||
        peOI === undefined ||
        ceSurrounding.some((val) => val === undefined) ||
        peSurrounding.some((val) => val === undefined)
      ) {
        continue;
      }

      const ceOIAvgAdj = (ceSurrounding as number[]).reduce((sum, val) => sum + val, 0) / 4;
      if (ceOI > ceOIAvgAdj * 1.5) {
        candidateCEWallsList.push({ strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC });
      }

      const peOIAvgAdj = (peSurrounding as number[]).reduce((sum, val) => sum + val, 0) / 4;
      if (peOI > peOIAvgAdj * 1.5) {
        candidatePEWallsList.push({ strike, type: 'PE', totalOI: peOI, oiChange: peOIC });
      }
    }
    return { candidateCEWallsList, candidatePEWallsList };
  }`;

const newFindCandidate = `  private findCandidateOIWalls(chainRows: any[], spot: number, sess: LocalSessionState) {
    const candidateCEWallsList: any[] = [];
    const candidatePEWallsList: any[] = [];

    const getOI = (row: any, side: 'CE' | 'PE'): number | undefined => this.readRequiredOi(row, side);
    const getOIChange = (row: any, side: 'CE' | 'PE'): number => {
      const md = side === 'CE' ? row.call_options?.market_data : row.put_options?.market_data;
      return Number(md?.oi_change ?? md?.oiChange ?? 0);
    };

    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};

    const allCeOIs = chainRows.map(r => getOI(r, 'CE')).filter(oi => oi !== undefined && oi > 0) as number[];
    const allPeOIs = chainRows.map(r => getOI(r, 'PE')).filter(oi => oi !== undefined && oi > 0) as number[];
    allCeOIs.sort((a, b) => a - b);
    allPeOIs.sort((a, b) => a - b);

    const getPercentileRank = (val: number, sortedArr: number[]) => {
      if (sortedArr.length === 0) return 0;
      let count = 0;
      for (const x of sortedArr) if (x <= val) count++;
      return (count / sortedArr.length) * 100;
    };

    const percentileThreshold = Number(this.settings.WALL_OI_PERCENTILE || 90);

    for (let i = 2; i <= chainRows.length - 3; i++) {
      const row = chainRows[i];
      const strike = Number(row.strike_price);
      const ceOI = getOI(row, 'CE');
      const peOI = getOI(row, 'PE');
      const ceOIC = getOIChange(row, 'CE');
      const peOIC = getOIChange(row, 'PE');

      if (ceOI !== undefined && ceOI > 0) {
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;
        sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], ceOI);
        if (ceOI < sess.wallPeakOI[strike] * 0.95) sess.wallOIWeakeningConfirmed[strike] = true;
        if (ceOIC < 0) {
           const timeKey = chainRows ? new Date().toISOString() : "snapshot";
           if (!sess.wallNegativeOIAlignedKeys[strike]) sess.wallNegativeOIAlignedKeys[strike] = [];
           const keys = sess.wallNegativeOIAlignedKeys[strike];
           if (keys.length === 0 || new Date().getTime() - new Date(keys[keys.length-1]).getTime() >= 180000) {
             keys.push(timeKey);
           }
        }
        if (sess.wallNegativeOIAlignedKeys[strike]?.length >= 2) {
           sess.wallInvalidForRejection[strike] = true;
        }
        if (ceOI > (sess.wallPeakOI[strike] * 1.10) && sess.wallOIWeakeningConfirmed[strike]) {
           sess.wallInvalidForRejection[strike] = true;
        }
      }

      if (ceOI !== undefined && ceOI > 0) {
        const cePct = getPercentileRank(ceOI, allCeOIs);
        if (cePct >= percentileThreshold) {
          candidateCEWallsList.push({ strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC });
        }
      }

      if (peOI !== undefined && peOI > 0) {
        const pePct = getPercentileRank(peOI, allPeOIs);
        if (pePct >= percentileThreshold) {
          candidatePEWallsList.push({ strike, type: 'PE', totalOI: peOI, oiChange: peOIC });
        }
      }
    }
    return { candidateCEWallsList, candidatePEWallsList };
  }`;

if (code.includes('if (ceOI > ceOIAvgAdj * 1.5) {')) {
  code = code.replace(oldFindCandidate, newFindCandidate);
  fs.writeFileSync('src/backend/strategy-engine.ts', code);
  console.log('patched findCandidateOIWalls');
} else {
  console.log('Could not find oldFindCandidate snippet in strategy-engine.ts');
}
