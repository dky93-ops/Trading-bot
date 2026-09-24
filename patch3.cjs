const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const uiHtml = `
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col h-[500px]">
        <div className="p-4 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#0A0F1C]">
          <h3 className="text-lg font-bold text-white">NIFTY 50 Live Chart & PA Bot</h3>
          <div className="flex items-center space-x-2">
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
        </div>
        <div className="mx-4 w-px h-4 bg-[#1F2937]"></div>
        <div className="flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
        </div>
      </div>
      
      {/* Strategies Settings Panel */}
      <div className="bg-[#0A0F1C] border-b border-[#1F2937] px-4 py-3 flex items-center gap-6 overflow-x-auto text-xs font-medium text-gray-300">
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.classicSR} onChange={e => setStrategies(s => ({...s, classicSR: e.target.checked}))} className="accent-brand-blue" />
          Classic S/R
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.alBrooks} onChange={e => setStrategies(s => ({...s, alBrooks: e.target.checked}))} className="accent-brand-blue" />
          Al Brooks PA
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.scalping} onChange={e => setStrategies(s => ({...s, scalping: e.target.checked}))} className="accent-brand-blue" />
          EMA Scalping
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.srRsi} onChange={e => setStrategies(s => ({...s, srRsi: e.target.checked}))} className="accent-brand-blue" />
          Support/Resistance + RSI
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.mbee} onChange={e => setStrategies(s => ({...s, mbee: e.target.checked}))} className="accent-brand-blue" />
          MBEE Breakout
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.candlesticks} onChange={e => setStrategies(s => ({...s, candlesticks: e.target.checked}))} className="accent-brand-blue" />
          Candlestick Patterns
        </label>
      </div>`;

code = code.replace(
  /<div className="bg-\[#111827\] rounded-lg border border-\[#1F2937\] overflow-hidden flex flex-col h-\[500px\]">[\s\S]*?<\/div>\n      <\/div>/,
  uiHtml
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Patched UI');
