import re

with open('src/backend/upstox-service.ts', 'r') as f:
    text = f.read()

pattern = r'\} else \{\n      // If market is closed or trading disabled or feed inactive, exit any active positions\n      if \(this\.strategyEngine\.activeSignals\.size > 0\) \{[^}]+\}\n    \}'

replacement = """} else {
      // If market is closed or trading disabled or feed inactive, exit any active positions
      if (this.strategyEngine.activeSignals.size > 0) {
        const reason = !this.strategyEngine.isMarketOpen() 
          ? "Market Closed (Outside NSE Trading Hours)" 
          : "Market Feed Inactive or Trading Disabled";
        this.strategyEngine.exitAllActiveTrades(reason);
      }
      this.state.signals = [
        ...Array.from(this.strategyEngine.activeSignals.values()),
        ...Array.from(this.strategyEngine.history.values()).reverse()
      ].slice(0, 10) as any[];
    }"""

text = re.sub(pattern, replacement, text)

with open('src/backend/upstox-service.ts', 'w') as f:
    f.write(text)
