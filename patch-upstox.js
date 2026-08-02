const fs = require('fs');
let content = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');
content = content.replace(
  /strategies: \{\s*straddle130: \{[^}]+\},\s*oiDivergence: \{[^}]+\},\s*bbSqueeze: \{[^}]+\},\s*orb: \{[^}]+\},\s*adx9Ema: \{[^}]+\},\s*(macdSupertrend: \{[^}]+\},\s*rsiReversal: \{[^}]+\},)?\s*\}/g,
  `strategies: {
      straddle130: { enabled: true, lotSize: 1, slPercent: 20, targetPercent: 60, trailingEnabled: true },
      oiDivergence: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 45, trailingEnabled: true },
      bbSqueeze: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 45, trailingEnabled: true },
      orb: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 37.5, trailingEnabled: true },
      adx9Ema: { enabled: true, lotSize: 1, slPercent: 10, targetPercent: 20, trailingEnabled: true },
      vwapBounce: { enabled: true, lotSize: 1, slPercent: 10, targetPercent: 30, trailingEnabled: true },
      insideBar: { enabled: true, lotSize: 1, slPercent: 15, targetPercent: 40, trailingEnabled: true },
      gammaScalping: { enabled: true, lotSize: 1, slPercent: 50, targetPercent: 200, trailingEnabled: false },
    }`
);
fs.writeFileSync('src/backend/upstox-service.ts', content);
