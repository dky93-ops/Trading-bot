const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const regex1 = /const insertTick = \(inst: string, price: number, time: number\) => \{\s*\/\/ Placeholder since this is abstracted away\s*\};\s*if \(data\['NSE_INDEX:Nifty 50'\]\) \{\s*const tick = data\['NSE_INDEX:Nifty 50'\];\s*this\.state\.nifty50 = \{\s*lastPrice: tick\.last_price,\s*change: tick\.net_change,\s*timestamp: Date\.now\(\)\s*\};\s*\}/m;

const replace1 = `if (data['NSE_INDEX:Nifty 50']) {
            const tick = data['NSE_INDEX:Nifty 50'];
            const niftyLast = Number(tick.last_price);
            const niftyTimestamp = Date.now();
            if (Number.isFinite(niftyLast) && niftyLast > 0) {
              this.state.nifty50 = {
                lastPrice: niftyLast,
                change: Number(tick.net_change || 0),
                timestamp: niftyTimestamp,
              };
              await insertTick('NIFTY', niftyLast, niftyTimestamp);
            }
          }`;

code = code.replace(regex1, replace1);

const regex2 = /if \(this\.settings\.isTradingEnabled && this\.state\.isConnected && !this\.state\.apiError && this\.strategyEngine\.isMarketOpen\(\)\) \{\s*const now = Date\.now\(\);\s*const isNiftyFresh = this\.state\.nifty50\.timestamp > 0 && \(now - this\.state\.nifty50\.timestamp < 12000\);\s*if \(isNiftyFresh\) \{\s*const newSignals = await this\.strategyEngine\.onTick\(this\.state\);\s*if \(newSignals\.length > 0\) \{\s*this\.state\.signals = newSignals\.slice\(0, 10\); \/\/ Keep last 10 decisions in state\s*\}\s*\}\s*\}/m;

const replace2 = `const paperOnly = this.isPaperTradingOnly();
    const freshSpot =
      this.state.nifty50.timestamp > 0 &&
      Date.now() - this.state.nifty50.timestamp <= 12_000;

    if (
      paperOnly &&
      this.settings.isTradingEnabled &&
      this.state.isConnected &&
      !this.state.apiError &&
      this.strategyEngine.isMarketOpen() &&
      freshSpot
    ) {
      const newSignals = await this.strategyEngine.onTick(this.state);
      this.state.signals = newSignals.slice(0, 10);
    }`;
    
code = code.replace(regex2, replace2);

fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Patched pollData');
