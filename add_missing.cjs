const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const targetFunction = `
  private computeSpotTargets(
    direction: 'CALL' | 'PUT',
    spot: number,
    brokenLevel: number,
    chainRows: any[],
    sess: LocalSessionState
  ): { structuralStopSpot:number; target1Spot:number; target2Spot:number } | undefined {
    const tolerance = Number(this.settings.WALL_TOLERANCE_POINTS);
    if (!Number.isFinite(tolerance) || tolerance <= 0) return undefined;
    const levels: number[] = [];
    if (direction === 'CALL') {
      if (sess.sessionHigh > spot) levels.push(sess.sessionHigh);
      if (sess.previousDayHigh > spot) levels.push(sess.previousDayHigh);
      if (sess.openingRangeHigh > spot) levels.push(sess.openingRangeHigh);
      const candidates = this.findCandidateOIWalls(chainRows, spot, 50, sess);
      for (const w of candidates.candidateCEWallsList) {
        if (w.strike > spot) levels.push(w.strike);
      }
      const sorted = [...new Set(levels)]
        .filter(x => x > spot + tolerance)
        .sort((a,b) => a-b);
      if (sorted.length < 1 || brokenLevel >= spot) return undefined;
      return {
        structuralStopSpot: brokenLevel,
        target1Spot: sorted[0],
        target2Spot: sorted.find(x => x > sorted[0]) ?? 0
      };
    }
    if (sess.sessionLow < spot) levels.push(sess.sessionLow);
    if (sess.previousDayLow > 0 && sess.previousDayLow < spot) {
      levels.push(sess.previousDayLow);
    }
    if (sess.openingRangeLow > 0 && sess.openingRangeLow < spot) {
      levels.push(sess.openingRangeLow);
    }
    const candidates = this.findCandidateOIWalls(chainRows, spot, 50, sess);
    for (const w of candidates.candidatePEWallsList) {
      if (w.strike < spot) levels.push(w.strike);
    }
    const sorted = [...new Set(levels)]
      .filter(x => x < spot - tolerance)
      .sort((a,b) => b-a);
    if (sorted.length < 1 || brokenLevel <= spot) return undefined;
    return {
      structuralStopSpot: brokenLevel,
      target1Spot: sorted[0],
      target2Spot: sorted.find(x => x < sorted[0]) ?? 0
    };
  }
`;

if (!code.includes('computeSpotTargets')) {
  code = code.replace(/private createSignal\(/, targetFunction + "\n  $&");
  fs.writeFileSync('src/backend/strategy-engine.ts', code);
  console.log('Added computeSpotTargets');
}
