const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const touchedWall = isAbove[\s\S]*?\? candle\.high >= strike && candle\.close < strike[\s\S]*?: candle\.low <= strike && candle\.close > strike;/;

const replacement = `
        const tol = this.settings.WALL_TOLERANCE_POINTS || 5;
        let touchedWall = false;
        
        // A wall rejection requires: spot touches or enters the tolerance zone; spot moves away from the wall; the completed candle does not accept beyond the wall
        if (isAbove) {
          // CE wall above spot (resistance)
          const reachedTolerance = candle.high >= (strike - tol);
          const closedBelow = candle.close < strike;
          touchedWall = reachedTolerance && closedBelow;
        } else {
          // PE wall below spot (support)
          const reachedTolerance = candle.low <= (strike + tol);
          const closedAbove = candle.close > strike;
          touchedWall = reachedTolerance && closedAbove;
        }
`;

code = code.replace(regex, replacement.trim());
fs.writeFileSync('src/backend/strategy-engine.ts', code);
