const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// 1. Add Trade type
if (!code.includes('type Trade =')) {
  code = code.replace(
    `import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';`,
    `import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';\n\ntype Trade = {\n  id: string;\n  type: 'LONG' | 'SHORT';\n  signal: string;\n  entryTime: number;\n  entryPrice: number;\n  stoploss: number;\n  target: number;\n  exitTime?: number;\n  exitPrice?: number;\n  pnl?: number;\n  status: 'OPEN' | 'WIN' | 'LOSS';\n};`
  );
}

// 2. Add state for backtestTrades
if (!code.includes('const [backtestTrades, setBacktestTrades] = useState<Trade[]>([])')) {
  code = code.replace(
    `const [loading, setLoading] = useState(true);`,
    `const [loading, setLoading] = useState(true);\n  const [backtestTrades, setBacktestTrades] = useState<Trade[]>([]);`
  );
}

// 3. Rewrite applyPriceActionAnalysis to include backtesting
const oldLogicStr = `    let activeSetup: any = null;

    // Al Brooks Price Action Analysis
    for (let i = 20; i < candles.length; i++) {`;

const newLogicStr = `    let activeSetup: any = null;
    let ongoingTrade: Trade | null = null;
    const completedTrades: Trade[] = [];

    // Al Brooks Price Action Analysis
    for (let i = 20; i < candles.length; i++) {
       const curr = candles[i];
       const prev = candles[i-1];
       const ema = ema20[i].value;

       // 1. Manage open trade
       if (ongoingTrade) {
         if (ongoingTrade.type === 'LONG') {
           if (curr.low <= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.high >= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.exitPrice - ongoingTrade.entryPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         } else { // SHORT
           if (curr.high >= ongoingTrade.stoploss) {
             ongoingTrade.exitPrice = ongoingTrade.stoploss;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'LOSS';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           } else if (curr.low <= ongoingTrade.target) {
             ongoingTrade.exitPrice = ongoingTrade.target;
             ongoingTrade.exitTime = curr.time as number;
             ongoingTrade.status = 'WIN';
             ongoingTrade.pnl = ongoingTrade.entryPrice - ongoingTrade.exitPrice;
             completedTrades.push(ongoingTrade);
             ongoingTrade = null;
           }
         }
       }

`;

code = code.replace(oldLogicStr, newLogicStr);

// 4. Update the logic where markers are pushed to also set ongoingTrade if it doesn't exist
// I need to intercept the High 1/2/3/4 and Low 1/2/3/4 blocks.

code = code.replace(
  `              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.high;
                const sl = curr.low;
                const target = entry + (entry - sl) * 2;
                activeSetup = { type: 'LONG', entry, stoploss: sl, target };
              }`,
  `              if (!ongoingTrade) {
                const entry = curr.high;
                const sl = curr.low;
                const target = entry + (entry - sl) * 2;
                ongoingTrade = { id: \`\${curr.time}-H1\`, type: 'LONG', signal: 'H1', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target, status: 'OPEN' };
              }
              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.high;
                const sl = curr.low;
                const target = entry + (entry - sl) * 2;
                activeSetup = { type: 'LONG', entry, stoploss: sl, target };
              }`
);

code = code.replace(
  `              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.low;
                const sl = curr.high;
                const target = entry - (sl - entry) * 2;
                activeSetup = { type: 'SHORT', entry, stoploss: sl, target };
              }`,
  `              if (!ongoingTrade) {
                const entry = curr.low;
                const sl = curr.high;
                const target = entry - (sl - entry) * 2;
                ongoingTrade = { id: \`\${curr.time}-L1\`, type: 'SHORT', signal: 'L1', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target, status: 'OPEN' };
              }
              if (i === candles.length - 1 || i === candles.length - 2) {
                const entry = curr.low;
                const sl = curr.high;
                const target = entry - (sl - entry) * 2;
                activeSetup = { type: 'SHORT', entry, stoploss: sl, target };
              }`
);

code = code.replace(
  `       const isMicroDB = Math.abs(curr.low - prev.low) <= range * 0.1 && isBullReversal;
       const isMicroDT = Math.abs(curr.high - prev.high) <= range * 0.1 && isBearReversal;
       if (isMicroDB) markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
       if (isMicroDT) markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });`,
  `       const isMicroDB = Math.abs(curr.low - prev.low) <= range * 0.1 && isBullReversal;
       const isMicroDT = Math.abs(curr.high - prev.high) <= range * 0.1 && isBearReversal;
       if (isMicroDB) {
          markers.push({ time: curr.time, position: 'belowBar', color: '#3B82F6', shape: 'arrowUp', text: 'MDB' });
          if (!ongoingTrade) {
             const entry = curr.high;
             const sl = curr.low;
             ongoingTrade = { id: \`\${curr.time}-MDB\`, type: 'LONG', signal: 'MDB', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry + (entry - sl)*2, status: 'OPEN' };
          }
       }
       if (isMicroDT) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F97316', shape: 'arrowDown', text: 'MDT' });
          if (!ongoingTrade) {
             const entry = curr.low;
             const sl = curr.high;
             ongoingTrade = { id: \`\${curr.time}-MDT\`, type: 'SHORT', signal: 'MDT', entryTime: curr.time as number, entryPrice: entry, stoploss: sl, target: entry - (sl - entry)*2, status: 'OPEN' };
          }
       }`
);

