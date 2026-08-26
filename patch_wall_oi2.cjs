const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');

code = code.replace(
  "sess.wallOIHistory[strike].push({ time: Date.now(), oi: ceOI });",
  "const simTime = (this.state && this.state.nifty50 && this.state.nifty50.lastUpdateTime) ? this.state.nifty50.lastUpdateTime : Date.now();\n        sess.wallOIHistory[strike].push({ time: simTime, oi: ceOI });"
);

code = code.replace(
  "sess.wallOIHistory[strike].push({ time: Date.now(), oi: peOI });",
  "const simTimePE = (this.state && this.state.nifty50 && this.state.nifty50.lastUpdateTime) ? this.state.nifty50.lastUpdateTime : Date.now();\n        sess.wallOIHistory[strike].push({ time: simTimePE, oi: peOI });"
);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
