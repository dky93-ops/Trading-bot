const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const constructorRegex = /if \(this\.settings\.accessToken && this\.settings\.isTradingEnabled\) \{\s*this\.startPolling\(\);\s*\}/;

const newGuards = `if (!this.isPaperTradingOnly()) {
      this.state.apiError =
        'Blocked: set PAPER_TRADING_ONLY=true. Live trading is disabled.';
    } else if (!this.hasBrokerCredentials()) {
      this.state.apiError =
        'Blocked: Upstox runtime credentials are missing.';
    }

    if (this.isPaperTradingOnly() && this.hasBrokerCredentials()) {
      this.startPolling();
    }`;

code = code.replace(constructorRegex, newGuards);
fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Patched constructor');
