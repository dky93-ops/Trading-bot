const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const newApp = `
  return (
    <div className="min-h-screen bg-[#0A0F1C] text-gray-200 font-mono selection:bg-brand-green/20">
      {/* Header */}
      <header className="bg-[#111827] border-b border-[#1F2937] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-brand-green rounded-lg flex items-center justify-center text-black">
              <TrendingUp size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-widest text-white leading-tight">INDIAN QUANT STUDIO</h1>
              <p className="text-[10px] tracking-widest text-gray-500 font-bold uppercase">NSE INDEX OPTIONS TRADING ENGINE</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-6">
            <button className="flex items-center space-x-2 px-3 py-1.5 rounded bg-transparent border border-[#1F2937] text-xs font-bold text-gray-400 hover:text-white transition-colors">
              <Activity size={14} />
              <span>AUDIO ON</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        
        {/* Top Info Bar */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-bold bg-[#111827] border border-[#1F2937] rounded-lg p-3">
          <span className="text-yellow-500">NSE Trading Hours:</span>
          <span className="text-gray-400">Mon-Fri 09:15 - 15:30 IST</span>
          <div className="h-4 w-px bg-[#1F2937] mx-2"></div>
          <button className="flex items-center space-x-2 px-3 py-1 bg-brand-green/10 text-brand-green border border-brand-green/30 rounded">
            <Power size={12} />
            <span>Mode: NSE Live REST</span>
          </button>
        </div>

        {/* Top Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox title="INDEX SPOT (NIFTY)" value={\`₹\${state.nifty50?.lastPrice || '---'}\`} sub={\`Change: \${state.nifty50?.change || 0}\`} color="green" />
          <StatBox title="INDIA VIX" value={state.indiaVix?.lastPrice || '---'} sub={\`Vol Change: \${state.indiaVix?.change || 0}\`} color="yellow" />
          <StatBox title="BANK NIFTY" value={\`₹\${state.bankNifty?.lastPrice || '---'}\`} sub={\`Change: \${state.bankNifty?.change || 0}\`} color="blue" />
          <StatBox title="VWAP / DELTA" value={\`₹\${state.nifty50?.lastPrice ? (state.nifty50.lastPrice - 10).toFixed(2) : '---'}\`} sub="Vol Δ: +0" color="purple" />
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={toggleTrading}
            className={cn(
              "flex items-center space-x-2 px-6 py-2 rounded font-bold uppercase text-sm tracking-wider transition-all",
              settings?.isTradingEnabled 
                ? "bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)]"
                : "bg-brand-green hover:bg-emerald-400 text-black shadow-[0_0_15px_rgba(0,255,163,0.3)]"
            )}
          >
            <Power size={16} />
            <span>{settings?.isTradingEnabled ? 'PAUSE MARKET FEED' : 'START MARKET FEED'}</span>
          </button>
          
          <button className="flex items-center space-x-2 px-4 py-2 rounded bg-transparent border border-[#1F2937] hover:bg-[#1F2937] text-sm text-gray-400 transition-all">
            <RefreshCw size={16} />
            <span>Reset Logs</span>
          </button>

          <div className="ml-auto flex gap-4 text-xs font-bold text-brand-green hidden md:flex">
            <div className="flex items-center space-x-2 px-3 py-2 bg-brand-green/5 border border-brand-green/20 rounded">
              <Server size={14} />
              <span>Source: Server Engine</span>
            </div>
            <div className="flex items-center space-x-2 px-3 py-2 bg-[#111827] border border-[#1F2937] text-gray-400 rounded">
              <Clock size={14} />
              <span>Interval: 0.8 Seconds (Ultra)</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto space-x-1 border-b border-[#1F2937] pb-px hide-scrollbar">
          {[
            { id: 'dashboard', label: 'Multi-Strategy Dashboard' },
            { id: 'settings', label: 'Configure 5 Strategies' },
            { id: 'options', label: 'Live Option Chain' },
            { id: 'logs', label: 'Execution Logs' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all whitespace-nowrap",
                activeTab === item.id 
                  ? "text-brand-green border-b-2 border-brand-green bg-brand-green/5" 
                  : "text-gray-500 hover:text-gray-300 hover:bg-[#111827]"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="min-h-[400px]">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                  <StatBox title="NET REALIZED P&L" value={\`+₹\${Math.max(0, state.overallPnL || 0).toLocaleString()}\`} sub="Across all active strategies" color={state.overallPnL >= 0 ? "green" : "red"} large />
                  <StatBox title="OVERALL WIN RATE" value={\`\${(state.winRate || 0).toFixed(0)}%\`} sub={\`\${state.winningTrades || 0} wins out of \${state.totalTrades || 0} trades\`} color="green" large />
                  <StatBox title="ACTIVE STRATEGIES" value={\`\${state.signals?.filter((s) => s.status === 'ACTIVE').length || 0} / 5\`} sub="Running simultaneously" color="blue" large />
                  <StatBox title="EXECUTION SPEED" value="1.3 Ticks/s" sub="NSE Real-Time Stream" color="purple" large />
                </div>
              </div>

              {/* Performance Matrix */}
              <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">
                <div className="p-4 border-b border-[#1F2937] flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-white">Individual Strategy Performance Matrix</h3>
                    <p className="text-xs text-gray-500">Real-time side-by-side performance results for each Indian options buying strategy.</p>
                  </div>
                  <div className="flex space-x-2">
                    <button className="px-3 py-1 bg-brand-green/10 text-brand-green border border-brand-green/30 rounded text-xs font-bold uppercase">Activate All</button>
                    <button className="px-3 py-1 bg-transparent border border-[#1F2937] text-gray-400 rounded text-xs font-bold uppercase hover:bg-[#1F2937]">Deactivate All</button>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left font-mono">
                    <thead className="text-xs text-gray-500 uppercase bg-[#0A0F1C] border-b border-[#1F2937]">
                      <tr>
                        <th className="px-6 py-4">Strategy Name</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Trades</th>
                        <th className="px-6 py-4">Win Rate</th>
                        <th className="px-6 py-4">Net P&L (₹)</th>
                        <th className="px-6 py-4">Target RR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2937]">
                      {[
                        { id: 'oiDivergence', name: '1. Option Chain OI Divergence & Unwinding', desc: 'Optimal: Post 12:30 PM IST | Timeframe: 5 Min', rr: '1:3 to 1:5' },
                        { id: 'straddle130', name: '2. 1:30 PM Expiry Day "Hero or Zero" Straddle', desc: 'Optimal: 1:30 PM IST | Timeframe: 1 Min', rr: '1:4+' },
                        { id: 'bbSqueeze', name: '3. Bollinger Band Squeeze + India VIX Breakout', desc: 'Optimal: Low VIX | Timeframe: 15 Min', rr: '1:3' },
                        { id: 'orb', name: '4. Opening Range Breakout (ORB) with VWAP', desc: 'Optimal: 9:15 AM - 10:15 AM | Timeframe: 5 Min', rr: '1:2.5' },
                        { id: 'adx9Ema', name: '5. High-Frequency ADX-Filtered 9 EMA Trend Rider', desc: 'Optimal: High ADX (>25) | Timeframe: 3 Min', rr: '1:2' },
                      ].map(strat => (
                        <tr key={strat.id} className="hover:bg-[#1F2937]/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold text-gray-200">{strat.name}</div>
                            <div className="text-xs text-gray-500 mt-1">{strat.desc}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 text-xs font-bold rounded", 
                              settings?.strategies?.[strat.id]?.enabled 
                                ? "bg-brand-green/10 text-brand-green border border-brand-green/20" 
                                : "bg-red-500/10 text-red-400 border border-red-500/20"
                            )}>
                              {settings?.strategies?.[strat.id]?.enabled ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-300">0</td>
                          <td className="px-6 py-4 text-red-400">0%</td>
                          <td className="px-6 py-4 text-brand-green">+₹0</td>
                          <td className="px-6 py-4 text-brand-blue">{strat.rr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="bg-[#111827] rounded-lg shadow-sm border border-[#1F2937] overflow-hidden">
              <div className="p-4 border-b border-[#1F2937]">
                <h3 className="text-lg font-bold text-white">Execution Signals Log</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-500 uppercase bg-[#0A0F1C] border-b border-[#1F2937]">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Index</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Strategy</th>
                      <th className="px-4 py-3">Entry</th>
                      <th className="px-4 py-3">Stop Loss</th>
                      <th className="px-4 py-3">Target</th>
                      <th className="px-4 py-3">Exit</th>
                      <th className="px-4 py-3">P&L</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937] font-mono text-sm">
                    {state.signals.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                          No signals generated yet. Waiting for strategy triggers...
                        </td>
                      </tr>
                    ) : (
                      state.signals.map((sig, i) => (
                        <tr key={i} className="hover:bg-[#1F2937]/50">
                          <td className="px-4 py-3 text-gray-400">{new Date(sig.timestamp).toLocaleTimeString()}</td>
                          <td className="px-4 py-3 font-bold text-white">{sig.instrument}</td>
                          <td className="px-4 py-3">
                            <span className={cn("px-2 py-1 rounded text-xs font-bold", sig.action === 'BUY' ? 'bg-brand-green/20 text-brand-green' : 'bg-red-500/20 text-red-400')}>
                              {sig.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-300">{sig.strategy}</td>
                          <td className="px-4 py-3 text-gray-300">₹{sig.entryPrice}</td>
                          <td className="px-4 py-3 text-red-400">₹{sig.stopLoss}</td>
                          <td className="px-4 py-3 text-brand-green">₹{sig.target}</td>
                          <td className="px-4 py-3 text-gray-300">{sig.exitPrice ? \`₹\${sig.exitPrice}\` : '-'}</td>
                          <td className={cn("px-4 py-3 font-bold", sig.pnl > 0 ? 'text-brand-green' : sig.pnl < 0 ? 'text-red-400' : 'text-gray-500')}>
                            {sig.pnl ? \`₹\${sig.pnl.toFixed(2)}\` : '-'}
                          </td>
                          <td className="px-4 py-3">
                             <span className={cn("text-xs font-bold", sig.status === 'ACTIVE' ? 'text-brand-blue' : 'text-gray-500')}>
                               {sig.status}
                             </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'settings' && settings && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(settings.strategies).map(([key, config]: [string, any]) => {
                  const strategyDetails: Record<string, any> = {
                    'oiDivergence': { name: '1. Option Chain OI Divergence & Unwinding', desc: 'Triggers when Call or Put writers panic-unwind (-Change in OI) near key round strikes, sparking explosive gamma breakouts.', rr: '1:3 to 1:5', win: 'Post 12:30 PM IST' },
                    'straddle130': { name: '2. 1:30 PM Expiry Day "Hero or Zero"', desc: 'Exploits gamma expansion on expiry day by buying OTM/ATM straddles when theta decay is maximized.', rr: '1:4+', win: '1:15 - 1:30 PM IST' },
                    'bbSqueeze': { name: '3. Bollinger Band Squeeze + VIX', desc: 'Captures volatility expansion by waiting for extreme BB squeeze and an uptick in India VIX from historical lows.', rr: '1:3', win: 'Any (Low VIX)' },
                    'orb': { name: '4. Opening Range Breakout (ORB)', desc: 'Trades the 15-minute opening range breakout confirmed by VWAP and Volume Delta for morning momentum.', rr: '1:2.5', win: '9:15 - 10:15 AM' },
                    'adx9Ema': { name: '5. ADX-Filtered 9 EMA Trend Rider', desc: 'High-frequency scalping along the 9 EMA, filtered strictly by ADX > 25 to avoid sideways chop.', rr: '1:2', win: 'Any (ADX > 25)' }
                  };
                  
                  const detail = strategyDetails[key] || { name: key, desc: '', rr: '1:2', win: 'Any' };

                  return (
                    <div key={key} className="bg-[#111827] border border-[#1F2937] rounded-lg p-6 relative">
                      <div className="flex justify-between items-start mb-4">
                        <div className="pr-16">
                          <h4 className="text-lg font-bold text-white mb-2 leading-snug">{detail.name}</h4>
                          <p className="text-sm text-gray-400 mb-6">{detail.desc}</p>
                        </div>
                        <button 
                          onClick={() => updateStrategyConfig(key, 'enabled', !config.enabled)}
                          className={cn(
                            "absolute top-6 right-6 px-3 py-1 rounded text-xs font-bold uppercase border transition-colors",
                            config.enabled 
                              ? "bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30"
                              : "bg-transparent text-gray-500 border-[#1F2937] hover:text-gray-300"
                          )}
                        >
                          {config.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-6 mb-6">
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Lot Size (Count)</label>
                          <input 
                            type="number" 
                            min="1"
                            value={config.lotSize}
                            onChange={(e) => updateStrategyConfig(key, 'lotSize', parseInt(e.target.value))}
                            className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white focus:border-brand-green outline-none font-mono text-sm"
                          />
                          <p className="text-[10px] text-gray-500 mt-1 font-mono">{config.lotSize * 25} Total Shares</p>
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Strike Preference</label>
                          <select className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white focus:border-brand-green outline-none font-mono text-sm appearance-none">
                            <option>ATM (At The Money)</option>
                            <option>ITM (In The Money)</option>
                            <option>OTM (Out of The Money)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Stop Loss (% Premium)</label>
                          <input 
                            type="number" 
                            value={config.slPercent}
                            onChange={(e) => updateStrategyConfig(key, 'slPercent', parseFloat(e.target.value))}
                            className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-red-400 focus:border-red-400 outline-none font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Target Gain (% Premium)</label>
                          <input 
                            type="number" 
                            value={config.targetPercent}
                            onChange={(e) => updateStrategyConfig(key, 'targetPercent', parseFloat(e.target.value))}
                            className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-brand-green focus:border-brand-green outline-none font-mono text-sm"
                          />
                        </div>
                      </div>

                      <div className="bg-[#0A0F1C] border border-[#1F2937] rounded p-4 flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-mono uppercase">
                        <div><span className="text-gray-500 mr-2">Timeframe:</span> <span className="text-white font-bold">5 Min</span></div>
                        <div><span className="text-gray-500 mr-2">Target RR:</span> <span className="text-brand-green font-bold">{detail.rr}</span></div>
                        <div><span className="text-gray-500 mr-2">Optimal Window:</span> <span className="text-brand-blue font-bold">{detail.win}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'options' && (
            <OptionChainView settings={settings} />
          )}

        </main>
      </div>
    </div>
  );
`;

const matchStr = `  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-100">`;

const startIdx = code.indexOf(matchStr);

const funcEndMatchStr = `function MetricCard(`;
const endIdx = code.indexOf(funcEndMatchStr);

if (startIdx !== -1 && endIdx !== -1) {
  let newFile = code.substring(0, startIdx) + newApp + '\n\n' + code.substring(endIdx);
  
  // Also we need to replace the MetricCard implementation with StatBox implementation.
  newFile = newFile.replace(/function MetricCard\(\{[^]*?\}[^]*?\}$/m, 
`function StatBox({ title, value, sub, color, large = false }: { title: string, value: string | number, sub: string, color: 'green' | 'red' | 'blue' | 'yellow' | 'gray' | 'purple', large?: boolean }) {
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
}`);

  fs.writeFileSync('src/App.tsx', newFile);
  console.log('App.tsx overwritten successfully.');
} else {
  console.log('Could not find boundaries.', startIdx, endIdx);
}
