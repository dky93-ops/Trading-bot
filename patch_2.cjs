const fs = require('fs');
let upstoxCode = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
if (!upstoxCode.includes('WALL_TOLERANCE_POINTS: 10')) {
  upstoxCode = upstoxCode.replace('DECISION_TIMEFRAME_MINUTES: 5,', 'DECISION_TIMEFRAME_MINUTES: 5,\n    WALL_TOLERANCE_POINTS: 10,');
  fs.writeFileSync('src/backend/upstox-service.ts', upstoxCode);
}

let engineCode = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const target1 = `const rows = normalizeChainRows(chainRows);

    if (rows.length === 0) {
      return this.createNoTrade(
        index,
        spotPrice,
        'FAILED_OPTION_CHAIN: No usable option-chain rows',
      );
    }`;

const replacement1 = `const rows = normalizeChainRows(chainRows);

    if (rows.length === 0) {
      return this.createNoTrade(
        index,
        spotPrice,
        'FAILED_OPTION_CHAIN: No usable option-chain rows',
      );
    }

    const snapshotTimestamp =
      Number(this.state.optionChainTimestamp) > 0
        ? Number(this.state.optionChainTimestamp)
        : Date.now();

    for (const row of rows) {
      const strike = Number(row.strike_price);

      if (!Number.isFinite(strike)) {
        continue;
      }

      const ceOi = this.readRequiredOi(row, 'CE');
      const peOi = this.readRequiredOi(row, 'PE');

      if (ceOi !== undefined) {
        this.recordWallOi(
          'CE',
          strike,
          ceOi,
          snapshotTimestamp,
          sessState,
        );
      }

      if (peOi !== undefined) {
        this.recordWallOi(
          'PE',
          strike,
          peOi,
          snapshotTimestamp,
          sessState,
        );
      }
    }

    const candidates = this.findCandidateOIWalls(
      rows,
      spotPrice,
      sessState,
    );

    const wallTolerance = Number(this.settings.WALL_TOLERANCE_POINTS || 10);

    this.recordWallTests(
      candidates,
      candles,
      sessState,
      wallTolerance,
    );

    const nearestCeWallAbove =
      candidates.candidateCEWallsList.find(
        (wall) => wall.strike > spotPrice,
      )?.strike || 0;

    const nearestPeWallBelow =
      candidates.candidatePEWallsList.find(
        (wall) => wall.strike < spotPrice,
      )?.strike || 0;`;

// Before doing replacement1, I need to strip out the old findCandidateOIWalls block if it exists
engineCode = engineCode.replace(/const candidates = this\.findCandidateOIWalls\(chainRows, spotPrice, sessState\);\s*const nearestCeWallAbove = candidates\.candidateCEWallsList\.find\(w => w\.strike > spotPrice\)\?\.strike \|\| 0;\s*const nearestPeWallBelow = candidates\.candidatePEWallsList\.find\(w => w\.strike < spotPrice\)\?\.strike \|\| 0;/g, '');

engineCode = engineCode.replace(target1, replacement1);

// I need to add this.readRequiredOi(row, type) if it doesn't exist
if (!engineCode.includes('readRequiredOi')) {
  const readRequiredOiMethod = `
  private readRequiredOi(row: any, type: 'CE' | 'PE'): number | undefined {
    const opt = type === 'CE' ? (row.ce || row.call_options) : (row.pe || row.put_options);
    if (!opt) return undefined;
    const oi = Number(opt.market_data?.oi || opt.open_interest || opt.oi);
    return Number.isFinite(oi) ? oi : undefined;
  }
`;
  engineCode = engineCode.replace('class StrategyEngine {', 'class StrategyEngine {' + readRequiredOiMethod);
}

fs.writeFileSync('src/backend/strategy-engine.ts', engineCode);

let valCode = fs.readFileSync('src/backend/validation-rules.ts', 'utf8');
const valTarget = `if (isCEWall) {
    const peak = ctx.sessState.wallPeakOI[closest.strike] || 0;
    if (closest.totalOI > peak) {
      ctx.sessState.wallPeakOI[closest.strike] = closest.totalOI;
    }
  } else {
    const peak = ctx.sessState.wallPeakOI[closest.strike] || 0;
    if (closest.totalOI > peak) {
      ctx.sessState.wallPeakOI[closest.strike] = closest.totalOI;
    }
  }`;
const valReplacement = `if (setup.wallStable !== true) {
    return fail(
      'FAILED_WALL_STABILITY: Wall OI is not stable enough',
    );
  }`;
valCode = valCode.replace(valTarget, valReplacement);
fs.writeFileSync('src/backend/validation-rules.ts', valCode);
