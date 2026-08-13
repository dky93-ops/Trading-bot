const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Inside checkOIWallReactions? No, better inside findCandidateOIWalls or where we iterate rows.
// Actually, I can just append it inside findCandidateOIWalls.

const findCandidateRegex = /const candidatePEWallsList: any\[\] = \[\];\n\n    for \(let i = 2; i <= rows\.length - 3; i\+\+\) \{[\s\S]*?\}\n\n    return/m;

const replacement = `const candidatePEWallsList: any[] = [];
    
    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};

    for (let i = 2; i <= rows.length - 3; i++) {
      const row = rows[i];
      const strike = Number(row.strike_price);
      const ceOI = getOI(row, 'CE');
      const peOI = getOI(row, 'PE');
      const ceOIC = getOIChange(row, 'CE');
      const peOIC = getOIChange(row, 'PE');

      // Update peaks
      if (ceOI > 0) {
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;
        sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], ceOI);
        if (ceOI < sess.wallPeakOI[strike] * 0.95) {
          sess.wallOIWeakeningConfirmed[strike] = true;
        }
        if (ceOIC < 0) {
           const timeKey = chainRows ? new Date().toISOString() : "snapshot";
           if (!sess.wallNegativeOIAlignedKeys[strike]) sess.wallNegativeOIAlignedKeys[strike] = [];
           const keys = sess.wallNegativeOIAlignedKeys[strike];
           if (keys.length === 0 || new Date().getTime() - new Date(keys[keys.length-1]).getTime() >= 180000) {
             keys.push(timeKey);
           }
        }
        if (ceOIC > sess.wallPeakOI[strike] * 0.05) { // Assuming 5% increase is invalidation, actually the prompt says "If positive OI is subsequently added > 10% of peak, wallInvalidForRejection = true"
           sess.wallInvalidForRejection[strike] = true;
        }
      }
      
      const prev2 = rows[i - 2];
      const prev1 = rows[i - 1];
      const next1 = rows[i + 1];
      const next2 = rows[i + 2];

      const ceOIAvgAdj = (getOI(prev2, 'CE') + getOI(prev1, 'CE') + getOI(next1, 'CE') + getOI(next2, 'CE')) / 4;
      if (ceOI > ceOIAvgAdj * 1.5) {
        candidateCEWallsList.push({
          strike, type: 'CE', totalOI: ceOI, oiChange: ceOIC
        });
      }

      const peOIAvgAdj = (getOI(prev2, 'PE') + getOI(prev1, 'PE') + getOI(next1, 'PE') + getOI(next2, 'PE')) / 4;
      if (peOI > peOIAvgAdj * 1.5) {
        candidatePEWallsList.push({
          strike, type: 'PE', totalOI: peOI, oiChange: peOIC
        });
      }
    }

    return`;

code = code.replace(findCandidateRegex, replacement);

// And wait, the prompt says exact logic:
// "If OI decreases by > 5% from wallPeakOI => sess.wallOIWeakeningConfirmed[strike] = true"
// "If positive OI is subsequently added > 10% of peak => wallInvalidForRejection = true"
// "Require 3 consecutive snapshots spaced by at least 3 minutes showing negative OI"

// I'll update it exactly as requested.

code = code.replace(/if \(ceOIC > sess.wallPeakOI\[strike\] \* 0.05\)/g, "if (ceOI > (sess.wallPeakOI[strike] * 1.10) && sess.wallOIWeakeningConfirmed[strike])");

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 3 finding complete');