// Close the loop and set backtestTrades
code = code.replace(
  `    if (activeSetup) {`,
  `    if (ongoingTrade) { completedTrades.push(ongoingTrade); }
    setBacktestTrades(completedTrades.reverse());

    if (activeSetup) {`
);

// 5. Update the return layout
const newReturn = `  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  };

  const totalTrades = backtestTrades.length;
  const wins = backtestTrades.filter(t => t.status === 'WIN').length;
  const losses = backtestTrades.filter(t => t.status === 'LOSS').length;
  const winRate = totalTrades > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(1) : '0.0';

  return (
    <div className="w-full h-full flex flex-col bg-[#0A0F1C]">
      <div className="flex items-center space-x-2 p-2 border-b border-[#1F2937] shrink-0">
        <span className="text-xs font-bold text-gray-400 uppercase mr-2">Timeframe:</span>
        {[
          { label: '1m', value: 1 },
          { label: '3m', value: 3 },
          { label: '5m', value: 5 },
          { label: '15m', value: 15 },
          { label: '1H', value: 60 }
        ].map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={\`px-3 py-1 rounded text-xs font-bold transition-colors \${timeframe === tf.value ? 'bg-brand-blue text-black' : 'bg-[#1F2937] text-gray-400 hover:text-white'}\`}
          >
            {tf.label}
          </button>
        ))}
        <div className="flex-1"></div>
        <div className="flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
        </div>
      </div>
      
      <div className="flex-1 relative min-h-0 min-h-[400px]">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>

      <div className="h-64 border-t border-[#1F2937] flex flex-col shrink-0">
        <div className="p-3 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#0A0F1C]">
          <h3 className="text-sm font-bold text-white">Backtest Dashboard ({timeframe}m)</h3>
          <div className="flex space-x-6 text-xs text-gray-400">
            <div>Total Trades: <span className="text-white font-bold">{totalTrades}</span></div>
            <div>Wins: <span className="text-emerald-500 font-bold">{wins}</span></div>
            <div>Losses: <span className="text-red-500 font-bold">{losses}</span></div>
            <div>Win Rate: <span className="text-brand-blue font-bold">{winRate}%</span></div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-[#0A0F1C]">
          <table className="w-full text-left text-xs text-gray-300">
            <thead className="bg-[#111827] sticky top-0 border-b border-[#1F2937]">
              <tr>
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Signal</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3 text-right">Entry</th>
                <th className="py-2 px-3 text-right">Stoploss</th>
                <th className="py-2 px-3 text-right">Target</th>
                <th className="py-2 px-3 text-center">Status</th>
                <th className="py-2 px-3 text-right">PnL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]">
              {backtestTrades.length === 0 && (
                 <tr><td colSpan={8} className="py-8 text-center text-gray-500">No trades generated for this period</td></tr>
              )}
              {backtestTrades.map((t, idx) => (
                <tr key={t.id + '-' + idx} className="hover:bg-[#111827]">
                  <td className="py-2 px-3">{formatTime(t.entryTime)}</td>
                  <td className="py-2 px-3">{t.signal}</td>
                  <td className="py-2 px-3">
                    <span className={\`px-1.5 py-0.5 rounded text-[10px] font-bold \${t.type === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}\`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{t.entryPrice.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-mono text-red-400">{t.stoploss.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-400">{t.target.toFixed(2)}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={\`px-1.5 py-0.5 rounded text-[10px] font-bold \${
                      t.status === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 
                      t.status === 'LOSS' ? 'bg-red-500/20 text-red-400' : 
                      'bg-brand-blue/20 text-brand-blue'
                    }\`}>
                      {t.status}
                    </span>
                  </td>
                  <td className={\`py-2 px-3 text-right font-mono \${!t.pnl ? 'text-gray-500' : t.pnl > 0 ? 'text-emerald-500' : 'text-red-500'}\`}>
                    {t.pnl ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}`;

code = code.replace(
  /<div className="w-full h-full flex flex-col">[\s\S]*?<\/div>\s*<\/div>\s*\);\s*\}/,
  newReturn + '\n}'
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Modified LiveChart to add dashboard.');
