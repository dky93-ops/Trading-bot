const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(sessState\.tradeTakenFlag \|\| sessState\.noNewTradeFlag\) \{[\s\S]*?\}/m;
const replacement = `if (sessState.tradeTakenFlag || sessState.noNewTradeFlag) {
      return this.createNoTrade(index, spotPrice, 'Active trade gate: trade already taken');
    }
    
    if (sessState.totalTradesToday >= 3) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Daily trade limit (3) reached');
    }
    
    if (sessState.consecutiveLosses >= 2) {
      return this.createNoTrade(index, spotPrice, 'Execution Limit: Consecutive loss limit (2) reached');
    }`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 6 execution limits complete');
