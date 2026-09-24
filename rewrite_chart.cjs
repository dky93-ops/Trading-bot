const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// Update imports
code = code.replace(
  "import { computeSMA, computeRSI } from '../backend/technical-indicators';",
  "import { computeSMA, computeRSI, computeEMA, computeMACD, computeBollinger, computeSuperTrend, computeATR } from '../backend/technical-indicators';"
);

// Update strategies state
code = code.replace(
  /const \[strategies, setStrategies\] = useState\(\{[\s\S]*?\}\);/,
  `const [strategies, setStrategies] = useState({
    classicSR: true,
    alBrooks: true,
    scalping: true,
    mbee: true,
    candlesticks: true,
    consensus: true
  });`
);

// Update Strategies Settings Panel UI
code = code.replace(
  /\{\/\* Strategies Settings Panel \*\/\}[\s\S]*?<\/div>/,
  `{/* Strategies Settings Panel */}
      <div className="bg-[#0A0F1C] border-b border-[#1F2937] px-4 py-3 flex items-center gap-6 overflow-x-auto text-xs font-medium text-gray-300">
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.classicSR} onChange={e => setStrategies(s => ({...s, classicSR: e.target.checked}))} className="accent-brand-blue" />
          Classic S/R
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.consensus} onChange={e => setStrategies(s => ({...s, consensus: e.target.checked}))} className="accent-brand-blue" />
          Consensus Strategy (4/5)
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
          <input type="checkbox" checked={strategies.mbee} onChange={e => setStrategies(s => ({...s, mbee: e.target.checked}))} className="accent-brand-blue" />
          MBEE Breakout
        </label>
        <label className="flex items-center gap-2 cursor-pointer hover:text-white">
          <input type="checkbox" checked={strategies.candlesticks} onChange={e => setStrategies(s => ({...s, candlesticks: e.target.checked}))} className="accent-brand-blue" />
          Candlestick Patterns
        </label>
      </div>`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Done 1');
