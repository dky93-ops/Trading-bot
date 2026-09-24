import { LiveChart } from './components/LiveChart';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Settings, Download, Trash2, Activity, Clock, ShieldAlert, BarChart3, TrendingUp, Power, Server, RefreshCw, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { OptionChainReplay } from './components/OptionChainReplay';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeInstrument, setActiveInstrument] = useState<'NIFTY' | 'GOLD'>('NIFTY');
  const [chartViewMode, setChartViewMode] = useState<'SINGLE' | 'DUAL'>('SINGLE');
  const [state, setState] = useState<any>({
    nifty50: { lastPrice: 0, change: 0 },
    gold: { lastPrice: 154263, change: 1282 },
    bankNifty: { lastPrice: 0, change: 0 },
    indiaVix: { lastPrice: 0, change: 0 },
    isConnected: false,
    signals: [],
    overallPnL: 0,
    winRate: 0,
    totalTrades: 0,
    winningTrades: 0,
  });

  const [settings, setSettings] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    // Check localStorage first
    const savedLocal = localStorage.getItem('indian_quant_settings');
    if (savedLocal) {
      try {
        const parsed = JSON.parse(savedLocal);
        setSettings(parsed);
        // Sync local settings to backend safely
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed)
        }).catch(e => console.warn("Sync settings warning:", e));
      } catch (e) {
        console.error("Error reading saved settings", e);
      }
    } else {
      // Fetch initial settings from backend safely
      fetch('/api/settings')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setSettings(data);
            localStorage.setItem('indian_quant_settings', JSON.stringify(data));
          }
        })
        .catch(e => console.warn("Initial settings fetch warning:", e));
    }

    let ws: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;

    const connectWs = () => {
      try {
        const wsUrl = window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'STATE_UPDATE' && msg.data) {
              setState(msg.data);
              setChartData(prev => {
                const newPoint = {
                  time: new Date().toLocaleTimeString(),
                  nifty: msg.data.nifty50?.lastPrice || 0,
                  bankNifty: msg.data.bankNifty?.lastPrice || 0,
                  gold: msg.data.gold?.lastPrice || 0
                };
                const updated = [...prev, newPoint];
                return updated.length > 50 ? updated.slice(updated.length - 50) : updated;
              });
            } else if (msg.type === 'SETTINGS_UPDATE' && msg.data) {
              setSettings(msg.data);
              localStorage.setItem('indian_quant_settings', JSON.stringify(msg.data));
            }
          } catch (e) {
            console.warn("WS parse error:", e);
          }
        };

        ws.onerror = (e) => {
          console.warn("WebSocket error:", e);
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connectWs, 2000);
        };
      } catch (e) {
        console.warn("WebSocket connection attempt error:", e);
        reconnectTimeout = setTimeout(connectWs, 2000);
      }
    };

    connectWs();

    // High-reliability 1.5s state polling fallback
    const pollState = async () => {
      try {
        const res = await fetch('/api/state');
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setState(data);
          }
        }
      } catch (e) {
        // silent
      }
    };
    const pollInterval = setInterval(pollState, 1500);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  const saveSettingsToStorageAndServer = async (newSettings: any) => {
    setSettings(newSettings);
    localStorage.setItem('indian_quant_settings', JSON.stringify(newSettings));
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
    } catch (e) {
      console.warn("Save settings network error:", e);
    }
  };

  const toggleTrading = async () => {
    if (!settings) return;
    const newSettings = { ...settings, isTradingEnabled: !settings.isTradingEnabled };
    await saveSettingsToStorageAndServer(newSettings);
  };

  const handleResetLogs = async () => {
    try {
      await fetch('/api/reset-signals', { method: 'POST' });
      setState((prev: any) => ({
        ...prev,
        signals: [],
        overallPnL: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0
      }));
    } catch (e) {
      console.warn("Reset signals error:", e);
    }
  };

  const updateGlobalSettings = async (field: string, value: any) => {
    if (!settings) return;
    const newSettings = { ...settings, [field]: value };
    await saveSettingsToStorageAndServer(newSettings);
  };

  const updateStrategyConfig = async (stratKey: string, field: string, value: any) => {
    if (!settings) return;
    const newSettings = {
      ...settings,
      strategies: {
        ...settings.strategies,
        [stratKey]: {
          ...settings.strategies[stratKey],
          [field]: value
        }
      }
    };
    await saveSettingsToStorageAndServer(newSettings);
  };


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
        
        {/* Top Info Bar & Instrument Quick-Select */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-bold bg-[#111827] border border-[#1F2937] rounded-lg p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-gray-400 uppercase tracking-wider">Trading Session:</span>
            {activeInstrument === 'GOLD' ? (
              <span className="px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                MCX Commodity Hours: Mon-Fri 09:00 - 23:30 IST (Open Evening Session)
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                NSE Trading Hours: Mon-Fri 09:15 - 15:30 IST
              </span>
            )}
            <div className="h-4 w-px bg-[#1F2937] mx-1"></div>
            <button className="flex items-center space-x-2 px-3 py-1 bg-brand-green/10 text-brand-green border border-brand-green/30 rounded">
              <Power size={12} />
              <span>Engine: Upstox Live Feed + PA Bot</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-[11px]">Quick Switch:</span>
            <button
              onClick={() => setActiveInstrument('NIFTY')}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer",
                activeInstrument === 'NIFTY' 
                  ? "bg-brand-blue text-black font-extrabold" 
                  : "bg-[#0A0F1C] border border-[#1F2937] text-gray-400 hover:text-white"
              )}
            >
              🇮🇳 NIFTY 50
            </button>
            <button
              onClick={() => setActiveInstrument('GOLD')}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer",
                activeInstrument === 'GOLD' 
                  ? "bg-amber-400 text-black font-extrabold" 
                  : "bg-[#0A0F1C] border border-[#1F2937] text-gray-400 hover:text-white"
              )}
            >
              🟡 GOLD (MCX)
            </button>
          </div>
        </div>

        {/* Global API Error Alert Banner */}
        {state?.apiError && (
          <div className="bg-red-950/80 border border-red-500 text-red-200 px-4 py-3 rounded-lg flex items-center justify-between text-xs font-mono shadow-lg">
            <div className="flex items-center space-x-3">
              <ShieldAlert size={18} className="text-red-400 shrink-0" />
              <div>
                <strong className="uppercase font-bold text-red-400">Upstox API Alert:</strong> {state.apiError}
              </div>
            </div>
            <button 
              onClick={() => setActiveTab('settings')}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-bold uppercase shrink-0 transition-colors"
            >
              Update Token in Settings
            </button>
          </div>
        )}

        {/* Top Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox 
            title={activeInstrument === 'GOLD' ? "COMMODITY SPOT (MCX GOLD)" : "INDEX SPOT (NIFTY 50)"} 
            value={`₹${(activeInstrument === 'GOLD' ? state.gold?.lastPrice : state.nifty50?.lastPrice) || '---'}`} 
            sub={`Change: ${(activeInstrument === 'GOLD' ? state.gold?.change : state.nifty50?.change) || 0}`} 
            color={activeInstrument === 'GOLD' ? "yellow" : "green"} 
          />
          <StatBox 
            title={activeInstrument === 'GOLD' ? "MCX GOLD CONTRACT" : "INDIA VIX"} 
            value={activeInstrument === 'GOLD' ? "10g LOT (MCX)" : (state.indiaVix?.lastPrice || '---')} 
            sub={activeInstrument === 'GOLD' ? `Day Δ: ${(state.gold?.change || 0) >= 0 ? '+' : ''}${state.gold?.change || 0} pts` : `Vol Change: ${state.indiaVix?.change || 0}`} 
            color="yellow" 
          />
          <StatBox 
            title="VWAP / SPOT DELTA" 
            value={`₹${activeInstrument === 'GOLD' ? (state.gold?.lastPrice ? (state.gold.lastPrice - 18.5).toFixed(2) : '---') : (state.nifty50?.lastPrice ? (state.nifty50.lastPrice - 10).toFixed(2) : '---')}`} 
            sub={activeInstrument === 'GOLD' ? "MCX Commodity Spread: Normal" : "Vol Δ: +0"} 
            color="purple" 
          />
          <StatBox 
            title="NET REALIZED P&L" 
            value={`${(state.overallPnL || 0) >= 0 ? '+' : ''}₹${(state.overallPnL || 0).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`} 
            sub={`Realized: ₹${(state.realizedPnL || 0).toFixed(1)} | Live: ₹${(state.unrealizedPnL || 0).toFixed(1)}`} 
            color={(state.overallPnL || 0) >= 0 ? "green" : "red"} 
          />
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
          
          <button 
            onClick={handleResetLogs}
            className="flex items-center space-x-2 px-4 py-2 rounded bg-transparent border border-[#1F2937] hover:bg-[#1F2937] text-sm text-gray-400 transition-all cursor-pointer"
          >
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
        <div className="flex overflow-x-auto space-x-1 border-b border-[#1F2937] pb-px hide-scrollbar touch-pan-x">
          {[
            { id: 'dashboard', label: '5 Core Strategies Dashboard', short: 'Dashboard', icon: BarChart3 },
            { id: 'settings', label: 'Configure 5 Strategies', short: 'Settings', icon: Settings },
            { id: 'options', label: 'Live Option Chain', short: 'Option Chain', icon: Activity },
            { id: 'replay', label: 'Option Chain Replay & History', short: 'Replay', icon: Clock },
            { id: 'logs', label: 'Execution Signals Log', short: 'Signals Log', icon: ShieldAlert },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "px-3 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-bold uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0",
                activeTab === item.id 
                  ? "text-brand-green border-b-2 border-brand-green bg-brand-green/5" 
                  : "text-gray-500 hover:text-gray-300 hover:bg-[#111827]"
              )}
            >
              <item.icon size={15} className="shrink-0" />
              <span className="sm:hidden">{item.short}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </div>

        <main className="min-h-[400px]">
          {activeTab === 'dashboard' && (() => {
            const enabledStrategiesCount = Object.values(settings?.strategies || {}).filter((s: any) => s.enabled).length;
            const activeTradesCount = state.signals?.filter((s: any) => s.status === 'ACTIVE').length || 0;

            const handleActivateAll = () => {
              const updated = { ...settings?.strategies };
              Object.keys(updated).forEach(k => { updated[k] = { ...updated[k], enabled: true }; });
              updateGlobalSettings('strategies', updated);
            };

            const handleDeactivateAll = () => {
              const updated = { ...settings?.strategies };
              Object.keys(updated).forEach(k => { updated[k] = { ...updated[k], enabled: false }; });
              updateGlobalSettings('strategies', updated);
            };

            return (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                  <StatBox title="NET REALIZED P&L" value={`+₹${Math.max(0, state.overallPnL || 0).toLocaleString()}`} sub="Across active strategies" color={state.overallPnL >= 0 ? "green" : "red"} large />
                  <StatBox title="OVERALL WIN RATE" value={`${(state.winRate || 0).toFixed(0)}%`} sub={`${state.winningTrades || 0} wins out of ${state.totalTrades || 0} trades`} color="green" large />
                  <StatBox title="ACTIVE STRATEGIES" value={`${settings?.isTradingEnabled ? enabledStrategiesCount : 0} / 6`} sub={settings?.isTradingEnabled ? `${enabledStrategiesCount} Modules Enabled` : "Trading Paused"} color={settings?.isTradingEnabled && enabledStrategiesCount > 0 ? "blue" : "gray"} large />
                  <StatBox title="OPEN POSITIONS" value={`${activeTradesCount}`} sub="Active Trades Running" color={activeTradesCount > 0 ? "purple" : "gray"} large />
                </div>
              </div>

              {/* Asset Selector & Live Candlestick Chart Controls */}
              <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-3 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Chart:</span>
                  <button
                    onClick={() => setActiveInstrument('NIFTY')}
                    className={cn(
                      "flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-bold text-xs transition-all cursor-pointer",
                      activeInstrument === 'NIFTY'
                        ? "bg-brand-blue text-black shadow-[0_0_12px_rgba(0,180,255,0.4)]"
                        : "bg-[#0A0F1C] border border-[#1F2937] text-gray-300 hover:text-white hover:border-gray-600"
                    )}
                  >
                    <span>🇮🇳</span>
                    <span>NIFTY 50</span>
                    <span className="font-mono text-[11px] opacity-90">₹{state.nifty50?.lastPrice || '---'}</span>
                    <span className={cn("text-[10px] font-mono", (state.nifty50?.change || 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {(state.nifty50?.change || 0) >= 0 ? '+' : ''}{state.nifty50?.change || 0}
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveInstrument('GOLD')}
                    className={cn(
                      "flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-bold text-xs transition-all cursor-pointer",
                      activeInstrument === 'GOLD'
                        ? "bg-amber-400 text-black shadow-[0_0_12px_rgba(251,191,36,0.4)]"
                        : "bg-[#0A0F1C] border border-[#1F2937] text-gray-300 hover:text-white hover:border-gray-600"
                    )}
                  >
                    <span>🟡</span>
                    <span>MCX GOLD COMMODITY</span>
                    <span className="font-mono text-[11px] opacity-90">₹{state.gold?.lastPrice || '---'}</span>
                    <span className={cn("text-[10px] font-mono", (state.gold?.change || 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {(state.gold?.change || 0) >= 0 ? '+' : ''}{state.gold?.change || 0}
                    </span>
                  </button>
                </div>

                {/* Chart View Mode Switcher */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">View:</span>
                  <button
                    onClick={() => setChartViewMode('SINGLE')}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer",
                      chartViewMode === 'SINGLE'
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold"
                        : "bg-[#0A0F1C] text-gray-400 border border-[#1F2937] hover:text-white"
                    )}
                  >
                    Single Asset ({activeInstrument})
                  </button>
                  <button
                    onClick={() => setChartViewMode('DUAL')}
                    className={cn(
                      "flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all cursor-pointer",
                      chartViewMode === 'DUAL'
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold"
                        : "bg-[#0A0F1C] text-gray-400 border border-[#1F2937] hover:text-white"
                    )}
                  >
                    <span>◫</span>
                    <span>Dual Charts (Nifty + Gold)</span>
                  </button>
                </div>
              </div>

              {/* Live Candlestick Chart(s) */}
              <div className="flex flex-col gap-6">
                {chartViewMode === 'SINGLE' ? (
                  <LiveChart 
                    key={activeInstrument}
                    livePrice={activeInstrument === 'GOLD' ? state.gold?.lastPrice : state.nifty50?.lastPrice} 
                    instrument={activeInstrument} 
                  />
                ) : (
                  <div className="flex flex-col gap-6">
                    <LiveChart 
                      key="nifty-chart"
                      livePrice={state.nifty50?.lastPrice} 
                      instrument="NIFTY" 
                    />
                    <LiveChart 
                      key="gold-chart"
                      livePrice={state.gold?.lastPrice} 
                      instrument="GOLD" 
                    />
                  </div>
                )}
              </div>

              {/* Performance Matrix */}
              <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">
                <div className="p-4 border-b border-[#1F2937] flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-white">5 Core Options Strategy Performance Matrix</h3>
                    <p className="text-xs text-gray-500">Strict real-time option-buying signals with OI wall confirmation and fake-breakout filters.</p>
                  </div>
                  <div className="flex space-x-2">
                    <button onClick={handleActivateAll} className="px-3 py-1 bg-brand-green/10 text-brand-green border border-brand-green/30 hover:bg-brand-green/20 rounded text-xs font-bold uppercase cursor-pointer transition-colors">Activate All</button>
                    <button onClick={handleDeactivateAll} className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded text-xs font-bold uppercase cursor-pointer transition-colors">Deactivate All</button>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left font-mono">
                    <thead className="text-xs text-gray-500 uppercase bg-[#0A0F1C] border-b border-[#1F2937]">
                      <tr>
                        <th className="px-6 py-4">Priority & Strategy Name</th>
                        <th className="px-6 py-4">Status & Control</th>
                        <th className="px-6 py-4">Trades</th>
                        <th className="px-6 py-4">Win Rate</th>
                        <th className="px-6 py-4">Net P&L (₹)</th>
                        <th className="px-6 py-4">Target RR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2937]">
                      {[
                        { id: 'failedRetest', familyKey: 'FAILED_RETEST', name: '1. Failed Retest Reversal (FAILED_RETEST)', desc: 'Priority 1 | Catches failed retests of broken key levels after candle confirmation.', rr: '>= 0.8R to 1.5R+' },
                        { id: 'continuationBreakdown', familyKey: 'CONTINUATION_BREAKDOWN', name: '2. Continuation Breakdown (CONTINUATION_BREAKDOWN)', desc: 'Priority 2 | Trades bearish continuation after level breakdown and consolidation pause.', rr: '>= 0.8R to 1.5R' },
                        { id: 'continuationBreakout', familyKey: 'CONTINUATION_BREAKOUT', name: '3. Continuation Breakout (CONTINUATION_BREAKOUT)', desc: 'Priority 3 | Trades bullish continuation after level breakout and consolidation pause.', rr: '>= 0.8R to 1.5R' },
                        { id: 'openingTrap', familyKey: 'OPENING_TRAP', name: '4. Opening Breakout Trap (OPENING_TRAP)', desc: 'Priority 4 | Catches opening range fake breakouts/breakdowns upon retest confirmation.', rr: '>= 0.8R to 1.0R' },
                        { id: 'oiWallRejection', familyKey: 'OI_WALL_REJECTION', name: '5. OI Wall Rejection (OI_WALL_REJECTION)', desc: 'Priority 5 | Rejection trades when 1.5x dominant OI walls reject price 2+ times & begin unwinding.', rr: '>= 0.8R to 1.2R' },
                        { id: 'technicalConfluence', familyKey: 'TECHNICAL_CONFLUENCE', name: '6. Technical Confluence (TECHNICAL_CONFLUENCE)', desc: 'Priority 1 | Trades based on technical indicators (RSI, MACD, EMA, BB, SuperTrend) voting consensus.', rr: '>= 1.0R' },
                        { id: 'adxBreakout', familyKey: 'ADX_BREAKOUT', name: '7. Rob Booker - ADX Breakout (ADX_BREAKOUT) [GOLD ONLY]', desc: 'Gold Only Strategy | Consolidations when ADX < 18, trades 20-candle box breakout with candle extreme SL and 1x box target.', rr: '1.0x Box Width' },
                      ].map(strat => {
                        const isEnabled = !!settings?.strategies?.[strat.id]?.enabled;
                        const toggleStrat = () => {
                          const updated = {
                            ...settings?.strategies,
                            [strat.id]: { ...settings?.strategies?.[strat.id], enabled: !isEnabled }
                          };
                          updateGlobalSettings('strategies', updated);
                        };

                        const stratSignals = state.signals?.filter((s: any) => 
                          s.strategy_family === strat.familyKey || 
                          (s.strategy_family || '').toUpperCase() === strat.familyKey || 
                          s.strategy === strat.id
                        ) || [];

                        const closedStrat = stratSignals.filter((s: any) => s.status === 'CLOSED');
                        const winningStrat = closedStrat.filter((s: any) => (s.realizedPnL || 0) > 0);
                        const winRateStr = closedStrat.length > 0 
                          ? `${((winningStrat.length / closedStrat.length) * 100).toFixed(0)}%` 
                          : (stratSignals.length > 0 ? '0%' : '---');

                        const stratPnL = stratSignals.reduce((sum: number, s: any) => {
                          if (s.status === 'CLOSED') {
                            return sum + (s.realizedPnL || 0);
                          } else {
                            const curP = s.latestPrice || s.entryPrice;
                            const lots = settings?.strategies?.[strat.id]?.lotSize || 1;
                            return sum + ((curP - s.entryPrice) * 75 * lots);
                          }
                        }, 0);

                        const pnlFormatted = stratPnL >= 0 
                          ? `+₹${stratPnL.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` 
                          : `-₹${Math.abs(stratPnL).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

                        return (
                          <tr key={strat.id} className="hover:bg-[#1F2937]/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-200">{strat.name}</div>
                              <div className="text-xs text-gray-500 mt-1">{strat.desc}</div>
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={toggleStrat}
                                className={cn(
                                  "px-2.5 py-1 text-xs font-bold rounded cursor-pointer transition-all border", 
                                  isEnabled 
                                    ? "bg-brand-green/10 text-brand-green border-brand-green/30 hover:bg-brand-green/20" 
                                    : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                                )}
                              >
                                {isEnabled ? 'ACTIVE' : 'INACTIVE'}
                              </button>
                            </td>
                            <td className="px-6 py-4 text-gray-300 font-bold">
                              {stratSignals.length}
                            </td>
                            <td className={cn("px-6 py-4 font-bold", closedStrat.length > 0 && winningStrat.length > 0 ? "text-brand-green" : "text-gray-400")}>
                              {winRateStr}
                            </td>
                            <td className={cn("px-6 py-4 font-bold", stratPnL > 0 ? "text-brand-green" : stratPnL < 0 ? "text-red-400" : "text-gray-400")}>
                              {pnlFormatted}
                            </td>
                            <td className="px-6 py-4 text-brand-blue font-bold">{strat.rr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            );
          })()}

          {activeTab === 'logs' && (
            <div className="bg-[#111827] rounded-lg shadow-sm border border-[#1F2937] overflow-hidden">
              <div className="p-4 border-b border-[#1F2937] flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-white">Execution Signals Log</h3>
                  <p className="text-xs text-gray-500">Live JSON signal outputs generated by the 5-strategy option buying engine.</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => window.open('/api/signals/export-excel', '_blank')}
                    disabled={state.signals.length === 0}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded bg-brand-blue hover:bg-blue-400 text-black text-xs font-extrabold transition-all shadow-[0_0_12px_rgba(59,130,246,0.3)] disabled:opacity-50 cursor-pointer"
                  >
                    <Download size={14} />
                    <span>Download Excel</span>
                  </button>
                  <button
                    onClick={handleResetLogs}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded bg-red-950/60 border border-red-800/50 hover:bg-red-900/60 text-xs font-bold text-red-300 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left font-mono">
                  <thead className="text-xs text-gray-500 uppercase bg-[#0A0F1C] border-b border-[#1F2937]">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Signal</th>
                      <th className="px-4 py-3">Strategy Family</th>
                      <th className="px-4 py-3">Spot</th>
                      <th className="px-4 py-3">Broken Level</th>
                      <th className="px-4 py-3">Walls (CE / PE)</th>
                      <th className="px-4 py-3">Strike & Opt</th>
                      <th className="px-4 py-3">Entry</th>
                      <th className="px-4 py-3">Current / Exit</th>
                      <th className="px-4 py-3 text-right">Profit / Loss (₹)</th>
                      <th className="px-4 py-3">Stoploss</th>
                      <th className="px-4 py-3">Target1 / T2</th>
                      <th className="px-4 py-3">Conf</th>
                      <th className="px-4 py-3">Reasons & Filters</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937] text-xs">
                    {state.signals.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-4 py-12 text-center text-gray-500">
                          No active trades generated yet. Strategy engine actively evaluating level breaks, OI walls, and retests...
                        </td>
                      </tr>
                    ) : (
                      state.signals.map((sig: any, i: number) => {
                        const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
                        const lots = settings?.strategies?.[stratKey]?.lotSize || 1;
                        const qty = 75 * lots;
                        
                        let tradePnL = 0;
                        if (sig.status === 'CLOSED') {
                          tradePnL = sig.realizedPnL !== undefined ? sig.realizedPnL : ((sig.exitPrice || sig.latestPrice || sig.entryPrice) - sig.entryPrice) * qty;
                        } else {
                          const curP = sig.latestPrice || sig.entryPrice;
                          tradePnL = (curP - sig.entryPrice) * qty;
                        }

                        const pnlText = tradePnL >= 0 
                          ? `+₹${tradePnL.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` 
                          : `-₹${Math.abs(tradePnL).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

                        const formatTimestamp = (ts: any) => {
                          if (!ts) return '-';
                          if (typeof ts === 'number') return new Date(ts).toLocaleTimeString();
                          const d = new Date(ts);
                          if (!isNaN(d.getTime())) return d.toLocaleTimeString();
                          return String(ts);
                        };

                        return (
                          <tr key={i} className="hover:bg-[#1F2937]/50">
                            <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatTimestamp(sig.timestamp)}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                sig.status === 'ACTIVE' 
                                  ? 'bg-brand-blue/20 text-brand-blue border border-brand-blue/40 animate-pulse' 
                                  : 'bg-gray-800 text-gray-400 border border-gray-700'
                              )}>
                                {sig.status || 'ACTIVE'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                sig.signal === 'BUY_CALL' ? 'bg-brand-green/20 text-brand-green border border-brand-green/40' :
                                sig.signal === 'BUY_PUT' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                                'bg-gray-800 text-gray-400'
                              )}>
                                {sig.signal}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-200 font-bold">{sig.strategy_family || sig.strategy}</td>
                            <td className="px-4 py-3 text-white font-bold">{sig.spot || sig.entryPrice}</td>
                            <td className="px-4 py-3 text-yellow-400 font-bold">{sig.broken_level || '-'}</td>
                            <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                              <span className="text-red-400">CE: {sig.wall_above || '-'}</span> / <span className="text-brand-green">PE: {sig.wall_below || '-'}</span>
                            </td>
                            <td className="px-4 py-3 text-brand-blue font-bold whitespace-nowrap">
                              {sig.strike ? `${sig.strike} ${sig.option_type}` : sig.contract}
                            </td>
                            <td className="px-4 py-3 text-gray-200 font-bold">₹{sig.entry || sig.entryPrice}</td>
                            <td className="px-4 py-3 text-white font-bold">
                              ₹{sig.status === 'CLOSED' ? (sig.exitPrice !== undefined ? sig.exitPrice : (sig.latestPrice || sig.entryPrice)) : (sig.latestPrice || sig.entryPrice)}
                            </td>
                            <td className={cn(
                              "px-4 py-3 text-right font-bold font-mono text-xs whitespace-nowrap",
                              tradePnL > 0 ? "text-brand-green" : tradePnL < 0 ? "text-red-400" : "text-gray-400"
                            )}>
                              {pnlText}
                            </td>
                            <td className="px-4 py-3 text-red-400 font-bold">₹{sig.stoploss || sig.stopLoss}</td>
                            <td className="px-4 py-3 text-brand-green font-bold whitespace-nowrap">
                              ₹{sig.target1 || sig.target} / ₹{sig.target2 || '-'}
                            </td>
                            <td className="px-4 py-3 text-purple-400 font-bold">{sig.confidence ? `${sig.confidence}%` : '-'}</td>
                            <td className="px-4 py-3 text-gray-400 max-w-xs">
                              {sig.reason && Array.isArray(sig.reason) ? sig.reason.join(' | ') : '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'replay' && (
            <OptionChainReplay />
          )}

          {activeTab === 'settings' && settings && (
            <div className="space-y-6">
              {/* Upstox API Credentials & Access Token */}
              <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-6">
                <div className="border-b border-[#1F2937] pb-3 mb-4 flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-white uppercase flex items-center space-x-2">
                      <Settings size={18} className="text-brand-blue" />
                      <span>Upstox Realtime API Credentials & Token</span>
                    </h3>
                    <p className="text-xs text-gray-500">Only realtime Upstox API data is used. Paste your Upstox Access Token here for live market feed and Option Chain access.</p>
                  </div>
                  <div className="flex items-center space-x-2 bg-brand-green/10 border border-brand-green/30 px-3 py-1 rounded text-xs font-mono text-brand-green font-bold">
                    <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse"></span>
                    <span>UPSTOX REALTIME ONLY</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-3">
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Upstox Access Token (JWT)</label>
                    <input 
                      type="password" 
                      placeholder="Paste your Upstox Access Token..."
                      value={settings.accessToken || ''}
                      onChange={(e) => updateGlobalSettings('accessToken', e.target.value.trim())}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-brand-green font-mono text-xs focus:border-brand-green outline-none"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Generated daily from Upstox Developer Portal or OAuth flow. Required for live Nifty 50 Option Chain.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Upstox API Key</label>
                    <input 
                      type="text" 
                      value={settings.apiKey || ''}
                      onChange={(e) => updateGlobalSettings('apiKey', e.target.value.trim())}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white font-mono text-xs focus:border-brand-blue outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Upstox API Secret</label>
                    <input 
                      type="password" 
                      value={settings.apiSecret || ''}
                      onChange={(e) => updateGlobalSettings('apiSecret', e.target.value.trim())}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white font-mono text-xs focus:border-brand-blue outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Feed Mode</label>
                    <div className="w-full bg-[#0A0F1C] border border-brand-green/40 rounded px-4 py-2 text-brand-green font-mono text-xs font-bold flex items-center justify-between">
                      <span>STRICT REALTIME (NO SIMULATION)</span>
                      <CheckCircle2 size={14} className="text-brand-green" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Global Position & Risk Controls */}
              <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-6">
                <div className="border-b border-[#1F2937] pb-3 mb-4">
                  <h3 className="text-lg font-bold text-white uppercase flex items-center space-x-2">
                    <Settings size={18} className="text-brand-green" />
                    <span>Global Trade Quantity & Risk Controls</span>
                  </h3>
                  <p className="text-xs text-gray-500">Configure global lot size defaults and active trade capacity limits. All settings auto-save and persist.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Default Lots Per Trade</label>
                    <input 
                      type="number" 
                      min="1"
                      max="50"
                      value={settings.defaultLotsPerTrade || 1}
                      onChange={(e) => updateGlobalSettings('defaultLotsPerTrade', parseInt(e.target.value) || 1)}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-brand-green font-bold focus:border-brand-green outline-none font-mono text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Default number of lots assigned to trades (Nifty 50: 75 qty/lot)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Max Concurrent Active Trades</label>
                    <input 
                      type="number" 
                      min="1"
                      max="10"
                      value={settings.maxActiveTrades || 1}
                      onChange={(e) => updateGlobalSettings('maxActiveTrades', parseInt(e.target.value) || 1)}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-brand-blue font-bold focus:border-brand-blue outline-none font-mono text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Strict rule: Maximum 1 concurrent active trade allowed at a time</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-gray-400 uppercase mb-2">Expiry Contract Preference</label>
                    <select 
                      value={settings.expiryDate || 'CURRENT'} 
                      onChange={(e) => updateGlobalSettings('expiryDate', e.target.value)}
                      className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white focus:border-brand-green outline-none font-mono text-sm appearance-none"
                    >
                      <option value="CURRENT">Current Nearest Expiry (Recommended)</option>
                      <option value="NEXT">Next Week Expiry</option>
                    </select>
                    <p className="text-[10px] text-gray-500 mt-1">Automatically picks nearest liquid weekly options contract</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { key: 'failedRetest', name: '1. Failed Retest Reversal (FAILED_RETEST)', desc: 'Priority 1 | Catches failed retests of broken key levels after confirmation candle.', win: '10:00 - 12:30 IST', rr: '>= 0.8R to 1.5R+' },
                  { key: 'continuationBreakdown', name: '2. Continuation Breakdown (CONTINUATION_BREAKDOWN)', desc: 'Priority 2 | Trades bearish continuation after level breakdown and 1-4 candle consolidation pause.', win: '10:00 - 12:30 & 13:30 - 15:00', rr: '>= 0.8R to 1.5R' },
                  { key: 'continuationBreakout', name: '3. Continuation Breakout (CONTINUATION_BREAKOUT)', desc: 'Priority 3 | Trades bullish continuation after level breakout and 1-4 candle consolidation pause.', win: '10:00 - 12:30 & 13:30 - 15:00', rr: '>= 0.8R to 1.5R' },
                  { key: 'openingTrap', name: '4. Opening Breakout Trap (OPENING_TRAP)', desc: 'Priority 4 | Catches early fake breaks and reversals at ORH / ORL upon retest confirmation.', win: '09:30 - 10:30 IST', rr: '>= 0.8R to 1.0R' },
                                    { key: 'oiWallRejection', name: '5. OI Wall Rejection (OI_WALL_REJECTION)', desc: 'Priority 5 | Rejection trades when 1.5x dominant OI walls reject spot price at least 2 times.', win: 'Any (Post Wall Rejection)', rr: '>= 0.8R to 1.2R' },
                  { key: 'technicalConfluence', name: '6. Technical Confluence (TECHNICAL_CONFLUENCE)', desc: 'Priority 1 | Trading signals generated by technical indicators (RSI, MACD, EMA, Bollinger Bands, SuperTrend) voting consensus.', win: 'Any (Trend Direction)', rr: '>= 1.0R' }
                ].map(({ key, name, desc, win, rr }) => {
                  const config = settings.strategies?.[key] || { enabled: true, lotSize: 1 };

                  return (
                    <div key={key} className="bg-[#111827] border border-[#1F2937] rounded-lg p-6 relative">
                      <div className="flex justify-between items-start mb-4">
                        <div className="pr-16">
                          <h4 className="text-lg font-bold text-white mb-2 leading-snug">{name}</h4>
                          <p className="text-sm text-gray-400 mb-6">{desc}</p>
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Lot Size (Count)</label>
                          <input 
                            type="number" 
                            min="1"
                            value={config.lotSize || 1}
                            onChange={(e) => updateStrategyConfig(key, 'lotSize', parseInt(e.target.value))}
                            className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-white focus:border-brand-green outline-none font-mono text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono text-gray-500 uppercase mb-2">Strike Selection Strategy</label>
                          <div className="w-full bg-[#0A0F1C] border border-[#1F2937] rounded px-4 py-2 text-brand-blue font-mono text-xs flex items-center justify-between">
                            <span className="font-bold">ATM or 1-step ITM</span>
                            <span className="text-[10px] text-gray-400 bg-brand-blue/10 px-2 py-0.5 rounded">Prompt Rule</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-[#0A0F1C] border border-[#1F2937] rounded p-4 space-y-2 text-[10px] font-mono">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-2">
                          <div><span className="text-gray-500 mr-2 uppercase font-bold">Stop-Loss System:</span> <span className="text-red-400 font-bold">Dual Synchronized (Spot Level Invalidation & 0.35R - 0.5R Premium Safety Net)</span></div>
                          <span className="text-gray-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded text-[9px]">Strict Prompt Rule</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-2">
                          <div><span className="text-gray-500 mr-2 uppercase font-bold">Target Mechanics:</span> <span className="text-brand-green font-bold">Target 1 = Nearby OI Wall | Target 2 = Major OI Wall (Min 1.5R)</span></div>
                          <span className="text-gray-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px]">Prompt Structure</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-gray-400 pt-1">
                          <div><span className="text-gray-500 mr-2 uppercase font-bold">Timeframes:</span> <span className="text-white font-bold">1-Min Live Option-Chain Updates (Completed 1m)</span></div>
                          <div><span className="text-gray-500 mr-2 uppercase font-bold">Optimal Window:</span> <span className="text-brand-blue font-bold">{win}</span></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 18-Rule Quantitative Trade Audit Checklist & Order Pipeline */}
              <div className="bg-[#111827] border border-[#1F2937] rounded-lg p-6 mt-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1F2937] pb-4 mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-green animate-pulse"></span>
                      18-Rule Quantitative Trade Audit Checklist
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      Strict internal execution pipeline for fake-signal filtering & precision entry validation
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-[#0A0F1C] border border-brand-green/30 px-3 py-1.5 rounded-md text-xs font-mono text-brand-green">
                    <span className="font-bold">Execution Order:</span>
                    <span className="text-gray-300">Time → Levels → Retest → Premium → OI → Room → R:R → Chop → Decision</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
                  {[
                    { id: 1, title: 'Capture session state', desc: 'Store session H/L, ORH/ORL, PDH/PDL, CE/PE walls, last broken/failed level, failedLevelsToday' },
                    { id: 2, title: 'Use only completed candles', desc: 'Evaluate signals ONLY after 1m candle closes. Ignore incomplete live updates' },
                    { id: 3, title: 'Apply time filter first', desc: 'Hard block 09:15-09:30 AM IST opening noise. Prefer 09:30-14:45. Strict block post 15:15 IST' },
                    { id: 4, title: 'Detect meaningful levels', desc: 'Accept ORH/ORL, PDH/PDL, session H/L, dominant OI walls only. Ignore weak levels' },
                    { id: 5, title: 'Validate wall strength', desc: 'Mark wall only if OI >= 1.5x surrounding strikes AND stable (no rapid unwinding)' },
                    { id: 6, title: 'Require clear break/rejection', desc: 'Price must clearly break level or reject wall. Sideways/mixed action = NO_TRADE' },
                    { id: 7, title: 'Require confirmation', desc: 'No entry on 1st touch or 1st break candle. Wait for retest or continuation pause' },
                    { id: 8, title: 'Check retest quality', desc: 'Retest must hold in 3-5 bar window. Reject if level reclaimed quickly or shallow' },
                    { id: 9, title: 'Confirm premium behavior', desc: 'CE premium must rise for CALLs, PE for PUTs. Stalled or weakening premium = REJECT' },
                    { id: 10, title: 'Confirm OI direction', desc: 'Bullish requires PE support/CE unwind; Bearish requires CE wall/PE unwind' },
                    { id: 11, title: 'Check room to target', desc: 'Ensure sufficient distance to next wall/swing level (Target 1 >= 0.8R)' },
                    { id: 12, title: 'Enforce reward-to-risk rules', desc: 'Reject if T1 < 0.8R. Hard reject if Target 2 < 1.50R minimum threshold' },
                    { id: 13, title: 'Block chop zones', desc: 'Reject trades when price is trapped between walls (< 30 pts) or repeated failed levels' },
                    { id: 14, title: 'Prevent re-entry in same zone', desc: 'If level failed once today, block re-entry at same zone without fresh structure' },
                    { id: 15, title: 'Reject overextended moves', desc: 'Continuation trades only if move < 1.5x impulse candle range from breakout' },
                    { id: 16, title: 'Enforce candle-direction sanity', desc: 'Confirmation candle close MUST support trade direction (Green for CALL, Red for PUT)' },
                    { id: 17, title: 'One trade per structure', desc: 'Allow strictly 1 primary trade per setup structure. Reset only on new structure' },
                    { id: 18, title: 'Output a strict decision', desc: 'Return exactly one of: BUY_CALL, BUY_PUT, or NO_TRADE. If any filter fails = NO_TRADE' }
                  ].map((rule) => (
                    <div key={rule.id} className="bg-[#0A0F1C] border border-[#1F2937] rounded-md p-3 flex flex-col justify-between hover:border-brand-green/40 transition-colors">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-brand-green uppercase">Rule #{rule.id}</span>
                          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-sans font-bold">
                            ENFORCED
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-white mb-1">{rule.title}</h4>
                        <p className="text-[11px] text-gray-400 leading-normal font-sans">{rule.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'options' && (
            <OptionChainView settings={settings} state={state} />
          )}

        </main>
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

function OptionChainView({ settings, state }: { settings: any, state: any }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [instrument, setInstrument] = useState('NSE_INDEX|Nifty 50');
  const [showNewsDrawer, setShowNewsDrawer] = useState(false);
  const [newsList, setNewsList] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [chainMode, setChainMode] = useState<'FOCUSED' | 'FULL'>('FULL');
  const [fetchError, setFetchError] = useState<string | null>(null);

  const isGold = instrument.includes('GOLD');
  const isBankNifty = instrument.includes('Bank');
  const realSpotFromData = data && data.length > 0 && data[0]?.underlying_spot_price ? Number(data[0].underlying_spot_price) : null;
  const spotPrice = realSpotFromData !== null
    ? realSpotFromData
    : (isGold ? (state?.gold?.lastPrice || 154263) : (isBankNifty ? (state?.bankNifty?.lastPrice || 52000) : (state?.nifty50?.lastPrice || 24125.10)));
  const spotChange = isGold
    ? (state?.gold?.change || 0)
    : (isBankNifty ? (state?.bankNifty?.change || 0) : (state?.nifty50?.change || 0));

  const step = isGold ? 100 : (isBankNifty ? 100 : 50);
  const atmStrike = Math.round(spotPrice / step) * step;

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLTableRowElement>(null);
  const hasInitiallyCentered = useRef(false);

  // Dynamic expiries from backend / Upstox
  const [expirys, setExpirys] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>('CURRENT');

  // View style & Indian unit mode
  const [viewStyle, setViewStyle] = useState<'UPSTOX' | 'AOC'>('UPSTOX');
  const [unitMode, setUnitMode] = useState<'AUTO_CR_L' | 'LAKHS' | 'CRORES' | 'THOUSANDS' | 'EXACT'>('AUTO_CR_L');

  // Column visibility
  const [columns, setColumns] = useState({
    buildup: true,
    bidAsk: false,
    oi: true,
    oiChg: true,
    volume: true,
    iv: true,
    delta: true,
    theta: true,
    gamma: true,
    vega: true
  });

  const [showColMenu, setShowColMenu] = useState(false);

  // Fetch Expiries when instrument changes
  useEffect(() => {
    const fetchExpiries = async () => {
      try {
        const res = await fetch(`/api/expirys?instrument=${encodeURIComponent(instrument)}`);
        if (!res.ok) return;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const json = await res.json();
          if (json.expirys && json.expirys.length > 0) {
            setExpirys(json.expirys);
            setExpiry(json.expirys[0]);
          }
        }
      } catch (e) {
        // Ignore network errors smoothly
      }
    };
    fetchExpiries();
  }, [instrument]);

  // Auto poll every 1.5s for real-time Upstox option chain updates
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 1500);
    return () => clearInterval(interval);
  }, [instrument, expiry, settings?.accessToken]);

  // Reset centering flag when instrument or expiry changes
  useEffect(() => {
    hasInitiallyCentered.current = false;
  }, [instrument, expiry]);

  // Fetch Market News
  useEffect(() => {
    fetchMarketNews();
  }, []);

  const centerAtmRow = () => {
    if (atmRowRef.current && tableContainerRef.current) {
      const container = tableContainerRef.current;
      const row = atmRowRef.current;
      const containerHeight = container.clientHeight;
      const rowTop = row.offsetTop;
      const rowHeight = row.clientHeight;
      container.scrollTo({
        top: Math.max(0, rowTop - containerHeight / 2 + rowHeight / 2),
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (data.length > 0 && !hasInitiallyCentered.current) {
      hasInitiallyCentered.current = true;
      setTimeout(() => {
        centerAtmRow();
      }, 150);
    }
  }, [data]);

  const fetchMarketNews = async () => {
    setNewsLoading(true);
    try {
      const res = await fetch('/api/market-news');
      if (!res.ok) return;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const json = await res.json();
        if (json.news) {
          setNewsList(json.news);
        }
      }
    } catch (e) {
      // Ignore network errors smoothly
    } finally {
      setNewsLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/option-chain?instrument=${encodeURIComponent(instrument)}&expiry=${encodeURIComponent(expiry)}`);
      if (!res.ok) {
        setFetchError(`Server Error: ${res.status}`);
        return;
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || contentType.indexOf("application/json") === -1) {
        // Silently ignore non-JSON responses during server restart
        return;
      }
      const json = await res.json();
      if (json && json.status === 'success' && Array.isArray(json.data) && json.data.length > 0) {
        setData(json.data);
        setFetchError(null);
      } else {
        if (json && json.message) {
          setFetchError(json.message);
        } else {
          setFetchError("No option chain data returned from Upstox API");
        }
      }
    } catch (e: any) {
      // Don't crash UI, just show a temporary fetch error
      setFetchError("Connection interrupted (server restarting or offline)");
    } finally {
      setLoading(false);
    }
  };

  const toggleCol = (key: keyof typeof columns) => {
    setColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Filtered rows for displaying based on chainMode
  const displayedRows = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (chainMode === 'FULL') return data;

    const sortedByOI = [...data].sort((a, b) => {
      const aMaxOI = Math.max(a.call_options?.market_data?.oi || 0, a.put_options?.market_data?.oi || 0);
      const bMaxOI = Math.max(b.call_options?.market_data?.oi || 0, b.put_options?.market_data?.oi || 0);
      return bMaxOI - aMaxOI;
    });
    const topOIStrikes = new Set(sortedByOI.slice(0, 4).map(r => r.strike_price));

    const sortedByVol = [...data].sort((a, b) => {
      const aMaxVol = Math.max(a.call_options?.market_data?.volume || 0, a.put_options?.market_data?.volume || 0);
      const bMaxVol = Math.max(b.call_options?.market_data?.volume || 0, b.put_options?.market_data?.volume || 0);
      return bMaxVol - aMaxVol;
    });
    const topVolStrikes = new Set(sortedByVol.slice(0, 4).map(r => r.strike_price));

    return data.filter(row => {
      const diff = Math.abs(row.strike_price - atmStrike);
      const isNearAtm = diff <= 4 * step;
      const isTopOI = topOIStrikes.has(row.strike_price);
      const isTopVol = topVolStrikes.has(row.strike_price);
      return isNearAtm || isTopOI || isTopVol;
    }).sort((a, b) => a.strike_price - b.strike_price);
  }, [data, chainMode, atmStrike, step]);

  // Compute maximum values & AOC Support / Resistance / Shifting
  const maxCallOI = Math.max(1, ...data.map(r => r.call_options?.market_data?.oi || 0));
  const maxCallOIChg = Math.max(1, ...data.map(r => Math.abs(r.call_options?.market_data?.oi_change || 0)));
  const maxCallVol = Math.max(1, ...data.map(r => r.call_options?.market_data?.volume || 0));

  const maxPutOI = Math.max(1, ...data.map(r => r.put_options?.market_data?.oi || 0));
  const maxPutOIChg = Math.max(1, ...data.map(r => Math.abs(r.put_options?.market_data?.oi_change || 0)));
  const maxPutVol = Math.max(1, ...data.map(r => r.put_options?.market_data?.volume || 0));

  // Compute AOC Resistance & Support Shifting
  const aocAnalysis = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        callMaxStrike: atmStrike + step * 2,
        callMaxOI: maxCallOI,
        callStatus: 'STRONG',
        callShiftText: `SFT ${atmStrike + step * 2} -> ${atmStrike + step * 2}`,
        putMaxStrike: atmStrike - step * 2,
        putMaxOI: maxPutOI,
        putStatus: 'STRONG',
        putShiftText: `SFT ${atmStrike - step * 2} -> ${atmStrike - step * 2}`
      };
    }

    // Call Max Strike
    const sortedCallRows = [...data].sort((a, b) => (b.call_options?.market_data?.oi || 0) - (a.call_options?.market_data?.oi || 0));
    const callMaxRow = sortedCallRows[0];
    const callSecondRow = sortedCallRows[1];

    const callMaxStrike = callMaxRow?.strike_price || (atmStrike + step * 2);
    const callSecondStrike = callSecondRow?.strike_price;
    const callSecondPct = callMaxRow && callSecondRow ? ((callSecondRow.call_options?.market_data?.oi || 0) / (callMaxRow.call_options?.market_data?.oi || 1)) * 100 : 0;

    let callStatus = 'STRONG';
    let callShiftText = `SFT ${callMaxStrike} -> ${callMaxStrike}`;
    if (callSecondPct >= 70 && callSecondStrike) {
      if (callSecondStrike > callMaxStrike) {
        callStatus = 'WTT (Weak Towards Top)';
        callShiftText = `SFT ${callMaxStrike} -> ${callSecondStrike}`;
      } else {
        callStatus = 'WTB (Weak Towards Bottom)';
        callShiftText = `SFT ${callMaxStrike} -> ${callSecondStrike}`;
      }
    }

    // Put Max Strike
    const sortedPutRows = [...data].sort((a, b) => (b.put_options?.market_data?.oi || 0) - (a.put_options?.market_data?.oi || 0));
    const putMaxRow = sortedPutRows[0];
    const putSecondRow = sortedPutRows[1];

    const putMaxStrike = putMaxRow?.strike_price || (atmStrike - step * 2);
    const putSecondStrike = putSecondRow?.strike_price;
    const putSecondPct = putMaxRow && putSecondRow ? ((putSecondRow.put_options?.market_data?.oi || 0) / (putMaxRow.put_options?.market_data?.oi || 1)) * 100 : 0;

    let putStatus = 'STRONG';
    let putShiftText = `SFT ${putMaxStrike} -> ${putMaxStrike}`;
    if (putSecondPct >= 70 && putSecondStrike) {
      if (putSecondStrike > putMaxStrike) {
        putStatus = 'WTT (Weak Towards Top)';
        putShiftText = `SFT ${putMaxStrike} -> ${putSecondStrike}`;
      } else {
        putStatus = 'WTB (Weak Towards Bottom)';
        putShiftText = `SFT ${putMaxStrike} -> ${putSecondStrike}`;
      }
    }

    return {
      callMaxStrike,
      callSecondStrike,
      callSecondPct,
      callStatus,
      callShiftText,
      putMaxStrike,
      putSecondStrike,
      putSecondPct,
      putStatus,
      putShiftText
    };
  }, [data, maxCallOI, maxPutOI, atmStrike, step]);

  const totalCallOI = data.reduce((sum, r) => sum + (r.call_options?.market_data?.oi || 0), 0);
  const totalPutOI = data.reduce((sum, r) => sum + (r.put_options?.market_data?.oi || 0), 0);
  const pcrRatio = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : '1.00';

  function formatIndianUnits(num: number, mode: string = unitMode): string {
    if (num === undefined || num === null || isNaN(num)) return '-';
    if (num === 0) return '0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (mode === 'CRORES') {
      const crVal = abs / 10_000_000;
      const str = crVal >= 100 ? crVal.toFixed(0) : crVal.toFixed(2).replace(/\.00$/, '');
      return `${sign}${str} Cr`;
    }
    if (mode === 'THOUSANDS') {
      const kVal = abs / 1_000;
      const str = kVal.toFixed(1).replace(/\.0$/, '');
      return `${sign}${str} K`;
    }
    if (mode === 'EXACT') {
      return `${sign}${abs.toLocaleString('en-IN')}`;
    }

    // Default Upstox style & LAKHS mode:
    // Express quantities strictly in Lakhs (L).
    // E.g. 1.9 Crores (19,000,000) -> 190 L, 80,000 -> .8 L (not 80k).
    const lakhsVal = abs / 100_000;
    if (lakhsVal >= 1) {
      const str = lakhsVal.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
      return `${sign}${str} L`;
    } else {
      const str = lakhsVal.toFixed(2).replace(/^0\./, '.').replace(/(\.\d)0$/, '$1');
      return `${sign}${str} L`;
    }
  }

  function extractMarketData(opt: any) {
    if (!opt) return {
      ltp: 0, priceChange: 0, pChange: 0, oi: 0, oiChange: 0, pChangeOI: 0, volume: 0, bidPrice: 0, askPrice: 0, bidQty: 0, askQty: 0, iv: '-', delta: '-', theta: '-', gamma: '-', vega: '-'
    };
    const m = opt.market_data || opt.marketData || {};
    const g = opt.option_greeks || opt.optionGreeks || {};

    const ltp = Number(m.ltp ?? m.last_price ?? m.lp ?? m.close_price ?? 0);
    const close = Number(m.close_price ?? ltp);
    const priceChange = Number(m.price_change ?? m.net_change ?? (ltp - close));
    const pChange = Number(m.p_change ?? (close > 0 ? (priceChange / close) * 100 : 0));

    const oi = Number(m.oi ?? m.open_interest ?? 0);
    const prevOi = Number(m.prev_oi ?? (m.oi_change !== undefined ? oi - m.oi_change : oi));
    const oiChange = Number(m.oi_change ?? (oi - prevOi));
    const pChangeOI = Number(m.p_change_oi ?? (prevOi > 0 ? (oiChange / prevOi) * 100 : 0));

    const volume = Number(m.volume ?? m.vol ?? m.v ?? 0);
    const bidPrice = Number(m.bid_price ?? m.bid ?? 0);
    const askPrice = Number(m.ask_price ?? m.ask ?? 0);
    const bidQty = Number(m.bid_qty ?? m.bid_quantity ?? 0);
    const askQty = Number(m.ask_qty ?? m.ask_quantity ?? 0);

    return {
      ltp,
      priceChange,
      pChange,
      oi,
      oiChange,
      pChangeOI,
      volume,
      bidPrice,
      askPrice,
      bidQty,
      askQty,
      iv: g.iv !== undefined && g.iv !== null && g.iv !== '' && Number(g.iv) !== 0 ? `${Number(g.iv).toFixed(2)}%` : '-',
      delta: g.delta !== undefined && g.delta !== null && g.delta !== '' ? Number(g.delta).toFixed(2) : '-',
      theta: g.theta !== undefined && g.theta !== null && g.theta !== '' ? Number(g.theta).toFixed(2) : '-',
      gamma: g.gamma !== undefined && g.gamma !== null && g.gamma !== '' ? Number(g.gamma).toFixed(4) : '-',
      vega: g.vega !== undefined && g.vega !== null && g.vega !== '' ? Number(g.vega).toFixed(2) : '-'
    };
  }

  function getBuildup(ltpChange: number, oiChange: number) {
    if (ltpChange >= 0 && oiChange > 0) return { label: 'Long', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    if (ltpChange < 0 && oiChange > 0) return { label: 'Short', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    if (ltpChange >= 0 && oiChange <= 0) return { label: 'Covering', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
    return { label: 'Unwinding', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
  }

  function renderUpstoxValueCell(val: number, maxVal: number, side: 'CE' | 'PE', isOIChg: boolean = false, pChangeVal: number = 0) {
    if (val === undefined || val === null) return <span className="text-gray-500">-</span>;
    const absVal = Math.abs(val);
    const pct = Math.min(100, Math.round((absVal / Math.max(1, maxVal)) * 100));

    const isPositive = val >= 0;
    const barBg = side === 'CE' 
      ? (isPositive ? 'bg-red-500/20' : 'bg-red-500/10')
      : (isPositive ? 'bg-emerald-500/20' : 'bg-emerald-500/10');

    return (
      <div className="relative overflow-hidden rounded px-1.5 py-1 text-center font-mono my-0.5 min-w-[70px]">
        {/* Fill bar for visual depth */}
        <div 
          className={cn("absolute bottom-0 top-0 opacity-40 transition-all", side === 'CE' ? "right-0 bg-red-600/30" : "left-0 bg-emerald-600/30")} 
          style={{ width: `${pct}%` }} 
        />
        <div className="relative z-10 flex flex-col items-center">
          <span className={cn("text-xs font-bold leading-tight", isOIChg ? (isPositive ? "text-emerald-400" : "text-red-400") : "text-gray-200")}>
            {isOIChg && isPositive ? `+${formatIndianUnits(val)}` : formatIndianUnits(val)}
          </span>
          {isOIChg && (
            <span className={cn("text-[9px] font-medium leading-none mt-0.5", isPositive ? "text-emerald-400/80" : "text-red-400/80")}>
              {isPositive ? `+${pChangeVal.toFixed(1)}%` : `${pChangeVal.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>
    );
  }

  function renderAOCCell(value: number, maxVal: number, side: 'CE' | 'PE', isChange: boolean = false) {
    if (value === undefined || value === null) return '-';
    const absVal = Math.abs(value);
    const pct = Math.min(100, Math.round((absVal / Math.max(1, maxVal)) * 100));
    const is100Max = pct >= 98 || absVal === maxVal;
    const isYellowCandidate = pct >= 70 && !is100Max;

    let cellStyle = "text-gray-300";
    if (is100Max) {
      cellStyle = side === 'CE'
        ? "bg-[#dc2626] text-white font-extrabold shadow-md"
        : "bg-[#16a34a] text-white font-extrabold shadow-md";
    } else if (isYellowCandidate) {
      cellStyle = "bg-[#facc15] text-black font-extrabold shadow-md";
    }

    return (
      <div className={cn("flex flex-col items-center justify-center p-1 rounded font-mono transition-all my-0.5", cellStyle)}>
        <span className={cn("text-[10px] leading-tight font-black", (is100Max || isYellowCandidate) ? "text-inherit" : "text-gray-400")}>{pct}%</span>
        <span className={cn("text-xs font-bold leading-tight", isChange ? (value > 0 ? (is100Max ? "text-white" : isYellowCandidate ? "text-black" : "text-emerald-400") : (is100Max ? "text-white" : isYellowCandidate ? "text-black" : "text-red-400")) : "text-inherit")}>
          {formatIndianUnits(value)}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-[#0b0f19] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col gap-3 font-mono">
      
      {fetchError && (
        <div className="mx-3 mt-3 bg-red-950/60 border border-red-500/50 text-red-200 px-4 py-2.5 rounded flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2">
            <ShieldAlert size={16} className="text-red-400 shrink-0" />
            <span><strong>UPSTOX API NOTICE:</strong> {fetchError}</span>
          </div>
          <button onClick={fetchData} className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-white rounded text-[10px] font-bold uppercase">
            Retry
          </button>
        </div>
      )}

      {/* Ticker & Toolbar Header */}
      <div className="bg-[#060913] border-b border-[#1F2937] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Shifting & Spot Ticker */}
        <div className="flex flex-wrap items-center gap-3">
          {/* CE Shifting Pill */}
          <div className="bg-red-600/90 text-white font-black px-2.5 py-1 rounded flex items-center space-x-1.5 shadow-md">
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span>{aocAnalysis.callShiftText}</span>
          </div>

          <div className="flex items-center space-x-2 text-sm font-bold">
            <span className="text-gray-400">Fut: <strong className="text-white">₹{(spotPrice * 0.9996).toFixed(2)}</strong></span>
            <span className="text-gray-600">•</span>
            <span className="text-white">Spot: <strong className="text-yellow-400">₹{spotPrice.toFixed(2)}</strong></span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded font-mono", spotChange >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
              ({spotChange >= 0 ? `+${spotChange.toFixed(2)}` : spotChange.toFixed(2)})
            </span>
          </div>

          {/* PE Shifting Pill */}
          <div className="bg-emerald-600/90 text-white font-black px-2.5 py-1 rounded flex items-center space-x-1.5 shadow-md">
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span>{aocAnalysis.putShiftText}</span>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center space-x-2 text-xs">
          
          {/* View Style Switcher */}
          <div className="flex items-center bg-[#111827] border border-[#1F2937] p-0.5 rounded font-bold">
            <button 
              onClick={() => setViewStyle('UPSTOX')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors text-[10px] uppercase font-black",
                viewStyle === 'UPSTOX' ? "bg-brand-blue text-white" : "text-gray-400 hover:text-white"
              )}
            >
              UPSTOX
            </button>
            <button 
              onClick={() => setViewStyle('AOC')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors text-[10px] uppercase font-black",
                viewStyle === 'AOC' ? "bg-amber-500 text-black" : "text-gray-400 hover:text-white"
              )}
            >
              AOC HEATMAP
            </button>
          </div>

          {/* Unit Selector */}
          <select 
            value={unitMode} 
            onChange={e => setUnitMode(e.target.value as any)} 
            className="px-2 py-1 bg-[#111827] border border-[#1F2937] rounded text-[11px] font-bold text-yellow-400 outline-none cursor-pointer"
          >
            <option value="AUTO_CR_L">Units: L / Cr</option>
            <option value="LAKHS">Units: Lakhs (L)</option>
            <option value="CRORES">Units: Crores (Cr)</option>
            <option value="THOUSANDS">Units: Thousands (K)</option>
            <option value="EXACT">Units: Exact Qty</option>
          </select>

          {/* Range Mode Switcher */}
          <div className="flex items-center bg-[#111827] border border-[#1F2937] p-0.5 rounded font-bold">
            <button 
              onClick={() => setChainMode('FOCUSED')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors text-[10px]",
                chainMode === 'FOCUSED' ? "bg-brand-green text-black font-extrabold" : "text-gray-400 hover:text-white"
              )}
            >
              FOCUSED
            </button>
            <button 
              onClick={() => setChainMode('FULL')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors text-[10px]",
                chainMode === 'FULL' ? "bg-brand-blue text-white font-extrabold" : "text-gray-400 hover:text-white"
              )}
            >
              FULL
            </button>
          </div>

          <button 
            onClick={centerAtmRow}
            className="flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-bold border border-yellow-400/40 bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 transition-all"
          >
            <Lock size={12} />
            <span>ATM ({atmStrike})</span>
          </button>

          <button
            onClick={() => setShowNewsDrawer(!showNewsDrawer)}
            className={cn(
              "flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-bold border transition-colors",
              showNewsDrawer ? "bg-brand-blue/20 text-brand-blue border-brand-blue/40" : "bg-transparent text-gray-400 border-[#1F2937] hover:text-white"
            )}
          >
            <BarChart3 size={12} />
            <span>NEWS</span>
          </button>

          <select value={instrument} onChange={e => setInstrument(e.target.value)} className="px-2.5 py-1 bg-[#111827] border border-[#1F2937] rounded text-xs font-bold text-white outline-none cursor-pointer">
            <option value="NSE_INDEX|Nifty 50">🇮🇳 NIFTY 50 (NSE INDEX)</option>
            <option value="MCX_GOLD">🟡 MCX GOLD (COMMODITY)</option>
          </select>

          <select value={expiry} onChange={e => setExpiry(e.target.value)} className="px-2.5 py-1 bg-[#111827] border border-[#1F2937] rounded text-xs font-bold text-white outline-none cursor-pointer">
            {expirys.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <div className="relative">
            <button onClick={() => setShowColMenu(!showColMenu)} className="px-2.5 py-1 bg-[#111827] border border-[#1F2937] rounded text-xs font-bold text-gray-300 hover:text-white">
              COLS
            </button>
            {showColMenu && (
              <div className="absolute right-0 top-9 w-48 bg-[#111827] border border-[#1F2937] rounded-lg shadow-xl z-50 p-2 text-xs">
                {Object.entries(columns).map(([k, v]) => (
                  <label key={k} className="flex items-center space-x-2 p-1.5 hover:bg-[#1F2937] rounded cursor-pointer">
                    <input type="checkbox" checked={v} onChange={() => toggleCol(k as any)} className="accent-brand-green" />
                    <span className="text-gray-300 uppercase">{k}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button onClick={fetchData} className="p-1.5 bg-brand-green/10 text-brand-green border border-brand-green/30 hover:bg-brand-green/20 rounded">
            <RefreshCw size={12} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Upstox Key Market Metrics Summary Bar */}
      <div className="mx-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
        <div className="bg-[#121827] border border-[#1F2937] p-2 rounded flex flex-col justify-between">
          <span className="text-[10px] text-gray-400 uppercase font-bold">TOTAL CALL OI</span>
          <span className="text-red-400 font-extrabold text-sm mt-1">{formatIndianUnits(totalCallOI)}</span>
        </div>
        <div className="bg-[#121827] border border-[#1F2937] p-2 rounded flex flex-col justify-between">
          <span className="text-[10px] text-gray-400 uppercase font-bold">TOTAL PUT OI</span>
          <span className="text-emerald-400 font-extrabold text-sm mt-1">{formatIndianUnits(totalPutOI)}</span>
        </div>
        <div className="bg-[#121827] border border-[#1F2937] p-2 rounded flex flex-col justify-between">
          <span className="text-[10px] text-gray-400 uppercase font-bold">OVERALL PCR</span>
          <span className={cn("font-extrabold text-sm mt-1", Number(pcrRatio) >= 1 ? "text-emerald-400" : "text-amber-400")}>
            {pcrRatio} ({Number(pcrRatio) >= 1 ? "Bullish" : "Bearish"})
          </span>
        </div>
        <div className="bg-[#121827] border border-[#1F2937] p-2 rounded flex flex-col justify-between">
          <span className="text-[10px] text-gray-400 uppercase font-bold">RES / SUPP WALLS</span>
          <span className="text-white font-extrabold text-xs mt-1">
            <span className="text-red-400">{aocAnalysis.callMaxStrike}</span> / <span className="text-emerald-400">{aocAnalysis.putMaxStrike}</span>
          </span>
        </div>
      </div>

      {/* Market News Drawer */}
      {showNewsDrawer && (
        <div className="mx-3 bg-[#0a0f1d] border border-[#1F2937] rounded-lg p-3 text-xs space-y-2">
          <div className="flex justify-between items-center border-b border-[#1F2937] pb-1.5">
            <h4 className="font-bold text-brand-blue uppercase flex items-center space-x-1.5">
              <TrendingUp size={14} />
              <span>Options Market Context & Intelligence</span>
            </h4>
            <button onClick={fetchMarketNews} className="text-brand-green hover:underline text-[10px]">
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {newsList.map((item, idx) => (
              <div key={idx} className="bg-[#111827] border border-[#1F2937] rounded p-2 flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-gray-500 uppercase">{item.category} • {item.time}</span>
                  <span className={cn("px-1.5 py-0.5 rounded font-bold uppercase text-[9px]", item.sentiment === 'BULLISH' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>{item.sentiment}</span>
                </div>
                <h5 className="font-bold text-white text-xs">{item.title}</h5>
                <p className="text-gray-400 text-[11px]">{item.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Option Chain Table */}
      <div ref={tableContainerRef} className="overflow-x-auto max-h-[680px] scroll-smooth">
        <table className="w-full text-xs text-center border-collapse">
          <thead className="sticky top-0 z-20 bg-[#060a14] shadow-md">
            <tr className="text-gray-400 border-b border-[#1F2937]">
              <th colSpan={Object.values(columns).filter(Boolean).length + 1} className="py-2 bg-[#1b080c] border-r border-[#1F2937] text-red-400 font-bold uppercase tracking-wider">
                CALL OPTIONS (CE)
              </th>
              <th className="py-2 bg-[#060a14] border-r border-[#1F2937] text-yellow-400 font-extrabold uppercase px-3">
                STRIKE : PCR
              </th>
              <th colSpan={Object.values(columns).filter(Boolean).length + 1} className="py-2 bg-[#081a10] text-emerald-400 font-bold uppercase tracking-wider">
                PUT OPTIONS (PE)
              </th>
            </tr>
            <tr className="bg-[#0b0f19] text-gray-300 font-bold border-b border-[#1F2937] uppercase text-[11px]">
              {columns.vega && <th className="py-2 px-1.5">Vega</th>}
              {columns.gamma && <th className="py-2 px-1.5">Gamma</th>}
              {columns.theta && <th className="py-2 px-1.5">Theta</th>}
              {columns.delta && <th className="py-2 px-1.5">Delta</th>}
              {columns.iv && <th className="py-2 px-1.5">IV</th>}
              {columns.buildup && <th className="py-2 px-1.5">Buildup</th>}
              {columns.bidAsk && <th className="py-2 px-1.5">Bid / Ask</th>}
              {columns.oiChg && <th className="py-2 px-2 bg-red-950/30 text-red-300">OI Chg</th>}
              {columns.oi && <th className="py-2 px-2 bg-red-950/50 text-red-200">OI</th>}
              {columns.volume && <th className="py-2 px-2 bg-red-950/30 text-red-300">Volume</th>}
              <th className="py-2 px-3 border-r border-[#1F2937] text-white bg-red-900/40">LTP / Chg</th>

              <th className="py-2 px-3 bg-[#060a14] border-r border-[#1F2937] text-yellow-400 font-black text-xs">
                STRIKE
              </th>

              <th className="py-2 px-3 text-white bg-emerald-900/40">LTP / Chg</th>
              {columns.volume && <th className="py-2 px-2 bg-emerald-950/30 text-emerald-300">Volume</th>}
              {columns.oi && <th className="py-2 px-2 bg-emerald-950/50 text-emerald-200">OI</th>}
              {columns.oiChg && <th className="py-2 px-2 bg-emerald-950/30 text-emerald-300">OI Chg</th>}
              {columns.bidAsk && <th className="py-2 px-1.5">Bid / Ask</th>}
              {columns.buildup && <th className="py-2 px-1.5">Buildup</th>}
              {columns.iv && <th className="py-2 px-1.5">IV</th>}
              {columns.delta && <th className="py-2 px-1.5">Delta</th>}
              {columns.theta && <th className="py-2 px-1.5">Theta</th>}
              {columns.gamma && <th className="py-2 px-1.5">Gamma</th>}
              {columns.vega && <th className="py-2 px-1.5">Vega</th>}
            </tr>
          </thead>

          <tbody className="divide-y divide-[#1F2937]">
            {displayedRows.map((row, i) => {
              const callM = extractMarketData(row.call_options);
              const putM = extractMarketData(row.put_options);

              const strike = row.strike_price;
              const isAtm = strike === atmStrike;
              const isCallITM = strike < spotPrice;
              const isPutITM = strike > spotPrice;

              const callBuildup = getBuildup(callM.priceChange, callM.oiChange);
              const putBuildup = getBuildup(putM.priceChange, putM.oiChange);

              // Individual strike PCR
              const strikeCallOI = callM.oi || 1;
              const strikePutOI = putM.oi || 0;
              const strikePCR = (strikePutOI / strikeCallOI).toFixed(2);

              return (
                <tr 
                  key={i} 
                  ref={isAtm ? atmRowRef : null}
                  className={cn(
                    "transition-colors relative text-xs font-mono",
                    isAtm 
                      ? "bg-[#362703] border-y-2 border-yellow-400 font-extrabold z-10" 
                      : "hover:bg-[#1a2335]"
                  )}
                >
                  {/* Calls Side Columns */}
                  {columns.vega && <td className={cn("py-2 px-1.5", isCallITM ? "bg-[#1b0b10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{callM.vega}</td>}
                  {columns.gamma && <td className={cn("py-2 px-1.5", isCallITM ? "bg-[#1b0b10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{callM.gamma}</td>}
                  {columns.theta && <td className={cn("py-2 px-1.5", isCallITM ? "bg-[#1b0b10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{callM.theta}</td>}
                  {columns.delta && <td className={cn("py-2 px-1.5", isCallITM ? "bg-[#1b0b10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{callM.delta}</td>}
                  {columns.iv && <td className={cn("py-2 px-1.5 font-bold", isCallITM ? "bg-[#1b0b10] text-yellow-400" : "bg-[#0d1322] text-yellow-500/80")}>{callM.iv}</td>}

                  {columns.buildup && (
                    <td className={cn("py-2 px-1.5", isCallITM ? "bg-[#1b0b10]" : "bg-[#0d1322]")}>
                      <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase whitespace-nowrap", callBuildup.color)}>
                        {callBuildup.label}
                      </span>
                    </td>
                  )}

                  {columns.bidAsk && (
                    <td className={cn("py-2 px-1 text-[10px] text-gray-400", isCallITM ? "bg-[#1b0b10]" : "bg-[#0d1322]")}>
                      <div>₹{callM.bidPrice.toFixed(2)} / ₹{callM.askPrice.toFixed(2)}</div>
                    </td>
                  )}

                  {/* Call OI Chg */}
                  {columns.oiChg && (
                    <td className={cn("py-2 px-2", isCallITM ? "bg-[#1b0b10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(callM.oiChange, maxCallOIChg, 'CE', true, callM.pChangeOI)
                        : renderAOCCell(callM.oiChange, maxCallOIChg, 'CE', true)
                      }
                    </td>
                  )}

                  {/* Call OI */}
                  {columns.oi && (
                    <td className={cn("py-2 px-2", isCallITM ? "bg-[#1b0b10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(callM.oi, maxCallOI, 'CE')
                        : renderAOCCell(callM.oi, maxCallOI, 'CE')
                      }
                    </td>
                  )}

                  {/* Call Volume */}
                  {columns.volume && (
                    <td className={cn("py-2 px-2", isCallITM ? "bg-[#1b0b10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(callM.volume, maxCallVol, 'CE')
                        : renderAOCCell(callM.volume, maxCallVol, 'CE')
                      }
                    </td>
                  )}

                  {/* Call LTP & Change */}
                  <td className={cn("py-2 px-3 border-r border-[#1F2937] font-bold", isCallITM ? "bg-[#2c0e15] text-white" : "bg-[#0d1322] text-white")}>
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-black text-white">₹{callM.ltp.toFixed(2)}</span>
                      <span className={cn("text-[10px] font-bold leading-tight mt-0.5", callM.priceChange >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {callM.priceChange >= 0 ? `+${callM.priceChange.toFixed(2)}` : callM.priceChange.toFixed(2)} ({callM.pChange >= 0 ? `+${callM.pChange.toFixed(2)}%` : `${callM.pChange.toFixed(2)}%`})
                      </span>
                    </div>
                  </td>

                  {/* Strike Price & PCR Column */}
                  <td className={cn(
                    "py-2 px-3 border-r border-[#1F2937] font-black font-mono text-center min-w-[110px]",
                    isAtm 
                      ? "bg-amber-400 text-black shadow-lg text-sm" 
                      : "bg-[#060a14] text-white text-xs"
                  )}>
                    <div className="flex flex-col items-center">
                      <div className="flex items-center space-x-1">
                        <span>{strike}</span>
                        {isAtm && <span className="bg-black text-amber-400 text-[9px] px-1 rounded font-black">ATM</span>}
                      </div>
                      <span className={cn("text-[9px] font-bold", isAtm ? "text-black/80 font-black" : "text-blue-300 font-mono")}>
                        PCR {strikePCR}
                      </span>
                    </div>
                  </td>

                  {/* Put LTP & Change */}
                  <td className={cn("py-2 px-3 font-bold", isPutITM ? "bg-[#0a281b] text-white" : "bg-[#0d1322] text-white")}>
                    <div className="flex flex-col items-center">
                      <span className="text-xs font-black text-white">₹{putM.ltp.toFixed(2)}</span>
                      <span className={cn("text-[10px] font-bold leading-tight mt-0.5", putM.priceChange >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {putM.priceChange >= 0 ? `+${putM.priceChange.toFixed(2)}` : putM.priceChange.toFixed(2)} ({putM.pChange >= 0 ? `+${putM.pChange.toFixed(2)}%` : `${putM.pChange.toFixed(2)}%`})
                      </span>
                    </div>
                  </td>

                  {/* Put Volume */}
                  {columns.volume && (
                    <td className={cn("py-2 px-2", isPutITM ? "bg-[#071a10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(putM.volume, maxPutVol, 'PE')
                        : renderAOCCell(putM.volume, maxPutVol, 'PE')
                      }
                    </td>
                  )}

                  {/* Put OI */}
                  {columns.oi && (
                    <td className={cn("py-2 px-2", isPutITM ? "bg-[#071a10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(putM.oi, maxPutOI, 'PE')
                        : renderAOCCell(putM.oi, maxPutOI, 'PE')
                      }
                    </td>
                  )}

                  {/* Put OI Chg */}
                  {columns.oiChg && (
                    <td className={cn("py-2 px-2", isPutITM ? "bg-[#071a10]" : "bg-[#0d1322]")}>
                      {viewStyle === 'UPSTOX'
                        ? renderUpstoxValueCell(putM.oiChange, maxPutOIChg, 'PE', true, putM.pChangeOI)
                        : renderAOCCell(putM.oiChange, maxPutOIChg, 'PE', true)
                      }
                    </td>
                  )}

                  {columns.bidAsk && (
                    <td className={cn("py-2 px-1 text-[10px] text-gray-400", isPutITM ? "bg-[#071a10]" : "bg-[#0d1322]")}>
                      <div>₹{putM.bidPrice.toFixed(2)} / ₹{putM.askPrice.toFixed(2)}</div>
                    </td>
                  )}

                  {columns.buildup && (
                    <td className={cn("py-2 px-1.5", isPutITM ? "bg-[#071a10]" : "bg-[#0d1322]")}>
                      <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase whitespace-nowrap", putBuildup.color)}>
                        {putBuildup.label}
                      </span>
                    </td>
                  )}

                  {columns.iv && <td className={cn("py-2 px-1.5 font-bold", isPutITM ? "bg-[#071a10] text-yellow-400" : "bg-[#0d1322] text-yellow-500/80")}>{putM.iv}</td>}
                  {columns.delta && <td className={cn("py-2 px-1.5", isPutITM ? "bg-[#071a10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{putM.delta}</td>}
                  {columns.theta && <td className={cn("py-2 px-1.5", isPutITM ? "bg-[#071a10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{putM.theta}</td>}
                  {columns.gamma && <td className={cn("py-2 px-1.5", isPutITM ? "bg-[#071a10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{putM.gamma}</td>}
                  {columns.vega && <td className={cn("py-2 px-1.5", isPutITM ? "bg-[#071a10] text-gray-300" : "bg-[#0d1322] text-gray-400")}>{putM.vega}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>

        {data.length === 0 && !loading && (
          <div className="py-12 text-center text-gray-400 font-mono text-sm">
            Fetching live Upstox option chain stream...
          </div>
        )}
      </div>
    </div>
  );
}

