const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regexSnapshot = /const snapshotKey = candles1m\.length > 0 \? new Date\(candles1m\[candles1m\.length - 1\]\.timestamp\)\.toISOString\(\) : '';/;
const replacementSnapshot = `
    const history = this.getOptionChainHistory ? this.getOptionChainHistory() : [];
    const latestSnapshot = history.length > 0 ? history[history.length - 1] : null;
    const snapshotKey = latestSnapshot && latestSnapshot.timeISO ? latestSnapshot.timeISO : (candles1m.length > 0 ? new Date(candles1m[candles1m.length - 1].timestamp).toISOString() : '');
`;

code = code.replace(regexSnapshot, replacementSnapshot);

const regexProcessWeakening = /const processWeakening = \(strike: number, currentOI: number, oiChange: number\) => \{[\s\S]*?\}\s*;/g;
const replacementProcessWeakening = `const processWeakening = (strike: number, currentOI: number, oiChange: number) => {
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
    };`;

// Wait, the prompt says "OR OI Change < 0 for 2 consecutive distinct completed snapshots". 
// The current code is already doing that but I need to make sure the regex matches perfectly and the replacement does exactly what is required.
// Actually, the current code for processWeakening already does:
/*
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
*/
// Let's just patch the `snapshotKey` assignment, because processWeakening logic is already correct.

fs.writeFileSync('src/backend/strategy-engine.ts', code);
