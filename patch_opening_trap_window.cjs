const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /if \(candles\.length < 5\) return null;\n\s*const c0 = candles\[candles\.length - 1\];/m;

const replacement = `if (candles.length < 5) return null;
    const c0 = candles[candles.length - 1];

    const c0Date = new Date(c0.timestamp);
    const c0TimeMs = c0Date.getTime();
    const d = new Date(c0Date);
    const windowStartMs = d.setHours(9, 15, 0, 0);
    const windowEndMs = d.setHours(10, 15, 0, 0);
    
    if (c0TimeMs < windowStartMs || c0TimeMs > windowEndMs) {
      return null;
    }
    
    const isStrongWindow = c0TimeMs <= d.setHours(9, 45, 0, 0);
`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('PATCH 4 window complete');
