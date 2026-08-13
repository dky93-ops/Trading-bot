const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

// Fix inverted conditions
code = code.replace(/!sess\.wallOIWeakeningConfirmed\[wallAbove\]/g, "sess.wallOIWeakeningConfirmed[wallAbove] === true && sess.wallInvalidForRejection[wallAbove] !== true");
code = code.replace(/!sess\.wallOIWeakeningConfirmed\[wallBelow\]/g, "sess.wallOIWeakeningConfirmed[wallBelow] === true && sess.wallInvalidForRejection[wallBelow] !== true");

// 7. OI weakening from wall peak
// I'll add logic inside findCandidateOIWalls when building candidates
const findWallRegex = /candidateCEWallsList\.push\(\{[\s\S]*?\}\);/g;
const ceWallReplacement = `candidateCEWallsList.push({
          strike: Number(row.strike_price),
          type: 'CE',
          totalOI: Number(getOI(row, 'CE')),
          oiChange: Number(getOIChange(row, 'CE'))
        });`;
// we should update sess inside checkOIWallReactions or FIndCandidate? 
// The prompt says "When a candidate wall first becomes relevant: if (sess.wallPeakOI[strike] === undefined) { sess.wallPeakOI[strike] = wall.totalOI; } Every distinct aligned snapshot: sess.wallPeakOI[strike] = Math.max(sess.wallPeakOI[strike], wall.totalOI); ... "
