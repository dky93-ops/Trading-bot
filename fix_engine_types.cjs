const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf-8');
code = code.replace(/this\.state\.nifty50\?\.lastUpdateTime/g, 'this.state.nifty50?.timestamp');
code = code.replace(/this\.state\.nifty50\?\.candles1m/g, '(this.state.nifty50 as any)?.candles1m');
code = code.replace(/this\.settings\.CHOP_ATR_PERIOD/g, '(this.settings as any).CHOP_ATR_PERIOD');
code = code.replace(/this\.settings\.SL_BUFFER_ATR_MULTIPLIER/g, '(this.settings as any).SL_BUFFER_ATR_MULTIPLIER');
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed engine types');
