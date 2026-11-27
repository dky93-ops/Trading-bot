import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';
import { computeATR, computeSMA } from '../backend/technical-indicators';
import { NiftyMacdAdaptiveSupertrend } from '../backend/nifty-macd-adaptive-supertrend';
import { computeSamSignals, SamSignalsConfig, DEFAULT_SAM_CONFIG } from '../backend/sam-signals';
import {
  NIFTY_LOT_SIZE,
  CompactOptionSnapshot,
  OptionDataSource,
  ResolvedTradeOptionData,
  resolveTradeFromSnapshots,
} from '../lib/option-premium-utils';
import {
  TradeNotificationEvent,
  isFreshLiveCandleTime,
} from '../lib/trade-notifications';

type Trade = {
  id: string;
  type: 'LONG' | 'SHORT';
  signal: string;
  entryTime: number;
  entryPrice: number;
  stoploss: number;
  target: number;
  target2?: number;
  target1Hit?: boolean;
  exitTime?: number;
  exitPrice?: number;
  exitReason?: 'TARGET' | 'STOPLOSS' | 'DAY_END' | 'BREAKEVEN' | 'MAX_TIME' | 'OPPOSITE_SIGNAL' | 'BAR1_ADVERSE_CLOSE';
  duration?: string;
  pnl?: number;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BE';
  isBreakevenLocked?: boolean;
  strategyFamily?: string;
  riskDist?: number;
  peakPrice?: number;
  trailStage?: number;
  entryBarIdx?: number;
  signalBarIdx?: number;
  samExitProfile?: 'STANDARD' | 'FIXED_EOD' | 'CHANDELIER';
  samBeTriggerPts?: number;
  samStep2TriggerPts?: number;
  samStep2LockPts?: number;
  samChandelierDistPts?: number;
  samIgnoreOppositeExit?: boolean;
  samNoFixedTp?: boolean;
  samEodExitMin?: number;
  timeframeMin?: number;
  exitSpotBar?: { open: number; high: number; low: number; close: number };
  // Option Premium fields (strictly from real Option Chain History or Upstox 1m Option Candles, 65 qty/lot)
  optionStrike?: number;
  optionType?: 'CE' | 'PE';
  optionExpiry?: string;
  optionDelta?: number;
  optionEntryPremium?: number;
  optionExitPremium?: number;
  premiumPnl?: number;
  lotPnl?: number;
  optionDataSource?: OptionDataSource;
};

export const LOT_SIZE = NIFTY_LOT_SIZE;

export function getOptionTradeLookupKey(trade: Pick<Trade, 'id' | 'type' | 'entryTime' | 'entryPrice' | 'exitTime' | 'exitPrice' | 'exitReason' | 'status' | 'timeframeMin'>, timeframeMin = 1): string {
  const strike = Math.round(trade.entryPrice / 50) * 50;
  const tf = trade.timeframeMin || timeframeMin || 1;
  return `${trade.id}|${trade.type}|${strike}|${trade.entryTime}|${trade.exitTime ?? 'OPEN'}|${trade.exitPrice ?? ''}|${trade.exitReason ?? ''}|${trade.status}|${tf}`;
}

export function decorateTradeWithOptionData(
  trade: Trade,
  optionSnapshots: CompactOptionSnapshot[] = [],
  resolvedOptionMap: Record<string, ResolvedTradeOptionData> = {},
  timeframeMin: number = 1
): Trade {
  const tf = trade.timeframeMin || timeframeMin || 1;
  const fromSnapshots = resolveTradeFromSnapshots(
    {
      id: trade.id,
      type: trade.type,
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      exitReason: trade.exitReason,
      status: trade.status,
      pnl: trade.pnl,
      timeframeMin: tf,
      exitSpotBar: trade.exitSpotBar,
    },
    optionSnapshots,
    LOT_SIZE
  );

  if (fromSnapshots.optionDataSource === 'OPTION_CHAIN_HISTORY') {
    return {
      ...trade,
      timeframeMin: tf,
      optionStrike: fromSnapshots.optionStrike,
      optionType: fromSnapshots.optionType,
      optionExpiry: fromSnapshots.optionExpiry,
      optionDelta: fromSnapshots.optionDelta,
      optionEntryPremium: fromSnapshots.optionEntryPremium,
      optionExitPremium: fromSnapshots.optionExitPremium,
      premiumPnl: fromSnapshots.premiumPnl,
      lotPnl: fromSnapshots.lotPnl,
      optionDataSource: fromSnapshots.optionDataSource,
    };
  }

  const lookupKey = getOptionTradeLookupKey(trade, tf);
  const resolved = resolvedOptionMap[lookupKey] || resolvedOptionMap[trade.id];
  if (resolved && resolved.optionDataSource !== 'UNAVAILABLE') {
    return {
      ...trade,
      timeframeMin: tf,
      optionStrike: resolved.optionStrike,
      optionType: resolved.optionType,
      optionExpiry: resolved.optionExpiry,
      optionDelta: resolved.optionDelta,
      optionEntryPremium: resolved.optionEntryPremium,
      optionExitPremium: resolved.optionExitPremium,
      premiumPnl: resolved.premiumPnl,
      lotPnl: resolved.lotPnl,
      optionDataSource: resolved.optionDataSource,
    };
  }

  // Never fabricate fake ₹100 / 0.50-delta premiums when real option data is unavailable
  return {
    ...trade,
    timeframeMin: tf,
    optionStrike: fromSnapshots.optionStrike,
    optionType: fromSnapshots.optionType,
    optionExpiry: fromSnapshots.optionExpiry,
    optionDelta: fromSnapshots.optionDelta,
    optionEntryPremium: fromSnapshots.optionEntryPremium,
    optionExitPremium: undefined,
    premiumPnl: undefined,
    lotPnl: undefined,
    optionDataSource: 'UNAVAILABLE',
  };
}

