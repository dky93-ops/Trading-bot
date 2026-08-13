const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

const oldSettingsRegex = /private settings: AppSettings = \{[\s\S]*?\};\n/m;
const newSettings = `private settings: AppSettings = {
    apiKey: process.env.UPSTOX_API_KEY || '',
    apiSecret: process.env.UPSTOX_API_SECRET || '',
    accessToken: process.env.UPSTOX_ACCESS_TOKEN || '',
    isTradingEnabled: true,
    nifty50Enabled: true,
    expiryDate: 'CURRENT',
    defaultLotsPerTrade: 1,
    maxActiveTrades: 1,
    DECISION_TIMEFRAME_MINUTES: 5,
    OPENING_RANGE_MINUTES: 15,
    MAX_OPTION_SPREAD_PERCENT: 1.5,
    PREMIUM_CONFIRMATION_PERCENT: 1,
    OPENING_PREMIUM_CONFIRMATION_PERCENT: 1.5,
    WALL_OI_RATIO: 1.5,
    WALL_WEAKENING_PERCENT: 5,
    MAX_WALL_DISTANCE_ATR: 1.5,
    MIN_ENTRY_TIME_IST: '09:30',
    LAST_ENTRY_TIME_IST: '15:00',
    strategies: {
      openingTrap: { enabled: true, lotSize: 1 },
      failedRetest: { enabled: true, lotSize: 1 },
      continuationBreakdown: { enabled: true, lotSize: 1 },
      continuationBreakout: { enabled: true, lotSize: 1 },
      oiWallRejection: { enabled: true, lotSize: 1 },
    },
  };

  private isPaperTradingOnly(): boolean {
    return String(process.env.PAPER_TRADING_ONLY || '').toLowerCase() === 'true';
  }

  private hasBrokerCredentials(): boolean {
    return Boolean(
      process.env.UPSTOX_API_KEY &&
      process.env.UPSTOX_API_SECRET &&
      process.env.UPSTOX_ACCESS_TOKEN,
    );
  }

  public getPublicSettings() {
    const { apiKey: _apiKey, apiSecret: _apiSecret, accessToken: _accessToken, ...safe } =
      this.settings;
    return {
      ...safe,
      hasAccessToken: Boolean(this.settings.accessToken),
      paperTradingOnly: this.isPaperTradingOnly(),
      liveOrdersEnabled: false,
    };
  }
`;

code = code.replace(oldSettingsRegex, newSettings);
fs.writeFileSync('src/backend/upstox-service.ts', code);
console.log('Patched upstox settings');
