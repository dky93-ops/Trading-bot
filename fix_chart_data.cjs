const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// Add dataRef
if (!code.includes('const dataRef = useRef<any[]>([])')) {
  code = code.replace(
    `  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);`,
    `  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);\n  const dataRef = useRef<any[]>([]);`
  );
}

// Update dataRef when fetching data
code = code.replace(
  `          candlestickSeries.setData(unique);`,
  `          dataRef.current = unique;\n          candlestickSeries.setData(unique);`
);

// Fix livePrice update
code = code.replace(
  `      const data = (seriesRef.current as any).data?.() || [];
      if (data && data.length > 0) {
        const lastBar = data[data.length - 1] as any;
        const newBar = {
          ...lastBar,
          close: livePrice,
          high: Math.max(lastBar.high, livePrice),
          low: Math.min(lastBar.low, livePrice),
        };
        seriesRef.current.update(newBar);
      }`,
  `      const data = dataRef.current;
      if (data && data.length > 0) {
        // Find current candle boundary in IST
        const periodMs = timeframe * 60 * 1000;
        const ts = now.getTime();
        const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
        const boundaryTime = (Math.floor(boundary / 1000) + 19800);
        
        let lastBar = data[data.length - 1] as any;
        let newBar;
        if (lastBar.time === boundaryTime) {
           newBar = {
             ...lastBar,
             close: livePrice,
             high: Math.max(lastBar.high, livePrice),
             low: Math.min(lastBar.low, livePrice),
           };
           data[data.length - 1] = newBar;
        } else if (boundaryTime > lastBar.time) {
           newBar = {
             time: boundaryTime as Time,
             open: lastBar.close,
             high: Math.max(lastBar.close, livePrice),
             low: Math.min(lastBar.close, livePrice),
             close: livePrice,
           };
           data.push(newBar);
        } else {
           return;
        }
        seriesRef.current.update(newBar);
      }`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed LiveChart data reference');
