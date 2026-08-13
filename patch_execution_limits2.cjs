const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(sessState\.totalTradesToday >= 3\) \{[\s\S]*?\} \{[\s\S]*?\}/m;
const replacement = `if ((sessState.completedTradesCount || 0) >= 3) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Daily trade limit (3) reached');
    }
    
    if ((sessState.consecutiveLosingTrades || 0) >= 2) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Consecutive loss limit (2) reached');
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 6 updated limits complete');
