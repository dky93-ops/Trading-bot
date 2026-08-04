import React, { useState, useEffect } from 'react';
import { Download, Trash2, RefreshCw, Database, Clock, ArrowRight, Eye, CheckCircle2 } from 'lucide-react';
import { OptionChainSnapshot } from '../backend/types';

export const OptionChainReplay: React.FC = () => {
  const [history, setHistory] = useState<OptionChainSnapshot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedSnap, setSelectedSnap] = useState<OptionChainSnapshot | null>(null);
  const [message, setMessage] = useState<string>('');

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/option-chain/history');
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.snapshots)) {
        setHistory(data.snapshots);
        if (data.snapshots.length > 0 && !selectedSnap) {
          setSelectedSnap(data.snapshots[data.snapshots.length - 1]);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch option chain history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const timer = setInterval(fetchHistory, 10000); // Poll recorded snapshots every 10s
    return () => clearInterval(timer);
  }, []);

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear all recorded option chain snapshots?')) return;
    try {
      await fetch('/api/option-chain/clear', { method: 'POST' });
      setHistory([]);
      setSelectedSnap(null);
      setMessage('Recorded option chain history cleared successfully.');
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const handleExport = () => {
    window.open('/api/option-chain/export', '_blank');
  };

  const formatUnits = (num: number) => {
    if (!num) return '0';
    if (num >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `${(num / 100000).toFixed(2)} L`;
    return num.toLocaleString('en-IN');
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Database className="text-brand-green" size={20} />
              <h2 className="text-xl font-extrabold text-white">Option Chain History & Replay Buffer</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Automated high-frequency snapshot recorder storing option chain time-series data for historical backtesting and offline analysis.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={fetchHistory}
              className="flex items-center space-x-1.5 px-3 py-2 rounded bg-[#1F2937] hover:bg-gray-700 text-xs font-bold text-gray-200 transition-colors cursor-pointer"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-brand-green' : ''} />
              <span>Refresh</span>
            </button>

            <button
              onClick={handleExport}
              disabled={history.length === 0}
              className="flex items-center space-x-1.5 px-4 py-2 rounded bg-brand-green hover:bg-emerald-400 text-black text-xs font-extrabold transition-all shadow-[0_0_12px_rgba(0,255,163,0.3)] disabled:opacity-50 cursor-pointer"
            >
              <Download size={14} />
              <span>Export Replay JSON ({history.length})</span>
            </button>

            <button
              onClick={handleClear}
              disabled={history.length === 0}
              className="flex items-center space-x-1.5 px-3 py-2 rounded bg-red-950/60 border border-red-800/50 hover:bg-red-900/60 text-xs font-bold text-red-300 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Clear History</span>
            </button>
          </div>
        </div>

        {message && (
          <div className="mt-4 p-3 rounded bg-emerald-950/60 border border-emerald-800/50 text-brand-green text-xs flex items-center space-x-2">
            <CheckCircle2 size={14} />
            <span>{message}</span>
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-[#0A0F1C] border border-[#1F2937] p-3 rounded">
            <span className="text-[10px] text-gray-500 uppercase font-bold">Total Snapshots</span>
            <div className="text-lg font-bold text-white mt-1">{history.length} / 1000</div>
          </div>
          <div className="bg-[#0A0F1C] border border-[#1F2937] p-3 rounded">
            <span className="text-[10px] text-gray-500 uppercase font-bold">Time Range</span>
            <div className="text-xs font-bold text-brand-blue mt-1 font-mono">
              {history.length > 0 
                ? `${new Date(history[0].timestamp).toLocaleTimeString()} - ${new Date(history[history.length - 1].timestamp).toLocaleTimeString()}`
                : 'No recording yet'}
            </div>
          </div>
          <div className="bg-[#0A0F1C] border border-[#1F2937] p-3 rounded">
            <span className="text-[10px] text-gray-500 uppercase font-bold">Latest Nifty Spot</span>
            <div className="text-lg font-bold text-brand-green mt-1 font-mono">
              ₹{history.length > 0 ? history[history.length - 1].spotPrice : '---'}
            </div>
          </div>
          <div className="bg-[#0A0F1C] border border-[#1F2937] p-3 rounded">
            <span className="text-[10px] text-gray-500 uppercase font-bold">Latest PCR Ratio</span>
            <div className="text-lg font-bold text-yellow-400 mt-1 font-mono">
              {history.length > 0 ? history[history.length - 1].pcr : '---'}
            </div>
          </div>
        </div>
      </div>

      {/* Replay Time Series Table & Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Snapshots Time Series List */}
        <div className="lg:col-span-7 bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">
          <div className="p-4 border-b border-[#1F2937] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recorded Snapshots Log</h3>
            <span className="text-xs text-gray-500">Auto-recorded every 1 min on live option-chain updates</span>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs text-left font-mono">
              <thead className="text-[10px] text-gray-500 uppercase bg-[#0A0F1C] border-b border-[#1F2937] sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Spot Price</th>
                  <th className="px-3 py-2.5">PCR</th>
                  <th className="px-3 py-2.5">Call Wall (CE)</th>
                  <th className="px-3 py-2.5">Put Wall (PE)</th>
                  <th className="px-3 py-2.5 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                      No option chain snapshots recorded yet. Ensure Market Feed is active with valid Upstox Access Token.
                    </td>
                  </tr>
                ) : (
                  [...history].reverse().map((snap) => {
                    const isSelected = selectedSnap?.id === snap.id;
                    return (
                      <tr 
                        key={snap.id} 
                        onClick={() => setSelectedSnap(snap)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-brand-green/10 border-l-2 border-brand-green text-white' : 'hover:bg-[#1F2937]/50 text-gray-300'
                        }`}
                      >
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                          {new Date(snap.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2 font-bold text-white">
                          ₹{snap.spotPrice}
                        </td>
                        <td className={`px-3 py-2 font-bold ${snap.pcr >= 1 ? 'text-brand-green' : 'text-red-400'}`}>
                          {snap.pcr}
                        </td>
                        <td className="px-3 py-2 text-red-400 font-bold">
                          {snap.maxCallOIStrike}
                        </td>
                        <td className="px-3 py-2 text-brand-green font-bold">
                          {snap.maxPutOIStrike}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button className={`p-1 rounded ${isSelected ? 'text-brand-green' : 'text-gray-500 hover:text-white'}`}>
                            <Eye size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Snapshot Detailed Strike Breakdown */}
        <div className="lg:col-span-5 bg-[#111827] rounded-lg border border-[#1F2937] p-4 flex flex-col justify-between">
          <div>
            <div className="border-b border-[#1F2937] pb-3 mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Snapshot Strike Breakdown</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {selectedSnap ? `Recorded at ${new Date(selectedSnap.timestamp).toLocaleTimeString()} | Spot ₹${selectedSnap.spotPrice}` : 'Select a snapshot to inspect'}
                </p>
              </div>
              {selectedSnap && (
                <span className="px-2 py-0.5 bg-brand-blue/20 text-brand-blue border border-brand-blue/40 text-[10px] font-bold rounded">
                  PCR: {selectedSnap.pcr}
                </span>
              )}
            </div>

            {selectedSnap ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-[#0A0F1C] p-2 rounded border border-[#1F2937]">
                    <span className="text-[10px] text-gray-500">TOTAL CALL OI</span>
                    <div className="text-red-400 font-bold">{formatUnits(selectedSnap.totalCallOI)}</div>
                  </div>
                  <div className="bg-[#0A0F1C] p-2 rounded border border-[#1F2937]">
                    <span className="text-[10px] text-gray-500">TOTAL PUT OI</span>
                    <div className="text-brand-green font-bold">{formatUnits(selectedSnap.totalPutOI)}</div>
                  </div>
                </div>

                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-2">
                  Key ATM Strikes Structure:
                </div>

                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs font-mono text-center">
                    <thead className="bg-[#0A0F1C] text-[10px] text-gray-500 uppercase sticky top-0">
                      <tr>
                        <th className="py-2 px-1 text-red-400">CE Premium</th>
                        <th className="py-2 px-1 text-red-400">CE OI</th>
                        <th className="py-2 px-1 text-yellow-400">Strike</th>
                        <th className="py-2 px-1 text-brand-green">PE OI</th>
                        <th className="py-2 px-1 text-brand-green">PE Premium</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2937]">
                      {selectedSnap.rows.slice(0, 15).map((r, idx) => {
                        const isAtm = Math.abs(r.strike - selectedSnap.spotPrice) < 25;
                        return (
                          <tr key={idx} className={isAtm ? 'bg-yellow-400/10 font-bold' : 'hover:bg-[#1F2937]/30'}>
                            <td className="py-1.5 text-red-400">₹{r.ce.price}</td>
                            <td className="py-1.5 text-gray-300">{formatUnits(r.ce.oi)}</td>
                            <td className={`py-1.5 font-bold ${isAtm ? 'text-yellow-400 underline' : 'text-white'}`}>{r.strike}</td>
                            <td className="py-1.5 text-gray-300">{formatUnits(r.pe.oi)}</td>
                            <td className="py-1.5 text-brand-green">₹{r.pe.price}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-gray-500 text-xs">
                Click on any recorded timestamp on the left table to inspect the detailed option chain strike breakdown.
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#1F2937] text-[11px] text-gray-400">
            Note: All recorded option chain snapshots are ready for immediate export into backtesting engines, Python pandas dataframes, or manual trade review.
          </div>
        </div>
      </div>
    </div>
  );
};
