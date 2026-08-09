const fs = require('fs');

let engine = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const oldRegex = /const today = new Date\(\);\s*today\.setHours\(0, 0, 0, 0\);\s*const todayCandles = candles1m\.filter\(c => new Date\(c\.timestamp\)\.getTime\(\) >= today\.getTime\(\)\);\s*const prevCandles = candles1m\.filter\(c => new Date\(c\.timestamp\)\.getTime\(\) < today\.getTime\(\)\);/;

const newLogic = `
    const currentISTDate = this.getISTDateKey(timeObj);
    
    // Reset session state if it's a new day
    if (sessState.sessionDateIST !== currentISTDate) {
      this.sessionStates[index] = this.createInitialSessionState();
      this.sessionStates[index].sessionDateIST = currentISTDate;
      // Copy over prev day values logic below will populate them
    }

    const todayCandles = candles1m.filter(c => this.getISTDateKey(c.timestamp) === currentISTDate);
    const prevCandles = candles1m.filter(c => this.getISTDateKey(c.timestamp) < currentISTDate);
`;

engine = engine.replace(oldRegex, newLogic);
fs.writeFileSync('src/backend/strategy-engine.ts', engine);
