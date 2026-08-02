const fs = require('fs');
let content = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

// Replace the strategies block
content = content.replace(/strategies: \{[\s\S]*?\}\s*\};/, `strategies: {
      straddle130: { enabled: true, lotSize: 1, slPercent: 20, targetPercent: 60, trailingEnabled: true },
      oiDivergence: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 45, trailingEnabled: true },
      bbSqueeze: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 45, trailingEnabled: true },
      orb: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 37.5, trailingEnabled: true },
      adx9Ema: { enabled: true, lotSize: 1, slPercent: 10, targetPercent: 20, trailingEnabled: true },
      vwapBounce: { enabled: true, lotSize: 1, slPercent: 10, targetPercent: 30, trailingEnabled: true },
      insideBar: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 40, trailingEnabled: true },
      gammaScalping: { enabled: true, lotSize: 1, slPercent: 50, targetPercent: 200, trailingEnabled: false },
    }
  };`);
  
// Also update fetchOptionData to accept strikeOffset
content = content.replace(
  `private async fetchOptionData(index: string, type: 'CE' | 'PE', spotPrice: number) {`,
  `private async fetchOptionData(index: string, type: 'CE' | 'PE', spotPrice: number, strikeOffset: number = 0) {`
);

content = content.replace(
  `const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;`,
  `const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;
      const targetStrike = atmStrike + strikeOffset;`
);

content = content.replace(
  /const optionData = chainData\.find\(\(row: any\) => row\.strike_price === atmStrike\);/g,
  `const optionData = chainData.find((row: any) => row.strike_price === targetStrike);`
);

content = content.replace(
  /strike: atmStrike/g,
  `strike: targetStrike`
);

fs.writeFileSync('src/backend/upstox-service.ts', content);
