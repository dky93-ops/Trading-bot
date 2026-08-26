const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

const replacement = `    if (!sess.wallPeakOI) sess.wallPeakOI = {};
    if (!sess.wallNegativeOIAlignedKeys) sess.wallNegativeOIAlignedKeys = {};
    if (!sess.wallInvalidForRejection) sess.wallInvalidForRejection = {};
    if (!sess.wallOIWeakeningConfirmed) sess.wallOIWeakeningConfirmed = {};
    if (!sess.wallOIHistory) sess.wallOIHistory = {};`;

code = code.replace("if (!sess.wallPeakOI) sess.wallPeakOI = {};", replacement);

const ceOIRecord = `if (ceOI !== undefined && ceOI > 0) {
        if (!sess.wallOIHistory[strike]) sess.wallOIHistory[strike] = [];
        sess.wallOIHistory[strike].push({ time: Date.now(), oi: ceOI });
        
        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;`;

code = code.replace("if (ceOI !== undefined && ceOI > 0) {\n        if (sess.wallPeakOI[strike] === undefined) sess.wallPeakOI[strike] = ceOI;", ceOIRecord);

const peOIRecord = `if (peOI !== undefined && peOI > 0) {
        if (!sess.wallOIHistory[strike]) sess.wallOIHistory[strike] = [];
        sess.wallOIHistory[strike].push({ time: Date.now(), oi: peOI });
        const pePct = getPercentileRank(peOI, allPeOIs);`;

code = code.replace("if (peOI !== undefined && peOI > 0) {\n        const pePct = getPercentileRank(peOI, allPeOIs);", peOIRecord);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
