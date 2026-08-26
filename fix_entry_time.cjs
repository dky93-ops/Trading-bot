const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

code = code.replace(
  "latestSpotTimestamp: Date.now(),\n      latestOptionTimestamp: Date.now(),\n      entryTime: Date.now()",
  "latestSpotTimestamp: this.state.nifty50?.lastUpdateTime || Date.now(),\n      latestOptionTimestamp: this.state.nifty50?.lastUpdateTime || Date.now(),\n      entryTime: this.state.nifty50?.lastUpdateTime || Date.now()"
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed entryTime bug');
