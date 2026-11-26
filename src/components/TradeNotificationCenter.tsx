import React, { useState, useRef, useEffect } from 'react';
import { Bell, Volume2, VolumeX, X, Trash2, Radio, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import {
  TradeNotificationEvent,
  formatIstTimeWithSeconds,
  unlockAudioContext,
} from '../lib/trade-notifications';

interface TradeNotificationHeaderProps {
  notifications: TradeNotificationEvent[];
  unreadCount: number;
  wsConnected: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  desktopPermission: NotificationPermission | 'unsupported';
  onRequestDesktopPermission: () => void;
  pendingAlertsEnabled: boolean;
  onTogglePendingAlerts: () => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSendTestNotification: () => void;
  isTestingAlert: boolean;
}

export const TradeNotificationHeaderControls: React.FC<TradeNotificationHeaderProps> = ({
  notifications,
  unreadCount,
  wsConnected,
  audioEnabled,
  onToggleAudio,
  desktopPermission,
  onRequestDesktopPermission,
  pendingAlertsEnabled,
  onTogglePendingAlerts,
  onMarkAllRead,
  onClearAll,
  onSendTestNotification,
  isTestingAlert,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    };
    if (drawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [drawerOpen]);

  const handleToggleDrawer = () => {
    unlockAudioContext();
    const next = !drawerOpen;
    setDrawerOpen(next);
    if (next && unreadCount > 0) {
      onMarkAllRead();
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-2 sm:gap-3">
      {/* Live WebSocket Status Badge */}
      <div
        className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold border ${
          wsConnected
            ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
            : 'bg-amber-950/50 border-amber-500/30 text-amber-300'
        }`}
        title={wsConnected ? 'Real-time WebSocket push alerts active' : 'Reconnecting to WebSocket alert stream'}
      >
        <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
        <span>{wsConnected ? 'LIVE ALERTS' : 'RECONNECTING'}</span>
      </div>

      {/* Sound Toggle */}
      <button
        type="button"
        onClick={() => {
          unlockAudioContext();
          onToggleAudio();
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-bold transition-colors cursor-pointer ${
          audioEnabled
            ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/70'
            : 'bg-transparent border-[#1F2937] text-gray-500 hover:text-gray-300'
        }`}
        title={audioEnabled ? 'Audio chimes ON for real-time trades (click to mute)' : 'Audio chimes MUTED (click to unmute)'}
      >
        {audioEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        <span className="hidden md:inline">{audioEnabled ? 'AUDIO ON' : 'MUTED'}</span>
      </button>

      {/* Notification Bell Button */}
      <button
        type="button"
        onClick={handleToggleDrawer}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-bold transition-colors cursor-pointer ${
          drawerOpen || unreadCount > 0
            ? 'bg-blue-950/60 border-blue-500/50 text-blue-200 hover:bg-blue-900/60'
            : 'bg-[#0A0F1C] border-[#1F2937] text-gray-300 hover:text-white hover:border-gray-600'
        }`}
        title="Real-time trade notifications"
      >
        <Bell size={15} className={unreadCount > 0 ? 'animate-bounce text-brand-green' : ''} />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-green text-black text-[10px] font-extrabold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Notification Center Drawer */}
      {drawerOpen && (
        <div className="absolute right-0 top-12 w-[340px] sm:w-[420px] max-w-[95vw] bg-[#111827] border border-[#374151] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 bg-[#0A0F1C] border-b border-[#1F2937] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio size={15} className={wsConnected ? 'text-brand-green animate-pulse' : 'text-amber-400'} />
              <span className="text-xs font-extrabold text-white tracking-wider uppercase">
                Real-Time Trade Alerts
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onSendTestNotification}
                disabled={isTestingAlert}
                className="px-2 py-1 rounded text-[10px] font-bold bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/40 transition-colors cursor-pointer disabled:opacity-50"
                title="Send a live WebSocket test alert through the server to verify sound, toast, and desktop notifications"
              >
                {isTestingAlert ? 'Sending...' : 'Test Alert'}
              </button>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
                  title="Clear all notifications"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1 rounded text-gray-400 hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Notification Settings Strip */}
          <div className="px-4 py-2.5 bg-[#0D1322] border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-300 hover:text-white">
              <input
                type="checkbox"
                checked={pendingAlertsEnabled}
                onChange={onTogglePendingAlerts}
                className="accent-amber-400 cursor-pointer"
              />
              <span>Bar 0 Setup Alerts</span>
            </label>

            {desktopPermission === 'granted' ? (
              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                <CheckCircle2 size={12} />
                <span>Desktop Push ON</span>
              </span>
            ) : desktopPermission === 'denied' ? (
              <span className="flex items-center gap-1 text-amber-400" title="Enable notifications in browser site settings">
                <AlertTriangle size={12} />
                <span>Desktop Blocked</span>
              </span>
            ) : desktopPermission === 'default' ? (
              <button
                type="button"
                onClick={onRequestDesktopPermission}
                className="px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 font-bold cursor-pointer transition-colors"
              >
                Enable Desktop Push
              </button>
            ) : (
              <span className="text-gray-500">In-App Alerts Only</span>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#1F2937]">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-gray-500">
                Listening for real-time trades over WebSocket. Click <strong className="text-blue-300">Test Alert</strong> above to verify sound & push notifications.
              </div>
            ) : (
              notifications.map((ev) => {
                const isCall = ev.direction === 'CALL';
                const isClosed = ev.kind === 'TRADE_CLOSED';
                const isPending = ev.kind === 'SETUP_PENDING';
                return (
                  <div key={ev.id} className="px-4 py-3 hover:bg-[#1A2234]/70 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase shrink-0 ${
                            isPending
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : isClosed
                                ? ev.status === 'WIN' || (ev.lotPnl ?? ev.spotPnl ?? 0) > 0
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-red-500/20 text-red-300 border border-red-500/40'
                                : isCall
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-red-500/20 text-red-300 border border-red-500/40'
                          }`}
                        >
                          {isPending
                            ? `PENDING ${ev.direction}`
                            : isClosed
                              ? `EXIT ${ev.status || 'CLOSED'}`
                              : `NEW ${ev.direction}`}
                        </span>
                        {ev.optionStrike && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950/70 text-cyan-300 border border-cyan-700/50 shrink-0">
                            {ev.optionStrike} {ev.optionType || (isCall ? 'CE' : 'PE')}
                          </span>
                        )}
                        {ev.source === 'TEST' && (
                          <span className="text-[9px] px-1 rounded bg-blue-950 text-blue-300 border border-blue-700/50">
                            TEST
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 flex items-center gap-1 shrink-0">
                        <Clock size={10} />
                        {formatIstTimeWithSeconds(ev.timestamp)} IST
                      </span>
                    </div>

                    <div className="text-xs text-gray-200 font-semibold mt-1 truncate">
                      {ev.signal}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                      <span>Spot: <strong className="text-gray-200">{ev.entryPrice.toFixed(2)}</strong></span>
                      {isClosed && ev.exitPrice !== undefined && (
                        <span>Exit: <strong className="text-gray-200">{ev.exitPrice.toFixed(2)}</strong></span>
                      )}
                      {!isClosed && ev.stoploss !== undefined && (
                        <span>SL: <strong className="text-red-400">{ev.stoploss.toFixed(1)}</strong></span>
                      )}
                      {!isClosed && ev.target !== undefined && (
                        <span>TP: <strong className="text-emerald-400">{ev.target.toFixed(1)}</strong></span>
                      )}
                      {ev.optionEntryPremium !== undefined && (
                        <span>
                          Prem: <strong className="text-cyan-300">
                            ₹{ev.optionEntryPremium.toFixed(2)}
                            {ev.optionExitPremium !== undefined ? ` → ₹${ev.optionExitPremium.toFixed(2)}` : ''}
                          </strong>
                        </span>
                      )}
                      {isClosed && ev.lotPnl !== undefined && (
                        <span className={ev.lotPnl >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                          {ev.lotPnl >= 0 ? '+' : ''}₹{ev.lotPnl.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface TradeToastStackProps {
  toasts: TradeNotificationEvent[];
  onDismiss: (id: string) => void;
}

export const TradeToastStack: React.FC<TradeToastStackProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2.5 w-[340px] sm:w-[390px] max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((ev) => {
        const isCall = ev.direction === 'CALL';
        const isPending = ev.kind === 'SETUP_PENDING';
        const isClosed = ev.kind === 'TRADE_CLOSED';
        const isWin = isClosed && (ev.status === 'WIN' || (ev.lotPnl ?? ev.spotPnl ?? 0) > 0);
        const isLoss = isClosed && (ev.status === 'LOSS' || (ev.lotPnl ?? ev.spotPnl ?? 0) < 0);

        const borderClass = isPending
          ? 'border-amber-500/70 bg-[#1A160A]/95'
          : isClosed
            ? isWin
              ? 'border-emerald-500/70 bg-[#0B1E18]/95'
              : isLoss
                ? 'border-red-500/70 bg-[#1F0E12]/95'
                : 'border-cyan-500/70 bg-[#0D1A24]/95'
            : isCall
              ? 'border-emerald-400/80 bg-[#0A1F18]/95'
              : 'border-red-400/80 bg-[#200D11]/95';

        return (
          <div
            key={ev.id}
            className={`pointer-events-auto rounded-xl border-2 p-3.5 shadow-2xl backdrop-blur-md text-xs font-mono transition-all ${borderClass}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isCall ? (
                  <TrendingUp size={16} className="text-emerald-400 shrink-0" />
                ) : (
                  <TrendingDown size={16} className="text-red-400 shrink-0" />
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-extrabold text-white tracking-wide uppercase">
                    {isPending
                      ? `Pending ${ev.direction}`
                      : isClosed
                        ? `Trade ${ev.status || 'Closed'}`
                        : `Live ${ev.direction} Trade`}
                  </span>
                  {ev.optionStrike && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-cyan-950/90 text-cyan-300 border border-cyan-600/60">
                      {ev.optionStrike} {ev.optionType || (isCall ? 'CE' : 'PE')}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(ev.id)}
                className="text-gray-400 hover:text-white p-0.5 cursor-pointer shrink-0"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-1.5 text-gray-200 font-semibold">{ev.signal}</div>

            <div className="mt-2 grid grid-cols-3 gap-1.5 bg-black/35 rounded-lg p-2 text-[11px]">
              <div>
                <div className="text-[9px] text-gray-400 uppercase">{isClosed ? 'Entry → Exit' : 'Entry Spot'}</div>
                <div className="font-bold text-white">
                  {isClosed && ev.exitPrice !== undefined
                    ? `${ev.entryPrice.toFixed(0)}→${ev.exitPrice.toFixed(0)}`
                    : ev.entryPrice.toFixed(2)}
                </div>
              </div>
              {isClosed ? (
                <>
                  <div>
                    <div className="text-[9px] text-gray-400 uppercase">Spot P&L</div>
                    <div className={`font-bold ${(ev.spotPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {ev.spotPnl !== undefined ? `${ev.spotPnl >= 0 ? '+' : ''}${ev.spotPnl.toFixed(1)} pt` : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-400 uppercase">1 Lot P&L</div>
                    <div className={`font-bold ${(ev.lotPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {ev.lotPnl !== undefined
                        ? `${ev.lotPnl >= 0 ? '+' : ''}₹${ev.lotPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                        : ev.exitReason || '-'}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-[9px] text-gray-400 uppercase">Stoploss</div>
                    <div className="font-bold text-red-400">
                      {ev.stoploss !== undefined ? ev.stoploss.toFixed(1) : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-400 uppercase">Target</div>
                    <div className="font-bold text-emerald-400">
                      {ev.target !== undefined ? ev.target.toFixed(1) : 'Trail'}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
              <span>
                {ev.optionEntryPremium !== undefined
                  ? `Opt Prem: ₹${ev.optionEntryPremium.toFixed(2)}${ev.optionExitPremium !== undefined ? ` → ₹${ev.optionExitPremium.toFixed(2)}` : ''}`
                  : ev.message || 'Real-time WebSocket Alert'}
              </span>
              <span className="text-brand-green font-bold">
                {formatIstTimeWithSeconds(ev.timestamp)} IST
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
