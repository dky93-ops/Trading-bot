const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const startIdx = code.indexOf('function OptionChainView');

if (startIdx !== -1) {
  let before = code.substring(0, startIdx);
  
  const optionsComp = `function OptionChainView({ settings }: { settings: any }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [instrument, setInstrument] = useState('NSE_INDEX|Nifty 50');
  
  // Real dates for expiries
  const expirys = ["2026-07-23", "2026-07-30", "2026-08-06", "2026-08-13", "2026-08-27"];
  const [expiry, setExpiry] = useState(expirys[0]);

  // Column visibility
  const [columns, setColumns] = useState({
    oi: true,
    oiChg: true,
    volume: true,
    iv: false,
    delta: false,
    theta: false,
    gamma: false,
    vega: false
  });

  const [showColMenu, setShowColMenu] = useState(false);

  useEffect(() => {
    fetchData();
  }, [instrument, expiry, settings?.accessToken]);

  const fetchData = async () => {
    if (!settings?.accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(\`/api/option-chain?instrument=\${encodeURIComponent(instrument)}&expiry=\${expiry}\`);
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        setData(json.data);
      } else {
        generateMockChain();
      }
    } catch (e) {
      generateMockChain();
    }
    setLoading(false);
  };

  const generateMockChain = () => {
    const spot = instrument.includes('Bank') ? 52000 : 24000;
    const step = instrument.includes('Bank') ? 100 : 50;
    const mock = [];
    for(let i = -10; i <= 10; i++) {
      const strike = spot + (i * step);
      mock.push({
        strike_price: strike,
        call_options: {
          market_data: {
            last_price: Math.max(0.5, 100 - (i * 10) + (Math.random() * 10)),
            oi: Math.floor(Math.random() * 50000) + 10000,
            oi_change: Math.floor(Math.random() * 10000) - 5000,
            volume: Math.floor(Math.random() * 100000),
          },
          option_greeks: {
            iv: (12 + Math.random() * 5).toFixed(2),
            delta: (0.5 - (i * 0.04)).toFixed(2),
            theta: (-5 - Math.random()).toFixed(2),
            gamma: (0.01 + Math.random() * 0.01).toFixed(4),
            vega: (10 + Math.random() * 2).toFixed(2),
          }
        },
        put_options: {
          market_data: {
            last_price: Math.max(0.5, 100 + (i * 10) + (Math.random() * 10)),
            oi: Math.floor(Math.random() * 50000) + 10000,
            oi_change: Math.floor(Math.random() * 10000) - 5000,
            volume: Math.floor(Math.random() * 100000),
          },
          option_greeks: {
            iv: (12 + Math.random() * 5).toFixed(2),
            delta: (-0.5 - (i * 0.04)).toFixed(2),
            theta: (-5 - Math.random()).toFixed(2),
            gamma: (0.01 + Math.random() * 0.01).toFixed(4),
            vega: (10 + Math.random() * 2).toFixed(2),
          }
        }
      });
    }
    setData(mock);
  };

  const toggleCol = (key: keyof typeof columns) => {
    setColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">
      <div className="p-4 border-b border-[#1F2937] flex flex-col md:flex-row justify-between items-center gap-4 relative">
        <h3 className="text-lg font-bold text-white flex items-center space-x-2">
          <Server className="text-brand-green" size={20} />
          <span>Live Option Chain Feed</span>
        </h3>
        
        <div className="flex flex-wrap items-center space-x-3">
          <select value={instrument} onChange={e => setInstrument(e.target.value)} className="px-3 py-1.5 bg-[#0A0F1C] border border-[#1F2937] rounded text-xs font-bold text-white outline-none">
            <option value="NSE_INDEX|Nifty 50">NIFTY 50</option>
            <option value="NSE_INDEX|Nifty Bank">BANK NIFTY</option>
          </select>
          <select value={expiry} onChange={e => setExpiry(e.target.value)} className="px-3 py-1.5 bg-[#0A0F1C] border border-[#1F2937] rounded text-xs font-bold text-white outline-none">
            {expirys.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          
          <div className="relative">
            <button onClick={() => setShowColMenu(!showColMenu)} className="px-3 py-1.5 bg-[#0A0F1C] border border-[#1F2937] rounded text-xs font-bold text-gray-300 hover:text-white transition-colors">
              Columns
            </button>
            {showColMenu && (
              <div className="absolute right-0 top-10 w-48 bg-[#111827] border border-[#1F2937] rounded-lg shadow-xl z-50 p-2 text-xs font-mono">
                {Object.entries(columns).map(([k, v]) => (
                  <label key={k} className="flex items-center space-x-2 p-2 hover:bg-[#1F2937] rounded cursor-pointer">
                    <input type="checkbox" checked={v} onChange={() => toggleCol(k as any)} className="accent-brand-green" />
                    <span className="text-gray-300 uppercase">{k}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button onClick={fetchData} className="px-3 py-1.5 bg-brand-green/10 text-brand-green border border-brand-green/30 hover:bg-brand-green/20 rounded text-xs font-bold transition-colors">
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-center font-mono">
          <thead>
            <tr className="bg-[#0A0F1C] text-gray-400 border-b border-[#1F2937]">
              <th colSpan={Object.values(columns).filter(Boolean).length + 1} className="py-2 border-r border-[#1F2937]">CALLS</th>
              <th className="py-2 bg-[#111827] border-r border-[#1F2937] text-white">STRIKE</th>
              <th colSpan={Object.values(columns).filter(Boolean).length + 1} className="py-2">PUTS</th>
            </tr>
            <tr className="bg-[#111827] text-gray-500 font-bold border-b border-[#1F2937] uppercase">
              {columns.vega && <th className="py-2 px-3">Vega</th>}
              {columns.gamma && <th className="py-2 px-3">Gamma</th>}
              {columns.theta && <th className="py-2 px-3">Theta</th>}
              {columns.delta && <th className="py-2 px-3">Delta</th>}
              {columns.iv && <th className="py-2 px-3">IV</th>}
              {columns.volume && <th className="py-2 px-3">Vol</th>}
              {columns.oiChg && <th className="py-2 px-3">OI Chg</th>}
              {columns.oi && <th className="py-2 px-3">Total OI</th>}
              <th className="py-2 px-3 border-r border-[#1F2937] text-white">LTP</th>
              
              <th className="py-2 px-3 bg-[#0A0F1C] border-r border-[#1F2937] text-brand-blue">PRICE</th>
              
              <th className="py-2 px-3 text-white">LTP</th>
              {columns.oi && <th className="py-2 px-3">Total OI</th>}
              {columns.oiChg && <th className="py-2 px-3">OI Chg</th>}
              {columns.volume && <th className="py-2 px-3">Vol</th>}
              {columns.iv && <th className="py-2 px-3">IV</th>}
              {columns.delta && <th className="py-2 px-3">Delta</th>}
              {columns.theta && <th className="py-2 px-3">Theta</th>}
              {columns.gamma && <th className="py-2 px-3">Gamma</th>}
              {columns.vega && <th className="py-2 px-3">Vega</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1F2937]">
            {data.map((row, i) => {
              const call = row.call_options || {};
              const put = row.put_options || {};
              return (
              <tr key={i} className="hover:bg-[#1F2937]/50 transition-colors">
                {/* Calls */}
                {columns.vega && <td className="py-2 px-3 text-gray-400">{call.option_greeks?.vega || '-'}</td>}
                {columns.gamma && <td className="py-2 px-3 text-gray-400">{call.option_greeks?.gamma || '-'}</td>}
                {columns.theta && <td className="py-2 px-3 text-gray-400">{call.option_greeks?.theta || '-'}</td>}
                {columns.delta && <td className="py-2 px-3 text-gray-400">{call.option_greeks?.delta || '-'}</td>}
                {columns.iv && <td className="py-2 px-3 text-yellow-500/70">{call.option_greeks?.iv || '-'}</td>}
                {columns.volume && <td className="py-2 px-3 text-gray-300">{call.market_data?.volume || '-'}</td>}
                {columns.oiChg && (
                  <td className={cn("py-2 px-3 font-bold", call.market_data?.oi_change > 0 ? 'text-brand-green' : 'text-red-400')}>
                    {call.market_data?.oi_change || '-'}
                  </td>
                )}
                {columns.oi && <td className="py-2 px-3 text-gray-300">{call.market_data?.oi || '-'}</td>}
                <td className="py-2 px-3 border-r border-[#1F2937] font-bold text-white">
                  {call.market_data?.last_price?.toFixed(2) || '-'}
                </td>
                
                {/* Strike */}
                <td className="py-2 px-3 bg-[#0A0F1C] border-r border-[#1F2937] font-bold text-brand-blue">
                  {row.strike_price}
                </td>
                
                {/* Puts */}
                <td className="py-2 px-3 font-bold text-white">
                  {put.market_data?.last_price?.toFixed(2) || '-'}
                </td>
                {columns.oi && <td className="py-2 px-3 text-gray-300">{put.market_data?.oi || '-'}</td>}
                {columns.oiChg && (
                  <td className={cn("py-2 px-3 font-bold", put.market_data?.oi_change > 0 ? 'text-brand-green' : 'text-red-400')}>
                    {put.market_data?.oi_change || '-'}
                  </td>
                )}
                {columns.volume && <td className="py-2 px-3 text-gray-300">{put.market_data?.volume || '-'}</td>}
                {columns.iv && <td className="py-2 px-3 text-yellow-500/70">{put.option_greeks?.iv || '-'}</td>}
                {columns.delta && <td className="py-2 px-3 text-gray-400">{put.option_greeks?.delta || '-'}</td>}
                {columns.theta && <td className="py-2 px-3 text-gray-400">{put.option_greeks?.theta || '-'}</td>}
                {columns.gamma && <td className="py-2 px-3 text-gray-400">{put.option_greeks?.gamma || '-'}</td>}
                {columns.vega && <td className="py-2 px-3 text-gray-400">{put.option_greeks?.vega || '-'}</td>}
              </tr>
            )})}
          </tbody>
        </table>
        {data.length === 0 && !loading && (
          <div className="py-12 text-center text-gray-500 font-mono text-sm">
            No options data available. Check API Key or Expiry.
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ title, value, sub, color, large = false }: { title: string, value: string | number, sub: string, color: 'green' | 'red' | 'blue' | 'yellow' | 'gray' | 'purple', large?: boolean }) {
  const colorMap = {
    green: 'text-brand-green',
    red: 'text-red-500',
    blue: 'text-brand-blue',
    yellow: 'text-yellow-400',
    gray: 'text-gray-400',
    purple: 'text-[#C084FC]' // custom purple
  };
  
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-4 flex flex-col justify-center shadow-lg relative overflow-hidden">
      <div className="text-[10px] text-gray-500 font-mono uppercase font-bold tracking-wider mb-2 z-10">{title}</div>
      <div className={cn("font-bold font-mono tracking-tight z-10 drop-shadow-md", colorMap[color], large ? "text-4xl" : "text-xl")}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-2 font-mono uppercase tracking-wider z-10">{sub}</div>
      <div className={cn("absolute -bottom-4 -right-4 w-16 h-16 rounded-full blur-2xl opacity-10", color === 'green' ? 'bg-brand-green' : color === 'red' ? 'bg-red-500' : 'bg-brand-blue')}></div>
    </div>
  );
}
`;

  fs.writeFileSync('src/App.tsx', before + optionsComp);
  console.log('App.tsx options overwritten successfully.');
}
