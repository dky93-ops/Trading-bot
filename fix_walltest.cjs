const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const oldCheck1 = `    // Count how many recent 3m candles reached wallAbove and closed below it
    const ceWallTests = candles.filter(c => c.high >= wallAbove - tolerance && c.close < wallAbove).length;
    // Count how many recent 3m candles reached wallBelow and closed above it
    const peWallTests = candles.filter(c => c.low <= wallBelow + tolerance && c.close > wallBelow).length;`;

const newCheck1 = `    // Get the session-wide test counts against the actual wall strike
    const ceWallTests = sess.wallTestCounts[wallAbove] || 0;
    const peWallTests = sess.wallTestCounts[wallBelow] || 0;`;

code = code.replace(oldCheck1, newCheck1);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
