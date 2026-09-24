const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// 1. Remove the market hours filter in LiveChart (since server does it now)
code = code.replace(/const marketCandles = candles\.filter\([\s\S]*?Strictly Indian Market Hours\s*\}\);/, 'const marketCandles = candles;');

// 2. Add market hours check for live updates
const oldUpdate = `  useEffect(() => {
    if (livePrice && seriesRef.current) {
      const data = seriesRef.current.data();`;

const newUpdate = `  useEffect(() => {
    if (livePrice && seriesRef.current) {
      // Don't update chart outside market hours
      const now = new Date();
      const istTime = new Date(now.getTime() + 19800000);
      const timeNum = istTime.getUTCHours() * 100 + istTime.getUTCMinutes();
      if (timeNum < 915 || timeNum > 1530) return;

      const data = seriesRef.current.data();`;

code = code.replace(oldUpdate, newUpdate);
fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log("LiveChart updated for market hours");
