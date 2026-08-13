const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

if (!code.includes('MAX_OPTION_LOSS_PERCENT: 35')) {
    code = code.replace(/MAX_OPTION_SPREAD_PERCENT: 1\.5,/, 'MAX_OPTION_SPREAD_PERCENT: 1.5,\n    MAX_OPTION_LOSS_PERCENT: 35,');
}

const updateSettingsRegex = /updateSettings\(newSettings: Partial<AppSettings>\) \{[\s\S]*?this\.broadcast\(\{\n\s*type: 'SETTINGS_UPDATE',\n\s*data: this\.getPublicSettings\(\),\n\s*\}\);\n\s*\}/;
const newUpdateSettings = `updateSettings(newSettings: Partial<AppSettings>) {
  const {
    apiKey: _apiKey,
    apiSecret: _apiSecret,
    accessToken: _accessToken,
    ...safeSettings
  } = newSettings as Partial<AppSettings> & {
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
  };

  this.settings = { ...this.settings, ...safeSettings };
  this.strategyEngine.updateSettings(this.settings);

  const safeToPoll = this.isPaperTradingOnly() && this.hasBrokerCredentials();
  if (!safeToPoll) {
    this.stopPolling();
    this.state.apiError = !this.isPaperTradingOnly()
      ? 'Blocked: PAPER_TRADING_ONLY must be true.'
      : 'Blocked: runtime broker credentials are missing.';
  } else if (!this.pollingInterval && this.settings.isTradingEnabled) {
    this.startPolling();
    this.state.apiError = undefined;
  }

  this.broadcast({
    type: 'SETTINGS_UPDATE',
    data: this.getPublicSettings(),
  });
}`;

code = code.replace(updateSettingsRegex, newUpdateSettings);

code = code.replace(/this\.startOneMinOptionChainRecorder\(\);/g, 'if (this.isPaperTradingOnly() && this.hasBrokerCredentials()) {\n      this.startOneMinOptionChainRecorder();\n    }');

const recordGuard = /private async recordOneMinOptionChain\(\) \{/;
code = code.replace(recordGuard, 'private async recordOneMinOptionChain() {\n    if (!this.isPaperTradingOnly() || !this.hasBrokerCredentials()) return;');


const normalizeRegex = /const coi = r\.call_options\?\.market_data\?\.oi \|\| 0;\n\s*const poi = r\.put_options\?\.market_data\?\.oi \|\| 0;\n\s*if \(coi === 0 \|\| poi === 0\) continue;/m;

const newNormalize = `const readOi = (option: any): number | undefined => {
      const value = Number(
        option?.market_data?.oi ??
        option?.market_data?.total_oi ??
        option?.market_data?.totalOi,
      );
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    };

    const coi = readOi(r.call_options);
    const poi = readOi(r.put_options);
    if (coi === undefined || poi === undefined) continue;`;

if (normalizeRegex.test(code)) {
    code = code.replace(normalizeRegex, newNormalize);
}

fs.writeFileSync('src/backend/upstox-service.ts', code);
