const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regexProcessWeakening = /\s*const processWeakening[\s\S]*?candidatePEWallsList\.forEach\(w => processWeakening\(w\.strike, w\.totalOI, w\.oiChange \|\| 0\)\);/g;

code = code.replace(regexProcessWeakening, "");

const updateWallHelper = `
  private updateWallOIWeakening(
    candidates: { candidateCEWallsList: OIWall[]; candidatePEWallsList: OIWall[] },
    snapshotKey: string,
    sess: LocalSessionState
  ) {
    if (!sess.wallLastSeenOI) sess.wallLastSeenOI = {};
    if (!sess.wallLastProcessedSnapshotKey) sess.wallLastProcessedSnapshotKey = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};
    if (!sess.wallNegativeOICounts) sess.wallNegativeOICounts = {};

    const processWeakening = (strike: number, currentOI: number, oiChange: number) => {
      if (sess.wallLastProcessedSnapshotKey[strike] === snapshotKey) return;
      sess.wallLastProcessedSnapshotKey[strike] = snapshotKey;

      if (sess.wallLastSeenOI[strike] === undefined) {
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

    candidates.candidateCEWallsList.forEach(w => processWeakening(w.strike, w.totalOI, w.oiChange || 0));
    candidates.candidatePEWallsList.forEach(w => processWeakening(w.strike, w.totalOI, w.oiChange || 0));
  }
`;

// Insert it before findCandidateOIWalls
code = code.replace(/  private findCandidateOIWalls/, updateWallHelper + "\n  private findCandidateOIWalls");

// Now update the invocation in evaluateConditions
code = code.replace(/const candidates = this\.findCandidateOIWalls\(chainRows, spotPrice, sessState, snapshotKey\);\s*this\.recordWallReactions/, "const candidates = this.findCandidateOIWalls(chainRows, spotPrice, sessState, snapshotKey);\n      this.updateWallOIWeakening(candidates, snapshotKey, sessState);\n      this.recordWallReactions");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
