const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /private computeSpotTargets\([\s\S]*?\} \| undefined \{[\s\S]*?\n  \}\n/m;

const replacement = `private computeSpotTargets(
    direction: 'CALL' | 'PUT',
    spot: number,
    brokenLevel: number,
    chainRows: any[],
    sess: LocalSessionState
  ): { structuralStopSpot:number; target1Spot:number; target2Spot:number } | undefined {
    let structuralStopSpot = direction === 'CALL' ? spot - 15 : spot + 15;
    
    let target1Spot = direction === 'CALL' 
      ? spot + (spot - structuralStopSpot) * 1.5 
      : spot - (structuralStopSpot - spot) * 1.5;

    let target2Base = direction === 'CALL'
      ? spot + (spot - structuralStopSpot) * 3.0
      : spot - (structuralStopSpot - spot) * 3.0;

    let nearestOpposingWall: number | undefined;
    const candidates = this.findCandidateOIWalls(chainRows, spot, 50, sess);
    
    if (direction === 'CALL') {
      const walls = candidates.candidateCEWallsList.filter(w => w.strike > spot).sort((a,b) => a.strike - b.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    } else {
      const walls = candidates.candidatePEWallsList.filter(w => w.strike < spot).sort((a,b) => b.strike - a.strike);
      if (walls.length > 0) nearestOpposingWall = walls[0].strike;
    }

    let target2Spot = target2Base;
    if (nearestOpposingWall !== undefined) {
      if (direction === 'CALL') {
         if (nearestOpposingWall < target2Base) target2Spot = nearestOpposingWall - 5;
      } else {
         if (nearestOpposingWall > target2Base) target2Spot = nearestOpposingWall + 5;
      }
    }

    return { structuralStopSpot, target1Spot, target2Spot };
  }
`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 5 targets complete');
