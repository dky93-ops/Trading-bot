const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf-8');

// The lines 97 to 143 start at:
// private async getNearestExpiry(instrumentKey: string): Promise<string> {
// and end right before:
// public async startPolling() {

const prefix = code.substring(0, code.indexOf('private async getNearestExpiry'));
const suffix = code.substring(code.indexOf('public async startPolling()'));

const newMethods = `
  public updateSettings(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    if (this.settings.accessToken && !this.pollingInterval) {
      this.startPolling();
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public resetSignals() {
    this.state.signals = [];
    this.strategyEngine.activeSignals.clear();
    this.state.overallPnL = 0;
    this.state.realizedPnL = 0;
    this.state.unrealizedPnL = 0;
    this.state.winRate = 0;
    this.state.totalTrades = 0;
    this.state.winningTrades = 0;
    this.broadcastState();
  }

  public getOptionChainHistory() {
    return this.optionChainHistory;
  }

  public clearOptionChainHistory() {
    this.optionChainHistory = [];
  }

  public async getExpiries(instrumentKey: string): Promise<string[]> {
    try {
      const response = await axios.get(\`https://api.upstox.com/v2/option/contract\`, {
        params: { instrument_key: instrumentKey },
        headers: {
          'Accept': 'application/json',
          'Authorization': \`Bearer \${this.settings.accessToken}\`
        }
      });
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split('T')[0];
        const expirys = [...new Set(response.data.data.map((c: any) => c.expiry))].sort().filter((e: any) => (e) >= todayIST) as string[];
        if (expirys.length > 0) return expirys;
      }
    } catch (e) {
      console.error('Error fetching expiries:', e);
    }
    const nearest = await this.getNearestExpiry(instrumentKey);
    return [nearest];
  }

  private async getNearestExpiry(instrumentKey: string): Promise<string> {
    const cached = this.nearestExpiryCache[instrumentKey];
    if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
      return cached.date;
    }
    return 'CURRENT';
  }

  public async getOptionChain(instrumentKey: string, expiryDate?: string) {
    if (!this.dataFetcher) this.dataFetcher = new UpstoxDataFetcher(this.settings.accessToken, this.dataManager);
    return this.dataFetcher.fetchFullOptionChain(instrumentKey, expiryDate || this.settings.expiryDate);
  }

  private async fetchOptionData(spot: number): Promise<OptionChainSnapshot | null> {
    const expiry = await this.getNearestExpiry('NSE_INDEX|Nifty 50');
    const chain = await this.getOptionChain('NSE_INDEX|Nifty 50', expiry);
    if (!chain || chain.length === 0) return null;
    
    // Convert to OptionChainSnapshot
    return {
      id: Date.now().toString(),
      timestamp: Date.now(),
      timeISO: new Date().toISOString(),
      instrumentKey: 'NSE_INDEX|Nifty 50',
      expiryDate: expiry,
      spotPrice: spot,
      totalCallOI: 0,
      totalPutOI: 0,
      pcr: 1,
      maxCallOIStrike: 0,
      maxPutOIStrike: 0,
      strikeCount: chain.length,
      rows: chain.map((c: any) => ({
        strike: c.strike_price,
        ce: c.call_options ? {
          ltp: c.call_options.market_data?.ltp,
          totalOi: c.call_options.market_data?.oi,
          bidPrice: c.call_options.market_data?.bid_price,
          askPrice: c.call_options.market_data?.ask_price,
          volume: c.call_options.market_data?.volume,
          iv: c.call_options.option_greeks?.iv,
          delta: c.call_options.option_greeks?.delta,
          theta: c.call_options.option_greeks?.theta,
          gamma: c.call_options.option_greeks?.gamma,
          vega: c.call_options.option_greeks?.vega,
          oiChange: 0
        } : {} as any,
        pe: c.put_options ? {
          ltp: c.put_options.market_data?.ltp,
          totalOi: c.put_options.market_data?.oi,
          bidPrice: c.put_options.market_data?.bid_price,
          askPrice: c.put_options.market_data?.ask_price,
          volume: c.put_options.market_data?.volume,
          iv: c.put_options.option_greeks?.iv,
          delta: c.put_options.option_greeks?.delta,
          theta: c.put_options.option_greeks?.theta,
          gamma: c.put_options.option_greeks?.gamma,
          vega: c.put_options.option_greeks?.vega,
          oiChange: 0
        } : {} as any
      }))
    };
  }

  private async syncHistoricalCandles() {
    if (!this.settings.accessToken) return;
    if (Date.now() < this.candleSyncBackoffUntil) return;
    try {
      const decisionMinutes = Number(this.settings.DECISION_TIMEFRAME_MINUTES || 5);
      
      const response1m = await axios.get(
        \`https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/1\`,
        { headers: { Accept: 'application/json', Authorization: \`Bearer \${this.settings.accessToken}\` }, timeout: 5000 }
      );
      if (response1m.data?.status === 'success' && response1m.data.data?.candles) {
        await seedHistoricalCandles('NIFTY', 1, response1m.data.data.candles);
      }
      
      if (decisionMinutes > 1) {
          const responseDt = await axios.get(
            \`https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/\${decisionMinutes}\`,
            { headers: { Accept: 'application/json', Authorization: \`Bearer \${this.settings.accessToken}\` }, timeout: 5000 }
          );
          if (responseDt.data?.status === 'success' && responseDt.data.data?.candles) {
            await seedHistoricalCandles('NIFTY', decisionMinutes, responseDt.data.data.candles);
          }
      }
    } catch(e: any) {
      if (e.response?.status === 429) {
        this.candleSyncBackoffUntil = Date.now() + 10000;
      }
      console.error("Failed to sync historical candles:", e.response?.data || e.message);
    }
  }
`;

fs.writeFileSync('src/backend/upstox-service.ts', prefix + newMethods + suffix);
console.log('Restored deleted methods in upstox-service.ts');