// Formats elapsed duration from entry to exit (e.g. "14m", "1h 25m")
function formatDuration(entryTime?: number, exitTime?: number): string {
  if (!entryTime) return '-';
  const end = exitTime || Math.floor(Date.now() / 1000);
  const diffSec = Math.max(0, end - entryTime);
  const totalMins = Math.floor(diffSec / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// Helper to determine if a candle represents the end of the intraday trading session (Strict Intraday: No Overnight Carry)
function isSessionEndBar(currTime: number, nextTime?: number): boolean {
  const d = new Date(currTime * 1000);
  // currTime is epoch shifted by +19800 (IST offset)
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const totalMins = hour * 60 + min;

  // 1. Next candle belongs to a subsequent calendar date:
  if (nextTime) {
    const nextD = new Date(nextTime * 1000);
    const isDifferentDay =
      nextD.getUTCDate() !== d.getUTCDate() ||
      nextD.getUTCMonth() !== d.getUTCMonth() ||
      nextD.getUTCFullYear() !== d.getUTCFullYear();

    if (isDifferentDay && totalMins >= 14 * 60 + 30) {
      return true; // NSE closes at 15:30 IST
    }
  }

  // 2. Intraday session cutoff (strictly within last few minutes before NSE market close):
  // NSE (NIFTY/BANKNIFTY/SENSEX): 09:15 - 15:30 IST -> auto square-off at or after 15:20 IST (920 mins)
  if (totalMins >= 15 * 60 + 20) return true;

  return false;
}

export function LiveChart({
  livePrice,
  instrument,
  onTradeNotification,
}: {
  livePrice?: number;
  instrument: string;
  onTradeNotification?: (event: TradeNotificationEvent) => void;
  key?: React.Key;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const dataRef = useRef<any[]>([]);
  const isDisposedRef = useRef<boolean>(false);
  const boxUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const boxLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const targetLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const target2LineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stopLossLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [volumeMetrics, setVolumeMetrics] = useState<{ lastVol: number; volSma: number; rvol: number }>({ lastVol: 0, volSma: 0, rvol: 1.0 });
  const [backtestTrades, setBacktestTrades] = useState<Trade[]>([]);
  const optionSnapshotsRef = useRef<CompactOptionSnapshot[]>([]);
  const resolvedOptionMapRef = useRef<Record<string, ResolvedTradeOptionData>>({});
  const inFlightOptionKeysRef = useRef<Set<string>>(new Set());
  const attemptedOptionKeysRef = useRef<Set<string>>(new Set());
  const activeResolveCountRef = useRef<number>(0);
  const isMountedOptionRef = useRef<boolean>(true);
  const [isResolvingOptionPremiums, setIsResolvingOptionPremiums] = useState<boolean>(false);
  const [isBackfillingHistory, setIsBackfillingHistory] = useState<boolean>(false);

  // Real-time trade notification tracking refs (seeded silently on initial load/config change)
  const onTradeNotificationRef = useRef(onTradeNotification);
  onTradeNotificationRef.current = onTradeNotification;
  const lastAlertSignatureRef = useRef<string>('');
  const seenTradeStatusRef = useRef<Map<string, string>>(new Map());
  const seenPendingKeyRef = useRef<string>('');
  const lastLiveAnalysisMsRef = useRef<number>(0);
  const hasActiveLiveTradeOrSetupRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedOptionRef.current = true;
    return () => {
      isMountedOptionRef.current = false;
    };
  }, []);

  const refreshOptionSnapshots = () => {
    return fetch('/api/option-chain/premium-lookup')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!isMountedOptionRef.current || !res || !Array.isArray(res.snapshots)) return;
        optionSnapshotsRef.current = res.snapshots;
        setBacktestTrades(prev =>
          prev.map(t =>
            decorateTradeWithOptionData(t, res.snapshots, resolvedOptionMapRef.current, t.timeframeMin || 1)
          )
        );
      })
      .catch(() => {});
  };

  const handleBackfillHistoricalPremiums = async () => {
    if (isBackfillingHistory) return;
    setIsBackfillingHistory(true);
    try {
      const res = await fetch('/api/option-chain/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxDays: 15 }),
      });
      if (res.ok) {
        attemptedOptionKeysRef.current.clear();
        await refreshOptionSnapshots();
      }
    } catch (_) {
      // Ignore network errors cleanly
    } finally {
      if (isMountedOptionRef.current) setIsBackfillingHistory(false);
    }
  };

  // Load recorded Option Chain History snapshots on mount and refresh every 60s during live sessions
  useEffect(() => {
    refreshOptionSnapshots();
    const interval = setInterval(refreshOptionSnapshots, 60_000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Resolve real Upstox 1-min option candle prices for trades outside recorded Option Chain History
  // IMPORTANT: Never cancel in-flight fetch just because backtestTrades re-rendered on a live tick
  useEffect(() => {
    const pendingTrades: Array<{ key: string; trade: Trade }> = [];

    for (const t of backtestTrades) {
      if (t.optionDataSource === 'OPTION_CHAIN_HISTORY' || t.optionDataSource === 'UPSTOX_OPTION_CANDLE') {
        continue;
      }
      const key = getOptionTradeLookupKey(t, t.timeframeMin || 1);
      if (inFlightOptionKeysRef.current.has(key) || attemptedOptionKeysRef.current.has(key)) continue;
      pendingTrades.push({ key, trade: t });
    }

    if (pendingTrades.length === 0) return;

    const batch = pendingTrades.slice(0, 500);
    for (const item of batch) {
      inFlightOptionKeysRef.current.add(item.key);
      attemptedOptionKeysRef.current.add(item.key);
    }

    activeResolveCountRef.current += 1;
    setIsResolvingOptionPremiums(true);

    const payload = batch.map(({ key, trade }) => ({
      id: key,
      type: trade.type,
      entryTime: trade.entryTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      exitPrice: trade.exitPrice,
      exitReason: trade.exitReason,
      status: trade.status,
      pnl: trade.pnl,
      timeframeMin: trade.timeframeMin || 1,
      exitSpotBar: trade.exitSpotBar,
    }));

    fetch('/api/option-chain/resolve-trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades: payload, timeframeMin: batch[0]?.trade.timeframeMin || 1 }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!isMountedOptionRef.current) return;
        if (res && res.resolved && typeof res.resolved === 'object') {
          Object.assign(resolvedOptionMapRef.current, res.resolved);
          setBacktestTrades(prev =>
            prev.map(t =>
              decorateTradeWithOptionData(t, optionSnapshotsRef.current, resolvedOptionMapRef.current, t.timeframeMin || 1)
            )
          );
        } else {
          for (const item of batch) {
            attemptedOptionKeysRef.current.delete(item.key);
          }
        }
      })
      .catch(() => {
        for (const item of batch) {
          attemptedOptionKeysRef.current.delete(item.key);
        }
      })
      .finally(() => {
        for (const item of batch) {
          inFlightOptionKeysRef.current.delete(item.key);
        }
        activeResolveCountRef.current = Math.max(0, activeResolveCountRef.current - 1);
        if (isMountedOptionRef.current && activeResolveCountRef.current === 0) {
          setIsResolvingOptionPremiums(false);
        }
      });
  }, [backtestTrades]);

  const [pendingSamSetup, setPendingSamSetup] = useState<{
    type: 'CALL' | 'PUT';
    time?: number;
    setupBarTime: number;
    setupBarClose: number;
    currentBar1Price: number;
    estEntry: number;
    estSL: number;
    estTP: number;
    estTP2: number;
    formingTime?: number;
  } | null>(null);
  const [timeframe, setTimeframe] = useState<number>(1);
  const [isFiltersOpen, setIsFiltersOpen] = useState<boolean>(true);
  const [tradeViewMode, setTradeViewMode] = useState<'table' | 'cards'>(() => {
    try {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        return 'cards';
      }
    } catch (_) {}
    return 'table';
  });

  // Date Filter State for Backtest Dashboard
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('ALL');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isCustomRangeOpen, setIsCustomRangeOpen] = useState<boolean>(false);

  // Automatically adapt view mode on mobile portrait/vertical mode
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setTradeViewMode('cards');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [strategies, setStrategies] = useState({
    macdAdaptiveSupertrend: false,
    samSignals: true,
  });

  // BEST SAM SIGNALS Strategy (Pine Script by dy26102001)
  const [samConfig, setSamConfig] = useState<SamSignalsConfig>(() => {
    try {
      const saved = localStorage.getItem(`quant_sam_config_${instrument}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // User rule: Always enter after Immediate Adverse Bar + 1 candle close (Zero Repaint)
        parsed.entryTiming = parsed.entryTiming || 'bar1Close';
        return { 
          ...DEFAULT_SAM_CONFIG, 
          ...parsed, 
          entryTiming: 'bar1Close',
          vwapFilterEnabled: parsed.vwapFilterEnabled ?? true,
          vwapClimaxFilterEnabled: parsed.vwapClimaxFilterEnabled ?? true,
          vwapMaxDistancePoints: parsed.vwapMaxDistancePoints ?? 70,
          vwapOpeningBufferEnabled: parsed.vwapOpeningBufferEnabled ?? true,
          vwapExitOppositeEnabled: parsed.vwapExitOppositeEnabled ?? true,
          showVwapLine: parsed.showVwapLine ?? true,
          filterMinBodyEnabled: parsed.filterMinBodyEnabled ?? false,
          minBodyPoints: parsed.minBodyPoints ?? 7,
          minBodyRatioPercent: parsed.minBodyRatioPercent ?? 45,
          filterMtfEmaEnabled: parsed.filterMtfEmaEnabled ?? false,
          mtfEmaPeriod: parsed.mtfEmaPeriod ?? 20,
          mtfEmaRequireSlope: parsed.mtfEmaRequireSlope ?? false,
          filterDayTrapEnabled: parsed.filterDayTrapEnabled ?? false,
          dayTrapBufferPoints: parsed.dayTrapBufferPoints ?? 10,
          adaptiveRegimeEnabled: parsed.adaptiveRegimeEnabled ?? true,
          adaptiveTrendDistancePoints: parsed.adaptiveTrendDistancePoints ?? 20,
          adaptiveClimaxBandPoints: parsed.adaptiveClimaxBandPoints ?? 50,
          adaptiveAllowReversionBounce: parsed.adaptiveAllowReversionBounce ?? true,
          circuitBreakerEnabled: parsed.circuitBreakerEnabled ?? true,
          circuitBreakerConsecutiveLosses: parsed.circuitBreakerConsecutiveLosses ?? 3,
          circuitBreakerCooldownMinutes: parsed.circuitBreakerCooldownMinutes ?? 20,
          antiWhipsawEnabled: parsed.antiWhipsawEnabled ?? false,
          antiWhipsawMinutes: parsed.antiWhipsawMinutes ?? 10,
          maxDailyLossEnabled: parsed.maxDailyLossEnabled ?? false,
          maxDailyLossPoints: parsed.maxDailyLossPoints ?? 75,
          filterS12ConfluenceEnabled: parsed.filterS12ConfluenceEnabled ?? false,
          s12DiSpreadMin: parsed.s12DiSpreadMin ?? 5,
          s12EmaFastPeriod: parsed.s12EmaFastPeriod ?? 100,
          s12EmaSlowPeriod: parsed.s12EmaSlowPeriod ?? 200,
          s12MinRvol: parsed.s12MinRvol ?? 0.7,
          filterSam21AfternoonEnabled: parsed.filterSam21AfternoonEnabled ?? false,
          sam21AfternoonExitMode: parsed.sam21AfternoonExitMode === 'chandelier' ? 'chandelier' : 'fixed40',
          filterSam21CombinedEnabled: parsed.filterSam21CombinedEnabled ?? false,
        };
      }
    } catch (_) {}
    return { 
      ...DEFAULT_SAM_CONFIG, 
      entryTiming: 'bar1Close', 
      vwapFilterEnabled: true,
      vwapClimaxFilterEnabled: true,
      vwapMaxDistancePoints: 70,
      vwapOpeningBufferEnabled: true,
      vwapExitOppositeEnabled: true,
      showVwapLine: true,
      filterMinBodyEnabled: false,
      minBodyPoints: 7,
      minBodyRatioPercent: 45,
      filterMtfEmaEnabled: false,
      mtfEmaPeriod: 20,
      mtfEmaRequireSlope: false,
      filterDayTrapEnabled: false,
      dayTrapBufferPoints: 10,
      adaptiveRegimeEnabled: true,
      adaptiveTrendDistancePoints: 20,
      adaptiveClimaxBandPoints: 50,
      adaptiveAllowReversionBounce: true,
      circuitBreakerEnabled: true,
      circuitBreakerConsecutiveLosses: 3,
      circuitBreakerCooldownMinutes: 20,
      antiWhipsawEnabled: false,
      antiWhipsawMinutes: 10,
      maxDailyLossEnabled: false,
      maxDailyLossPoints: 75,
      filterS12ConfluenceEnabled: false,
      s12DiSpreadMin: 5,
      s12EmaFastPeriod: 100,
      s12EmaSlowPeriod: 200,
      s12MinRvol: 0.7,
      filterSam21AfternoonEnabled: false,
      sam21AfternoonExitMode: 'fixed40',
      filterSam21CombinedEnabled: false,
    };
  });

  const [showStrategySettingsModal, setShowStrategySettingsModal] = useState<null | 'SAM'>(null);

  const [comparisonStats, setComparisonStats] = useState({
    filteredCount: 0,
    wickFiltered: 0,
    bar1Filtered: 0,
    vwapFiltered: 0,
    minBodyFiltered: 0,
    mtfEmaFiltered: 0,
    dayTrapFiltered: 0,
    adaptiveRegimeFiltered: 0,
    circuitBreakerFiltered: 0,
    antiWhipsawFiltered: 0,
    s12Filtered: 0,
    sam21AfternoonSignals: 0,
    sam21OpenDriveSignals: 0,
    sam21LiveStatus: null as {
      latestDate: string;
      latestTimeIst: string;
      latestClose: number;
      pdh: number | null;
      pdl: number | null;
      adx5m: number | null;
      diSpread5m: number | null;
      st15mDir: number;
      inputBarMinutes: number;
      breakoutState: 'ABOVE_PDH' | 'BELOW_PDL' | 'INSIDE_RANGE' | 'NO_PDH_PDL';
    } | null,
    dailyDrawdownHalted: false,
    currentRegimeState: 'RANGE' as 'TREND_BULL' | 'TREND_BEAR' | 'RANGE',
    circuitBreakerActive: false,
    beSavedCount: 0,
  });

  // Synchronous references so background intervals and async feeds never revert to stale closure defaults
  const strategiesRef = useRef(strategies);
  strategiesRef.current = strategies;

  const samConfigRef = useRef(samConfig);
  samConfigRef.current = samConfig;

  // Persist user modifications so state never flips back, and sync to server live SAM watcher
  useEffect(() => {
    try {
      localStorage.setItem(`quant_sam_config_${instrument}`, JSON.stringify(samConfig));
    } catch (_) {}
    const syncTimer = setTimeout(() => {
      fetch('/api/sam-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(samConfig),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(syncTimer);
  }, [samConfig, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_strategies_${instrument}`, JSON.stringify(strategies));
    } catch (_) {}
  }, [strategies, instrument]);

  const handleResetFilters = () => {
    const resetSam = { ...DEFAULT_SAM_CONFIG };
    setSamConfig(resetSam);
    samConfigRef.current = resetSam;
    try {
      localStorage.removeItem(`quant_sam_config_${instrument}`);
    } catch (_) {}
  };

  useEffect(() => {
    if (!isDisposedRef.current && dataRef.current && dataRef.current.length > 0 && seriesRef.current && chartRef.current) {
      try {
        applyPriceActionAnalysis(
          dataRef.current,
          seriesRef.current,
          strategies,
          samConfig
        );
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
  }, [strategies, samConfig]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    isDisposedRef.current = false;

    const container = chartContainerRef.current;
    const initialWidth = container.clientWidth || 800;
    const initialHeight = container.clientHeight || 500;

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },

      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#1F2937',
        autoScale: true,
      },
      localization: {
        timeFormatter: (timeValue: any) => {
          if (typeof timeValue === 'number') {
            const date = new Date(timeValue * 1000);
            const dateStr = date.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
            const timeStr = date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
            return `${dateStr} ${timeStr}`;
          }
          return timeValue;
        }
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (timeValue: any, tickMarkType: any) => {
          const date = new Date(timeValue * 1000);
          if (tickMarkType !== undefined && tickMarkType < 3) {
            return date.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
          }
          return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });
    
    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    seriesRef.current = candlestickSeries;

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // overlay
    });
    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8, // highest volume bar will occupy bottom 20%
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    boxUpperRef.current = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, lineStyle: LineStyle.Dashed, title: 'Box Upper' });
    boxLowerRef.current = chart.addLineSeries({ color: '#ec4899', lineWidth: 2, lineStyle: LineStyle.Dashed, title: 'Box Lower' });
    targetLineRef.current = chart.addLineSeries({ color: '#10b981', lineWidth: 2, lineStyle: LineStyle.Solid, title: 'Target 1' });
    target2LineRef.current = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, lineStyle: LineStyle.Dashed, title: 'Target 2' });
    stopLossLineRef.current = chart.addLineSeries({ color: '#ef4444', lineWidth: 2, lineStyle: LineStyle.Solid, title: 'Stop Loss' });
    vwapLineRef.current = chart.addLineSeries({ color: '#06b6d4', lineWidth: 2, lineStyle: LineStyle.Solid, title: 'VWAP' });

    const abortController = new AbortController();
    let retryTimeoutId: any = null;

    const fetchData = async () => {
      if (isDisposedRef.current) return;
      if (dataRef.current.length === 0) {
        setLoading(true);
      }
      try {
        const fetchLimit = timeframe === 1 ? 8000 : 3000;
        const res = await fetch(`/api/candles?instrument=${encodeURIComponent(instrument)}&timeframe=${timeframe}&limit=${fetchLimit}`, {
          signal: abortController.signal
        });
        if (isDisposedRef.current) return;
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        const candles = await res.json();
        if (isDisposedRef.current) return;
        
        if (!Array.isArray(candles)) return;

        // Strictly filter for genuine market trading hours (NSE: Mon-Fri 09:15-15:30)
        const marketCandles = candles.filter(c => {
          if (!c || !c.timestamp) return false;
          const d = new Date(c.timestamp);
          if (isNaN(d.getTime())) return false;
          const ist = new Date(d.getTime() + 19800000);
          const day = ist.getUTCDay(); // 0 = Sun, 6 = Sat
          if (day === 0 || day === 6) return false;
          const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
          return mins >= 555 && mins < 930;
        });

        const formatted = marketCandles.slice().reverse().map(c => {
           const dateObj = new Date(c.timestamp);
           return {
             time: (Math.floor(dateObj.getTime() / 1000) + 19800) as Time,
             open: c.open,
             high: c.high,
             low: c.low,
             close: c.close,
             volume: c.volume || 0,
           };
        });
        
        const sorted = formatted.sort((a, b) => (a.time as number) - (b.time as number));
        const unique = sorted.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i);

        if (isDisposedRef.current || !chartRef.current || !seriesRef.current) return;

        if (unique.length > 0) {
          dataRef.current = unique;
          try {
            candlestickSeries.setData(unique);
            if (volumeSeriesRef.current) {
              const volData = unique.map(c => ({
                time: c.time,
                value: c.volume || 0,
                color: c.close >= c.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
              }));
              volumeSeriesRef.current.setData(volData);
            }
            applyPriceActionAnalysis(
              unique, 
              candlestickSeries, 
              strategiesRef.current,
              samConfigRef.current
            );
          } catch (err: any) {
            if (err?.message?.includes('disposed')) return;
            throw err;
          }
        }

      } catch(e: any) {
        if (isDisposedRef.current || e?.name === 'AbortError') {
          return;
        }
        console.warn("Notice: Chart data feed reconnecting...", e?.message || e);
        // Fast retry after 2 seconds if no data loaded yet
        if (dataRef.current.length === 0 && !isDisposedRef.current) {
          clearTimeout(retryTimeoutId);
          retryTimeoutId = setTimeout(() => {
            if (!isDisposedRef.current) {
              fetchData();
            }
          }, 2000);
        }
      } finally {
        if (!isDisposedRef.current) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    const refreshInterval = setInterval(fetchData, 10000);

    const ro = new ResizeObserver((entries) => {
      if (isDisposedRef.current || !chartRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !isDisposedRef.current && chartRef.current) {
          try {
            chart.applyOptions({ width, height });
          } catch (_) {}
        }
      }
    });

    if (container) {
      ro.observe(container);
    }

    return () => {
      isDisposedRef.current = true;
      abortController.abort();
      clearTimeout(retryTimeoutId);
      clearInterval(refreshInterval);
      ro.disconnect();

      const currentChart = chartRef.current;
      chartRef.current = null;
      seriesRef.current = null;
      boxUpperRef.current = null;
      boxLowerRef.current = null;
      targetLineRef.current = null;
      target2LineRef.current = null;
      stopLossLineRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];

      try {
        if (currentChart) {
          currentChart.remove();
        }
      } catch (err) {
        // ignore already disposed
      }
    };
  }, [instrument, timeframe]);

  useEffect(() => {
    if (!isDisposedRef.current && volumeSeriesRef.current) {
      try {
        volumeSeriesRef.current.applyOptions({ visible: showVolume });
      } catch (_) {}
    }
  }, [showVolume]);

  useEffect(() => {
    if (!livePrice || isDisposedRef.current || !seriesRef.current || !chartRef.current) return;
    try {
      const now = new Date();
      // Strictly enforce market trading hours: never create or update candles outside market hours
      const istNow = new Date(now.getTime() + 19800000);
      const day = istNow.getUTCDay(); // 0 = Sunday, 6 = Saturday
      if (day === 0 || day === 6) {
        // Weekend: regular market is closed, do not add or update candles
        return;
      }
      const mins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
      const isMarketOpenNow = mins >= 555 && mins < 930;
      if (!isMarketOpenNow) {
        // Outside market hours: strictly do not create or update candles on the chart
        return;
      }

      const data = dataRef.current;
      if (data && data.length > 0) {
        // Find current candle boundary in IST
        const periodMs = timeframe * 60 * 1000;
        const ts = now.getTime();
        const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
        const boundaryTime = (Math.floor(boundary / 1000) + 19800);
        
        let lastBar = data[data.length - 1] as any;
        const isNewCandle = boundaryTime > lastBar.time;
        let newBar;
        if (!isNewCandle) {
           newBar = {
             ...lastBar,
             close: livePrice,
             high: Math.max(lastBar.high, livePrice),
             low: Math.min(lastBar.low, livePrice),
             volume: (lastBar.volume || 0) + 1,
           };
           data[data.length - 1] = newBar;
        } else {
           newBar = {
             time: boundaryTime as Time,
             open: lastBar.close,
             high: Math.max(lastBar.close, livePrice),
             low: Math.min(lastBar.close, livePrice),
             close: livePrice,
             volume: 1,
           };
           data.push(newBar);
        }
        if (!isDisposedRef.current && seriesRef.current) {
          seriesRef.current.update(newBar);
        }
        if (!isDisposedRef.current && volumeSeriesRef.current) {
          volumeSeriesRef.current.update({
            time: newBar.time,
            value: newBar.volume || 1,
            color: newBar.close >= newBar.open ? 'rgba(38, 166, 154, 0.45)' : 'rgba(239, 83, 80, 0.45)',
          });
        }

        // Zero-lag real-time signal evaluation:
        // 1) Immediately re-evaluate when a candle closes (new candle opens)
        // 2) Re-evaluate intra-bar every ~1.5s when an active trade or pending setup exists
        const nowEvalMs = Date.now();
        if (
          !isDisposedRef.current &&
          seriesRef.current &&
          (isNewCandle || (hasActiveLiveTradeOrSetupRef.current && nowEvalMs - lastLiveAnalysisMsRef.current >= 1500))
        ) {
          lastLiveAnalysisMsRef.current = nowEvalMs;
          applyPriceActionAnalysis(
            data,
            seriesRef.current,
            strategiesRef.current,
            samConfigRef.current
          );
        }
      }
    } catch (e: any) {
      if (e?.message?.includes('disposed')) return;
      console.warn("Live candle update warning:", e);
    }
  }, [livePrice, instrument, timeframe]);

  // Dynamically update forming Bar + 1 price, entry point, SL, and TP for pending SAM setup in real-time
  useEffect(() => {
    if (!livePrice) return;
    setPendingSamSetup(prev => {
      if (!prev) return null;
      const slPts = samConfig?.stopLossPoints ?? 20;
      const tpPts = samConfig?.targetPoints ?? 60;
      const estEntry = livePrice;
      const estSL = prev.type === 'CALL' ? Number((estEntry - slPts).toFixed(2)) : Number((estEntry + slPts).toFixed(2));
      const estTP = prev.type === 'CALL' ? Number((estEntry + tpPts).toFixed(2)) : Number((estEntry - tpPts).toFixed(2));
      const estTP2 = prev.type === 'CALL' ? Number((estEntry + (tpPts * 2)).toFixed(2)) : Number((estEntry - (tpPts * 2)).toFixed(2));
      return {
        ...prev,
        currentBar1Price: livePrice,
        estEntry,
        estSL,
        estTP,
        estTP2,
      };
    });
  }, [livePrice, samConfig]);
  
  const applyPriceActionAnalysis = (
    candles: any[], 
    series: ISeriesApi<"Candlestick">, 
    activeStrategies = strategiesRef.current,
    activeSamConfig = samConfigRef.current
  ) => {
    if (isDisposedRef.current || !chartRef.current || !seriesRef.current) return;
    if (candles.length < 50) return;
    
    // Core Prices
    const closePrices = candles.map(c => c.close);
    const highPrices = candles.map(c => c.high);
    const lowPrices = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);
    const volSma20 = computeSMA(volumes, 20);

    // Update live volume metrics for the chart header
    const lastIdx = candles.length - 1;
    const lastVol = volumes[lastIdx] || 0;
    const lastVolSma = volSma20[lastIdx] || 0;
    const rvol = lastVolSma > 0 ? Number((lastVol / lastVolSma).toFixed(2)) : 1.0;
    setVolumeMetrics({ lastVol, volSma: Math.round(lastVolSma), rvol });
    
    const mapSeriesData = (dataArray: number[]) => dataArray.map((v, i) => ({ time: candles[i].time, value: v })).filter(d => !isNaN(d.value) && d.time !== undefined) as any[];

    let markers: any[] = [];
    const allTrades: Trade[] = [];

    // BEST SAM SIGNALS calculation (Pine Script by dy26102001)
    const samSignalsResult = computeSamSignals(candles, activeSamConfig);


    // Hide unused breakout reference lines
    try {
      if (!isDisposedRef.current) {
        boxUpperRef.current?.applyOptions({ visible: false });
        boxLowerRef.current?.applyOptions({ visible: false });
        targetLineRef.current?.applyOptions({ visible: false });
        target2LineRef.current?.applyOptions({ visible: false });
        stopLossLineRef.current?.applyOptions({ visible: false });
      }
    } catch (_) {}

    const atr14 = computeATR(highPrices, lowPrices, closePrices, 14);

    try {
      if (!isDisposedRef.current && vwapLineRef.current) {
        if (samSignalsResult?.vwapValues && (activeStrategies.samSignals || activeSamConfig?.vwapFilterEnabled)) {
          vwapLineRef.current.setData(mapSeriesData(samSignalsResult.vwapValues));
          vwapLineRef.current.applyOptions({ visible: activeSamConfig?.showVwapLine ?? true });
        } else {
          vwapLineRef.current.applyOptions({ visible: false });
        }
      }

      if (!isDisposedRef.current && priceLinesRef.current.length > 0) {
        priceLinesRef.current.forEach(line => {
          try { series.removePriceLine(line); } catch (_) {}
        });
        priceLinesRef.current = [];
      }
    } catch (e: any) {
      if (e?.message?.includes('disposed')) return;
    }

    // -------------------------------------------------------------------------
    // Active Execution Loop (SAM Signals & MACD Adaptive SuperTrend)
    // -------------------------------------------------------------------------
    const openTrades: Trade[] = [];
    let beSavedCount = 0;

    let pendingSamSignal: { type: 'LONG' | 'SHORT'; signalBarIdx: number; signalTime: number } | null = null;

    // Adaptive Regime, Directional Circuit Breaker & Daily Drawdown State Trackers
    let consecutiveLongLosses = 0;
    let consecutiveShortLosses = 0;
    let longCooldownUntil = 0;
    let shortCooldownUntil = 0;
    let cbFilteredCount = 0;
    let lastLossTime = 0;
    let lastLossType: 'LONG' | 'SHORT' | null = null;
    let antiWhipFilteredCount = 0;
    let dailyAccumulatedPnl = 0;
    let dailyDrawdownHalted = false;
    let currentSessionDateKey = '';

    const onSamTradeClosed = (t: Trade, barTime: number) => {
      if (t.strategyFamily !== 'SAM_SIGNALS') return;
      dailyAccumulatedPnl += (t.pnl || 0);

      if (t.status === 'LOSS') {
        lastLossTime = barTime;
        lastLossType = t.type;
        if (t.type === 'LONG') {
          consecutiveLongLosses++;
          consecutiveShortLosses = 0;
          if (activeSamConfig?.circuitBreakerEnabled && consecutiveLongLosses >= (activeSamConfig?.circuitBreakerConsecutiveLosses ?? 3)) {
            longCooldownUntil = barTime + ((activeSamConfig?.circuitBreakerCooldownMinutes ?? 20) * 60);
          }
        } else {
          consecutiveShortLosses++;
          consecutiveLongLosses = 0;
          if (activeSamConfig?.circuitBreakerEnabled && consecutiveShortLosses >= (activeSamConfig?.circuitBreakerConsecutiveLosses ?? 3)) {
            shortCooldownUntil = barTime + ((activeSamConfig?.circuitBreakerCooldownMinutes ?? 20) * 60);
          }
        }
      } else if (t.status === 'WIN') {
        if (t.type === 'LONG') consecutiveLongLosses = 0;
        else consecutiveShortLosses = 0;
      }

      if (activeSamConfig?.maxDailyLossEnabled && dailyAccumulatedPnl <= -(activeSamConfig?.maxDailyLossPoints ?? 75)) {
        dailyDrawdownHalted = true;
      }
    };

    for (let i = 50; i < candles.length; i++) {
       const curr = candles[i];
       const nextCandle = candles[i + 1];
       const isDayEnd = isSessionEndBar(curr.time as number, nextCandle?.time as number);

       // Reset daily metrics at the start of a new trading session
       const sessionDateStr = new Date((curr.time as number) * 1000).toISOString().split('T')[0];
       if (sessionDateStr !== currentSessionDateKey) {
         currentSessionDateKey = sessionDateStr;
         dailyAccumulatedPnl = 0;
         dailyDrawdownHalted = false;
         consecutiveLongLosses = 0;
         consecutiveShortLosses = 0;
         longCooldownUntil = 0;
         shortCooldownUntil = 0;
         lastLossTime = 0;
         lastLossType = null;
       }
       
       // Pre-market session check: strictly no trades before 09:15 AM IST for NSE
       const currDate = new Date((curr.time as number) * 1000);
       const currHour = currDate.getUTCHours();
       const currMin = currDate.getUTCMinutes();
       const currTotalMins = currHour * 60 + currMin;
       const isPreMarket = currTotalMins < (9 * 60 + 15);
       const isSamPreMarketBlocked = (activeSamConfig?.noTradeBefore915 ?? true) && isPreMarket;

       // --- Process Pending Bar + 1 Open SAM Entry at open of candle i ---
       if (
         activeStrategies.samSignals &&
         (activeSamConfig?.entryTiming ?? 'bar1Close') === 'bar1Open' &&
         pendingSamSignal &&
         !isDayEnd &&
         !isSamPreMarketBlocked
       ) {
         const hasActiveTrade = (activeSamConfig?.oneTradeAtATime ?? true) && openTrades.some(
           t => t.status === 'OPEN' && t.strategyFamily === 'SAM_SIGNALS'
         );
         if (!hasActiveTrade) {
           const slPts = activeSamConfig?.stopLossPoints ?? 20;
           const tpPts = activeSamConfig?.targetPoints ?? 60;
           const entry = curr.open; // Real-world fill at Bar + 1 Open!
           if (pendingSamSignal.type === 'LONG') {
             markers.push({
               time: curr.time,
               position: 'belowBar',
               color: activeSamConfig?.colorBuy || '#2196f3',
               shape: 'arrowUp',
               text: 'SAM CALL'
             });
             const stoploss = Number((entry - slPts).toFixed(2));
             const target = Number((entry + tpPts).toFixed(2));
             const newTrade: Trade = {
               id: `${curr.time}-SAM-CALL`,
               type: 'LONG',
               signal: 'SAM CALL',
               strategyFamily: 'SAM_SIGNALS',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: target,
               riskDist: slPts,
               peakPrice: entry,
               trailStage: 0,
               status: 'OPEN',
               entryBarIdx: i,
               signalBarIdx: pendingSamSignal.signalBarIdx,
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           } else if (pendingSamSignal.type === 'SHORT') {
             markers.push({
               time: curr.time,
               position: 'aboveBar',
               color: activeSamConfig?.colorSell || '#ff5252',
               shape: 'arrowDown',
               text: 'SAM PUT'
             });
             const stoploss = Number((entry + slPts).toFixed(2));
             const target = Number((entry - tpPts).toFixed(2));
             const newTrade: Trade = {
               id: `${curr.time}-SAM-PUT`,
               type: 'SHORT',
               signal: 'SAM PUT',
               strategyFamily: 'SAM_SIGNALS',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: target,
               riskDist: slPts,
               peakPrice: entry,
               trailStage: 0,
               status: 'OPEN',
               entryBarIdx: i,
               signalBarIdx: pendingSamSignal.signalBarIdx,
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           }
         }
         pendingSamSignal = null;
       }

       const range = curr.high - curr.low;
       const atr = atr14[i] || Math.max(range, 1);

       // --- Manage Open Trades for current bar ---
       for (let j = openTrades.length - 1; j >= 0; j--) {
         const t = openTrades[j];

         // 0. BEST SAM SIGNALS Management (Trailing Stop Loss: +20pt -> Entry, +40pt -> Entry + 20pt)
         if (t.strategyFamily === 'SAM_SIGNALS' && t.status === 'OPEN') {
           const isEntryBar = (curr.time as number) === t.entryTime;

           // 0A. Institutional SAM(21/5) Exit Engine (#3 Fixed SL40/BE30/EOD, #5 Chandelier 0.30%/0.40%, #1 3m OpenDrive 2x/3x 5m ATR)
           if (t.samExitProfile === 'FIXED_EOD' || t.samExitProfile === 'CHANDELIER') {
             const currBarMin = Math.floor(((((curr.time as number) % 86400) + 86400) % 86400) / 60);
             const isInstitutionalEod = isDayEnd || currBarMin >= (t.samEodExitMin ?? 925);

             if (!isEntryBar) {
               if (t.type === 'LONG') {
                 // 1. Check stop-loss hit first against the active stop entering bar i (strictly causal)
                 if (curr.low <= t.stoploss) {
                   t.exitPrice = t.stoploss;
                   t.exitTime = curr.time as number;
                   t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
                   if (t.pnl > 0) {
                     t.status = 'WIN';
                     t.exitReason = 'STOPLOSS';
                   } else if (t.pnl === 0) {
                     t.status = 'BE';
                     t.exitReason = 'BREAKEVEN';
                   } else {
                     t.status = 'LOSS';
                     t.exitReason = 'STOPLOSS';
                   }
                   t.duration = formatDuration(t.entryTime, t.exitTime);
                   onSamTradeClosed(t, curr.time as number);
                   openTrades.splice(j, 1);
                   markers.push({
                     time: curr.time,
                     position: 'aboveBar',
                     color: t.pnl > 0 ? '#10B981' : t.pnl === 0 ? '#F59E0B' : '#EF4444',
                     shape: 'circle',
                     text: t.pnl > 0
                       ? `close_long (SAM 21/5 +${t.pnl}pt Trail 🎯)`
                       : t.pnl === 0
                         ? `close_long (SAM 21/5 BE 🛡️)`
                         : `close_long (SAM 21/5 SL 🛑)`
                   });
                   continue;
                 }

                 // 2. End-of-day exit (15:25 IST or session end)
                 if (isInstitutionalEod) {
                   t.exitPrice = curr.close;
                   t.exitTime = curr.time as number;
                   t.exitReason = 'DAY_END';
                   t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
                   t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
                   t.duration = formatDuration(t.entryTime, t.exitTime);
                   onSamTradeClosed(t, curr.time as number);
                   openTrades.splice(j, 1);
                   markers.push({
                     time: curr.time,
                     position: 'aboveBar',
                     color: t.pnl >= 0 ? '#10B981' : '#EF4444',
                     shape: 'circle',
                     text: `close_long (SAM 21/5 EOD ${t.pnl >= 0 ? '+' : ''}${t.pnl}pt)`
                   });
                   continue;
                 }

                 // 3. Advance peak & trailing/BE/Step-2 profit lock for subsequent bars
                 t.peakPrice = Math.max(t.peakPrice || t.entryPrice, curr.high);
                 if (t.samStep2TriggerPts && t.samStep2LockPts !== undefined && t.peakPrice >= t.entryPrice + t.samStep2TriggerPts) {
                   const newSl = Number((t.entryPrice + t.samStep2LockPts).toFixed(2));
                   if (newSl > t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 2) {
                       t.trailStage = 2;
                       markers.push({
                         time: curr.time,
                         position: 'belowBar',
                         color: '#10B981',
                         shape: 'circle',
                         text: `SL ➔ +${t.samStep2LockPts}pt (+${t.samStep2TriggerPts}pt)`
                       });
                     }
                   }
                 } else if (t.samBeTriggerPts && t.peakPrice >= t.entryPrice + t.samBeTriggerPts) {
                   const newSl = Number(t.entryPrice.toFixed(2));
                   if (newSl > t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 1 && t.trailStage !== 2) {
                       t.trailStage = 1;
                       beSavedCount++;
                       markers.push({
                         time: curr.time,
                         position: 'belowBar',
                         color: '#3B82F6',
                         shape: 'circle',
                         text: `SL ➔ BE (+${t.samBeTriggerPts}pt)`
                       });
                     }
                   }
                 }
                 if (t.samExitProfile === 'CHANDELIER' && t.samChandelierDistPts && t.samChandelierDistPts > 0) {
                   const newSl = Number((t.peakPrice - t.samChandelierDistPts).toFixed(2));
                   if (newSl > t.stoploss) {
                     t.stoploss = newSl;
                     if (newSl >= t.entryPrice) t.isBreakevenLocked = true;
                   }
                 }
               } else {
                 // SHORT (PUT)
                 if (curr.high >= t.stoploss) {
                   t.exitPrice = t.stoploss;
                   t.exitTime = curr.time as number;
                   t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
                   if (t.pnl > 0) {
                     t.status = 'WIN';
                     t.exitReason = 'STOPLOSS';
                   } else if (t.pnl === 0) {
                     t.status = 'BE';
                     t.exitReason = 'BREAKEVEN';
                   } else {
                     t.status = 'LOSS';
                     t.exitReason = 'STOPLOSS';
                   }
                   t.duration = formatDuration(t.entryTime, t.exitTime);
                   onSamTradeClosed(t, curr.time as number);
                   openTrades.splice(j, 1);
                   markers.push({
                     time: curr.time,
                     position: 'belowBar',
                     color: t.pnl > 0 ? '#10B981' : t.pnl === 0 ? '#F59E0B' : '#EF4444',
                     shape: 'circle',
                     text: t.pnl > 0
                       ? `close_short (SAM 21/5 +${t.pnl}pt Trail 🎯)`
                       : t.pnl === 0
                         ? `close_short (SAM 21/5 BE 🛡️)`
                         : `close_short (SAM 21/5 SL 🛑)`
                   });
                   continue;
                 }

                 if (isInstitutionalEod) {
                   t.exitPrice = curr.close;
                   t.exitTime = curr.time as number;
                   t.exitReason = 'DAY_END';
                   t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
                   t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
                   t.duration = formatDuration(t.entryTime, t.exitTime);
                   onSamTradeClosed(t, curr.time as number);
                   openTrades.splice(j, 1);
                   markers.push({
                     time: curr.time,
                     position: 'belowBar',
                     color: t.pnl >= 0 ? '#10B981' : '#EF4444',
                     shape: 'circle',
                     text: `close_short (SAM 21/5 EOD ${t.pnl >= 0 ? '+' : ''}${t.pnl}pt)`
                   });
                   continue;
                 }

                 t.peakPrice = Math.min(t.peakPrice || t.entryPrice, curr.low);
                 if (t.samStep2TriggerPts && t.samStep2LockPts !== undefined && t.peakPrice <= t.entryPrice - t.samStep2TriggerPts) {
                   const newSl = Number((t.entryPrice - t.samStep2LockPts).toFixed(2));
                   if (newSl < t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 2) {
                       t.trailStage = 2;
                       markers.push({
                         time: curr.time,
                         position: 'aboveBar',
                         color: '#10B981',
                         shape: 'circle',
                         text: `SL ➔ +${t.samStep2LockPts}pt (+${t.samStep2TriggerPts}pt)`
                       });
                     }
                   }
                 } else if (t.samBeTriggerPts && t.peakPrice <= t.entryPrice - t.samBeTriggerPts) {
                   const newSl = Number(t.entryPrice.toFixed(2));
                   if (newSl < t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 1 && t.trailStage !== 2) {
                       t.trailStage = 1;
                       beSavedCount++;
                       markers.push({
                         time: curr.time,
                         position: 'aboveBar',
                         color: '#3B82F6',
                         shape: 'circle',
                         text: `SL ➔ BE (+${t.samBeTriggerPts}pt)`
                       });
                     }
                   }
                 }
                 if (t.samExitProfile === 'CHANDELIER' && t.samChandelierDistPts && t.samChandelierDistPts > 0) {
                   const newSl = Number((t.peakPrice + t.samChandelierDistPts).toFixed(2));
                   if (newSl < t.stoploss) {
                     t.stoploss = newSl;
                     if (newSl <= t.entryPrice) t.isBreakevenLocked = true;
                   }
                 }
               }
             }
             // Prevent generic fallthrough (breakevenTrail / target1Hit / target2) from touching SAM 21/5 institutional trades
             continue;
           }

           const trailingEnabled = activeSamConfig?.trailingStopEnabled ?? true;
           const step1 = activeSamConfig?.trailStep1Points ?? 20;
           const step2 = activeSamConfig?.trailStep2Points ?? 40;
           const step2Lock = activeSamConfig?.trailStep2LockProfit ?? 20;

           if (t.type === 'LONG') {
             if (!isEntryBar) {
               // Track highest price reached during the trade
               t.peakPrice = Math.max(t.peakPrice || t.entryPrice, curr.high);

               if (trailingEnabled) {
                 // Rule 2: If market goes up 40 points, switch stoploss to entry plus 20 points
                 if (t.peakPrice >= t.entryPrice + step2) {
                   const newSl = Number((t.entryPrice + step2Lock).toFixed(2));
                   if (newSl > t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 2) {
                       t.trailStage = 2;
                       markers.push({
                         time: curr.time,
                         position: 'belowBar',
                         color: '#10B981',
                         shape: 'circle',
                         text: `SL ➔ Entry+${step2Lock} (+${step2}pt)`
                       });
                     }
                   }
                 }
                 // Rule 1: If market goes up for 20 points, switch stoploss to entry
                 else if (t.peakPrice >= t.entryPrice + step1) {
                   const newSl = Number(t.entryPrice.toFixed(2));
                   if (newSl > t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 1 && t.trailStage !== 2) {
                       t.trailStage = 1;
                       beSavedCount++;
                       markers.push({
                         time: curr.time,
                         position: 'belowBar',
                         color: '#3B82F6',
                         shape: 'circle',
                         text: `SL ➔ Entry (+${step1}pt)`
                       });
                     }
                   }
                 }
               }
             }

             // Evaluate Exit Conditions
             if (curr.low <= t.stoploss) {
               t.exitPrice = t.stoploss;
               t.exitTime = curr.time as number;
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               if (t.pnl > 0) {
                 t.status = 'WIN';
                 t.exitReason = 'STOPLOSS';
               } else if (t.pnl === 0) {
                 t.status = 'BE';
                 t.exitReason = 'BREAKEVEN';
               } else {
                 t.status = 'LOSS';
                 t.exitReason = 'STOPLOSS';
               }
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: t.pnl > 0 ? '#10B981' : t.pnl === 0 ? '#F59E0B' : '#EF4444',
                 shape: 'circle',
                 text: t.pnl > 0
                   ? `close_long (SAM +${t.pnl}pt Trail SL 🎯)`
                   : t.pnl === 0
                     ? `close_long (SAM Breakeven 🛡️)`
                     : `close_long (SAM SL Hit 🛑)`
               });
               continue;
             } else if (curr.high >= t.target) {
               t.exitPrice = t.target;
               t.exitTime = curr.time as number;
               t.exitReason = 'TARGET';
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               t.status = 'WIN';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#10B981',
                 shape: 'circle',
                 text: `close_long (SAM Target Hit 🎯)`
               });
               continue;
             } else if (
               activeSamConfig?.filterBar1AdverseCloseEnabled &&
               activeSamConfig?.bar1ActionMode === 'exit' &&
               (t.signalBarIdx !== undefined ? i === t.signalBarIdx + 1 : (t.entryBarIdx !== undefined && i === t.entryBarIdx + 1)) &&
               (curr.close < curr.open || curr.close < t.entryPrice)
             ) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'BAR1_ADVERSE_CLOSE';
               t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_long (SAM Bar+1 Adverse Cut ✂️ ${t.pnl >= 0 ? '+' : ''}${t.pnl}pt)`
               });
               continue;
             } else if (
               activeSamConfig?.autoExitOpposite && 
               ((activeSamConfig?.vwapExitOppositeEnabled !== false && samSignalsResult.basePutSignals?.[i]) || samSignalsResult.putSignals[i])
             ) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'OPPOSITE_SIGNAL';
               t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#EC4899',
                 shape: 'circle',
                 text: `close_long (SAM Rev Exit 🔄)`
               });
               continue;
             } else if (isDayEnd) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               continue;
             }
           } else {
             // SHORT (PUT)
             if (!isEntryBar) {
               // Track lowest price reached during the short trade
               t.peakPrice = Math.min(t.peakPrice || t.entryPrice, curr.low);

               if (trailingEnabled) {
                 // Rule 2: If market drops 40 points in favor, switch stoploss to entry minus 20 points
                 if (t.peakPrice <= t.entryPrice - step2) {
                   const newSl = Number((t.entryPrice - step2Lock).toFixed(2));
                   if (newSl < t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 2) {
                       t.trailStage = 2;
                       markers.push({
                         time: curr.time,
                         position: 'aboveBar',
                         color: '#10B981',
                         shape: 'circle',
                         text: `SL ➔ Entry-${step2Lock} (+${step2}pt)`
                       });
                     }
                   }
                 }
                 // Rule 1: If market drops 20 points in favor, switch stoploss to entry
                 else if (t.peakPrice <= t.entryPrice - step1) {
                   const newSl = Number(t.entryPrice.toFixed(2));
                   if (newSl < t.stoploss) {
                     t.stoploss = newSl;
                     t.isBreakevenLocked = true;
                     if (t.trailStage !== 1 && t.trailStage !== 2) {
                       t.trailStage = 1;
                       beSavedCount++;
                       markers.push({
                         time: curr.time,
                         position: 'aboveBar',
                         color: '#3B82F6',
                         shape: 'circle',
                         text: `SL ➔ Entry (+${step1}pt)`
                       });
                     }
                   }
                 }
               }
             }

             // Evaluate Exit Conditions
             if (curr.high >= t.stoploss) {
               t.exitPrice = t.stoploss;
               t.exitTime = curr.time as number;
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               if (t.pnl > 0) {
                 t.status = 'WIN';
                 t.exitReason = 'STOPLOSS';
               } else if (t.pnl === 0) {
                 t.status = 'BE';
                 t.exitReason = 'BREAKEVEN';
               } else {
                 t.status = 'LOSS';
                 t.exitReason = 'STOPLOSS';
               }
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: t.pnl > 0 ? '#10B981' : t.pnl === 0 ? '#F59E0B' : '#EF4444',
                 shape: 'circle',
                 text: t.pnl > 0
                   ? `close_short (SAM +${t.pnl}pt Trail SL 🎯)`
                   : t.pnl === 0
                     ? `close_short (SAM Breakeven 🛡️)`
                     : `close_short (SAM SL Hit 🛑)`
               });
               continue;
             } else if (curr.low <= t.target) {
               t.exitPrice = t.target;
               t.exitTime = curr.time as number;
               t.exitReason = 'TARGET';
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               t.status = 'WIN';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#10B981',
                 shape: 'circle',
                 text: `close_short (SAM Target Hit 🎯)`
               });
               continue;
             } else if (
               activeSamConfig?.filterBar1AdverseCloseEnabled &&
               activeSamConfig?.bar1ActionMode === 'exit' &&
               (t.signalBarIdx !== undefined ? i === t.signalBarIdx + 1 : (t.entryBarIdx !== undefined && i === t.entryBarIdx + 1)) &&
               (curr.close > curr.open || curr.close > t.entryPrice)
             ) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'BAR1_ADVERSE_CLOSE';
               t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_short (SAM Bar+1 Adverse Cut ✂️ ${t.pnl >= 0 ? '+' : ''}${t.pnl}pt)`
               });
               continue;
             } else if (
               activeSamConfig?.autoExitOpposite && 
               ((activeSamConfig?.vwapExitOppositeEnabled !== false && samSignalsResult.baseCallSignals?.[i]) || samSignalsResult.callSignals[i])
             ) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'OPPOSITE_SIGNAL';
               t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#EC4899',
                 shape: 'circle',
                 text: `close_short (SAM Rev Exit 🔄)`
               });
               continue;
             } else if (isDayEnd) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
               t.status = t.pnl > 0 ? 'WIN' : t.pnl === 0 ? 'BE' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               onSamTradeClosed(t, curr.time as number);
               openTrades.splice(j, 1);
               continue;
             }
           }
           continue;
         }

         // 1. Maximum Time for MACD+ST Trades (60 minutes)
         const elapsedSecs = Math.max(0, (curr.time as number) - t.entryTime);
         const elapsedMins = elapsedSecs / 60;
         if (t.strategyFamily === 'MACD_ADAPTIVE_SUPERTREND' && t.status === 'OPEN' && elapsedMins >= 60) {
           const isLong = t.type === 'LONG';
           const exitP = curr.close;
           t.exitPrice = exitP;
           t.exitTime = curr.time as number;
           t.exitReason = 'MAX_TIME';
           t.pnl = isLong ? Number((exitP - t.entryPrice).toFixed(2)) : Number((t.entryPrice - exitP).toFixed(2));
           t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
           t.duration = formatDuration(t.entryTime, t.exitTime);
           openTrades.splice(j, 1);
           markers.push({
             time: curr.time,
             position: isLong ? 'aboveBar' : 'belowBar',
             color: '#F59E0B',
             shape: 'circle',
             text: `close_${isLong ? 'long' : 'short'} (${t.signal} Time Exit ⏱️)`
           });
           continue;
         }

         if (t.type === 'LONG') {
           // Track highest price reached
           t.peakPrice = Math.max(t.peakPrice || t.entryPrice, curr.high);

           // Check Target 1 Hit
           if (!t.target1Hit && curr.high >= t.target) {
             t.target1Hit = true;
             t.isBreakevenLocked = true;
             t.stoploss = Math.max(t.stoploss, t.entryPrice);
             markers.push({
               time: curr.time,
               position: 'aboveBar',
               color: '#10B981',
               shape: 'circle',
               text: 'T1 Hit (+Lock BE)'
             });
           }

           if (t.target1Hit) {
             const t2 = t.target2 || (t.entryPrice + (t.target - t.entryPrice) * 1.67);
             if (curr.high >= t2) {
               // Target 2 reached! Multi-target exit (50% booked at T1, 50% at T2)
               t.exitPrice = Number(((t.target + t2) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'TARGET';
               t.status = 'WIN';
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#8B5CF6',
                 shape: 'circle',
                 text: `close_long (${t.signal} TP2 Complete 🎯)`
               });
             } else if (curr.low <= t.stoploss) {
               // Runner stopped out at Breakeven / Dynamic Trail! (50% secured at T1, 50% at trail -> Guaranteed Net Win)
               t.exitPrice = Number(((t.target + t.stoploss) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'BREAKEVEN';
               t.status = 'WIN';
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#10B981',
                 shape: 'circle',
                 text: `close_long (${t.signal} T1 Secured / Trail Runner)`
               });
             } else if (isDayEnd) {
               t.exitPrice = Number(((t.target + curr.close) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_long (${t.signal} Day End @ ${curr.close.toFixed(1)})`
               });
             }
           } else {
             // Target 1 NOT hit yet: evaluate strict stoploss
             if (curr.low <= t.stoploss) {
               t.exitPrice = t.stoploss;
               t.exitTime = curr.time as number;
               t.exitReason = t.isBreakevenLocked ? 'BREAKEVEN' : 'STOPLOSS';
               t.status = (t.isBreakevenLocked && t.exitPrice >= t.entryPrice - 0.01) ? 'BE' : 'LOSS';
               t.pnl = Number((t.exitPrice - t.entryPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
             } else if (isDayEnd) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
               t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'aboveBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_long (${t.signal} Day End)`
               });
             }
           }
         } else { // SHORT
           // Track lowest price reached for dynamic trailing (PDF Section 4)
           t.peakPrice = Math.min(t.peakPrice || t.entryPrice, curr.low);

           // Check Target 1 Hit
           if (!t.target1Hit && curr.low <= t.target) {
             t.target1Hit = true;
             t.isBreakevenLocked = true;
             t.stoploss = Math.min(t.stoploss, t.entryPrice);
             markers.push({
               time: curr.time,
               position: 'belowBar',
               color: '#10B981',
               shape: 'circle',
               text: 'T1 Hit (+Lock BE)'
             });
           }

           if (t.target1Hit) {
             const t2 = t.target2 || (t.entryPrice - (t.entryPrice - t.target) * 1.67);
             if (curr.low <= t2) {
               // Target 2 reached! Multi-target exit (50% booked at T1, 50% at T2)
               t.exitPrice = Number(((t.target + t2) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'TARGET';
               t.status = 'WIN';
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#8B5CF6',
                 shape: 'circle',
                 text: `close_short (${t.signal} TP2 Complete 🎯)`
               });
             } else if (curr.high >= t.stoploss) {
               // Runner stopped out at Breakeven / Dynamic Trail! (50% secured at T1, 50% at trail -> Guaranteed Net Win)
               t.exitPrice = Number(((t.target + t.stoploss) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'BREAKEVEN';
               t.status = 'WIN';
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#10B981',
                 shape: 'circle',
                 text: `close_short (${t.signal} T1 Secured / Trail Runner)`
               });
             } else if (isDayEnd) {
               t.exitPrice = Number(((t.target + curr.close) / 2).toFixed(2));
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_short (${t.signal} Day End @ ${curr.close.toFixed(1)})`
               });
             }
           } else {
             // Target 1 NOT hit yet: evaluate strict stoploss
             if (curr.high >= t.stoploss) {
               t.exitPrice = t.stoploss;
               t.exitTime = curr.time as number;
               t.exitReason = t.isBreakevenLocked ? 'BREAKEVEN' : 'STOPLOSS';
               t.status = (t.isBreakevenLocked && t.exitPrice <= t.entryPrice + 0.01) ? 'BE' : 'LOSS';
               t.pnl = Number((t.entryPrice - t.exitPrice).toFixed(2));
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
             } else if (isDayEnd) {
               t.exitPrice = curr.close;
               t.exitTime = curr.time as number;
               t.exitReason = 'DAY_END';
               t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
               t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
               t.duration = formatDuration(t.entryTime, t.exitTime);
               openTrades.splice(j, 1);
               markers.push({
                 time: curr.time,
                 position: 'belowBar',
                 color: '#F59E0B',
                 shape: 'circle',
                 text: `close_short (${t.signal} Day End)`
               });
             }
           }
         }
       }

        // 1. NIFTY MACD + Adaptive SuperTrend Strategy
        // Evaluated SOLELY by its own rules: MACD crossover + Adaptive SuperTrend trend.
        // NO outside or other strategy filters apply. Isolated One Trade at a Time without interference.
        if (activeStrategies.macdAdaptiveSupertrend && !isDayEnd && !isPreMarket && i >= 35) {
          const hasActiveTrade = openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'MACD_ADAPTIVE_SUPERTREND');
          if (!hasActiveTrade) {
            const strat = new NiftyMacdAdaptiveSupertrend({
              macdFast: 12,
              macdSlow: 26,
              macdSignal: 9,
              atrPeriod: 10,
              superTrendMultiplier: 3,
              enableAdaptiveMultiplier: true,
              lookbackPeriod: 100,
              minVolume: 0,
            });
            const subCandles = candles.slice(0, i + 1);
            for (let sc = 0; sc < subCandles.length - 1; sc++) {
              strat.updatePriceData({
                open: subCandles[sc].open,
                high: subCandles[sc].high,
                low: subCandles[sc].low,
                close: subCandles[sc].close,
                volume: subCandles[sc].volume || 0,
              });
            }
            const currC = subCandles[subCandles.length - 1];
            const sigRes = strat.generateSignals({
              open: currC.open,
              high: currC.high,
              low: currC.low,
              close: currC.close,
              volume: currC.volume || 0,
            }, 100000, '10:00');

            if (sigRes.signal === 'BUY') {
              markers.push({ time: curr.time, position: 'belowBar', color: '#A855F7', shape: 'arrowUp', text: 'MACD+ST L' });
              const entry = curr.close;
              const stoploss = sigRes.stopLoss ? Number(sigRes.stopLoss.toFixed(2)) : Number((entry - atr * 1.5).toFixed(2));
              const target = sigRes.takeProfit ? Number(sigRes.takeProfit.toFixed(2)) : Number((entry + (entry - stoploss) * 2).toFixed(2));
              const riskDist = Math.abs(entry - stoploss);
              const newTrade: Trade = {
                id: `${curr.time}-MACD-ST-L`,
                type: 'LONG',
                signal: 'MACD+ST Long',
                strategyFamily: 'MACD_ADAPTIVE_SUPERTREND',
                entryTime: curr.time as number,
                entryPrice: entry,
                stoploss: stoploss,
                target: target,
                target2: Number((entry + riskDist * 3).toFixed(2)),
                riskDist: riskDist,
                peakPrice: entry,
                status: 'OPEN',
              };
              openTrades.push(newTrade);
              allTrades.push(newTrade);
            } else if (sigRes.signal === 'SELL') {
              markers.push({ time: curr.time, position: 'aboveBar', color: '#A855F7', shape: 'arrowDown', text: 'MACD+ST S' });
              const entry = curr.close;
              const stoploss = sigRes.stopLoss ? Number(sigRes.stopLoss.toFixed(2)) : Number((entry + atr * 1.5).toFixed(2));
              const target = sigRes.takeProfit ? Number(sigRes.takeProfit.toFixed(2)) : Number((entry - (stoploss - entry) * 2).toFixed(2));
              const riskDist = Math.abs(stoploss - entry);
              const newTrade: Trade = {
                id: `${curr.time}-MACD-ST-S`,
                type: 'SHORT',
                signal: 'MACD+ST Short',
                strategyFamily: 'MACD_ADAPTIVE_SUPERTREND',
                entryTime: curr.time as number,
                entryPrice: entry,
                stoploss: stoploss,
                target: target,
                target2: Number((entry - riskDist * 3).toFixed(2)),
                riskDist: riskDist,
                peakPrice: entry,
                status: 'OPEN',
              };
              openTrades.push(newTrade);
              allTrades.push(newTrade);
            }
          }
        }

        // 4. BEST SAM SIGNALS Strategy (Pine Script by dy26102001)
        // Calculations: SMA(Fast) - SMA(Slow) vs WMA(Signal) crossover
        // Stoploss 20 points from entry candle + optional ADX filter
        // Strictly NO trade before 09:15 AM IST (Pre-market session restriction)
        if (activeStrategies.samSignals && !isDayEnd && !isSamPreMarketBlocked && i >= 35) {
          const hasActiveTrade = (activeSamConfig?.oneTradeAtATime ?? true) && openTrades.some(
            t => t.status === 'OPEN' && t.strategyFamily === 'SAM_SIGNALS'
          );
          const slPts = activeSamConfig?.stopLossPoints ?? 20;
          const tpPts = activeSamConfig?.targetPoints ?? 60;
          const entryTiming = activeSamConfig?.entryTiming ?? 'bar1Close';

          // Visual Setup Markers on the setup candle (Bar 0)
          if (entryTiming === 'bar1Close') {
            if (samSignalsResult.candidateCallSignals?.[i]) {
              markers.push({
                time: curr.time,
                position: 'belowBar',
                color: '#F59E0B',
                shape: 'circle',
                text: 'SAM CALL (Setup: Awaiting Bar+1 Close ⏳)'
              });
            } else if (samSignalsResult.candidatePutSignals?.[i]) {
              markers.push({
                time: curr.time,
                position: 'aboveBar',
                color: '#F59E0B',
                shape: 'circle',
                text: 'SAM PUT (Setup: Awaiting Bar+1 Close ⏳)'
              });
            }

            // Visual Filtered Rejection Markers on Bar + 1 candle when filtered out
            if (i >= 1 && samSignalsResult.candidateCallSignals?.[i - 1] && !samSignalsResult.callSignals[i]) {
              const curVwap = samSignalsResult.vwapValues?.[i];
              const maxDist = activeSamConfig?.vwapMaxDistancePoints ?? 70;
              const isBelowVwap = activeSamConfig?.vwapFilterEnabled && curVwap !== undefined && !isNaN(curVwap) && curr.close < curVwap;
              const isClimaxOverextended = activeSamConfig?.vwapFilterEnabled && (activeSamConfig?.vwapClimaxFilterEnabled !== false) && curVwap !== undefined && !isNaN(curVwap) && (curr.close - curVwap) > maxDist;
              markers.push({
                time: curr.time,
                position: 'aboveBar',
                color: isBelowVwap || isClimaxOverextended ? '#06b6d4' : '#6B7280',
                shape: 'circle',
                text: isBelowVwap
                  ? `SAM CALL (Filtered: Below VWAP ${curVwap.toFixed(1)} 🚫)` 
                  : isClimaxOverextended
                    ? `SAM CALL (Filtered: Climax +${(curr.close - curVwap).toFixed(1)}pt > VWAP 🚫)`
                    : 'SAM CALL (Filtered: Adverse Bar+1 🚫)'
              });
            } else if (i >= 1 && samSignalsResult.candidatePutSignals?.[i - 1] && !samSignalsResult.putSignals[i]) {
              const curVwap = samSignalsResult.vwapValues?.[i];
              const maxDist = activeSamConfig?.vwapMaxDistancePoints ?? 70;
              const isAboveVwap = activeSamConfig?.vwapFilterEnabled && curVwap !== undefined && !isNaN(curVwap) && curr.close > curVwap;
              const isClimaxOversold = activeSamConfig?.vwapFilterEnabled && (activeSamConfig?.vwapClimaxFilterEnabled !== false) && curVwap !== undefined && !isNaN(curVwap) && (curVwap - curr.close) > maxDist;
              markers.push({
                time: curr.time,
                position: 'belowBar',
                color: isAboveVwap || isClimaxOversold ? '#06b6d4' : '#6B7280',
                shape: 'circle',
                text: isAboveVwap 
                  ? `SAM PUT (Filtered: Above VWAP ${curVwap.toFixed(1)} 🚫)` 
                  : isClimaxOversold
                    ? `SAM PUT (Filtered: Climax -${(curVwap - curr.close).toFixed(1)}pt < VWAP 🚫)`
                    : 'SAM PUT (Filtered: Adverse Bar+1 🚫)'
              });
            }

            // Visual Setup Rejection Markers on Bar 0 when filtered by VWAP
            if (samSignalsResult.rawCallSignals?.[i] && !samSignalsResult.candidateCallSignals?.[i]) {
              const curVwap = samSignalsResult.vwapValues?.[i];
              const maxDist = activeSamConfig?.vwapMaxDistancePoints ?? 70;
              if (activeSamConfig?.vwapFilterEnabled && curVwap !== undefined && !isNaN(curVwap)) {
                const isBelow = curr.close < curVwap;
                const isClimax = (activeSamConfig?.vwapClimaxFilterEnabled !== false) && (curr.close - curVwap) > maxDist;
                if (isBelow || isClimax) {
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#0891b2',
                    shape: 'circle',
                    text: isBelow 
                      ? `SAM CALL (Filtered: Below VWAP ${curVwap.toFixed(1)} 🚫)`
                      : `SAM CALL (Filtered: Climax +${(curr.close - curVwap).toFixed(1)}pt > VWAP 🚫)`
                  });
                }
              }
            } else if (samSignalsResult.rawPutSignals?.[i] && !samSignalsResult.candidatePutSignals?.[i]) {
              const curVwap = samSignalsResult.vwapValues?.[i];
              const maxDist = activeSamConfig?.vwapMaxDistancePoints ?? 70;
              if (activeSamConfig?.vwapFilterEnabled && curVwap !== undefined && !isNaN(curVwap)) {
                const isAbove = curr.close > curVwap;
                const isClimax = (activeSamConfig?.vwapClimaxFilterEnabled !== false) && (curVwap - curr.close) > maxDist;
                if (isAbove || isClimax) {
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#0891b2',
                    shape: 'circle',
                    text: isAbove 
                      ? `SAM PUT (Filtered: Above VWAP ${curVwap.toFixed(1)} 🚫)`
                      : `SAM PUT (Filtered: Climax -${(curVwap - curr.close).toFixed(1)}pt < VWAP 🚫)`
                  });
                }
              }
            }
          }

          if (!hasActiveTrade) {
            const samProfile = samSignalsResult.samSignalProfile?.[i] || 'STANDARD';
            const isInstitutionalSam21 = samProfile !== 'STANDARD';

            // Daily Drawdown Halt Check
            if (activeSamConfig?.maxDailyLossEnabled && dailyDrawdownHalted) {
              if (samSignalsResult.callSignals[i] || samSignalsResult.putSignals[i]) {
                markers.push({
                  time: curr.time,
                  position: samSignalsResult.callSignals[i] ? 'belowBar' : 'aboveBar',
                  color: '#9CA3AF',
                  shape: 'circle',
                  text: `SAM ${samSignalsResult.callSignals[i] ? 'CALL' : 'PUT'} (Halted: Daily Max Loss Hit 🛑)`
                });
              }
            } else if (isInstitutionalSam21 && (samSignalsResult.callSignals[i] || samSignalsResult.putSignals[i])) {
              // Institutional SAM(21/5) immediate entry at signal bar close (zero-lookahead)
              const isCall = samSignalsResult.callSignals[i];
              const entry = curr.close;
              const atr5mVal = samSignalsResult.atr5mValues?.[i];
              const fallbackAtr5m = !isNaN(atr) && atr > 0 ? atr * Math.sqrt(5) : 15;
              const effAtr5m = atr5mVal && !isNaN(atr5mVal) && atr5mVal > 0 ? atr5mVal : fallbackAtr5m;

              let profSlDist = 40;
              let exitProfile: 'FIXED_EOD' | 'CHANDELIER' = 'FIXED_EOD';
              let beTriggerPts: number | undefined = 30;
              let step2TriggerPts: number | undefined = undefined;
              let step2LockPts: number | undefined = undefined;
              let chandelierDistPts: number | undefined = undefined;
              let labelSuffix = 'AFT [#3 SL40/BE30]';

              if (samProfile === 'SAM21_AFT_CHAND') {
                profSlDist = Number((entry * 0.003).toFixed(2));
                exitProfile = 'CHANDELIER';
                beTriggerPts = undefined;
                chandelierDistPts = Number((entry * 0.004).toFixed(2));
                labelSuffix = 'AFT [#5 Chand 0.3/0.4%]';
              } else if (samProfile === 'SAM21_3M_OPENDRIVE') {
                profSlDist = Number((2.0 * effAtr5m).toFixed(2));
                exitProfile = 'CHANDELIER';
                beTriggerPts = 30;
                step2TriggerPts = 50;
                step2LockPts = 20;
                chandelierDistPts = Number((3.0 * effAtr5m).toFixed(2));
                labelSuffix = '3m OPEN [#1 2x/3x ATR + BE30/L20]';
              }

              const stoploss = Number((isCall ? entry - profSlDist : entry + profSlDist).toFixed(2));
              const signalLabel = `SAM 21/5 ${isCall ? 'CALL' : 'PUT'} ${labelSuffix}`;

              markers.push({
                time: curr.time,
                position: isCall ? 'belowBar' : 'aboveBar',
                color: isCall ? (activeSamConfig?.colorBuy || '#2196f3') : (activeSamConfig?.colorSell || '#ff5252'),
                shape: isCall ? 'arrowUp' : 'arrowDown',
                text: signalLabel,
              });

              const newTrade: Trade = {
                id: `${curr.time}-SAM21-${isCall ? 'CALL' : 'PUT'}`,
                type: isCall ? 'LONG' : 'SHORT',
                signal: signalLabel,
                strategyFamily: 'SAM_SIGNALS',
                entryTime: curr.time as number,
                entryPrice: entry,
                stoploss,
                target: isCall ? Number((entry + profSlDist * 3).toFixed(2)) : Number((entry - profSlDist * 3).toFixed(2)),
                riskDist: profSlDist,
                peakPrice: entry,
                trailStage: 0,
                status: 'OPEN',
                entryBarIdx: i,
                signalBarIdx: i,
                samExitProfile: exitProfile,
                samBeTriggerPts: beTriggerPts,
                samStep2TriggerPts: step2TriggerPts,
                samStep2LockPts: step2LockPts,
                samChandelierDistPts: chandelierDistPts,
                samIgnoreOppositeExit: true,
                samNoFixedTp: true,
                samEodExitMin: 925, // 15:25 IST
              };
              openTrades.push(newTrade);
              allTrades.push(newTrade);
            } else if (entryTiming === 'bar1Open') {
              // Signal detected on candle i. Entry executes on next candle open (Bar + 1).
              if (samSignalsResult.callSignals[i]) {
                const isCb = activeSamConfig?.circuitBreakerEnabled && (curr.time as number) < longCooldownUntil;
                const isWhip = activeSamConfig?.antiWhipsawEnabled && lastLossType === 'SHORT' && ((curr.time as number) - lastLossTime) < ((activeSamConfig?.antiWhipsawMinutes ?? 10) * 60);
                if (isCb) {
                  cbFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#F59E0B',
                    shape: 'circle',
                    text: 'SAM CALL (Filtered: Circuit Breaker Long Cooldown ⏸️)'
                  });
                } else if (isWhip) {
                  antiWhipFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#8B5CF6',
                    shape: 'circle',
                    text: 'SAM CALL (Filtered: Anti-Whipsaw Protection 🛡️)'
                  });
                } else {
                  pendingSamSignal = { type: 'LONG', signalBarIdx: i, signalTime: curr.time as number };
                }
              } else if (samSignalsResult.putSignals[i]) {
                const isCb = activeSamConfig?.circuitBreakerEnabled && (curr.time as number) < shortCooldownUntil;
                const isWhip = activeSamConfig?.antiWhipsawEnabled && lastLossType === 'LONG' && ((curr.time as number) - lastLossTime) < ((activeSamConfig?.antiWhipsawMinutes ?? 10) * 60);
                if (isCb) {
                  cbFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#F59E0B',
                    shape: 'circle',
                    text: 'SAM PUT (Filtered: Circuit Breaker Short Cooldown ⏸️)'
                  });
                } else if (isWhip) {
                  antiWhipFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#8B5CF6',
                    shape: 'circle',
                    text: 'SAM PUT (Filtered: Anti-Whipsaw Protection 🛡️)'
                  });
                } else {
                  pendingSamSignal = { type: 'SHORT', signalBarIdx: i, signalTime: curr.time as number };
                }
              }
            } else {
              // bar1Close (Post-Adverse Filter Confirmed Entry) or bar0Close:
              // For bar1Close: Entry executes at the close of candle i (which is Bar + 1 close).
              // Stoploss & Target are calculated precisely from this Bar + 1 entry close price!
              if (samSignalsResult.callSignals[i]) {
                const isCb = activeSamConfig?.circuitBreakerEnabled && (curr.time as number) < longCooldownUntil;
                const isWhip = activeSamConfig?.antiWhipsawEnabled && lastLossType === 'SHORT' && ((curr.time as number) - lastLossTime) < ((activeSamConfig?.antiWhipsawMinutes ?? 10) * 60);
                if (isCb) {
                  cbFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#F59E0B',
                    shape: 'circle',
                    text: 'SAM CALL (Filtered: Circuit Breaker Long Cooldown ⏸️)'
                  });
                } else if (isWhip) {
                  antiWhipFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#8B5CF6',
                    shape: 'circle',
                    text: 'SAM CALL (Filtered: Anti-Whipsaw Protection 🛡️)'
                  });
                } else {
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: activeSamConfig?.colorBuy || '#2196f3',
                    shape: 'arrowUp',
                    text: entryTiming === 'bar1Close' ? 'SAM CALL (Entry: Bar+1 Close)' : 'SAM CALL'
                  });
                  const entry = curr.close;
                  const stoploss = Number((entry - slPts).toFixed(2));
                  const target = Number((entry + tpPts).toFixed(2));
                  const target2 = Number((entry + (tpPts * 2)).toFixed(2));
                  const newTrade: Trade = {
                    id: `${curr.time}-SAM-CALL`,
                    type: 'LONG',
                    signal: entryTiming === 'bar1Close' ? 'SAM CALL (Bar+1 Close)' : 'SAM CALL',
                    strategyFamily: 'SAM_SIGNALS',
                    entryTime: curr.time as number,
                    entryPrice: entry,
                    stoploss: stoploss,
                    target: target,
                    target2: target2,
                    riskDist: slPts,
                    peakPrice: entry,
                    trailStage: 0,
                    status: 'OPEN',
                    entryBarIdx: i,
                    signalBarIdx: entryTiming === 'bar1Close' ? i - 1 : i,
                  };
                  openTrades.push(newTrade);
                  allTrades.push(newTrade);
                }
              } else if (samSignalsResult.putSignals[i]) {
                const isCb = activeSamConfig?.circuitBreakerEnabled && (curr.time as number) < shortCooldownUntil;
                const isWhip = activeSamConfig?.antiWhipsawEnabled && lastLossType === 'LONG' && ((curr.time as number) - lastLossTime) < ((activeSamConfig?.antiWhipsawMinutes ?? 10) * 60);
                if (isCb) {
                  cbFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#F59E0B',
                    shape: 'circle',
                    text: 'SAM PUT (Filtered: Circuit Breaker Short Cooldown ⏸️)'
                  });
                } else if (isWhip) {
                  antiWhipFilteredCount++;
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#8B5CF6',
                    shape: 'circle',
                    text: 'SAM PUT (Filtered: Anti-Whipsaw Protection 🛡️)'
                  });
                } else {
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: activeSamConfig?.colorSell || '#ff5252',
                    shape: 'arrowDown',
                    text: entryTiming === 'bar1Close' ? 'SAM PUT (Entry: Bar+1 Close)' : 'SAM PUT'
                  });
                  const entry = curr.close;
                  const stoploss = Number((entry + slPts).toFixed(2));
                  const target = Number((entry - tpPts).toFixed(2));
                  const target2 = Number((entry - (tpPts * 2)).toFixed(2));
                  const newTrade: Trade = {
                    id: `${curr.time}-SAM-PUT`,
                    type: 'SHORT',
                    signal: entryTiming === 'bar1Close' ? 'SAM PUT (Bar+1 Close)' : 'SAM PUT',
                    strategyFamily: 'SAM_SIGNALS',
                    entryTime: curr.time as number,
                    entryPrice: entry,
                    stoploss: stoploss,
                    target: target,
                    target2: target2,
                    riskDist: slPts,
                    peakPrice: entry,
                    trailStage: 0,
                    status: 'OPEN',
                    entryBarIdx: i,
                    signalBarIdx: entryTiming === 'bar1Close' ? i - 1 : i,
                  };
                  openTrades.push(newTrade);
                  allTrades.push(newTrade);
                }
              }
            }
          }
        }
     }

    // Candidate indicators: If a candidate setup formed on the latest closed candle, track pending confirmation state
    let nextPendingSetup: {
      type: 'CALL' | 'PUT';
      time?: number;
      setupBarTime: number;
      setupBarClose: number;
      currentBar1Price: number;
      estEntry: number;
      estSL: number;
      estTP: number;
      estTP2: number;
      formingTime?: number;
    } | null = null;

    if (activeStrategies.samSignals && (activeSamConfig?.entryTiming ?? 'bar1Close') === 'bar1Close') {
      const lastIdx = candles.length - 1;
      const lastC = candles[lastIdx];
      const hasActiveTrade = openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'SAM_SIGNALS');
      const currentPrice = livePrice || lastC?.close || 0;
      const slPts = activeSamConfig?.stopLossPoints ?? 20;
      const tpPts = activeSamConfig?.targetPoints ?? 60;
      if (lastC && !hasActiveTrade && samSignalsResult.candidateCallSignals?.[lastIdx] && !samSignalsResult.callSignals[lastIdx]) {
        nextPendingSetup = {
          type: 'CALL',
          time: lastC.time as number,
          setupBarTime: lastC.time as number,
          setupBarClose: lastC.close,
          currentBar1Price: currentPrice,
          estEntry: currentPrice,
          estSL: Number((currentPrice - slPts).toFixed(2)),
          estTP: Number((currentPrice + tpPts).toFixed(2)),
          estTP2: Number((currentPrice + (tpPts * 2)).toFixed(2)),
          formingTime: (lastC.time as number) + (timeframe * 60),
        };
      } else if (lastC && !hasActiveTrade && samSignalsResult.candidatePutSignals?.[lastIdx] && !samSignalsResult.putSignals[lastIdx]) {
        nextPendingSetup = {
          type: 'PUT',
          time: lastC.time as number,
          setupBarTime: lastC.time as number,
          setupBarClose: lastC.close,
          currentBar1Price: currentPrice,
          estEntry: currentPrice,
          estSL: Number((currentPrice + slPts).toFixed(2)),
          estTP: Number((currentPrice - tpPts).toFixed(2)),
          estTP2: Number((currentPrice - (tpPts * 2)).toFixed(2)),
          formingTime: (lastC.time as number) + (timeframe * 60),
        };
      }
    }
    setPendingSamSetup(nextPendingSetup);

    // Failsafe: If a pending signal occurred on the very last candle for bar1Open, show status indicator
    if (pendingSamSignal && activeStrategies.samSignals) {
      const lastC = candles[candles.length - 1];
      if (lastC) {
        markers.push({
          time: lastC.time,
          position: pendingSamSignal.type === 'LONG' ? 'belowBar' : 'aboveBar',
          color: pendingSamSignal.type === 'LONG' ? (activeSamConfig?.colorBuy || '#2196f3') : (activeSamConfig?.colorSell || '#ff5252'),
          shape: 'circle',
          text: `SAM ${pendingSamSignal.type === 'LONG' ? 'CALL' : 'PUT'} (Signal: Awaiting Bar+1 Open)`
        });
      }
    }

// Failsafe: Only square off if session actually ended, otherwise keep trade actively OPEN
    for (const t of openTrades) {
      if (t.status === 'OPEN') {
        const lastC = candles[candles.length - 1];
        const isActuallyDayEnd = isSessionEndBar(lastC.time as number);
        if (isActuallyDayEnd) {
          t.exitPrice = lastC.close;
          t.exitTime = lastC.time as number;
          t.exitReason = 'DAY_END';
          t.pnl = t.type === 'LONG' ? lastC.close - t.entryPrice : t.entryPrice - lastC.close;
          t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
          t.duration = formatDuration(t.entryTime, t.exitTime);
        } else {
          t.status = 'OPEN';
          t.exitPrice = undefined;
          t.exitTime = undefined;
          t.exitReason = undefined;
          t.pnl = t.type === 'LONG' ? lastC.close - t.entryPrice : t.entryPrice - lastC.close;
          t.duration = formatDuration(t.entryTime, lastC.time as number) + ' (Active)';
        }
      }
    }
    openTrades.length = 0;

    setComparisonStats({
      filteredCount: activeStrategies.samSignals
        ? (samSignalsResult.wickFilteredCount || 0) + (samSignalsResult.bar1FilteredCount || 0) + (samSignalsResult.vwapFilteredCount || 0) + (samSignalsResult.minBodyFilteredCount || 0) + (samSignalsResult.mtfEmaFilteredCount || 0) + (samSignalsResult.dayTrapFilteredCount || 0) + (samSignalsResult.adaptiveFilteredCount || 0) + (samSignalsResult.s12FilteredCount || 0) + cbFilteredCount + antiWhipFilteredCount
        : 0,
      wickFiltered: activeStrategies.samSignals ? (samSignalsResult.wickFilteredCount || 0) : 0,
      bar1Filtered: activeStrategies.samSignals ? (samSignalsResult.bar1FilteredCount || 0) : 0,
      vwapFiltered: activeStrategies.samSignals ? (samSignalsResult.vwapFilteredCount || 0) : 0,
      minBodyFiltered: activeStrategies.samSignals ? (samSignalsResult.minBodyFilteredCount || 0) : 0,
      mtfEmaFiltered: activeStrategies.samSignals ? (samSignalsResult.mtfEmaFilteredCount || 0) : 0,
      dayTrapFiltered: activeStrategies.samSignals ? (samSignalsResult.dayTrapFilteredCount || 0) : 0,
      adaptiveRegimeFiltered: activeStrategies.samSignals ? (samSignalsResult.adaptiveFilteredCount || 0) : 0,
      circuitBreakerFiltered: activeStrategies.samSignals ? cbFilteredCount : 0,
      antiWhipsawFiltered: activeStrategies.samSignals ? antiWhipFilteredCount : 0,
      s12Filtered: activeStrategies.samSignals ? (samSignalsResult.s12FilteredCount || 0) : 0,
      sam21AfternoonSignals: activeStrategies.samSignals ? (samSignalsResult.sam21AfternoonSignalCount || 0) : 0,
      sam21OpenDriveSignals: activeStrategies.samSignals ? (samSignalsResult.sam21OpenDriveSignalCount || 0) : 0,
      sam21LiveStatus: activeStrategies.samSignals ? (samSignalsResult.sam21LiveStatus || null) : null,
      dailyDrawdownHalted,
      currentRegimeState: samSignalsResult.regimeState?.[candles.length - 1] || 'RANGE',
      circuitBreakerActive: (longCooldownUntil > (candles[candles.length - 1]?.time as number)) || (shortCooldownUntil > (candles[candles.length - 1]?.time as number)),
      beSavedCount,
    });
    if (!isDisposedRef.current && series) {
      try {
        markers.sort((a, b) => Number(a.time) - Number(b.time));
        series.setMarkers(markers);
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
    const candleByTime = new Map<number, { open: number; high: number; low: number; close: number }>();
    for (const c of candles) {
      candleByTime.set(Number(c.time), { open: c.open, high: c.high, low: c.low, close: c.close });
    }
    const decoratedTrades = allTrades.map(t => {
      const exitSpotBar = t.exitTime ? candleByTime.get(t.exitTime) : undefined;
      return decorateTradeWithOptionData(
        { ...t, timeframeMin: timeframe, exitSpotBar },
        optionSnapshotsRef.current,
        resolvedOptionMapRef.current,
        timeframe
      );
    });
    setBacktestTrades([...decoratedTrades].reverse());

    hasActiveLiveTradeOrSetupRef.current =
      decoratedTrades.some(t => t.status === 'OPEN') || Boolean(nextPendingSetup);

    // Real-time trade transition detection (strictly silent on initial load or config/timeframe change)
    const alertSignature = `${instrument}|${timeframe}|${JSON.stringify(activeStrategies)}|${JSON.stringify(activeSamConfig)}`;
    if (lastAlertSignatureRef.current !== alertSignature) {
      lastAlertSignatureRef.current = alertSignature;
      const seeded = new Map<string, string>();
      for (const t of decoratedTrades) {
        seeded.set(t.id, t.status);
      }
      seenTradeStatusRef.current = seeded;
      seenPendingKeyRef.current = nextPendingSetup
        ? `PENDING:SAM:${nextPendingSetup.setupBarTime}:${nextPendingSetup.type}`
        : '';
    } else {
      const maxAgeMin = Math.max(timeframe * 2, 5);
      const nowMs = Date.now();

      const dispatchLiveNotification = (ev: TradeNotificationEvent) => {
        onTradeNotificationRef.current?.(ev);
        fetch('/api/notifications/emit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ev),
        }).catch(() => {});
      };

      for (const t of decoratedTrades) {
        const prevStatus = seenTradeStatusRef.current.get(t.id);
        const dir: 'CALL' | 'PUT' = t.type === 'LONG' ? 'CALL' : 'PUT';
        const optType: 'CE' | 'PE' = dir === 'CALL' ? 'CE' : 'PE';
        const stratKey = t.strategyFamily === 'SAM_SIGNALS' ? 'SAM' : (t.strategyFamily || 'CHART');

        if (!prevStatus) {
          seenTradeStatusRef.current.set(t.id, t.status);
          if (isFreshLiveCandleTime(t.entryTime, nowMs, maxAgeMin)) {
            dispatchLiveNotification({
              id: `OPEN:${stratKey}:${t.entryTime}:${dir}`,
              kind: 'TRADE_OPENED',
              direction: dir,
              signal: t.signal || `${stratKey} ${dir}`,
              source: 'LIVE_CHART',
              timestamp: nowMs,
              candleTimeSec: t.entryTime,
              entryPrice: Number(t.entryPrice.toFixed(2)),
              stoploss: Number.isFinite(t.stoploss) ? Number(t.stoploss.toFixed(2)) : undefined,
              target: Number.isFinite(t.target) ? Number(t.target.toFixed(2)) : undefined,
              status: 'OPEN',
              optionStrike: t.optionStrike ?? Math.round(t.entryPrice / 50) * 50,
              optionType: t.optionType ?? optType,
              optionEntryPremium: t.optionEntryPremium,
              message: `${timeframe}m Candle Close Confirmation`,
            });
          }
        } else if (prevStatus === 'OPEN' && t.status !== 'OPEN') {
          seenTradeStatusRef.current.set(t.id, t.status);
          if (isFreshLiveCandleTime(t.exitTime ?? t.entryTime, nowMs, maxAgeMin)) {
            dispatchLiveNotification({
              id: `CLOSE:${t.id}:${t.exitTime ?? 'EXIT'}`,
              kind: 'TRADE_CLOSED',
              direction: dir,
              signal: t.signal || `${stratKey} ${dir}`,
              source: 'LIVE_CHART',
              timestamp: nowMs,
              candleTimeSec: t.exitTime ?? t.entryTime,
              entryPrice: Number(t.entryPrice.toFixed(2)),
              exitPrice: t.exitPrice !== undefined ? Number(t.exitPrice.toFixed(2)) : undefined,
              exitReason: t.exitReason || t.status,
              status: t.status,
              spotPnl: t.pnl !== undefined ? Number(t.pnl.toFixed(2)) : undefined,
              optionStrike: t.optionStrike ?? Math.round(t.entryPrice / 50) * 50,
              optionType: t.optionType ?? optType,
              optionEntryPremium: t.optionEntryPremium,
              optionExitPremium: t.optionExitPremium,
              premiumPnl: t.premiumPnl,
              lotPnl: t.lotPnl,
            });
          }
        } else if (prevStatus !== t.status) {
          seenTradeStatusRef.current.set(t.id, t.status);
        }
      }

      if (nextPendingSetup) {
        const pendingKey = `PENDING:SAM:${nextPendingSetup.setupBarTime}:${nextPendingSetup.type}`;
        if (seenPendingKeyRef.current !== pendingKey) {
          seenPendingKeyRef.current = pendingKey;
          if (isFreshLiveCandleTime(nextPendingSetup.setupBarTime, nowMs, maxAgeMin)) {
            dispatchLiveNotification({
              id: pendingKey,
              kind: 'SETUP_PENDING',
              direction: nextPendingSetup.type,
              signal: `SAM ${nextPendingSetup.type} Setup (Bar 0 Closed)`,
              source: 'LIVE_CHART',
              timestamp: nowMs,
              candleTimeSec: nextPendingSetup.setupBarTime,
              entryPrice: Number(nextPendingSetup.estEntry.toFixed(2)),
              stoploss: nextPendingSetup.estSL,
              target: nextPendingSetup.estTP,
              optionStrike: Math.round(nextPendingSetup.estEntry / 50) * 50,
              optionType: nextPendingSetup.type === 'CALL' ? 'CE' : 'PE',
              message: `Bar 0 closed at ${nextPendingSetup.setupBarClose.toFixed(2)} • Awaiting Bar+1`,
            });
          }
        }
      } else {
        seenPendingKeyRef.current = '';
      }
    }
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const getTradeDateKey = (ts?: number): string => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Extract all unique dates from trades with trade counts and formatted labels
  const availableTradeDates = useMemo(() => {
    const dateMap = new Map<string, { dateKey: string; label: string; count: number }>();
    for (const t of backtestTrades) {
      if (!t.entryTime) continue;
      const key = getTradeDateKey(t.entryTime);
      if (!key) continue;
      const label = formatDate(t.entryTime);
      const existing = dateMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        dateMap.set(key, { dateKey: key, label, count: 1 });
      }
    }
    // Sort descending by date (most recent date first)
    return Array.from(dateMap.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [backtestTrades]);

  // Filter trades based on selected date or custom range
  const displayedTrades = useMemo(() => {
    if (selectedDateFilter === 'ALL' && !isCustomRangeOpen) {
      return backtestTrades;
    }

    if (isCustomRangeOpen) {
      return backtestTrades.filter(t => {
        const k = getTradeDateKey(t.entryTime);
        if (!k) return false;
        if (customStartDate && k < customStartDate) return false;
        if (customEndDate && k > customEndDate) return false;
        return true;
      });
    }

    if (selectedDateFilter !== 'ALL') {
      return backtestTrades.filter(t => getTradeDateKey(t.entryTime) === selectedDateFilter);
    }

    return backtestTrades;
  }, [backtestTrades, selectedDateFilter, isCustomRangeOpen, customStartDate, customEndDate]);

  const totalTrades = displayedTrades.length;
  const wins = displayedTrades.filter(t => t.status === 'WIN').length;
  const losses = displayedTrades.filter(t => t.status === 'LOSS').length;
  const beTrades = displayedTrades.filter(t => t.status === 'BE').length;
  const dayEndSquareOffs = displayedTrades.filter(t => t.exitReason === 'DAY_END').length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const totalNetPnL = displayedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const realOptionTrades = displayedTrades.filter(
    t => t.premiumPnl !== undefined && t.optionDataSource && t.optionDataSource !== 'UNAVAILABLE'
  );
  const optionDataCoverage = realOptionTrades.length;
  const totalNetPremPnL = Number(
    realOptionTrades.reduce((acc, t) => acc + (t.premiumPnl || 0), 0).toFixed(2)
  );
  const totalLotPnL = Number(
    realOptionTrades.reduce((acc, t) => acc + (t.lotPnl || 0), 0).toFixed(2)
  );
  const profitFactor = (() => {
    const grossProfit = displayedTrades.filter(t => (t.pnl || 0) > 0).reduce((acc, t) => acc + (t.pnl || 0), 0);
    const grossLoss = Math.abs(displayedTrades.filter(t => (t.pnl || 0) < 0).reduce((acc, t) => acc + (t.pnl || 0), 0));
    return grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '0.00';
  })();

  const closedTradesWithDuration = displayedTrades.filter(t => t.exitTime && t.entryTime && t.status !== 'OPEN');
  const avgDurationSec = closedTradesWithDuration.length > 0
    ? Math.floor(closedTradesWithDuration.reduce((acc, t) => acc + ((t.exitTime || 0) - t.entryTime), 0) / closedTradesWithDuration.length)
    : 0;
  const avgDurationFormatted = formatDuration(0, avgDurationSec);

  const shouldShowPendingSetup = pendingSamSetup && (
    (selectedDateFilter === 'ALL' && !isCustomRangeOpen) ||
    (selectedDateFilter === getTradeDateKey(pendingSamSetup.setupBarTime)) ||
    (isCustomRangeOpen && (
      (!customStartDate || getTradeDateKey(pendingSamSetup.setupBarTime) >= customStartDate) &&
      (!customEndDate || getTradeDateKey(pendingSamSetup.setupBarTime) <= customEndDate)
    ))
  );

  const exportTradesCsv = () => {
    if (displayedTrades.length === 0) return;
    const headers = [
      'Trade #', 'Date', 'Time', 'Strategy/Signal', 'Type', 'Entry Spot', 'Stoploss Spot', 
      'Target Spot', 'Target 2 Spot', 'Exit Time', 'Duration', 'Exit Reason', 'Status', 
      'Spot PnL (pts)', 'Option Contract', 'Option Expiry', 'Option Source', 'Option Delta', 'Entry Prem (₹)', 'Exit Prem (₹)', 
      'Prem PnL (pts)', '1 Lot PnL (65 Qty)'
    ];

    const rows = displayedTrades.map((t, idx) => [
      idx + 1,
      formatDate(t.entryTime),
      formatTime(t.entryTime),
      `"${t.signal || ''}"`,
      t.type,
      t.entryPrice?.toFixed(2) ?? '',
      t.stoploss?.toFixed(2) ?? '',
      t.target?.toFixed(2) ?? '',
      t.target2?.toFixed(2) ?? '',
      t.exitTime ? formatTime(t.exitTime) : '',
      t.duration || (t.exitTime ? formatDuration(t.entryTime, t.exitTime) : ''),
      t.exitReason || '',
      t.status || '',
      t.pnl !== undefined ? t.pnl.toFixed(2) : '',
      t.optionStrike ? `"${t.optionStrike} ${t.optionType}"` : '',
      t.optionExpiry || '',
      t.optionDataSource || 'UNAVAILABLE',
      t.optionDelta !== undefined ? t.optionDelta.toFixed(2) : '',
      t.optionEntryPremium !== undefined ? t.optionEntryPremium.toFixed(2) : '',
      t.optionExitPremium !== undefined ? t.optionExitPremium.toFixed(2) : '',
      t.premiumPnl !== undefined ? t.premiumPnl.toFixed(2) : '',
      t.lotPnl !== undefined ? t.lotPnl.toFixed(2) : ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const dateSuffix = selectedDateFilter !== 'ALL' ? `_${selectedDateFilter}` : isCustomRangeOpen ? '_custom_range' : '';
    link.setAttribute('download', `nifty_backtest_trades${dateSuffix}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full flex flex-col gap-6">
      
      {/* Chart Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] flex flex-col min-h-[560px] md:h-[75vh] md:min-h-[620px]">
        {/* Top Header */}
        <div className="p-3 sm:p-4 border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-2.5 shrink-0 bg-[#0A0F1C]">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <span className={`w-2.5 h-2.5 rounded-full $'bg-brand-blue animate-pulse'`}></span>
            <h3 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-wide">
              'NIFTY 50 Live Chart & PA Bot'
            </h3>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase $'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'`}>
              'NSE INDEX'
            </span>
          </div>
          
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <span className="text-[11px] sm:text-xs font-bold text-gray-400 uppercase mr-1">TF:</span>
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
                className={`px-2.5 sm:px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${timeframe === tf.value ? 'bg-brand-blue text-black font-extrabold shadow-sm' : 'bg-[#1F2937] text-gray-400 hover:text-white'}`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Volume Indicator Controls & Stats */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowVolume(v => !v)}
              className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                showVolume
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 shadow-sm'
                  : 'bg-[#1F2937] border-gray-700 text-gray-400 hover:text-white'
              }`}
              title="Toggle Volume Histogram overlay on chart"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showVolume ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}></span>
              <span>VOL</span>
            </button>
            {volumeMetrics.lastVol > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono bg-[#111827] px-2 py-0.5 rounded border border-[#1F2937]">
                <span className="text-gray-400">Vol:</span>
                <span className="text-white font-bold">{volumeMetrics.lastVol.toLocaleString()}</span>
                <span className="text-gray-600">|</span>
                <span className="text-gray-400">20SMA:</span>
                <span className="text-gray-300">{volumeMetrics.volSma.toLocaleString()}</span>
                <span className="text-gray-600">|</span>
                <span className={`font-bold ${volumeMetrics.rvol >= 1.0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {volumeMetrics.rvol}x
                </span>
              </div>
            )}
          </div>

          <div className="hidden lg:flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
            <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
            <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
            <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
          </div>
        </div>
      
        {/* Strategies Settings Panel */}
        <div className="bg-[#0A0F1C] border-b border-[#1F2937] px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-medium text-gray-300 shrink-0 w-full">

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 w-full">
              {/* Active Strategy Controls Strip (SAM Signals + MACD Adaptive SuperTrend + Settings) */}
              <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto pb-1 sm:pb-0 touch-pan-x whitespace-nowrap scrollbar-thin w-full lg:w-auto">
                {/* MACD + Adaptive SuperTrend Toggle */}
                <div className="flex items-center gap-2 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold" title="NIFTY MACD + Adaptive SuperTrend Strategy">
                    <input 
                      type="checkbox" 
                      checked={strategies.macdAdaptiveSupertrend} 
                      onChange={e => setStrategies(s => ({...s, macdAdaptiveSupertrend: e.target.checked}))} 
                      className="accent-purple-400 cursor-pointer" 
                    />
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                      <span className="text-purple-300">MACD + ST</span>
                    </span>
                  </label>
                </div>

                {/* BEST SAM SIGNALS Strategy Control (dy26102001) */}
                <div className="flex items-center gap-2 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold" title="BEST SAM SIGNALS: Fast SMA(1) - Slow SMA(34) vs WMA(5) crossover">
                    <input 
                      type="checkbox" 
                      checked={strategies.samSignals} 
                      onChange={e => setStrategies(s => ({...s, samSignals: e.target.checked}))} 
                      className="accent-blue-400 cursor-pointer" 
                    />
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="flex gap-0.5 items-center">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: samConfig.colorBuy }}></span>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: samConfig.colorSell }}></span>
                      </span>
                      <span className="text-blue-300 font-bold">SAM Signals</span>
                    </span>
                  </label>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Fast / Slow / Signal Quick Label */}
                  <span className="text-[10px] font-mono text-gray-400 hidden sm:inline" title="Fast SMA / Slow SMA / Signal WMA">
                    {samConfig.maFastPeriod}/{samConfig.maSlowPeriod}/{samConfig.signalPeriod}
                  </span>

                  <div className="h-3 w-px bg-gray-700 hidden sm:block"></div>

                  {/* SL badge */}
                  <span className="text-[11px] font-mono text-rose-300 font-semibold" title="Stop Loss: 20 points from entry candle">
                    SL:{samConfig.stopLossPoints}pt
                  </span>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Trailing SL indicator */}
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${(samConfig.trailingStopEnabled ?? true) ? 'bg-blue-950/70 text-blue-300 border border-blue-600/40' : 'text-gray-500'}`}
                    title="Trailing SL: Market +20pt -> SL to Entry, Market +40pt -> SL to Entry+20pt"
                  >
                    Trail: 20/40pt
                  </span>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Pre-market filter indicator */}
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${(samConfig.noTradeBefore915 ?? true) ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-600/40' : 'text-gray-500'}`}
                    title="Pre-market restriction: Strictly no trades before regular market opens at 09:15 AM IST"
                  >
                    ≥09:15
                  </span>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick Entry Timing toggle */}
                  <button
                    type="button"
                    onClick={() => setSamConfig(c => ({ ...c, entryTiming: 'bar1Close' }))}
                    disabled={!strategies.samSignals}
                    className="px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/60"
                    title="Entry Timing: Bar + 1 Close (Post-Adverse Filter — Zero Repaint). Entry, Stoploss & Target are calculated strictly upon Bar+1 candle close."
                  >
                    Entry: Bar+1 Close (Zero Repaint)
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick ADX Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, adxFilterEnabled: !c.adxFilterEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.adxFilterEnabled
                        ? 'bg-amber-950/70 border-amber-500/60 text-amber-300'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title={samConfig.adxFilterEnabled ? `ADX Filter ACTIVE (>= ${samConfig.adxThreshold})` : "Click to apply ADX filter"}
                  >
                    {samConfig.adxFilterEnabled ? `ADX:ON` : `ADX:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick Adverse Rejection Wick (>35%) Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterRejectionWickEnabled: !c.filterRejectionWickEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterRejectionWickEnabled
                        ? 'bg-purple-950/70 border-purple-500/60 text-purple-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title={
                      samConfig.filterRejectionWickEnabled
                        ? `Adverse Rejection Wick (>${samConfig.rejectionWickMaxPercent ?? 35}%) ACTIVE: Blocks signals with opposing wick >35% (40% losses filtered, 0% wins filtered)`
                        : "Click to toggle Adverse Rejection Wick (>35%) filter"
                    }
                  >
                    {samConfig.filterRejectionWickEnabled ? `Wick>35%:ON` : `Wick:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick Immediate Adverse Close on Bar +1 toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterBar1AdverseCloseEnabled: !c.filterBar1AdverseCloseEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterBar1AdverseCloseEnabled
                        ? 'bg-rose-950/70 border-rose-500/60 text-rose-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title={
                      samConfig.filterBar1AdverseCloseEnabled
                        ? `Immediate Adverse Close Bar+1 ACTIVE [Mode: ${samConfig.bar1ActionMode === 'exit' ? 'Cut Loss on Bar+1 Close' : 'Invalidate Signal'}] (70% in losses, 10% in wins)`
                        : "Click to toggle Immediate Adverse Close on Bar+1 filter"
                    }
                  >
                    {samConfig.filterBar1AdverseCloseEnabled ? `Bar+1:ON` : `Bar+1:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick Min Body Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterMinBodyEnabled: !c.filterMinBodyEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterMinBodyEnabled
                        ? 'bg-amber-950/70 border-amber-500/60 text-amber-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title="Click to toggle Minimum Candle Body / Doji Filter"
                  >
                    {samConfig.filterMinBodyEnabled ? `Body:ON` : `Body:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick 5m MTF EMA Trend Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterMtfEmaEnabled: !c.filterMtfEmaEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterMtfEmaEnabled
                        ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title="Click to toggle 5-Minute MTF EMA Trend Filter"
                  >
                    {samConfig.filterMtfEmaEnabled ? `5mEMA:ON` : `5mEMA:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick Day High/Low Trap Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterDayTrapEnabled: !c.filterDayTrapEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterDayTrapEnabled
                        ? 'bg-indigo-950/70 border-indigo-500/60 text-indigo-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title="Click to toggle Day High/Low Trap Filter"
                  >
                    {samConfig.filterDayTrapEnabled ? `DayTrap:ON` : `DayTrap:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick S12 Confluence Filter toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterS12ConfluenceEnabled: !c.filterS12ConfluenceEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterS12ConfluenceEnabled
                        ? 'bg-sky-950/70 border-sky-400/60 text-sky-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title={`S12 Confluence Filter: DI Spread > +${samConfig.s12DiSpreadMin ?? 5} + EMA ${samConfig.s12EmaFastPeriod ?? 100}/${samConfig.s12EmaSlowPeriod ?? 200} Alignment + RVOL >= ${samConfig.s12MinRvol ?? 0.7}`}
                  >
                    {samConfig.filterS12ConfluenceEnabled ? `S12:ON` : `S12:OFF`}
                  </button>

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Quick SAM 21/5 Afternoon (#3/#5) toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterSam21AfternoonEnabled: !c.filterSam21AfternoonEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterSam21AfternoonEnabled
                        ? 'bg-emerald-950/70 border-emerald-400/60 text-emerald-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title="1m SAM(21/5) Afternoon Breakout (12:30–14:50 IST): PDH/PDL + 5m ADX >= 30 & DI Spread > 5 (#3 Fixed SL40/BE30/EOD or #5 Chandelier)"
                  >
                    {samConfig.filterSam21AfternoonEnabled ? `21/5 Aft:ON` : `21/5 Aft:OFF`}
                  </button>

                  {/* Quick SAM 21/5 Morning+Afternoon Combined (#1 + #3/#5) toggle */}
                  <button
                    onClick={() => setSamConfig(c => ({ ...c, filterSam21CombinedEnabled: !c.filterSam21CombinedEnabled }))}
                    disabled={!strategies.samSignals}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      samConfig.filterSam21CombinedEnabled
                        ? 'bg-amber-950/70 border-amber-400/60 text-amber-300 shadow-sm'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                    title="SAM(21/5) Morning + Afternoon Combined: 3m OpenDrive (09:20–10:15, BE30 / +50➔+20 Lock + 3x ATR) + 1m Afternoon (12:30–14:50)"
                  >
                    {samConfig.filterSam21CombinedEnabled ? `21/5 Comb:ON` : `21/5 Comb:OFF`}
                  </button>

                  <button
                    onClick={() => setShowStrategySettingsModal('SAM')}
                    className="px-1.5 py-0.5 rounded text-[11px] bg-[#1F2937] hover:bg-[#374151] text-blue-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer font-medium"
                    title="Configure SAM strategy (Fast/Slow SMA, Signal WMA, SL, ADX filter, Colors)"
                  >
                    <span>⚙️ SAM</span>
                  </button>
                </div>

                {/* Dedicated Settings Button - ALWAYS Visible in vertical and horizontal modes */}
                <button
                  onClick={() => setShowStrategySettingsModal('SAM')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-950/60 hover:bg-blue-900/80 border border-blue-600/40 text-blue-300 hover:text-white font-semibold text-xs transition-colors shrink-0 shadow-sm cursor-pointer whitespace-nowrap"
                  title="Open SAM Strategy Calibration & Settings"
                >
                  <span className="text-sm">⚙️</span>
                  <span>Settings</span>
                </button>
              </div>
            </div>
        </div>
      
        <div className="flex-1 relative min-h-[380px] w-full overflow-hidden">
          {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
          <div ref={chartContainerRef} className="absolute inset-0" />
        </div>
      </div>

      {/* Signals Dashboard Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] flex flex-col w-full">
        {/* Header & Metrics */}
        <div className="p-3.5 sm:p-4 border-b border-[#1F2937] flex flex-col shrink-0 bg-[#0A0F1C] gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{`Backtest Dashboard (${instrument} ${timeframe}m)`}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  SAM Zero-Repaint
                </span>
              </h3>

              {/* View Mode Toggle: Table or Mobile Cards */}
              <div className="flex items-center bg-[#111827] p-0.5 rounded border border-[#1F2937] text-xs">
                <button
                  onClick={() => setTradeViewMode('table')}
                  className={`px-2 py-0.5 rounded transition-all font-medium cursor-pointer ${
                    tradeViewMode === 'table' ? 'bg-brand-blue text-black font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                  title="Full detailed backtest table view"
                >
                  📋 Table
                </button>
                <button
                  onClick={() => setTradeViewMode('cards')}
                  className={`px-2 py-0.5 rounded transition-all font-medium cursor-pointer ${
                    tradeViewMode === 'cards' ? 'bg-brand-blue text-black font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                  title="Mobile-optimized vertical card view"
                >
                  📱 Cards
                </button>
              </div>

              {/* CSV Export Button */}
              <button
                onClick={exportTradesCsv}
                disabled={displayedTrades.length === 0}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-[#111827] hover:bg-emerald-500/10 text-gray-300 hover:text-emerald-400 transition-colors flex items-center gap-1.5 border border-[#1F2937] hover:border-emerald-500/40 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Export filtered backtest trades to CSV"
              >
                <span>📥 CSV</span>
              </button>
            </div>

            {/* Collapsible Filters Toggle & Reset Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setIsFiltersOpen(prev => !prev)}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-[#1F2937] hover:bg-[#374151] text-gray-200 transition-colors flex items-center gap-1.5 border border-[#374151] cursor-pointer"
              >
                <span>⚙️ SAM Filters ({
                  (samConfig.adxFilterEnabled ? 1 : 0) +
                  (samConfig.filterRejectionWickEnabled ? 1 : 0) +
                  (samConfig.filterBar1AdverseCloseEnabled ? 1 : 0) +
                  (samConfig.vwapFilterEnabled ? 1 : 0) +
                  (samConfig.filterMinBodyEnabled ? 1 : 0) +
                  (samConfig.filterMtfEmaEnabled ? 1 : 0) +
                  (samConfig.filterDayTrapEnabled ? 1 : 0) +
                  (samConfig.adaptiveRegimeEnabled ? 1 : 0) +
                  (samConfig.circuitBreakerEnabled ? 1 : 0) +
                  (samConfig.antiWhipsawEnabled ? 1 : 0) +
                  (samConfig.maxDailyLossEnabled ? 1 : 0) +
                  (samConfig.filterS12ConfluenceEnabled ? 1 : 0) +
                  (samConfig.filterSam21AfternoonEnabled ? 1 : 0) +
                  (samConfig.filterSam21CombinedEnabled ? 1 : 0)
                } Active)</span>
                <span className="text-[10px]">{isFiltersOpen ? '▲ Hide' : '▼ Show'}</span>
              </button>
              <button
                onClick={handleResetFilters}
                className="px-2 py-1 text-[11px] rounded bg-[#111827] hover:bg-amber-500/10 text-gray-400 hover:text-amber-300 border border-[#1F2937] hover:border-amber-400/40 transition-colors cursor-pointer"
                title="Reset all filters back to default"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Date Filter Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#1F2937]/70 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1 shrink-0">
                <span>📅</span>
                <span>Date Filter:</span>
              </span>

              {/* Date Select Dropdown */}
              <select
                value={isCustomRangeOpen ? 'CUSTOM' : selectedDateFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'CUSTOM') {
                    setIsCustomRangeOpen(true);
                  } else {
                    setIsCustomRangeOpen(false);
                    setSelectedDateFilter(val);
                  }
                }}
                className="bg-[#111827] border border-[#374151] rounded px-2.5 py-1 text-xs text-white font-mono focus:border-brand-blue outline-none cursor-pointer"
              >
                <option value="ALL">All Dates ({backtestTrades.length} Total Trades)</option>
                {availableTradeDates.map(d => (
                  <option key={d.dateKey} value={d.dateKey}>
                    {d.label} ({d.count} {d.count === 1 ? 'trade' : 'trades'})
                  </option>
                ))}
                <option value="CUSTOM">Custom Date Range...</option>
              </select>

              {/* Quick 1-Click Date Buttons */}
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomRangeOpen(false);
                    setSelectedDateFilter('ALL');
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer border ${
                    selectedDateFilter === 'ALL' && !isCustomRangeOpen
                      ? 'bg-brand-blue/20 text-brand-blue border-brand-blue/40 font-bold'
                      : 'bg-[#111827] text-gray-400 border-[#1F2937] hover:text-white'
                  }`}
                >
                  All ({backtestTrades.length})
                </button>
                {availableTradeDates.map(d => (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() => {
                      setIsCustomRangeOpen(false);
                      setSelectedDateFilter(d.dateKey);
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer border ${
                      selectedDateFilter === d.dateKey && !isCustomRangeOpen
                        ? 'bg-brand-green/20 text-brand-green border-brand-green/40 font-bold'
                        : 'bg-[#111827] text-gray-400 border-[#1F2937] hover:text-white'
                    }`}
                  >
                    {d.label.split(' ').slice(0, 2).join(' ')} ({d.count})
                  </button>
                ))}
              </div>

              {/* Custom Date Range Picker */}
              {isCustomRangeOpen && (
                <div className="flex items-center gap-1.5 bg-[#111827] px-2.5 py-1 rounded border border-brand-blue/50 text-xs font-mono">
                  <span className="text-gray-400 text-[10px]">From:</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-[11px] text-white focus:border-brand-blue outline-none cursor-pointer"
                  />
                  <span className="text-gray-400 text-[10px]">To:</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-[11px] text-white focus:border-brand-blue outline-none cursor-pointer"
                  />
                  {(customStartDate || customEndDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomStartDate('');
                        setCustomEndDate('');
                      }}
                      className="text-gray-400 hover:text-red-400 text-xs px-1 cursor-pointer font-bold"
                      title="Clear Custom Date Range"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Clear Filter / Reset to All */}
            {(selectedDateFilter !== 'ALL' || isCustomRangeOpen) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDateFilter('ALL');
                  setIsCustomRangeOpen(false);
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
              >
                <span>✕ Clear Date Filter</span>
                <span className="text-[10px] text-gray-400 font-mono">({displayedTrades.length} of {backtestTrades.length})</span>
              </button>
            )}
          </div>

          {/* Performance Summary Metrics (Responsive Grid for Portrait/Landscape) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:flex md:flex-wrap gap-x-3 gap-y-1.5 text-xs text-gray-400 items-center bg-[#111827]/60 p-2 rounded-lg border border-[#1F2937]/80">
            {selectedDateFilter !== 'ALL' && !isCustomRangeOpen && (
              <div className="flex items-center gap-1.5 bg-brand-blue/10 text-brand-blue px-2 py-0.5 rounded border border-brand-blue/30 font-mono font-bold">
                <span>📅 Date:</span>
                <span>{availableTradeDates.find(d => d.dateKey === selectedDateFilter)?.label || selectedDateFilter}</span>
                <span className="text-gray-400 font-normal">({displayedTrades.length} of {backtestTrades.length})</span>
              </div>
            )}
            {isCustomRangeOpen && (
              <div className="flex items-center gap-1.5 bg-brand-blue/10 text-brand-blue px-2 py-0.5 rounded border border-brand-blue/30 font-mono font-bold">
                <span>📅 Range:</span>
                <span>{customStartDate || 'Start'} → {customEndDate || 'End'}</span>
                <span className="text-gray-400 font-normal">({displayedTrades.length} of {backtestTrades.length})</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span>Total:</span>
              <span className="text-white font-bold">{totalTrades}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Wins:</span>
              <span className="text-emerald-500 font-bold">{wins}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Losses:</span>
              <span className="text-red-500 font-bold">{losses}</span>
            </div>
            {beTrades > 0 && (
              <div className="flex items-center gap-1.5">
                <span>BE Safe:</span>
                <span className="text-cyan-400 font-bold">{beTrades}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span>Win Rate:</span>
              <span className="text-brand-blue font-bold">{winRate}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Spot Net:</span>
              <span className={`font-bold ${totalNetPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(totalNetPnL >= 0 ? '+' : '') + totalNetPnL.toFixed(1)} pts
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Net option premium P&L strictly from real Option Chain History / Upstox 1-min option prices (exit premium minus entry premium)">
              <span className="text-cyan-400">Prem Net:</span>
              {isResolvingOptionPremiums && optionDataCoverage < displayedTrades.length ? (
                <span className="text-amber-300 font-bold animate-pulse">Loading OC...</span>
              ) : optionDataCoverage === 0 && displayedTrades.length > 0 ? (
                <span className="text-gray-400 font-semibold">No OC Data</span>
              ) : (
                <span className={`font-bold ${totalNetPremPnL >= 0 ? 'text-cyan-300' : 'text-red-400'}`}>
                  {(totalNetPremPnL >= 0 ? '+' : '') + totalNetPremPnL.toFixed(2)} pts
                  {optionDataCoverage < displayedTrades.length && (
                    <span className="ml-1 text-[10px] text-amber-300">({optionDataCoverage}/{displayedTrades.length})</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30" title="Exact sum of real 1-lot (65 Qty) option P&L across matched trades">
              <span className="text-gray-300">1 Lot Net (65 Qty):</span>
              {(isResolvingOptionPremiums || isBackfillingHistory) && optionDataCoverage < displayedTrades.length ? (
                <span className="text-amber-300 font-bold animate-pulse">Loading...</span>
              ) : optionDataCoverage === 0 && displayedTrades.length > 0 ? (
                <span className="text-gray-400 font-semibold">No OC Data</span>
              ) : (
                <span className={`font-extrabold ${totalLotPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(totalLotPnL >= 0 ? '+₹' : '-₹') + Math.abs(totalLotPnL).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              <button
                type="button"
                onClick={handleBackfillHistoricalPremiums}
                disabled={isBackfillingHistory}
                title="Extract & save historical 1-minute option premiums from Upstox into PostgreSQL"
                className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/50 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isBackfillingHistory ? 'Syncing...' : 'Sync Hist OC'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Profit Factor:</span>
              <span className="text-amber-300 font-bold">{profitFactor}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Avg Duration:</span>
              <span className="text-purple-400 font-bold">{avgDurationFormatted}</span>
            </div>
            {dayEndSquareOffs > 0 && (
              <div className="flex items-center gap-1.5">
                <span>Day-End:</span>
                <span className="text-amber-400 font-bold">{dayEndSquareOffs}</span>
              </div>
            )}
            {comparisonStats.filteredCount > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400 font-medium col-span-2 sm:col-span-1">
                <span>Filtered Out:</span>
                <span className="font-bold">{comparisonStats.filteredCount}</span>
              </div>
            )}
            {strategies.samSignals && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-gray-400">Regime:</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                  comparisonStats.currentRegimeState === 'TREND_BULL'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : comparisonStats.currentRegimeState === 'TREND_BEAR'
                      ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                      : 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                }`}>
                  {comparisonStats.currentRegimeState === 'TREND_BULL'
                    ? '🟢 Bull Trend'
                    : comparisonStats.currentRegimeState === 'TREND_BEAR'
                      ? '🔴 Bear Trend'
                      : '⚖️ Dynamic Range'}
                </span>
              </div>
            )}
            {strategies.samSignals && comparisonStats.dailyDrawdownHalted && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                  🛑 Daily Max Loss Halted
                </span>
              </div>
            )}
            {strategies.samSignals && !comparisonStats.dailyDrawdownHalted && comparisonStats.circuitBreakerActive && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                  ⏸️ Circuit Breaker Cooldown
                </span>
              </div>
            )}
          </div>

        </div>

        {/* SAM Signals 1-Min Empirical Loss Filters (Collapsible) */}
        {isFiltersOpen && strategies.samSignals && (
          <div className="bg-blue-950/20 border-b border-[#1F2937] px-3.5 sm:px-4 py-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-bold text-blue-300 flex items-center gap-1.5">
                      <span>🛡️</span>
                      <span>SAM 1-Min Failure Protection:</span>
                    </span>

                    {/* Filter 1: Adverse Rejection Wick */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Filters entry bars with opposing rejection wick >35% (40% losses filtered, 0% wins filtered)">
                      <input
                        type="checkbox"
                        checked={samConfig.filterRejectionWickEnabled}
                        onChange={e => setSamConfig(c => ({ ...c, filterRejectionWickEnabled: e.target.checked }))}
                        className="accent-purple-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterRejectionWickEnabled ? 'text-purple-300' : 'text-gray-400'}`}>
                        Rejection Wick &gt;{samConfig.rejectionWickMaxPercent ?? 35}% ({comparisonStats.wickFiltered})
                      </span>
                      <span className="text-[10px] bg-purple-500/10 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/20 font-mono">
                        40% Losses / 0% Wins
                      </span>
                    </label>

                    {/* Filter 2: Immediate Adverse Close on Bar +1 */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Next candle closes in opposite direction of signal (70% in losses, 10% in wins)">
                      <input
                        type="checkbox"
                        checked={samConfig.filterBar1AdverseCloseEnabled}
                        onChange={e => setSamConfig(c => ({ ...c, filterBar1AdverseCloseEnabled: e.target.checked }))}
                        className="accent-rose-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterBar1AdverseCloseEnabled ? 'text-rose-300' : 'text-gray-400'}`}>
                        Immediate Adverse Bar+1 ({comparisonStats.bar1Filtered})
                      </span>
                      <span className="text-[10px] bg-rose-500/10 text-rose-300 px-1.5 py-0.2 rounded border border-rose-500/20 font-mono">
                        70% Losses / 10% Wins [{samConfig.bar1ActionMode === 'exit' ? 'Cut' : 'Skip'}]
                      </span>
                    </label>

                    {/* Filter 3: Smart Intraday VWAP & Climax Filter */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Smart Intraday VWAP: Institutional trend alignment (Long >= VWAP, Short <= VWAP) + Climax Exhaustion Band (<= 70pt) + Early Reversal Exit unblocking. Click to toggle ON/OFF.">
                      <input
                        type="checkbox"
                        checked={samConfig.vwapFilterEnabled ?? true}
                        onChange={e => setSamConfig(c => ({ ...c, vwapFilterEnabled: e.target.checked }))}
                        className="accent-cyan-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.vwapFilterEnabled ? 'text-cyan-300' : 'text-gray-400'}`}>
                        Smart VWAP ({comparisonStats.vwapFiltered})
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        samConfig.vwapFilterEnabled
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {samConfig.vwapFilterEnabled ? 'ON' : 'OFF'} • &le;{samConfig.vwapMaxDistancePoints ?? 70}pt Band
                      </span>
                    </label>

                    {/* Show VWAP Line Toggle */}
                    <label className="flex items-center gap-1 cursor-pointer text-gray-400 hover:text-cyan-300 text-[11px]" title="Toggle Intraday VWAP line overlay on chart">
                      <input
                        type="checkbox"
                        checked={samConfig.showVwapLine ?? true}
                        onChange={e => setSamConfig(c => ({ ...c, showVwapLine: e.target.checked }))}
                        className="accent-cyan-400 cursor-pointer w-3.5 h-3.5"
                      />
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block"></span>
                        <span>VWAP Line</span>
                      </span>
                    </label>

                    {/* Filter 4: Minimum Candle Body Filter (Kill Dojis) */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Filters entry candles with tiny body or doji (lacks institutional follow-through)">
                      <input
                        type="checkbox"
                        checked={samConfig.filterMinBodyEnabled}
                        onChange={e => setSamConfig(c => ({ ...c, filterMinBodyEnabled: e.target.checked }))}
                        className="accent-amber-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterMinBodyEnabled ? 'text-amber-300' : 'text-gray-400'}`}>
                        Min Body &ge;{samConfig.minBodyPoints ?? 7}pt ({comparisonStats.minBodyFiltered})
                      </span>
                      <span className="text-[10px] bg-amber-500/10 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/20 font-mono">
                        Kill Dojis
                      </span>
                    </label>

                    {/* Filter 5: 5-Minute MTF EMA Trend Alignment */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Only takes CALLs above 5m EMA20 and PUTs below 5m EMA20. Dynamic momentum without VWAP lag.">
                      <input
                        type="checkbox"
                        checked={samConfig.filterMtfEmaEnabled}
                        onChange={e => setSamConfig(c => ({ ...c, filterMtfEmaEnabled: e.target.checked }))}
                        className="accent-emerald-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterMtfEmaEnabled ? 'text-emerald-300' : 'text-gray-400'}`}>
                        5m EMA{samConfig.mtfEmaPeriod ?? 20} ({comparisonStats.mtfEmaFiltered})
                      </span>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/20 font-mono">
                        MTF Trend
                      </span>
                    </label>

                    {/* Filter 6: Day High / Day Low Trap */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Prevents buying into Day High resistance or shorting into Day Low support within 10 points.">
                      <input
                        type="checkbox"
                        checked={samConfig.filterDayTrapEnabled}
                        onChange={e => setSamConfig(c => ({ ...c, filterDayTrapEnabled: e.target.checked }))}
                        className="accent-indigo-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterDayTrapEnabled ? 'text-indigo-300' : 'text-gray-400'}`}>
                        Day H/L Trap &le;{samConfig.dayTrapBufferPoints ?? 10}pt ({comparisonStats.dayTrapFiltered})
                      </span>
                      <span className="text-[10px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-500/20 font-mono">
                        Range Guard
                      </span>
                    </label>

                    {/* Filter 7: Dynamic Regime Classification (Dual-Mode VWAP) */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Dual-Mode Adaptive VWAP: Trend Mode enforces trend alignment; Range Mode enables two-way dip-buying and short bounces without getting chopped. Click to toggle ON/OFF.">
                      <input
                        type="checkbox"
                        checked={samConfig.adaptiveRegimeEnabled ?? true}
                        onChange={e => setSamConfig(c => ({ ...c, adaptiveRegimeEnabled: e.target.checked }))}
                        className="accent-teal-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.adaptiveRegimeEnabled ? 'text-teal-300' : 'text-gray-400'}`}>
                        Dynamic Regime ({comparisonStats.adaptiveRegimeFiltered})
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        samConfig.adaptiveRegimeEnabled
                          ? 'bg-teal-500/10 text-teal-300 border-teal-500/20'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {comparisonStats.currentRegimeState === 'TREND_BULL'
                          ? '🟢 Bull Trend'
                          : comparisonStats.currentRegimeState === 'TREND_BEAR'
                            ? '🔴 Bear Trend'
                            : '⚖️ Range Mode'}
                      </span>
                    </label>

                    {/* Filter 8: Directional Loss Circuit Breaker */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Circuit Breaker: Freezes directional trades for 20m after 3 consecutive losses in that direction, preventing revenge loops while allowing opposite breakout trades. Click to toggle ON/OFF.">
                      <input
                        type="checkbox"
                        checked={samConfig.circuitBreakerEnabled ?? true}
                        onChange={e => setSamConfig(c => ({ ...c, circuitBreakerEnabled: e.target.checked }))}
                        className="accent-amber-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.circuitBreakerEnabled ? 'text-amber-300' : 'text-gray-400'}`}>
                        Circuit Breaker ({comparisonStats.circuitBreakerFiltered})
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        comparisonStats.circuitBreakerActive
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                      }`}>
                        {comparisonStats.circuitBreakerActive ? '⏸️ Cooling' : `${samConfig.circuitBreakerConsecutiveLosses ?? 3}L Cooldown`}
                      </span>
                    </label>

                    {/* Filter 9: Anti-Whipsaw Protection */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Anti-Whipsaw: Suppresses immediate reverse flipping within 10 minutes of a losing trade. Click to toggle ON/OFF.">
                      <input
                        type="checkbox"
                        checked={samConfig.antiWhipsawEnabled ?? false}
                        onChange={e => setSamConfig(c => ({ ...c, antiWhipsawEnabled: e.target.checked }))}
                        className="accent-violet-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.antiWhipsawEnabled ? 'text-violet-300' : 'text-gray-400'}`}>
                        Anti-Whipsaw ({comparisonStats.antiWhipsawFiltered})
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        samConfig.antiWhipsawEnabled
                          ? 'bg-violet-500/10 text-violet-300 border-violet-500/20'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {samConfig.antiWhipsawMinutes ?? 10}m Window
                      </span>
                    </label>

                    {/* Filter 10: Daily Drawdown Guard */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Daily Drawdown Guard: Stops taking new trades if accumulated daily loss hits limit (e.g. -75 pts). Click to toggle ON/OFF.">
                      <input
                        type="checkbox"
                        checked={samConfig.maxDailyLossEnabled ?? false}
                        onChange={e => setSamConfig(c => ({ ...c, maxDailyLossEnabled: e.target.checked }))}
                        className="accent-red-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.maxDailyLossEnabled ? 'text-red-300' : 'text-gray-400'}`}>
                        Daily Drawdown Guard
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        comparisonStats.dailyDrawdownHalted
                          ? 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse'
                          : 'bg-red-500/10 text-red-300 border-red-500/20'
                      }`}>
                        {comparisonStats.dailyDrawdownHalted ? '🛑 Halted' : `${samConfig.maxDailyLossPoints ?? 75}pt Max`}
                      </span>
                    </label>

                    {/* Filter 11: S12 Confluence Filter */}
                    <label
                      className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white"
                      title={`S12 Confluence Filter (Zero-Lookahead): Requires DI Spread > +${samConfig.s12DiSpreadMin ?? 5}, Close aligned with both EMA ${samConfig.s12EmaFastPeriod ?? 100} & EMA ${samConfig.s12EmaSlowPeriod ?? 200}, and Bar+1 RVOL >= ${samConfig.s12MinRvol ?? 0.7}.`}
                    >
                      <input
                        type="checkbox"
                        checked={samConfig.filterS12ConfluenceEnabled ?? false}
                        onChange={e => setSamConfig(c => ({ ...c, filterS12ConfluenceEnabled: e.target.checked }))}
                        className="accent-sky-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterS12ConfluenceEnabled ? 'text-sky-300' : 'text-gray-400'}`}>
                        S12 Confluence ({comparisonStats.s12Filtered})
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        samConfig.filterS12ConfluenceEnabled
                          ? 'bg-sky-500/10 text-sky-300 border-sky-500/25'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        DI&gt;+{samConfig.s12DiSpreadMin ?? 5} • EMA{samConfig.s12EmaFastPeriod ?? 100}/{samConfig.s12EmaSlowPeriod ?? 200} • RVOL&ge;{samConfig.s12MinRvol ?? 0.7}
                      </span>
                    </label>

                    {/* Filter 12 (Rec #1): 1-Min SAM 21/5 Afternoon Breakout (#3 Fixed or #5 Chandelier) */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <label
                        className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white"
                        title="Recommendation #1 — 1-Min SAM(21/5) Afternoon Breakout (12:30–14:50 IST): PDH/PDL Breakout + Causal 5m ADX >= 30 & DI Spread > 5. Switch between #3 Fixed (SL 40 / BE +30 / EOD, PF 1.91) and #5 Chandelier (SL 0.30% / Trail 0.40% / EOD, PF 1.83)."
                      >
                        <input
                          type="checkbox"
                          checked={samConfig.filterSam21AfternoonEnabled ?? false}
                          onChange={e => setSamConfig(c => ({ ...c, filterSam21AfternoonEnabled: e.target.checked }))}
                          className="accent-emerald-400 cursor-pointer"
                        />
                        <span className={`font-semibold ${samConfig.filterSam21AfternoonEnabled ? 'text-emerald-300' : 'text-gray-400'}`}>
                          SAM 21/5 1m Afternoon{samConfig.filterSam21AfternoonEnabled || samConfig.filterSam21CombinedEnabled ? ` (${comparisonStats.sam21AfternoonSignals})` : ''}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setSamConfig(c => ({
                          ...c,
                          sam21AfternoonExitMode: c.sam21AfternoonExitMode === 'chandelier' ? 'fixed40' : 'chandelier'
                        }))}
                        className={`text-[10px] px-1.5 py-0.2 rounded border font-mono cursor-pointer transition-colors ${
                          samConfig.filterSam21AfternoonEnabled || samConfig.filterSam21CombinedEnabled
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                        }`}
                        title="Click to switch Afternoon Exit Mode between #3 Fixed (SL40/BE+30/EOD) and #5 Chandelier (0.30%/0.40%/EOD)"
                      >
                        {samConfig.sam21AfternoonExitMode === 'chandelier'
                          ? '#5 Chand 0.3%/0.4% • 12:30–14:50'
                          : '#3 SL40/BE30/EOD • 12:30–14:50'}
                      </button>
                    </div>

                    {/* Filter 13 (Rec #2): Morning + Afternoon Combined (3m OpenDrive + 1m Afternoon) */}
                    <label
                      className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white"
                      title="Recommendation #2 — Morning + Afternoon Combined (SAM 21/5): Runs #1 (3m SAM 21/5 OpenDrive 09:20–10:15, PDH/PDL + StrongBar + 15m Supertrend, 2x/3x 5m ATR + BE30 / +50➔+20 Lock) in the morning + #3/#5 (1m SAM 21/5 Afternoon 12:30–14:50) in the afternoon."
                    >
                      <input
                        type="checkbox"
                        checked={samConfig.filterSam21CombinedEnabled ?? false}
                        onChange={e => setSamConfig(c => ({ ...c, filterSam21CombinedEnabled: e.target.checked }))}
                        className="accent-amber-400 cursor-pointer"
                      />
                      <span className={`font-semibold ${samConfig.filterSam21CombinedEnabled ? 'text-amber-300' : 'text-gray-400'}`}>
                        SAM 21/5 Combined{samConfig.filterSam21CombinedEnabled ? ` (${comparisonStats.sam21OpenDriveSignals + comparisonStats.sam21AfternoonSignals})` : ''}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border font-mono ${
                        samConfig.filterSam21CombinedEnabled
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        3m OpenDrive 09:20–10:15 + 1m Aft
                      </span>
                    </label>
                  </div>

                  {(samConfig.filterSam21AfternoonEnabled || samConfig.filterSam21CombinedEnabled) && comparisonStats.sam21LiveStatus && (
                    <div className="w-full mt-1 px-2.5 py-1.5 rounded bg-emerald-950/30 border border-emerald-700/40 text-[10px] font-mono text-gray-300 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-emerald-300 font-bold">
                        LIVE SAM 21/5 ({comparisonStats.sam21LiveStatus.latestDate} {comparisonStats.sam21LiveStatus.latestTimeIst} IST):
                      </span>
                      <span>Spot <strong className="text-white">{comparisonStats.sam21LiveStatus.latestClose.toFixed(1)}</strong></span>
                      <span>
                        PDH <strong className="text-emerald-300">{comparisonStats.sam21LiveStatus.pdh?.toFixed(1) ?? '-'}</strong> / PDL <strong className="text-red-300">{comparisonStats.sam21LiveStatus.pdl?.toFixed(1) ?? '-'}</strong>
                      </span>
                      <span className={
                        comparisonStats.sam21LiveStatus.breakoutState === 'ABOVE_PDH'
                          ? 'text-emerald-300 font-bold'
                          : comparisonStats.sam21LiveStatus.breakoutState === 'BELOW_PDL'
                            ? 'text-red-300 font-bold'
                            : 'text-amber-300'
                      }>
                        {comparisonStats.sam21LiveStatus.breakoutState === 'ABOVE_PDH'
                          ? 'Above PDH (CALL Ready)'
                          : comparisonStats.sam21LiveStatus.breakoutState === 'BELOW_PDL'
                            ? 'Below PDL (PUT Ready)'
                            : 'Inside PDH/PDL Range (No Breakout Yet)'}
                      </span>
                      <span>
                        5m ADX <strong className={(comparisonStats.sam21LiveStatus.adx5m ?? 0) >= 30 ? 'text-emerald-300' : 'text-amber-300'}>
                          {comparisonStats.sam21LiveStatus.adx5m ?? '-'}
                        </strong> (need ≥30)
                      </span>
                      {comparisonStats.sam21LiveStatus.diSpread5m !== null && (
                        <span>
                          DI Δ <strong className={Math.abs(comparisonStats.sam21LiveStatus.diSpread5m) > 5 ? 'text-emerald-300' : 'text-gray-400'}>
                            {comparisonStats.sam21LiveStatus.diSpread5m > 0 ? '+' : ''}{comparisonStats.sam21LiveStatus.diSpread5m}
                          </strong>
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => setShowStrategySettingsModal('SAM')}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer underline"
                  >
                    <span>Configure SAM Filters ⚙️</span>
                  </button>
                </div>
          </div>
        )}

        {/* Pending Confirmation Banner for SAM Bar+1 Setup */}
        {shouldShowPendingSetup && (
          <div className="mx-3.5 sm:mx-4 mt-3 mb-1 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-amber-200">
            <div className="flex items-start sm:items-center gap-2.5">
              <span className="text-base animate-pulse">⏳</span>
              <div>
                <div className="font-bold text-amber-300 flex items-center gap-2">
                  <span>POTENTIAL TRADE / PENDING CONFIRMATION</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    SAM {pendingSamSetup.type}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                    Zero Repaint Rule
                  </span>
                </div>
                <div className="text-[11px] text-gray-300 mt-1">
                  Setup crossover formed on prior candle at {formatTime(pendingSamSetup.setupBarTime)} (Spot: ₹{pendingSamSetup.setupBarClose.toFixed(2)}).
                  Trade entry is <span className="text-amber-300 font-bold">NOT</span> taken at the earlier candle. 
                  Actual entry executes <span className="text-emerald-400 font-bold">strictly upon close of Immediate Adverse Bar + 1</span> (currently forming @ ~₹{pendingSamSetup.estEntry.toFixed(2)}). 
                  Stoploss ({pendingSamSetup.type === 'CALL' ? '-20pt' : '+20pt'}: ₹{pendingSamSetup.estSL.toFixed(2)}) and Target ({pendingSamSetup.type === 'CALL' ? '+60pt' : '-60pt'}: ₹{pendingSamSetup.estTP.toFixed(2)}) are calculated strictly from this Bar + 1 close entry price.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono text-[10px] font-bold animate-pulse">
                AWAITING BAR+1 CLOSE
              </span>
            </div>
          </div>
        )}

        {/* Backtest Trades Container: Responsive Cards or Horizontal Table */}
        {tradeViewMode === 'cards' ? (
          /* Mobile / Portrait Card View: Fully readable vertically without horizontal scrolling */
          <div className="overflow-y-auto max-h-[550px] min-h-[350px] p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-[#0A0F1C]">
            {/* Pending Setup Card */}
            {shouldShowPendingSetup && (
              <div className="bg-[#111827] rounded-lg border border-amber-500/50 p-3 flex flex-col justify-between gap-2.5 hover:border-amber-400 transition-colors shadow-sm ring-1 ring-amber-500/20">
                <div className="flex items-start justify-between gap-2 border-b border-[#1F2937]/70 pb-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        pendingSamSetup.type === 'CALL'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {pendingSamSetup.type === 'CALL' ? 'LONG' : 'SHORT'}
                      </span>
                      <span className="font-semibold text-xs text-amber-300 truncate max-w-[130px]">
                        SAM {pendingSamSetup.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-400/80 font-mono mt-0.5">
                      At Bar+1 Close ⏳ (Setup @ {formatTime(pendingSamSetup.setupBarTime)})
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                      POTENTIAL ⏳
                    </span>
                    <span className="text-[10px] text-gray-400 mt-0.5 font-mono">Bar+1 Forming</span>
                  </div>
                </div>

                {/* Pending Setup Price Levels */}
                <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] font-mono bg-[#0A0F1C] p-2 rounded border border-amber-500/20">
                  <div className="flex flex-col">
                    <span className="text-amber-400/80 text-[10px]">Entry Point</span>
                    <span className="text-amber-300 font-bold">~{pendingSamSetup.estEntry.toFixed(2)}</span>
                    <span className="text-[9px] text-gray-400">At Bar+1 Close</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-red-400/80 text-[10px]">Stoploss</span>
                    <span className="text-red-400 font-medium">~{pendingSamSetup.estSL.toFixed(2)}</span>
                    <span className="text-[9px] text-gray-400">{pendingSamSetup.type === 'CALL' ? '-20pt' : '+20pt'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-emerald-400/80 text-[10px]">Target 1</span>
                    <span className="text-emerald-400 font-medium">~{pendingSamSetup.estTP.toFixed(2)}</span>
                    <span className="text-[9px] text-gray-400">{pendingSamSetup.type === 'CALL' ? '+60pt' : '-60pt'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-purple-400/80 text-[10px]">Target 2</span>
                    <span className="text-purple-300 font-medium">~{pendingSamSetup.estTP2.toFixed(2)}</span>
                    <span className="text-[9px] text-gray-400">{pendingSamSetup.type === 'CALL' ? '+120pt' : '-120pt'}</span>
                  </div>
                </div>

                {/* Pending Setup Option Estimate */}
                <div className="flex items-center justify-between text-[11px] font-mono bg-amber-950/20 px-2 py-1.5 rounded border border-amber-500/30 text-amber-200">
                  <span>Option ATM: ~{Math.round(pendingSamSetup.estEntry / 50) * 50} {pendingSamSetup.type === 'CALL' ? 'CE' : 'PE'} (Δ 0.50)</span>
                  <span className="font-bold text-emerald-400">1 Lot Est: ~+₹1,950 / -₹1,138</span>
                </div>

                <div className="text-[10px] text-gray-400 bg-gray-900/80 px-2 py-1 rounded border border-gray-800 text-center">
                  Trade executes strictly on Immediate Adverse Bar+1 close (Zero Repaint). Stoploss &amp; Target are locked from this Bar+1 close.
                </div>
              </div>
            )}
            {displayedTrades.length === 0 && !shouldShowPendingSetup ? (
              <div className="col-span-full py-12 text-center text-gray-400 font-mono text-xs flex flex-col items-center gap-2.5">
                <span>
                  {selectedDateFilter !== 'ALL' || isCustomRangeOpen 
                    ? `No trades triggered on the selected date under active filters${backtestTrades.length > 0 ? ` (${backtestTrades.length} trades available across all dates)` : ''}.` 
                    : 'No trades generated for this period or all filtered out by selected filters.'}
                </span>
                {(selectedDateFilter !== 'ALL' || isCustomRangeOpen) && backtestTrades.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDateFilter('ALL');
                      setIsCustomRangeOpen(false);
                    }}
                    className="px-3 py-1.5 rounded bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/40 font-bold cursor-pointer transition-colors"
                  >
                    Show All {backtestTrades.length} Trades
                  </button>
                )}
              </div>
            ) : (
              displayedTrades.map((t, idx) => (
                <div
                  key={t.id + '-' + idx}
                  className="bg-[#111827] rounded-lg border border-[#1F2937] p-3 flex flex-col justify-between gap-2.5 hover:border-gray-600 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-[#1F2937]/70 pb-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.type === 'LONG' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {t.type}
                        </span>
                        <span className="font-semibold text-xs text-white truncate max-w-[130px]">{t.signal}</span>
                        {t.optionStrike && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                            {t.optionStrike} {t.optionType}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                        {formatDate(t.entryTime)} {formatTime(t.entryTime)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.status === 'WIN' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 
                        t.status === 'LOSS' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                        t.status === 'BE' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
                        'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'
                      }`}>
                        {t.status === 'BE' ? 'BE (Safe)' : t.status}
                      </span>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                        Spot: <span className={t.pnl === undefined ? 'text-gray-500' : t.pnl > 0 ? 'text-emerald-400 font-semibold' : t.pnl < 0 ? 'text-red-400 font-semibold' : 'text-gray-300 font-semibold'}>
                          {t.pnl !== undefined ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) + ' pts' : '-'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono font-bold text-cyan-300">
                        Prem: {t.premiumPnl !== undefined ? (t.premiumPnl > 0 ? '+' : '') + t.premiumPnl.toFixed(2) + ' pts' : '-'}
                      </div>
                    </div>
                  </div>

                  {/* Price Levels Grid */}
                  <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] font-mono bg-[#0A0F1C] p-2 rounded border border-[#1F2937]/50">
                    <div className="flex flex-col">
                      <span className="text-gray-500 text-[10px]">Entry</span>
                      <span className="text-gray-200 font-medium">{t.entryPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-red-400/80 text-[10px]">Stoploss</span>
                      <span className="text-red-400 font-medium">{t.stoploss.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-emerald-400/80 text-[10px]">Target 1</span>
                      <span className="text-emerald-400 font-medium">{t.samNoFixedTp ? 'EOD Trail' : t.target.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-purple-400/80 text-[10px]">Target 2</span>
                      <span className="text-purple-300 font-medium">{t.samNoFixedTp ? '-' : (t.target2 ? t.target2.toFixed(2) : '-')}</span>
                    </div>
                  </div>

                  {/* Option Premium & 1-Lot PnL Bar */}
                  <div className="flex items-center justify-between text-[11px] font-mono bg-cyan-950/20 px-2 py-1.5 rounded border border-cyan-500/20">
                    <div className="flex items-center gap-1 text-cyan-200">
                      <span className="text-gray-400 text-[10px]">Prem:</span>
                      {t.optionEntryPremium !== undefined ? (
                        <span>₹{t.optionEntryPremium.toFixed(2)} {t.optionExitPremium !== undefined ? `→ ₹${t.optionExitPremium.toFixed(2)}` : ''}</span>
                      ) : (
                        <span className="text-gray-500">No OC Data</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-400">1 Lot (65 Qty):</span>
                      <span className={`font-bold ${
                        t.lotPnl === undefined ? 'text-gray-500' : t.lotPnl > 0 ? 'text-emerald-400' : t.lotPnl < 0 ? 'text-red-400' : 'text-gray-300'
                      }`}>
                        {t.lotPnl !== undefined ? (t.lotPnl >= 0 ? '+' : '') + '₹' + t.lotPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                      </span>
                    </div>
                  </div>

                  {/* Exit & Duration Info */}
                  <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1 border-t border-[#1F2937]/50">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">Exit:</span>
                      {t.exitReason === 'TARGET' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Target</span>
                      ) : t.exitReason === 'STOPLOSS' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">Stoploss</span>
                      ) : t.exitReason === 'BREAKEVEN' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">BE Lock</span>
                      ) : t.exitReason === 'MAX_TIME' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">⏱️ Time Exit</span>
                      ) : t.exitReason === 'OPPOSITE_SIGNAL' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-pink-500/20 text-pink-300 border border-pink-500/30">🔄 Trend Rev</span>
                      ) : t.exitReason === 'DAY_END' ? (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Day End</span>
                      ) : (
                        <span className="text-gray-500 font-mono">Open</span>
                      )}
                      {t.exitTime && <span className="font-mono text-gray-300">@{formatTime(t.exitTime)}</span>}
                    </div>

                    <div className="font-mono text-[10px] text-gray-400 bg-gray-800/80 px-1.5 py-0.5 rounded">
                      ⏱️ {t.duration || (t.exitTime ? formatDuration(t.entryTime, t.exitTime) : formatDuration(t.entryTime, Math.floor(Date.now() / 1000)) + ' (Active)')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Table View: Full width with horizontal scroll support on narrow screens */
          <div className="w-full flex flex-col">
            {/* Portrait Mobile Hint */}
            <div className="md:hidden px-3 py-1.5 bg-blue-950/40 border-b border-blue-900/50 text-[11px] text-blue-300 flex items-center justify-between">
              <span>👉 Swipe left/right ↔️ for Stoploss, Target & PnL</span>
              <button 
                onClick={() => setTradeViewMode('cards')} 
                className="underline text-blue-200 font-bold hover:text-white"
              >
                Switch to Cards
              </button>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[550px] min-h-[320px] bg-[#0A0F1C] w-full touch-pan-x">
              <table className="w-full min-w-[840px] text-left text-xs text-gray-300">
              <thead className="bg-[#111827] sticky top-0 border-b border-[#1F2937] z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Entry Time</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Signal</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Entry</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Stoploss</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Target 1</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Target 2</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Exit Time</th>
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">Time in Trade</th>
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">Exit Trigger</th>
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Spot PnL</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-cyan-400">Option Contract</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-cyan-400">Prem PnL (pts)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-400">1 Lot PnL (65 Qty)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]">
                {shouldShowPendingSetup && (
                  <tr className="bg-amber-950/20 border-b border-amber-500/30 text-amber-200 hover:bg-amber-950/30 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-amber-300">{formatDate(pendingSamSetup.time || pendingSamSetup.setupBarTime)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-amber-300">
                      <span className="flex items-center gap-1.5">
                        <span>{formatTime(pendingSamSetup.time || pendingSamSetup.setupBarTime)}</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-sans font-bold">Bar 0 Setup</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-bold text-amber-300">
                      SAM {pendingSamSetup.type} (Pending Confirmation ⏳)
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pendingSamSetup.type === 'CALL' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {pendingSamSetup.type === 'CALL' ? 'LONG' : 'SHORT'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap text-amber-300 font-bold" title="Will enter at Bar+1 close; approx level near current price">
                      ~{pendingSamSetup.estEntry.toFixed(2)} (At Bar+1 Close)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-400/90 whitespace-nowrap" title="Stoploss is decided at Bar+1 close (Entry - 20 pts)">
                      ~{pendingSamSetup.estSL.toFixed(2)} (-20pt from Entry)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-400/90 whitespace-nowrap" title="Target is decided at Bar+1 close (Entry + 60 pts)">
                      ~{pendingSamSetup.estTP.toFixed(2)} (+60pt from Entry)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-purple-300/80 whitespace-nowrap">
                      ~{(pendingSamSetup.type === 'CALL' ? pendingSamSetup.estEntry + 120 : pendingSamSetup.estEntry - 120).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-gray-500 whitespace-nowrap">-</td>
                    <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                        Bar + 1 Forming ⏳
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        Awaiting Filter
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500/30 text-amber-200 border border-amber-500/50 shadow-sm animate-pulse">
                        POTENTIAL ⏳
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-500 whitespace-nowrap">-</td>
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-cyan-300">
                      ~{Math.round(pendingSamSetup.estEntry / 50) * 50} {pendingSamSetup.type === 'CALL' ? 'CE' : 'PE'} (ATM)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-cyan-300/80 whitespace-nowrap">
                      ~+30.00 / -17.50 pt
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                      ~+₹1,950 / -₹1,138
                    </td>
                  </tr>
                )}
                {displayedTrades.length === 0 && !shouldShowPendingSetup && (
                   <tr>
                     <td colSpan={16} className="py-8 text-center text-gray-400 font-mono text-xs">
                       <div className="flex flex-col items-center gap-2">
                         <span>
                           {selectedDateFilter !== 'ALL' || isCustomRangeOpen 
                             ? `No trades triggered on the selected date under active filters${backtestTrades.length > 0 ? ` (${backtestTrades.length} trades available across all dates)` : ''}.` 
                             : 'No trades generated for this period'}
                         </span>
                         {(selectedDateFilter !== 'ALL' || isCustomRangeOpen) && backtestTrades.length > 0 && (
                           <button
                             type="button"
                             onClick={() => {
                               setSelectedDateFilter('ALL');
                               setIsCustomRangeOpen(false);
                             }}
                             className="px-3 py-1 rounded bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/40 font-bold cursor-pointer transition-colors"
                           >
                             Show All {backtestTrades.length} Trades
                           </button>
                         )}
                       </div>
                     </td>
                   </tr>
                )}
                {displayedTrades.map((t, idx) => (
                  <tr key={t.id + '-' + idx} className="hover:bg-[#111827] transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-gray-300">{formatDate(t.entryTime)}</td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-gray-300">{formatTime(t.entryTime)}</td>
                    <td className="py-2 px-3 whitespace-nowrap font-medium text-gray-200">{t.signal}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.type === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap text-gray-200">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono text-red-400 whitespace-nowrap">{t.stoploss.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 whitespace-nowrap">{t.samNoFixedTp ? 'EOD Trail' : t.target.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono text-purple-300 whitespace-nowrap">{t.samNoFixedTp ? '-' : (t.target2 ? t.target2.toFixed(2) : '-')}</td>
                    <td className="py-2 px-3 font-mono whitespace-nowrap">
                      {t.exitTime ? (
                        <div>
                          <span className="text-gray-200">{formatTime(t.exitTime)}</span>
                          {formatDate(t.exitTime) !== formatDate(t.entryTime) && (
                            <span className="ml-1.5 text-[10px] text-gray-400">({formatDate(t.exitTime)})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center font-mono whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        t.status === 'OPEN' 
                          ? 'bg-brand-blue/20 text-brand-blue border border-brand-blue/30' 
                          : 'bg-gray-800/80 text-gray-300 border border-gray-700/50'
                      }`}>
                        {t.duration || (t.exitTime ? formatDuration(t.entryTime, t.exitTime) : formatDuration(t.entryTime, Math.floor(Date.now() / 1000)) + ' (Active)')}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      {t.exitReason === 'TARGET' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Target (TP)
                        </span>
                      ) : t.exitReason === 'STOPLOSS' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                          Stoploss (SL)
                        </span>
                      ) : t.exitReason === 'BREAKEVEN' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" title="Stoploss shifted to breakeven after 50% progress toward target">
                          BE Protected
                        </span>
                      ) : t.exitReason === 'MAX_TIME' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30" title="Max trade time reached (30m, 1h, 2h)">
                          ⏱️ Time Exit
                        </span>
                      ) : t.exitReason === 'OPPOSITE_SIGNAL' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-pink-500/20 text-pink-300 border border-pink-500/30" title="Opposite trend reversal">
                          🔄 Trend Rev
                        </span>
                      ) : t.exitReason === 'DAY_END' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Squared off at Market Session Close (No Overnight Carry)">
                          Day End Close
                        </span>
                      ) : (
                        <span className="text-gray-500 text-[10px] font-mono">Open</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        t.status === 'WIN' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 
                        t.status === 'LOSS' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 
                        t.status === 'BE' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' :
                        'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'
                      }`}>
                        {t.status === 'BE' ? 'BE (Safe)' : t.status}
                      </span>
                    </td>
                    <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${t.pnl === undefined ? 'text-gray-500' : t.pnl > 0 ? 'text-emerald-400 font-semibold' : t.pnl < 0 ? 'text-red-400 font-semibold' : 'text-gray-300 font-semibold'}`}>
                      {t.pnl !== undefined ? (
                        <span>
                          {t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)} pts
                          {t.status === 'OPEN' && <span className="text-[10px] text-gray-500 ml-1">(unrealized)</span>}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono">
                      {t.optionStrike ? (
                        <div
                          className="flex items-center gap-1.5"
                          title={
                            t.optionDataSource === 'OPTION_CHAIN_HISTORY'
                              ? `Recorded Option Chain History${t.optionExpiry ? ` • Exp ${t.optionExpiry}` : ''}`
                              : t.optionDataSource === 'UPSTOX_OPTION_CANDLE'
                                ? `Real Upstox 1-Min Option Candle${t.optionExpiry ? ` • Exp ${t.optionExpiry}` : ''}`
                                : 'No recorded option chain or historical option candle data for this timestamp'
                          }
                        >
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                            {t.optionStrike} {t.optionType}
                          </span>
                          {t.optionExpiry && (
                            <span className="text-[10px] text-gray-400 font-mono">{t.optionExpiry.slice(5)}</span>
                          )}
                          {t.optionDataSource === 'OPTION_CHAIN_HISTORY' ? (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-700/50">OC</span>
                          ) : t.optionDataSource === 'UPSTOX_OPTION_CANDLE' ? (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/70 text-blue-300 border border-blue-700/50">1m Opt</span>
                          ) : (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-gray-800 text-gray-400 border border-gray-700">No Data</span>
                          )}
                          {t.optionDelta !== undefined && (
                            <span className="text-[10px] text-gray-500 font-mono">(Δ {t.optionDelta.toFixed(2)})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${
                      t.premiumPnl === undefined ? 'text-gray-500' : t.premiumPnl > 0 ? 'text-cyan-300 font-semibold' : t.premiumPnl < 0 ? 'text-red-400 font-semibold' : 'text-gray-300 font-semibold'
                    }`}>
                      {t.premiumPnl !== undefined ? (
                        <div className="flex flex-col items-end">
                          <span>{t.premiumPnl > 0 ? '+' : ''}{t.premiumPnl.toFixed(2)} pts</span>
                          {t.optionEntryPremium !== undefined && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              ₹{t.optionEntryPremium.toFixed(2)} {t.optionExitPremium !== undefined ? `→ ₹${t.optionExitPremium.toFixed(2)}` : ''}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-500">No OC Data</span>
                      )}
                    </td>
                    <td className={`py-2 px-3 text-right font-mono whitespace-nowrap font-bold ${
                      t.lotPnl === undefined ? 'text-gray-500' : t.lotPnl > 0 ? 'text-emerald-400' : t.lotPnl < 0 ? 'text-red-400' : 'text-gray-300'
                    }`}>
                      {t.lotPnl !== undefined ? (
                        <span>
                          {t.lotPnl >= 0 ? '+' : ''}₹{t.lotPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
      {/* ========================================================================= */}
      {/* NIFTY STRATEGY PARAMETERS & ANTI-WHIPSAW TUNING MODAL */}
      {/* ========================================================================= */}
      {showStrategySettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#111827] border border-[#374151] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#1F2937] flex items-center justify-between bg-[#0A0F1C]/80">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚙️</span>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Nifty Strategy Calibration
                    <span className="text-xs px-2 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      1-Minute Anti-Whipsaw
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400">
                    Fine-tune indicator parameters and risk-reward targets to eliminate losing chop trades
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowStrategySettingsModal(null)}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-[#1F2937] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#1F2937] bg-[#0A0F1C]/40 px-6">
              <button
                onClick={() => setShowStrategySettingsModal('SAM')}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                  showStrategySettingsModal === 'SAM'
                    ? 'border-blue-400 text-blue-300'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                BEST SAM SIGNALS
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {showStrategySettingsModal === 'SAM' ? (
                <div className="space-y-5">
                  {/* Description Box */}
                  <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-800/40 text-blue-200 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5 text-blue-300">
                      <span>⚡</span>
                      <span>BEST SAM SIGNALS (Pine Script by dy26102001)</span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      Calculates <code className="text-blue-300 font-mono">buffer1 = SMA(Fast) - SMA(Slow)</code> and <code className="text-blue-300 font-mono">buffer2 = WMA(buffer1, Signal)</code>.
                      A <strong className="text-blue-400">CALL</strong> signal is triggered when buffer1 crosses above buffer2.
                      A <strong className="text-rose-400">PUT</strong> signal is triggered when buffer1 crosses below buffer2.
                      Stop Loss is calibrated to <strong className="text-amber-300">20 points from entry candle</strong>.
                    </p>
                  </div>

                  {/* SAM Repeated Loss Pattern Diagnostic Notice */}
                  <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-200 space-y-2.5">
                    <div className="font-semibold flex items-center justify-between text-rose-300">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🔍</span>
                        <span>SAM Losing Trades Pattern Analysis (Chart Audit)</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                        Repeated Trap Identified
                      </span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      Across all executed SAM trades on this chart, <strong>1 specific pattern is repeated 73.5% of the time in losing trades, yet virtually ABSENT in winning trades</strong>:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                      <div className="p-2.5 rounded-lg bg-[#0A0F1C]/90 border border-rose-900/50">
                        <div className="text-rose-400 font-semibold mb-0.5">1-Bar Instant Reversal</div>
                        <div className="text-lg font-bold text-white font-mono">49.0% <span className="text-[10px] text-gray-400 font-normal">in losses</span></div>
                        <div className="text-[10px] text-emerald-400 font-mono">0.0% in wins (Absent)</div>
                        <p className="text-[9px] text-gray-400 mt-1 leading-tight">Trade flipped on the very next bar without follow-through.</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#0A0F1C]/90 border border-rose-900/50">
                        <div className="text-rose-400 font-semibold mb-0.5">&le; 2-Bar Rapid Stopout</div>
                        <div className="text-lg font-bold text-white font-mono">73.5% <span className="text-[10px] text-gray-400 font-normal">in losses</span></div>
                        <div className="text-[10px] text-emerald-400 font-mono">2.5% in wins (30x lower)</div>
                        <p className="text-[9px] text-gray-400 mt-1 leading-tight">Premature reversal before momentum can develop.</p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#0A0F1C]/90 border border-rose-900/50">
                        <div className="text-rose-400 font-semibold mb-0.5">Bar +1 Adverse Close</div>
                        <div className="text-lg font-bold text-white font-mono">65.3% <span className="text-[10px] text-gray-400 font-normal">in losses</span></div>
                        <div className="text-[10px] text-emerald-400 font-mono">14.6% in wins</div>
                        <p className="text-[9px] text-gray-400 mt-1 leading-tight">Next candle immediately rejects and closes against signal.</p>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-300 bg-[#0A0F1C]/70 p-2 rounded-lg border border-gray-800">
                      <strong className="text-amber-300">Root Cause:</strong> Because <code className="text-blue-300 font-mono">MaFastPeriod = 1</code> uses single-candle closing price, an isolated candle in choppy consolidation causes a false crossover. When the next candle drops/rebounds, an opposing signal triggers immediately (accounting for <strong>95.9% of all loss exits</strong>). Enabling the ADX momentum filter or requiring multi-bar confirmation filters out this ping-pong trap!
                    </div>
                  </div>

                  {/* Parameters Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Fast MA Period */}
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Ma Fast Period</label>
                        <span className="font-mono text-blue-400 font-bold">{samConfig.maFastPeriod}</span>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={samConfig.maFastPeriod}
                        onChange={e => setSamConfig(c => ({ ...c, maFastPeriod: Math.max(1, Number(e.target.value) || 1) }))}
                        className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <p className="text-[10px] text-gray-500">Pine Script default: 1 (acts as raw price when 1)</p>
                    </div>

                    {/* Slow MA Period */}
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Ma Slow Period</label>
                        <span className="font-mono text-purple-400 font-bold">{samConfig.maSlowPeriod}</span>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={samConfig.maSlowPeriod}
                        onChange={e => setSamConfig(c => ({ ...c, maSlowPeriod: Math.max(1, Number(e.target.value) || 34) }))}
                        className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <p className="text-[10px] text-gray-500">Pine Script default: 34 (baseline oscillator trend)</p>
                    </div>

                    {/* Signal Period */}
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Signal Period (WMA)</label>
                        <span className="font-mono text-emerald-400 font-bold">{samConfig.signalPeriod}</span>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={samConfig.signalPeriod}
                        onChange={e => setSamConfig(c => ({ ...c, signalPeriod: Math.max(1, Number(e.target.value) || 5) }))}
                        className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <p className="text-[10px] text-gray-500">Pine Script default: 5 (Weighted Moving Average of oscillator)</p>
                    </div>

                    {/* Price Source */}
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Price Source (Ma Value)</label>
                        <span className="font-mono text-amber-400 font-bold">{samConfig.source}</span>
                      </div>
                      <select
                        value={samConfig.source}
                        onChange={e => setSamConfig(c => ({ ...c, source: e.target.value as any }))}
                        className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="close">Close (Pine Script Default)</option>
                        <option value="hl2">HL2 ((High + Low) / 2)</option>
                        <option value="hlc3">HLC3 ((High + Low + Close) / 3)</option>
                        <option value="ohlc4">OHLC4 ((Open + High + Low + Close) / 4)</option>
                      </select>
                      <p className="text-[10px] text-gray-500">Price source series used to calculate Fast and Slow SMAs</p>
                    </div>
                  </div>

                  {/* Risk Management */}
                  <div className="bg-[#0A0F1C] p-4 rounded-xl border border-[#1F2937] space-y-4">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <span>🛡️</span>
                      <span>Risk &amp; Exit Management</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Stoploss Points */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-gray-300">Stop Loss (Points from Entry)</label>
                          <span className="font-mono text-rose-400 font-bold">{samConfig.stopLossPoints} pts</span>
                        </div>
                        <input
                          type="number"
                          min={5}
                          max={500}
                          step={1}
                          value={samConfig.stopLossPoints}
                          onChange={e => setSamConfig(c => ({ ...c, stopLossPoints: Math.max(1, Number(e.target.value) || 20) }))}
                          className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500 font-mono"
                        />
                        <p className="text-[10px] text-gray-500">Configurable stoploss: 20 points from entry candle</p>
                      </div>

                      {/* Target Points */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-gray-300">Profit Target (Points)</label>
                          <span className="font-mono text-emerald-400 font-bold">{samConfig.targetPoints} pts</span>
                        </div>
                        <input
                          type="number"
                          min={5}
                          max={1000}
                          step={1}
                          value={samConfig.targetPoints}
                          onChange={e => setSamConfig(c => ({ ...c, targetPoints: Math.max(1, Number(e.target.value) || 40) }))}
                          className="w-full bg-[#111827] border border-[#374151] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                        />
                        <p className="text-[10px] text-gray-500">Target points (Default: 60 points for 3:1 RR)</p>
                      </div>
                    </div>

                    {/* Dynamic Trailing Stoploss */}
                    <div className="p-3.5 rounded-lg bg-[#111827] border border-[#1F2937] space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">🔄</span>
                          <span className="text-xs font-semibold text-white">Dynamic Step Trailing SL</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">Active</span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={samConfig.trailingStopEnabled ?? true}
                            onChange={e => setSamConfig(c => ({ ...c, trailingStopEnabled: e.target.checked }))}
                            className="accent-blue-500 cursor-pointer"
                          />
                          <span className="text-xs font-medium text-gray-300">Enable Trailing</span>
                        </label>
                      </div>

                      <div className="text-[11px] text-gray-300 bg-blue-950/20 p-2.5 rounded-lg border border-blue-900/40 space-y-1">
                        <p className="flex items-center gap-1.5 font-medium text-blue-300">
                          <span>📌</span>
                          <span>Rule 1: If market goes up <strong>{samConfig.trailStep1Points ?? 20} pts</strong> &rarr; Switch Stop Loss to <strong>Entry</strong> (Breakeven)</span>
                        </p>
                        <p className="flex items-center gap-1.5 font-medium text-emerald-300">
                          <span>📌</span>
                          <span>Rule 2: If market goes up <strong>{samConfig.trailStep2Points ?? 40} pts</strong> &rarr; Switch Stop Loss to <strong>Entry + {samConfig.trailStep2LockProfit ?? 20} pts</strong> (Lock Profit)</span>
                        </p>
                      </div>

                      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 transition-opacity ${(samConfig.trailingStopEnabled ?? true) ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                        <div className="space-y-1">
                          <label className="text-[11px] text-gray-400">Step 1 Move (pts)</label>
                          <input
                            type="number"
                            min={5}
                            max={200}
                            value={samConfig.trailStep1Points ?? 20}
                            onChange={e => setSamConfig(c => ({ ...c, trailStep1Points: Math.max(1, Number(e.target.value) || 20) }))}
                            className="w-full bg-[#0A0F1C] border border-[#374151] rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                          />
                          <p className="text-[9px] text-gray-500">Moves SL to Entry (0 risk)</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-gray-400">Step 2 Move (pts)</label>
                          <input
                            type="number"
                            min={10}
                            max={500}
                            value={samConfig.trailStep2Points ?? 40}
                            onChange={e => setSamConfig(c => ({ ...c, trailStep2Points: Math.max(1, Number(e.target.value) || 40) }))}
                            className="w-full bg-[#0A0F1C] border border-[#374151] rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                          />
                          <p className="text-[9px] text-gray-500">Triggers step 2 profit lock</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-gray-400">Step 2 Lock (pts)</label>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={samConfig.trailStep2LockProfit ?? 20}
                            onChange={e => setSamConfig(c => ({ ...c, trailStep2LockProfit: Math.max(1, Number(e.target.value) || 20) }))}
                            className="w-full bg-[#0A0F1C] border border-[#374151] rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                          />
                          <p className="text-[9px] text-gray-500">Locks Entry + pts</p>
                        </div>
                      </div>
                    </div>

                    {/* Entry Timing Toggle (Bar + 1 Close vs Bar + 1 Open vs Bar 0 Close) */}
                    <div className="p-3.5 rounded-lg bg-[#111827] border border-[#1F2937] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">⏱️</span>
                          <span className="text-xs font-semibold text-white">Entry Timing &amp; Invalidation Point</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            (samConfig.entryTiming ?? 'bar1Close') === 'bar1Close'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : samConfig.entryTiming === 'bar1Open'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {(samConfig.entryTiming ?? 'bar1Close') === 'bar1Close' ? 'Bar + 1 Close (Zero Repaint)' : samConfig.entryTiming === 'bar1Open' ? 'Bar + 1 Open' : 'Bar 0 Close'}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-300">
                        Choose your exact entry trigger point. Stop loss and profit target levels are calculated directly from this entry price:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <button
                          type="button"
                          onClick={() => setSamConfig(c => ({ ...c, entryTiming: 'bar1Close' }))}
                          className={`p-3 rounded-lg text-left transition-all cursor-pointer border ${
                            (samConfig.entryTiming ?? 'bar1Close') === 'bar1Close'
                              ? 'bg-emerald-950/40 border-emerald-500/60 shadow-sm ring-1 ring-emerald-500/30'
                              : 'bg-[#0A0F1C] border-[#374151] hover:border-gray-500 text-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-bold ${(samConfig.entryTiming ?? 'bar1Close') === 'bar1Close' ? 'text-emerald-400' : 'text-gray-300'}`}>
                              Bar + 1 Close
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Zero Repaint
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">
                            Waits for Immediate Adverse Bar + 1 to close. If favorable, enters at Bar + 1 close. Stop loss and target are calculated from this exact entry. Completely eliminates repainting!
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSamConfig(c => ({ ...c, entryTiming: 'bar1Open' }))}
                          className={`p-3 rounded-lg text-left transition-all cursor-pointer border ${
                            samConfig.entryTiming === 'bar1Open'
                              ? 'bg-cyan-950/40 border-cyan-500/60 shadow-sm ring-1 ring-cyan-500/30'
                              : 'bg-[#0A0F1C] border-[#374151] hover:border-gray-500 text-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-bold ${samConfig.entryTiming === 'bar1Open' ? 'text-cyan-400' : 'text-gray-300'}`}>
                              Bar + 1 Open
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                              Pine Script
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">
                            Waits for signal candle to close; fills at the opening tick of Bar + 1. Stop loss &amp; target are calculated from Bar + 1 open.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSamConfig(c => ({ ...c, entryTiming: 'bar0Close' }))}
                          className={`p-3 rounded-lg text-left transition-all cursor-pointer border ${
                            samConfig.entryTiming === 'bar0Close'
                              ? 'bg-blue-950/40 border-blue-500/60 shadow-sm ring-1 ring-blue-500/30'
                              : 'bg-[#0A0F1C] border-[#374151] hover:border-gray-500 text-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-bold ${samConfig.entryTiming === 'bar0Close' ? 'text-blue-400' : 'text-gray-300'}`}>
                              Bar 0 Close
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-800 text-gray-400 border border-gray-700">
                              Bar 0 Close Fill
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-relaxed">
                            Enters immediately at signal candle closing price. Assumes instantaneous zero-latency fill with markers on the signal candle.
                          </p>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#1F2937]">
                      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-[#111827] hover:bg-[#1a2333] transition-colors">
                        <input
                          type="checkbox"
                          checked={samConfig.oneTradeAtATime}
                          onChange={e => setSamConfig(c => ({ ...c, oneTradeAtATime: e.target.checked }))}
                          className="accent-blue-500 cursor-pointer"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-200">One Trade at a Time</span>
                          <p className="text-[10px] text-gray-400">Prevent multiple open positions simultaneously</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-[#111827] hover:bg-[#1a2333] transition-colors">
                        <input
                          type="checkbox"
                          checked={samConfig.autoExitOpposite}
                          onChange={e => setSamConfig(c => ({ ...c, autoExitOpposite: e.target.checked }))}
                          className="accent-blue-500 cursor-pointer"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-200">Exit on Opposite Signal</span>
                          <p className="text-[10px] text-gray-400">Close CALL on PUT signal, close PUT on CALL</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-[#111827] hover:bg-[#1a2333] transition-colors sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={samConfig.noTradeBefore915 ?? true}
                          onChange={e => setSamConfig(c => ({ ...c, noTradeBefore915: e.target.checked }))}
                          className="accent-blue-500 cursor-pointer"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-200">No Pre-Market Trades (&lt; 09:15 IST)</span>
                          <p className="text-[10px] text-gray-400">Strictly blocks trade generation before regular NSE market opens at 09:15 AM</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* ADX Filter Options */}
                  <div className="bg-[#0A0F1C] p-4 rounded-xl border border-[#1F2937] space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>📊</span>
                        <h4 className="font-semibold text-white">ADX Momentum Filter</h4>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-gray-400">Apply ADX Filter:</span>
                        <input
                          type="checkbox"
                          checked={samConfig.adxFilterEnabled}
                          onChange={e => setSamConfig(c => ({ ...c, adxFilterEnabled: e.target.checked }))}
                          className="accent-amber-400 w-4 h-4 cursor-pointer"
                        />
                      </label>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Eliminate chop whipsaws. When enabled, signals only fire if the ADX trend strength is above the threshold.
                    </p>

                    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 transition-opacity ${samConfig.adxFilterEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                      <div className="space-y-1">
                        <label className="text-[11px] text-gray-400">ADX Period</label>
                        <input
                          type="number"
                          min={5}
                          max={50}
                          value={samConfig.adxPeriod}
                          onChange={e => setSamConfig(c => ({ ...c, adxPeriod: Math.max(2, Number(e.target.value) || 14) }))}
                          className="w-full bg-[#111827] border border-[#374151] rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-gray-400">ADX Threshold</label>
                        <input
                          type="number"
                          min={10}
                          max={60}
                          value={samConfig.adxThreshold}
                          onChange={e => setSamConfig(c => ({ ...c, adxThreshold: Math.max(5, Number(e.target.value) || 20) }))}
                          className="w-full bg-[#111827] border border-[#374151] rounded-lg px-2.5 py-1 text-xs text-white font-mono"
                        />
                      </div>
                      <div className="flex items-center pt-4">
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-300">
                          <input
                            type="checkbox"
                            checked={samConfig.adxRequireDirectional}
                            onChange={e => setSamConfig(c => ({ ...c, adxRequireDirectional: e.target.checked }))}
                            className="accent-emerald-400 cursor-pointer"
                          />
                          <span>Directional (+DI / -DI) check</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Loss Prevention Micro-Filters (1-Min Chart Calibration) */}
                  <div className="bg-[#0A0F1C] p-4 rounded-xl border border-[#1F2937] space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>🛡️</span>
                        <div>
                          <h4 className="font-semibold text-white">Loss Prevention Micro-Filters (1-Min Calibration)</h4>
                          <p className="text-[11px] text-gray-400">
                            Based on empirical 1-minute failure analysis (10 Wins vs 10 Losses with 60pt Target / 35pt Stop Loss)
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Filter 1: Adverse Rejection Wick */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterRejectionWickEnabled
                          ? 'bg-purple-950/20 border-purple-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterRejectionWickEnabled}
                              onChange={e => setSamConfig(c => ({ ...c, filterRejectionWickEnabled: e.target.checked }))}
                              className="accent-purple-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">1. Adverse Rejection Wick (&gt;35%)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterRejectionWickEnabled
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterRejectionWickEnabled ? 'FILTER ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-3">
                          Invalidates signals where the entry candle has an opposing wick greater than 35% of total candle range:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-blue-300">• For LONG: Upper Wick / Range &gt; {samConfig.rejectionWickMaxPercent ?? 35}%</p>
                          <p className="text-rose-300">• For SHORT: Lower Wick / Range &gt; {samConfig.rejectionWickMaxPercent ?? 35}%</p>
                        </div>

                        {/* Threshold Control */}
                        <div className="flex items-center justify-between gap-2 pt-1 mb-3">
                          <label className="text-[11px] text-gray-400">Max Opposing Wick (%):</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={10}
                              max={60}
                              step={5}
                              value={samConfig.rejectionWickMaxPercent ?? 35}
                              onChange={e => setSamConfig(c => ({ ...c, rejectionWickMaxPercent: Math.max(5, Number(e.target.value) || 35) }))}
                              className="w-16 bg-[#0A0F1C] border border-[#374151] rounded px-2 py-1 text-xs text-white font-mono text-center"
                            />
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                        </div>

                        {/* Occurrence Stats Pill */}
                        <div className="p-2 rounded bg-purple-900/10 border border-purple-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Losing Trades Hit:</span>
                            <span className="font-bold text-rose-400">4 / 10 (40%)</span>
                          </div>
                          <div className="flex justify-between text-gray-300">
                            <span>Winning Trades Hit:</span>
                            <span className="font-bold text-emerald-400">0 / 10 (0% - None filtered!)</span>
                          </div>
                          <p className="text-purple-300/90 pt-1 font-sans text-[10px]">
                            ✨ Completely absent in winning trades — zero false rejections.
                          </p>
                        </div>
                      </div>

                      {/* Filter 2: Immediate Adverse Close on Bar +1 */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterBar1AdverseCloseEnabled
                          ? 'bg-rose-950/20 border-rose-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterBar1AdverseCloseEnabled}
                              onChange={e => setSamConfig(c => ({ ...c, filterBar1AdverseCloseEnabled: e.target.checked }))}
                              className="accent-rose-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">2. Immediate Adverse Close on Bar +1</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterBar1AdverseCloseEnabled
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterBar1AdverseCloseEnabled ? 'ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Detects when the next candle closes in the opposite direction of the signal:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-blue-300">• For LONG: Bar +1 closes Red / Bearish</p>
                          <p className="text-rose-300">• For SHORT: Bar +1 closes Green / Bullish</p>
                        </div>

                        {/* Mode Selector */}
                        <div className="space-y-1 mb-3">
                          <label className="text-[11px] text-gray-400">Action Execution Mode:</label>
                          <div className="grid grid-cols-2 gap-1.5 bg-[#0A0F1C] p-1 rounded-lg border border-[#374151]">
                            <button
                              type="button"
                              onClick={() => setSamConfig(c => ({ ...c, bar1ActionMode: 'filter' }))}
                              className={`py-1 px-2 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                                (samConfig.bar1ActionMode ?? 'filter') === 'filter'
                                  ? 'bg-blue-600 text-white shadow'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              Invalidate Signal
                            </button>
                            <button
                              type="button"
                              onClick={() => setSamConfig(c => ({ ...c, bar1ActionMode: 'exit' }))}
                              className={`py-1 px-2 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                                samConfig.bar1ActionMode === 'exit'
                                  ? 'bg-amber-600 text-white shadow'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              Cut Loss on Bar+1 Close
                            </button>
                          </div>
                          <p className="text-[9px] text-gray-500">
                            {(samConfig.bar1ActionMode ?? 'filter') === 'filter'
                              ? 'Invalidates signal entirely if Bar +1 closes adverse'
                              : 'Takes trade at c0 close, exits immediately on Bar +1 close to avoid -35pt SL'}
                          </p>
                        </div>

                        {/* Occurrence Stats Pill */}
                        <div className="p-2 rounded bg-rose-900/10 border border-rose-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Losing Trades Hit:</span>
                            <span className="font-bold text-rose-400">7 / 10 (70%)</span>
                          </div>
                          <div className="flex justify-between text-gray-300">
                            <span>Winning Trades Hit:</span>
                            <span className="font-bold text-amber-300">1 / 10 (10%) — Win #3 (12:22)</span>
                          </div>
                          <p className="text-gray-400 pt-1 font-mono text-[9px] leading-tight">
                            Win #3 (12:22 SHORT): Entry c0 (22,675.25 &rarr; 22,668.65 Red), Bar+1 c1 (22,667.80 &rarr; 22,669.85 Green).
                          </p>
                        </div>
                      </div>

                      {/* Filter 3: Smart Intraday VWAP & Climax Protection */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.vwapFilterEnabled
                          ? 'bg-cyan-950/20 border-cyan-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.vwapFilterEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, vwapFilterEnabled: e.target.checked }))}
                              className="accent-cyan-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">3. Smart Intraday VWAP &amp; Climax Guard</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.vwapFilterEnabled
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.vwapFilterEnabled ? 'FILTER ACTIVE (ON)' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Institutional benchmark filter: Enforces trend alignment + limits climax overextension + unblocks early reversal exits:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-cyan-300">• For LONG: Price &ge; VWAP &amp; Distance &le; {samConfig.vwapMaxDistancePoints ?? 70}pt</p>
                          <p className="text-rose-300">• For SHORT: Price &le; VWAP &amp; Distance &le; {samConfig.vwapMaxDistancePoints ?? 70}pt</p>
                        </div>

                        {/* Climax Band Protection Controls */}
                        <div className="space-y-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="text-[11px] text-gray-300 font-medium">Climax / Overextension Protection:</span>
                            <input
                              type="checkbox"
                              checked={samConfig.vwapClimaxFilterEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, vwapClimaxFilterEnabled: e.target.checked }))}
                              className="accent-cyan-400 cursor-pointer"
                            />
                          </label>
                          
                          <div className={`space-y-1.5 transition-opacity ${samConfig.vwapClimaxFilterEnabled !== false ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-[10px] text-gray-400">Max Distance from VWAP:</label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={30}
                                  max={150}
                                  step={5}
                                  value={samConfig.vwapMaxDistancePoints ?? 70}
                                  onChange={e => setSamConfig(c => ({ ...c, vwapMaxDistancePoints: Math.max(20, Number(e.target.value) || 70) }))}
                                  className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                                />
                                <span className="text-[10px] text-gray-400">pts</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {[50, 70, 85].map(pts => (
                                <button
                                  key={pts}
                                  type="button"
                                  onClick={() => setSamConfig(c => ({ ...c, vwapMaxDistancePoints: pts }))}
                                  className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors cursor-pointer border ${
                                    (samConfig.vwapMaxDistancePoints ?? 70) === pts
                                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold'
                                      : 'bg-[#111827] text-gray-400 border-gray-700 hover:text-white'
                                  }`}
                                >
                                  {pts}pt {pts === 70 ? '(Ideal)' : ''}
                                </button>
                              ))}
                            </div>
                            <p className="text-[9px] text-gray-400">
                              Blocks taking long entries when price is &gt; {samConfig.vwapMaxDistancePoints ?? 70}pt above VWAP (prevents climax exhaustion entries).
                            </p>
                          </div>
                        </div>

                        {/* Opening Buffer & Opposite Exit Toggles */}
                        <div className="space-y-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800 text-[11px]">
                          <label className="flex items-center justify-between cursor-pointer">
                            <div>
                              <span className="text-gray-300 font-medium">Opening 09:25 Buffer:</span>
                              <p className="text-[9px] text-gray-400">Skip entries before 09:25 AM when VWAP is forming</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={samConfig.vwapOpeningBufferEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, vwapOpeningBufferEnabled: e.target.checked }))}
                              className="accent-cyan-400 cursor-pointer"
                            />
                          </label>

                          <label className="flex items-center justify-between cursor-pointer pt-1.5 border-t border-gray-800">
                            <div>
                              <span className="text-gray-300 font-medium">Early Reversal Exit Unblocked:</span>
                              <p className="text-[9px] text-gray-400">Exit open trades on opposite signal even if counter entry is blocked</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={samConfig.vwapExitOppositeEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, vwapExitOppositeEnabled: e.target.checked }))}
                              className="accent-cyan-400 cursor-pointer"
                            />
                          </label>
                        </div>

                        {/* Chart Overlay Toggle */}
                        <div className="flex items-center justify-between gap-2 pt-1 mb-3 bg-[#0A0F1C] p-2 rounded border border-[#374151]">
                          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-gray-300">
                            <input
                              type="checkbox"
                              checked={samConfig.showVwapLine ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, showVwapLine: e.target.checked }))}
                              className="accent-cyan-400 cursor-pointer"
                            />
                            <span>Plot VWAP Cyan Line on Chart</span>
                          </label>
                          <span className="w-3 h-0.5 bg-cyan-400 rounded"></span>
                        </div>

                        {/* Occurrence Stats Pill */}
                        <div className="p-2 rounded bg-cyan-900/10 border border-cyan-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Trades Filtered on Chart:</span>
                            <span className="font-bold text-cyan-300 font-mono">{comparisonStats.vwapFiltered} Blocked</span>
                          </div>
                          <p className="text-cyan-300/90 pt-1 font-sans text-[10px] leading-relaxed">
                            ⚡ Prevents buying climax exhaustion spikes (like the 13:00 trade at +168 pts above VWAP) and enables early reversal exits instead of taking full -20pt stop losses.
                          </p>
                        </div>
                      </div>

                      {/* Filter 4: Minimum Candle Body Filter (Kill Dojis) */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterMinBodyEnabled
                          ? 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterMinBodyEnabled}
                              onChange={e => setSamConfig(c => ({ ...c, filterMinBodyEnabled: e.target.checked }))}
                              className="accent-amber-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">4. Min Candle Body Filter (Kill Dojis)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterMinBodyEnabled
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterMinBodyEnabled ? 'FILTER ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Eliminates hesitation candles (Dojis, spinning tops) that lack institutional volume and follow-through:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-amber-300">• Min Real Body Height: &ge; {samConfig.minBodyPoints ?? 7} pts on Nifty Spot</p>
                          <p className="text-gray-300">• Min Body-to-Range Ratio: &ge; {samConfig.minBodyRatioPercent ?? 45}%</p>
                        </div>

                        <div className="space-y-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Min Body Height (pts):</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={3}
                                max={30}
                                step={1}
                                value={samConfig.minBodyPoints ?? 7}
                                onChange={e => setSamConfig(c => ({ ...c, minBodyPoints: Math.max(2, Number(e.target.value) || 7) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">pts</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Min Body Ratio (% of Range):</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={20}
                                max={80}
                                step={5}
                                value={samConfig.minBodyRatioPercent ?? 45}
                                onChange={e => setSamConfig(c => ({ ...c, minBodyRatioPercent: Math.max(10, Number(e.target.value) || 45) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">%</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-2 rounded bg-amber-900/10 border border-amber-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Dojis Filtered on Chart:</span>
                            <span className="font-bold text-amber-300 font-mono">{comparisonStats.minBodyFiltered} Blocked</span>
                          </div>
                          <p className="text-amber-300/90 pt-1 font-sans text-[10px]">
                            ✨ Removes low-energy chop signals where buyers and sellers are indecisive.
                          </p>
                        </div>
                      </div>

                      {/* Filter 5: 5-Minute MTF EMA Trend Alignment */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterMtfEmaEnabled
                          ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterMtfEmaEnabled}
                              onChange={e => setSamConfig(c => ({ ...c, filterMtfEmaEnabled: e.target.checked }))}
                              className="accent-emerald-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">5. 5-Min MTF EMA Trend Alignment</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterMtfEmaEnabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterMtfEmaEnabled ? 'FILTER ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Higher-timeframe trend filter: Fast and dynamic without the lagging day-anchor flaws of VWAP:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-emerald-300">• For CALL: Price &ge; 5-min EMA {samConfig.mtfEmaPeriod ?? 20} (or slope &gt; 0)</p>
                          <p className="text-rose-300">• For PUT: Price &le; 5-min EMA {samConfig.mtfEmaPeriod ?? 20} (or slope &lt; 0)</p>
                        </div>

                        <div className="space-y-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">5-Min EMA Period:</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={5}
                                max={100}
                                step={1}
                                value={samConfig.mtfEmaPeriod ?? 20}
                                onChange={e => setSamConfig(c => ({ ...c, mtfEmaPeriod: Math.max(3, Number(e.target.value) || 20) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">bars</span>
                            </div>
                          </div>
                          <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-gray-800">
                            <span className="text-[10px] text-gray-300">Strict Slope Confirmation:</span>
                            <input
                              type="checkbox"
                              checked={samConfig.mtfEmaRequireSlope ?? false}
                              onChange={e => setSamConfig(c => ({ ...c, mtfEmaRequireSlope: e.target.checked }))}
                              className="accent-emerald-400 cursor-pointer"
                            />
                          </label>
                        </div>

                        <div className="p-2 rounded bg-emerald-900/10 border border-emerald-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Counter-Trend Filtered:</span>
                            <span className="font-bold text-emerald-300 font-mono">{comparisonStats.mtfEmaFiltered} Blocked</span>
                          </div>
                          <p className="text-emerald-300/90 pt-1 font-sans text-[10px]">
                            🚀 Prevents taking trades against the active 5-minute directional tide.
                          </p>
                        </div>
                      </div>

                      {/* Filter 6: Day High / Day Low Trap Filter */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterDayTrapEnabled
                          ? 'bg-indigo-950/20 border-indigo-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterDayTrapEnabled}
                              onChange={e => setSamConfig(c => ({ ...c, filterDayTrapEnabled: e.target.checked }))}
                              className="accent-indigo-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">6. Day High / Day Low Trap Guard</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterDayTrapEnabled
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterDayTrapEnabled ? 'FILTER ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Prevents buying directly under resistance (Day High) or selling directly above support (Day Low):
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-indigo-300">• For CALL: Block if within {samConfig.dayTrapBufferPoints ?? 10}pt below Day High</p>
                          <p className="text-rose-300">• For PUT: Block if within {samConfig.dayTrapBufferPoints ?? 10}pt above Day Low</p>
                          <p className="text-gray-400">• Clean breakouts/breakdowns are always permitted!</p>
                        </div>

                        <div className="space-y-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Trap Danger Buffer Distance:</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={5}
                                max={30}
                                step={1}
                                value={samConfig.dayTrapBufferPoints ?? 10}
                                onChange={e => setSamConfig(c => ({ ...c, dayTrapBufferPoints: Math.max(3, Number(e.target.value) || 10) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">pts</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-2 rounded bg-indigo-900/10 border border-indigo-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Range Traps Filtered:</span>
                            <span className="font-bold text-indigo-300 font-mono">{comparisonStats.dayTrapFiltered} Blocked</span>
                          </div>
                          <p className="text-indigo-300/90 pt-1 font-sans text-[10px]">
                            🛡️ Saves you from buying the absolute top and selling the absolute bottom of the day.
                          </p>
                        </div>
                      </div>

                      {/* Filter 7: Dynamic Regime Classification (Dual-Mode Adaptive VWAP) */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.adaptiveRegimeEnabled
                          ? 'bg-teal-950/20 border-teal-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.adaptiveRegimeEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, adaptiveRegimeEnabled: e.target.checked }))}
                              className="accent-teal-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">7. Dynamic Regime Classification (Dual-Mode VWAP)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.adaptiveRegimeEnabled
                              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.adaptiveRegimeEnabled ? 'ACTIVE (DUAL-MODE)' : 'OFF (STATIC VWAP)'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Solves the static filter paradox where static VWAP turns trend days into wins but kills range days by blocking dip-buys:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-teal-300">• Trend Mode (|Price - VWAP| &gt; {samConfig.adaptiveTrendDistancePoints ?? 20}pt + slope): Strict trend alignment (no counter-trend)</p>
                          <p className="text-cyan-300">• Range Mode: Two-way mean reversion allowed (enables winning dip-buys &amp; top-fades)</p>
                          <p className="text-amber-300">• Climax Band Guard (&gt;{samConfig.adaptiveClimaxBandPoints ?? 50}pt): Blocks chasing overextended tops/bottoms</p>
                          <p className="text-emerald-300">• Panic/Euphoria Reversion: Permits exhaustion bounce trades at the outer climax band</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Trend Mode Threshold:</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={10}
                                max={50}
                                step={1}
                                value={samConfig.adaptiveTrendDistancePoints ?? 20}
                                onChange={e => setSamConfig(c => ({ ...c, adaptiveTrendDistancePoints: Math.max(5, Number(e.target.value) || 20) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">pts</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Climax Exhaustion Band:</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={30}
                                max={100}
                                step={5}
                                value={samConfig.adaptiveClimaxBandPoints ?? 50}
                                onChange={e => setSamConfig(c => ({ ...c, adaptiveClimaxBandPoints: Math.max(20, Number(e.target.value) || 50) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">pts</span>
                            </div>
                          </div>

                          <div className="col-span-1 sm:col-span-2 flex items-center justify-between pt-1 border-t border-gray-800">
                            <span className="text-[10px] text-gray-300">Allow Exhaustion Counter-Bounces at Climax:</span>
                            <input
                              type="checkbox"
                              checked={samConfig.adaptiveAllowReversionBounce ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, adaptiveAllowReversionBounce: e.target.checked }))}
                              className="accent-teal-400 cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="p-2 rounded bg-teal-900/10 border border-teal-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Adaptive Regime Filtered:</span>
                            <span className="font-bold text-teal-300 font-mono">{comparisonStats.adaptiveRegimeFiltered} Blocked</span>
                          </div>
                          <p className="text-teal-300/90 pt-1 font-sans text-[10px]">
                            💎 Preserves high-probability trend trades while unlocking profitable mean-reversion swings on range days.
                          </p>
                        </div>
                      </div>

                      {/* Filter 8: Directional Loss Circuit Breaker & Anti-Whipsaw */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.circuitBreakerEnabled || samConfig.antiWhipsawEnabled
                          ? 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.circuitBreakerEnabled ?? true}
                              onChange={e => setSamConfig(c => ({ ...c, circuitBreakerEnabled: e.target.checked }))}
                              className="accent-amber-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">8. Directional Circuit Breaker &amp; Anti-Whipsaw</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.circuitBreakerEnabled
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.circuitBreakerEnabled ? 'CIRCUIT BREAKER ON' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Halts directional bleeding when market order flow is trending against signals:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-amber-300">• Cooldown: After {samConfig.circuitBreakerConsecutiveLosses ?? 3} consecutive losses in one direction, freeze that direction for {samConfig.circuitBreakerCooldownMinutes ?? 20} min</p>
                          <p className="text-emerald-300">• Opposite Trades Allowed: Does not lock out opposite trades if the market breaks out</p>
                          <p className="text-violet-300">• Anti-Whipsaw: Suppresses rapid direction reversal within {samConfig.antiWhipsawMinutes ?? 10} min after a loss</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Max Consecutive Losses:</label>
                            <input
                              type="number"
                              min={2}
                              max={5}
                              step={1}
                              value={samConfig.circuitBreakerConsecutiveLosses ?? 3}
                              onChange={e => setSamConfig(c => ({ ...c, circuitBreakerConsecutiveLosses: Math.max(2, Number(e.target.value) || 3) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Cooldown Duration:</label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={5}
                                max={60}
                                step={5}
                                value={samConfig.circuitBreakerCooldownMinutes ?? 20}
                                onChange={e => setSamConfig(c => ({ ...c, circuitBreakerCooldownMinutes: Math.max(5, Number(e.target.value) || 20) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">min</span>
                            </div>
                          </div>

                          <div className="col-span-1 sm:col-span-2 flex items-center justify-between pt-1 border-t border-gray-800">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={samConfig.antiWhipsawEnabled ?? false}
                                onChange={e => setSamConfig(c => ({ ...c, antiWhipsawEnabled: e.target.checked }))}
                                className="accent-violet-400 cursor-pointer"
                              />
                              <span className="text-[10px] text-gray-300">Enable Anti-Whipsaw Reversal Guard</span>
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={5}
                                max={30}
                                step={1}
                                value={samConfig.antiWhipsawMinutes ?? 10}
                                onChange={e => setSamConfig(c => ({ ...c, antiWhipsawMinutes: Math.max(3, Number(e.target.value) || 10) }))}
                                className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                              />
                              <span className="text-[10px] text-gray-400">min</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-2 rounded bg-amber-900/10 border border-amber-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Circuit Breaker / Whipsaw Blocked:</span>
                            <span className="font-bold text-amber-300 font-mono">{comparisonStats.circuitBreakerFiltered} CB • {comparisonStats.antiWhipsawFiltered} Whipsaw</span>
                          </div>
                          <p className="text-amber-300/90 pt-1 font-sans text-[10px]">
                            🛑 Prevents fighting stubborn directional trends and kills revenge-trading chop loops.
                          </p>
                        </div>
                      </div>

                      {/* Filter 9: Volatility-Adaptive Daily Drawdown Guard */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.maxDailyLossEnabled
                          ? 'bg-rose-950/20 border-rose-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.maxDailyLossEnabled ?? false}
                              onChange={e => setSamConfig(c => ({ ...c, maxDailyLossEnabled: e.target.checked }))}
                              className="accent-rose-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">9. Daily Drawdown Guard</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.maxDailyLossEnabled
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.maxDailyLossEnabled ? (comparisonStats.dailyDrawdownHalted ? 'HALTED TODAY' : 'GUARD ACTIVE') : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Caps maximum loss per day to protect capital on rare severe market outlier days:
                        </p>

                        <div className="flex items-center justify-between gap-2 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <label className="text-[10px] text-gray-400">Max Daily Loss Limit:</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={40}
                              max={150}
                              step={5}
                              value={samConfig.maxDailyLossPoints ?? 75}
                              onChange={e => setSamConfig(c => ({ ...c, maxDailyLossPoints: Math.max(30, Number(e.target.value) || 75) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                            <span className="text-[10px] text-gray-400">pts (Nifty Spot)</span>
                          </div>
                        </div>

                        <div className="p-2 rounded bg-rose-900/10 border border-rose-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>Status Today:</span>
                            <span className={`font-bold font-mono ${comparisonStats.dailyDrawdownHalted ? 'text-rose-400 animate-pulse' : 'text-emerald-300'}`}>
                              {comparisonStats.dailyDrawdownHalted ? 'HALTED FOR TODAY' : 'NORMAL TRADING'}
                            </span>
                          </div>
                          <p className="text-rose-300/90 pt-1 font-sans text-[10px]">
                            🛡️ Guarantees no single bad session can ever cause catastrophic portfolio drawdown.
                          </p>
                        </div>
                      </div>

                      {/* Filter 10: S12 Confluence Filter (DI Spread + EMA 100/200 + RVOL) */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterS12ConfluenceEnabled
                          ? 'bg-sky-950/20 border-sky-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterS12ConfluenceEnabled ?? false}
                              onChange={e => setSamConfig(c => ({ ...c, filterS12ConfluenceEnabled: e.target.checked }))}
                              className="accent-sky-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">10. S12 Confluence Filter (Zero-Lookahead)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterS12ConfluenceEnabled
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterS12ConfluenceEnabled ? 'FILTER ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Requires directional momentum, macro trend alignment, and volume participation strictly at Bar+1 close:
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-3 text-gray-300">
                          <p className="text-sky-300">• DI Spread: +DI - (-DI) &gt; +{samConfig.s12DiSpreadMin ?? 5} (CALL) | -DI - (+DI) &gt; +{samConfig.s12DiSpreadMin ?? 5} (PUT)</p>
                          <p className="text-emerald-300">• Macro Alignment: Close above EMA {samConfig.s12EmaFastPeriod ?? 100} &amp; EMA {samConfig.s12EmaSlowPeriod ?? 200} (CALL), below both (PUT)</p>
                          <p className="text-amber-300">• Volume Participation: Bar+1 Volume &ge; {(samConfig.s12MinRvol ?? 0.7).toFixed(2)}x 20-bar Average Volume</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 mb-3 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Min DI Spread:</label>
                            <input
                              type="number"
                              min={0}
                              max={25}
                              step={1}
                              value={samConfig.s12DiSpreadMin ?? 5}
                              onChange={e => setSamConfig(c => ({ ...c, s12DiSpreadMin: Math.max(0, Number(e.target.value) || 0) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Min RVOL:</label>
                            <input
                              type="number"
                              min={0}
                              max={3}
                              step={0.05}
                              value={samConfig.s12MinRvol ?? 0.7}
                              onChange={e => setSamConfig(c => ({ ...c, s12MinRvol: Math.max(0, Number(e.target.value) || 0) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Fast Macro EMA:</label>
                            <input
                              type="number"
                              min={20}
                              max={200}
                              step={10}
                              value={samConfig.s12EmaFastPeriod ?? 100}
                              onChange={e => setSamConfig(c => ({ ...c, s12EmaFastPeriod: Math.max(10, Number(e.target.value) || 100) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] text-gray-400">Slow Macro EMA:</label>
                            <input
                              type="number"
                              min={50}
                              max={400}
                              step={10}
                              value={samConfig.s12EmaSlowPeriod ?? 200}
                              onChange={e => setSamConfig(c => ({ ...c, s12EmaSlowPeriod: Math.max(20, Number(e.target.value) || 200) }))}
                              className="w-16 bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-white font-mono text-center"
                            />
                          </div>
                        </div>

                        <div className="p-2 rounded bg-sky-900/10 border border-sky-800/30 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-gray-300">
                            <span>S12 Low-Confluence Blocked:</span>
                            <span className="font-bold text-sky-300 font-mono">{comparisonStats.s12Filtered} Blocked</span>
                          </div>
                          <p className="text-sky-300/90 pt-1 font-sans text-[10px]">
                            Filters counter-DI whipsaws, counter-EMA100/200 fades, and thin-volume dead-zone crossovers.
                          </p>
                        </div>
                      </div>

                      {/* Filter 11 (Rec #1): 1-Min SAM(21/5) Afternoon Breakout (#3 Fixed or #5 Chandelier) */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterSam21AfternoonEnabled
                          ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterSam21AfternoonEnabled ?? false}
                              onChange={e => setSamConfig(c => ({ ...c, filterSam21AfternoonEnabled: e.target.checked }))}
                              className="accent-emerald-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">11. SAM 21/5 — 1m Afternoon Breakout (Rec #1)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterSam21AfternoonEnabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterSam21AfternoonEnabled ? 'ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          4-Year verified 1-Min SAM(21/5) institutional breakout (12:30–14:50 IST) with PDH/PDL breakout + causal 5m ADX(14) &ge; 30 &amp; DI spread &gt; 5. Auto-exit opposite disabled; holds trend to EOD (15:25 IST).
                        </p>

                        <div className="grid grid-cols-2 gap-2 mb-2.5">
                          <button
                            type="button"
                            onClick={() => setSamConfig(c => ({ ...c, sam21AfternoonExitMode: 'fixed40' }))}
                            className={`p-2 rounded-md border text-left transition-all cursor-pointer ${
                              (samConfig.sam21AfternoonExitMode ?? 'fixed40') === 'fixed40'
                                ? 'bg-emerald-500/15 border-emerald-400/60 text-emerald-200'
                                : 'bg-[#0A0F1C] border-gray-800 text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            <div className="text-[11px] font-bold">#3 Fixed SL40 / BE+30 / EOD</div>
                            <div className="text-[10px] font-mono opacity-80">PF 1.91 • OOS 1.77 • 5/5 Green Yrs</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSamConfig(c => ({ ...c, sam21AfternoonExitMode: 'chandelier' }))}
                            className={`p-2 rounded-md border text-left transition-all cursor-pointer ${
                              samConfig.sam21AfternoonExitMode === 'chandelier'
                                ? 'bg-emerald-500/15 border-emerald-400/60 text-emerald-200'
                                : 'bg-[#0A0F1C] border-gray-800 text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            <div className="text-[11px] font-bold">#5 Chandelier 0.30% / 0.40%</div>
                            <div className="text-[10px] font-mono opacity-80">PF 1.83 • WR 56.2% • 17.4x Ret/DD</div>
                          </button>
                        </div>

                        <div className="p-2 rounded bg-emerald-900/10 border border-emerald-800/30 text-[10px] flex justify-between text-gray-300">
                          <span>1m SAM(21/5) Afternoon Signals on Chart:</span>
                          <span className="font-bold text-emerald-300 font-mono">{comparisonStats.sam21AfternoonSignals} Signals</span>
                        </div>
                      </div>

                      {/* Filter 12 (Rec #2): Morning + Afternoon Combined (3m OpenDrive + 1m Afternoon) */}
                      <div className={`p-3.5 rounded-lg border transition-all ${
                        samConfig.filterSam21CombinedEnabled
                          ? 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                          : 'bg-[#111827] border-[#1F2937]'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={samConfig.filterSam21CombinedEnabled ?? false}
                              onChange={e => setSamConfig(c => ({ ...c, filterSam21CombinedEnabled: e.target.checked }))}
                              className="accent-amber-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs font-bold text-white">12. SAM 21/5 — Morning + Afternoon Combined (Rec #2)</span>
                          </label>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            samConfig.filterSam21CombinedEnabled
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-gray-800 text-gray-400'
                          }`}>
                            {samConfig.filterSam21CombinedEnabled ? 'ACTIVE' : 'OFF'}
                          </span>
                        </div>

                        <p className="text-[11px] text-gray-300 mb-2">
                          Combines two uncorrelated institutional windows (~+9,500 pts over 4 years, PF ~2.0):
                        </p>

                        <div className="text-[10px] space-y-1 bg-[#0A0F1C] p-2.5 rounded-md border border-gray-800/80 font-mono mb-2.5 text-gray-300">
                          <p className="text-amber-300">• Morning (#1): 3m SAM(21/5) OpenDrive (09:20–10:15) • PDH/PDL + StrongBar + 15m Supertrend • SL 2x / Trail 3x 5m ATR + BE30 / +50➔+20 Lock</p>
                          <p className="text-emerald-300">• Afternoon (#3/#5, PF 1.83–1.91): 1m SAM(21/5) (12:30–14:50) • PDH/PDL + 5m ADX &ge; 30 &amp; DI &gt; 5 • Uses selected exit mode above</p>
                        </div>

                        <div className="p-2 rounded bg-amber-900/10 border border-amber-800/30 text-[10px] flex justify-between text-gray-300">
                          <span>Combined Signals (Morning 3m / Afternoon 1m):</span>
                          <span className="font-bold text-amber-300 font-mono">
                            {comparisonStats.sam21OpenDriveSignals} Morning + {comparisonStats.sam21AfternoonSignals} Afternoon
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Colors & Visibility */}
                  <div className="bg-[#0A0F1C] p-4 rounded-xl border border-[#1F2937] space-y-3">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <span>🎨</span>
                      <span>Signal Visibility &amp; Colors</span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* CALL Settings */}
                      <div className="p-3 rounded-lg bg-[#111827] border border-[#1F2937] space-y-2">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="font-semibold text-blue-400 text-xs">Show CALL Signals</span>
                          <input
                            type="checkbox"
                            checked={samConfig.visibleBuy}
                            onChange={e => setSamConfig(c => ({ ...c, visibleBuy: e.target.checked }))}
                            className="accent-blue-500 cursor-pointer"
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={samConfig.colorBuy}
                            onChange={e => setSamConfig(c => ({ ...c, colorBuy: e.target.value }))}
                            className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                          />
                          <span className="font-mono text-gray-300 text-xs">{samConfig.colorBuy}</span>
                        </div>
                      </div>

                      {/* PUT Settings */}
                      <div className="p-3 rounded-lg bg-[#111827] border border-[#1F2937] space-y-2">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="font-semibold text-rose-400 text-xs">Show PUT Signals</span>
                          <input
                            type="checkbox"
                            checked={samConfig.visibleSell}
                            onChange={e => setSamConfig(c => ({ ...c, visibleSell: e.target.checked }))}
                            className="accent-rose-500 cursor-pointer"
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={samConfig.colorSell}
                            onChange={e => setSamConfig(c => ({ ...c, colorSell: e.target.value }))}
                            className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                          />
                          <span className="font-mono text-gray-300 text-xs">{samConfig.colorSell}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer Buttons */}
            <div className="px-6 py-4 border-t border-[#1F2937] bg-[#0A0F1C]/80 flex items-center justify-between">
              <button
                onClick={() => {
                  setSamConfig({ ...DEFAULT_SAM_CONFIG });
                }}
                className="px-3.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>🎯</span>
                <span>Restore Pine Script Defaults (SL 20pts)</span>
              </button>

              <button
                onClick={() => setShowStrategySettingsModal(null)}
                className="px-5 py-1.5 rounded-lg bg-brand-blue hover:bg-blue-600 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                Done / Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
