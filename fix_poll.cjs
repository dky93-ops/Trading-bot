const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// The pollData function ends somewhere around 524. Let's find it.
const regex = /private async pollData\(\) \{[\s\S]*?private handlePollError\(\) \{/m;
const match = code.match(regex);
if (match) {
  code = code.replace(regex, `private async pollData() {
    if (this.isPolling) return; // Prevent concurrent/overlapping requests
    if (Date.now() < this.rateLimitBackoffUntil) return; // Wait during rate limit backoff

    this.isPolling = true;
    let success = false;
    let isRateLimit = false;

    if (this.settings.accessToken) {
      try {
        const activeOptionKeys = Array.from(this.strategyEngine.activeSignals.values())
          .map(s => s.instrumentKey ? s.instrumentKey.replace(':', '|') : '')
          .filter(Boolean);

        const keysList = [
          'NSE_INDEX|Nifty 50', 
          'NSE_INDEX|India VIX',
          ...activeOptionKeys
        ];

        // Deduplicate and encode instrument keys
        const instrumentKeys = Array.from(new Set(keysList)).join(',');

        const response = await axios.get(\`https://api.upstox.com/v2/market-quote/quotes?instrument_key=\${encodeURIComponent(instrumentKeys)}\`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': \`Bearer \${this.settings.accessToken}\`
          },
          timeout: 4000
        });

        if (response.data && response.data.status === 'success' && response.data.data) {
          const data = response.data.data;
          this.state.isConnected = true;
          this.errorCount = 0; // reset errors

          const insertTick = (inst: string, price: number, time: number) => {
            // Placeholder since this is abstracted away
          };

          if (data['NSE_INDEX:Nifty 50']) {
            const tick = data['NSE_INDEX:Nifty 50'];
            this.state.nifty50 = {
              lastPrice: tick.last_price,
              change: tick.net_change,
              timestamp: Date.now()
            };
          }
          if (data['NSE_INDEX:India VIX']) {
            const tick = data['NSE_INDEX:India VIX'];
            this.state.indiaVix = {
              lastPrice: tick.last_price,
              change: tick.net_change,
              timestamp: Date.now()
            };
          }
            
          // Update live prices for active options using exact instrument_token match from Upstox quote response
          const quoteList = Object.values(data) as any[];
          for (const signal of this.strategyEngine.activeSignals.values()) {
            if (signal.instrumentKey) {
              const matchingQuote = quoteList.find((q: any) => 
                q && (
                  q.instrument_token === signal.instrumentKey ||
                  q.instrument_token === signal.instrumentKey.replace(':', '|') ||
                  q.instrument_token === signal.instrumentKey.replace('|', ':')
                )
              );
              if (matchingQuote && matchingQuote.last_price !== undefined) {
                signal.latestPrice = matchingQuote.last_price;
              }
            }
          }

          this.state.apiError = undefined;
          success = true;
        }
      } catch (error: any) {
        console.warn("Upstox market quote polling warning:", error.response?.data || error.message);
        const errObj = error.response?.data?.errors?.[0];
        const code = errObj?.errorCode || errObj?.error_code;
        const msg = errObj?.message || error.message;

        if (code === 'UDAPI10005' || error.response?.status === 401) {
          this.state.apiError = "Upstox Access Token is invalid or expired (UDAPI10005). Please paste a new token in Settings.";
        } else if (code === 'UDAPI100042' || error.response?.status === 429) {
          isRateLimit = true;
          this.rateLimitBackoffUntil = Date.now() + 6000; // Back off 6 seconds for rate limit
          this.state.apiError = "Upstox API Rate Limit reached (UDAPI100042). Automatically throttling requests...";
        } else if (code) {
          this.state.apiError = \`Upstox API Error (\${code}): \${msg}\`;
        }
      } finally {
        this.isPolling = false;
      }
    } else {
      this.isPolling = false;
    }

    if (!success) {
      if (!isRateLimit) {
        this.handlePollError();
      }
      return;
    }

    // Run strategy engine tick ONLY on live, fresh real-time feed during market hours
    if (this.settings.isTradingEnabled && this.state.isConnected && !this.state.apiError && this.strategyEngine.isMarketOpen()) {
      const now = Date.now();
      const isNiftyFresh = this.state.nifty50.timestamp > 0 && (now - this.state.nifty50.timestamp < 12000);

      if (isNiftyFresh) {
        const newSignals = await this.strategyEngine.onTick(this.state);
        if (newSignals.length > 0) {
          this.state.signals = newSignals.slice(0, 10); // Keep last 10 decisions in state
        }
      }
    } else {
      // If market is closed or trading disabled or feed inactive, exit any active positions
      if (this.strategyEngine.activeSignals.size > 0) {
        const reason = !this.strategyEngine.isMarketOpen() 
          ? "Market Closed (Outside NSE Trading Hours)" 
          : "Market Feed Inactive or Trading Disabled";
        this.strategyEngine.exitAllActiveTrades(reason);
      }
    }

    this.state.overallPnL = this.strategyEngine.overallPnL;
    this.state.realizedPnL = this.strategyEngine.realizedPnL;
    this.state.unrealizedPnL = this.strategyEngine.unrealizedPnL;
    this.state.winRate = this.strategyEngine.winRate;
    this.state.totalTrades = this.strategyEngine.totalTrades;
    this.state.winningTrades = this.strategyEngine.winningTrades;

    this.broadcastState();
  }

  private handlePollError() {`);

  fs.writeFileSync('src/backend/upstox-service.ts', code);
}
