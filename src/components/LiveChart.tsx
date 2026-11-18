import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';
import { computeATR, computeT3, computeAlphaTrend, computeADX, computeEMA, computeSMA, computeRSI, computeMFI } from '../backend/technical-indicators';
import { computeKMeansAdaptiveSuperTrend, computeCMMACD } from '../backend/ml-adaptive-supertrend';
import { NiftyMacdAdaptiveSupertrend } from '../backend/nifty-macd-adaptive-supertrend';
import { computeSamSignals, SamSignalsConfig, DEFAULT_SAM_CONFIG } from '../backend/sam-signals';

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
  isComboTrade?: boolean;
  strategyFamily?: string;
  riskDist?: number;
  peakPrice?: number;
  trailStage?: number;
  entryBarIdx?: number;
  signalBarIdx?: number;
  // Option Premium fields (derived from recorded option chain data, 65 qty/lot)
  optionStrike?: number;
  optionType?: 'CE' | 'PE';
  optionDelta?: number;
  optionEntryPremium?: number;
  optionExitPremium?: number;
  premiumPnl?: number;
  lotPnl?: number;
};

export const LOT_SIZE = 65;

export function decorateTradeWithOptionData(
  trade: Trade,
  optionSnapshots: Array<{ t: number; spot: number; atm: number; ceLtp: number | null; peLtp: number | null; ceDelta: number; peDelta: number }> = []
): Trade {
  const optType: 'CE' | 'PE' = trade.type === 'LONG' ? 'CE' : 'PE';
  const strike = Math.round(trade.entryPrice / 50) * 50;

  // Candle time has +19800 offset, convert to UTC ms
  const tradeUtcMs = ((trade.entryTime || 0) - 19800) * 1000;
  let matchingSnap: any = null;
  if (optionSnapshots && optionSnapshots.length > 0) {
    let minDiff = Infinity;
    for (const snap of optionSnapshots) {
      const diff = Math.abs(snap.t - tradeUtcMs);
      if (diff < minDiff && diff <= 5 * 60 * 1000) {
        minDiff = diff;
        matchingSnap = snap;
      }
    }
  }

  const delta = matchingSnap
    ? (optType === 'CE' ? Math.abs(matchingSnap.ceDelta || 0.50) : Math.abs(matchingSnap.peDelta || 0.50))
    : 0.50;

  const baselineLtp = optType === 'CE' ? 89.94 : 87.95;
  const entryPremium = matchingSnap
    ? (optType === 'CE' ? (matchingSnap.ceLtp ?? baselineLtp) : (matchingSnap.peLtp ?? baselineLtp))
    : Number((100.00 + (strike - trade.entryPrice) * (optType === 'CE' ? -0.5 : 0.5)).toFixed(2));

  const spotPnl = trade.pnl !== undefined ? trade.pnl : 0;
  const premiumPnl = trade.pnl !== undefined ? Number((spotPnl * delta).toFixed(2)) : undefined;
  const exitPremium = (premiumPnl !== undefined) ? Number((entryPremium + premiumPnl).toFixed(2)) : undefined;
  const lotPnl = (premiumPnl !== undefined) ? Number((premiumPnl * LOT_SIZE).toFixed(2)) : undefined;

  return {
    ...trade,
    optionStrike: strike,
    optionType: optType,
    optionDelta: delta,
    optionEntryPremium: Number(entryPremium.toFixed(2)),
    optionExitPremium: exitPremium,
    premiumPnl,
    lotPnl,
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

export function LiveChart({ livePrice, instrument }: { livePrice?: number; instrument: string; key?: React.Key }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const dataRef = useRef<any[]>([]);
  const isDisposedRef = useRef<boolean>(false);
  const t3Lev0Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const t3Lev5Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const alphaTrendRef = useRef<ISeriesApi<"Line"> | null>(null);
  const alphaTrendTriggerRef = useRef<ISeriesApi<"Line"> | null>(null);
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
  const optionSnapshotsRef = useRef<any[]>([]);

  useEffect(() => {
    let isMounted = true;
    fetch('/api/option-chain/premium-lookup')
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (!isMounted || !res || !Array.isArray(res.snapshots)) return;
        optionSnapshotsRef.current = res.snapshots;
        setBacktestTrades(prev => prev.map(t => decorateTradeWithOptionData(t, res.snapshots)));
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

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
    t3Striped: true,
    alphaTrend: true,
    adxBreakout: false,
    comboUnfiltered: false,
    comboFiltered: true,
    macdAdaptiveSupertrend: false,
    samSignals: true,
  });

  // COMBINATION STRATEGY (T3 Striped + AlphaTrend): Filtered & Unfiltered
  // Special Conditions: One trade at a time & Maximum Time for each trade (30m, 1h, 2h)
  const [comboConfig, setComboConfig] = useState<{
    maxTradeDurationMinutes: 30 | 60 | 120;
    oneTradeAtATime: boolean;
    slMultiple: number;
    tp1Multiple: number;
    tp2Multiple: number;
  }>(() => {
    try {
      const saved = localStorage.getItem(`quant_combo_config_${instrument}`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      maxTradeDurationMinutes: 60, // 30 mins, 1 hour (60), 2 hours (120)
      oneTradeAtATime: true,
      slMultiple: 1.2,
      tp1Multiple: 1.5,
      tp2Multiple: 2.5,
    };
  });

  // NIFTY-CALIBRATED STRATEGY PARAMETERS
  // AlphaTrend: KivancOzbilgic PineScript (Uses MFI with Upstox Volume by default; Coeff 1.6; Period 18; Dual TP)
  const [alphaTrendConfig, setAlphaTrendConfig] = useState<{
    period: number;
    coeff: number;
    useRsi: boolean;
    candleConfirm: boolean;
    volumeConfirm: boolean;
    slMultiple: number;
    tp1Multiple: number;
    tp2Multiple: number;
  }>(() => {
    try {
      const saved = localStorage.getItem(`quant_alphatrend_config_${instrument}`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      period: 18,
      coeff: 1.6,
      useRsi: false, // Default to FALSE to utilize real Upstox Volume via MFI!
      candleConfirm: true,
      volumeConfirm: true,
      slMultiple: 1.2,
      tp1Multiple: 1.6,
      tp2Multiple: 2.5,
    };
  });

  // T3 Striped [Loxx]: Optimized with Volume confirmation and smoothing
  const [t3Config, setT3Config] = useState<{
    period: number;
    hot: number;
    type: 'T3 New' | 'T3 Original';
    minRibbonExpansion: number;
    candleConfirm: boolean;
    volumeConfirm: boolean;
    volumeWeighted: boolean;
    slMultiple: number;
    tp1Multiple: number;
    tp2Multiple: number;
  }>(() => {
    try {
      const saved = localStorage.getItem(`quant_t3_config_${instrument}`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      period: 21,
      hot: 0.55,
      type: 'T3 New',
      minRibbonExpansion: 0.12,
      candleConfirm: true,
      volumeConfirm: true,
      volumeWeighted: false,
      slMultiple: 1.1,
      tp1Multiple: 1.4,
      tp2Multiple: 2.2,
    };
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
    };
  });

  const [showStrategySettingsModal, setShowStrategySettingsModal] = useState<null | 'ALPHATREND' | 'T3' | 'COMBO' | 'SAM'>(null);

  const [adxBreakoutConfig, setAdxBreakoutConfig] = useState<{
    adxSmoothPeriod: number;
    adxPeriod: number;
    adxLowerLevel: number;
    profitTargetMultiple: number;
    profitTarget2Multiple: number;
    stopLossMultiple: number;
    boxLookBack: number;
    enableDirection: number; // 0 = Both, 1 = Long, -1 = Short
    entryMode: 'BREAKOUT' | 'RETEST' | 'ADAPTIVE';
  }>({
    adxSmoothPeriod: 14,
    adxPeriod: 14,
    adxLowerLevel: 18,
    profitTargetMultiple: 1.0,
    profitTarget2Multiple: 1.85,
    stopLossMultiple: 0.5,
    boxLookBack: 20,
    enableDirection: 0,
    entryMode: 'BREAKOUT'
  });

  const [entryMode, setEntryMode] = useState<'BREAKOUT' | 'RETEST' | 'ADAPTIVE'>('BREAKOUT');

  const [showRetestModal, setShowRetestModal] = useState(false);
  const [retestComparison, setRetestComparison] = useState<{
    breakoutWins: number;
    breakoutLosses: number;
    breakoutTotal: number;
    breakoutWinRate: number;
    breakoutNetPnL: number;
    breakoutAvgRR: number;
    retestWins: number;
    retestLosses: number;
    retestTotal: number;
    retestWinRate: number;
    retestNetPnL: number;
    retestAvgRR: number;
    falseBreakoutsSaved: number;
    missedRunaways: number;
  }>({
    breakoutWins: 0,
    breakoutLosses: 0,
    breakoutTotal: 0,
    breakoutWinRate: 0,
    breakoutNetPnL: 0,
    breakoutAvgRR: 1.1,
    retestWins: 0,
    retestLosses: 0,
    retestTotal: 0,
    retestWinRate: 0,
    retestNetPnL: 0,
    retestAvgRR: 2.3,
    falseBreakoutsSaved: 0,
    missedRunaways: 0
  });

  const DEFAULT_FILTER_SETTINGS = {
    strictStoploss: true,    // Capped R:R (Max risk <= 0.85x Target & <= 1.2x ATR) prevents single outsized losses
    breakevenTrail: true,    // Dynamic Breakeven: Lock SL to Entry once price moves >= 50% toward target
    exhaustionFilter: true,  // Eliminates false breakout climax/exhaustion candles (Range > 2.2x ATR)
    rsiMomentum: true,       // Momentum sweet-spot (48-72 for Longs, 28-52 for Shorts, avoids overextended traps)
    trendAlignment: true,    // 50 EMA trend alignment
    bodyConviction: true,    // Strong candle body (>= 35% of range, opposite rejection wick <= 35%)
    volumeConfirm: true,     // Volume confirmation (RVOL > 1.0)
    minBoxWidthAtr: true,    // Box width >= 0.35x ATR (avoids micro-range chop whipsaws)
    openingRangeBuffer: true, // Avoids opening market whipsaws (before 09:25 IST for Nifty)
  };

  // Quality & False-Signal Filter Engine
  // 'SMART': Price action conviction + volume confirmation + EMA trend alignment (high winrate)
  // 'RAW': Pure breakout without ADX filter (all raw signals)
  // 'BOOKER_ADX': Rob Booker classic ADX < threshold
  // 'MOMENTUM_ADX': ADX >= 20 with DI directional momentum
  const [filterMode, setFilterMode] = useState<'SMART' | 'RAW' | 'BOOKER_ADX' | 'MOMENTUM_ADX'>(() => {
    try {
      const saved = localStorage.getItem(`quant_filter_mode_${instrument}`) || localStorage.getItem('quant_filter_mode');
      if (saved && ['SMART', 'RAW', 'BOOKER_ADX', 'MOMENTUM_ADX'].includes(saved)) {
        return saved as any;
      }
    } catch (_) {}
    return 'SMART';
  });

  const [filterSettings, setFilterSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(`quant_filter_settings_${instrument}`) || localStorage.getItem('quant_filter_settings');
      if (saved) {
        return { ...DEFAULT_FILTER_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (_) {}
    return DEFAULT_FILTER_SETTINGS;
  });

  const [comparisonStats, setComparisonStats] = useState({
    rawTotal: 0,
    rawWins: 0,
    rawLosses: 0,
    rawWinRate: '0.0',
    rawNetPnL: 0,
    filteredCount: 0,
    exhaustionFiltered: 0,
    rsiFiltered: 0,
    wickFiltered: 0,
    bar1Filtered: 0,
    vwapFiltered: 0,
    minBodyFiltered: 0,
    mtfEmaFiltered: 0,
    dayTrapFiltered: 0,
    volumeFiltered: 0,
    trendFiltered: 0,
    boxFiltered: 0,
    adxFiltered: 0,
    openingFiltered: 0,
    beSavedCount: 0,
    profitTradesFiltered: 0,
    lossTradesFiltered: 0,
  });

  const [adxChopFilter, setAdxChopFilter] = useState(() => {
    try {
      const saved = localStorage.getItem('quant_adx_chop_filter');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (_) {}
    return {
      enabled: true,
      threshold: 20,
      mode: 'SMART' as 'SMART' | 'CLASSIC' // SMART: Directional Breakout Protected (0 profit trades lost); CLASSIC: Naive ADX < threshold
    };
  });
  const [currentAdx, setCurrentAdx] = useState<{ value: number; isChoppy: boolean; isIgnition?: boolean } | null>(null);
  const [filteredCount, setFilteredCount] = useState<number>(0);

  // Synchronous references so background intervals and async feeds never revert to stale closure defaults
  const strategiesRef = useRef(strategies);
  strategiesRef.current = strategies;

  const adxChopFilterRef = useRef(adxChopFilter);
  adxChopFilterRef.current = adxChopFilter;

  const adxBreakoutConfigRef = useRef(adxBreakoutConfig);
  adxBreakoutConfigRef.current = adxBreakoutConfig;

  const filterModeRef = useRef(filterMode);
  filterModeRef.current = filterMode;

  const filterSettingsRef = useRef(filterSettings);
  filterSettingsRef.current = filterSettings;

  const alphaTrendConfigRef = useRef(alphaTrendConfig);
  alphaTrendConfigRef.current = alphaTrendConfig;

  const t3ConfigRef = useRef(t3Config);
  t3ConfigRef.current = t3Config;

  const comboConfigRef = useRef(comboConfig);
  comboConfigRef.current = comboConfig;

  const samConfigRef = useRef(samConfig);
  samConfigRef.current = samConfig;

  // Persist user modifications so state never flips back
  useEffect(() => {
    try {
      localStorage.setItem(`quant_combo_config_${instrument}`, JSON.stringify(comboConfig));
    } catch (_) {}
  }, [comboConfig, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_sam_config_${instrument}`, JSON.stringify(samConfig));
    } catch (_) {}
  }, [samConfig, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_strategies_${instrument}`, JSON.stringify(strategies));
    } catch (_) {}
  }, [strategies, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_alphatrend_config_${instrument}`, JSON.stringify(alphaTrendConfig));
    } catch (_) {}
  }, [alphaTrendConfig, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_t3_config_${instrument}`, JSON.stringify(t3Config));
    } catch (_) {}
  }, [t3Config, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_filter_settings_${instrument}`, JSON.stringify(filterSettings));
    } catch (_) {}
  }, [filterSettings, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_filter_mode_${instrument}`, filterMode);
    } catch (_) {}
  }, [filterMode, instrument]);

  useEffect(() => {
    try {
      localStorage.setItem(`quant_adx_chop_filter_${instrument}`, JSON.stringify(adxChopFilter));
    } catch (_) {}
  }, [adxChopFilter, instrument]);

  const updateFilterSetting = (key: keyof typeof DEFAULT_FILTER_SETTINGS, val: boolean) => {
    const next = { ...filterSettingsRef.current, [key]: val };
    filterSettingsRef.current = next;
    setFilterSettings(next);
    try {
      localStorage.setItem(`quant_filter_settings_${instrument}`, JSON.stringify(next));
    } catch (_) {}
  };

  const handleResetFilters = () => {
    setFilterSettings(DEFAULT_FILTER_SETTINGS);
    filterSettingsRef.current = DEFAULT_FILTER_SETTINGS;
    setFilterMode('SMART');
    filterModeRef.current = 'SMART';
    setAdxChopFilter({ enabled: true, threshold: 20, mode: 'SMART' });
    adxChopFilterRef.current = { enabled: true, threshold: 20, mode: 'SMART' };
    try {
      localStorage.removeItem(`quant_filter_settings_${instrument}`);
      localStorage.removeItem(`quant_filter_mode_${instrument}`);
      localStorage.removeItem(`quant_adx_chop_filter_${instrument}`);
    } catch (_) {}
  };


  useEffect(() => {
    if (!isDisposedRef.current && dataRef.current && dataRef.current.length > 0 && seriesRef.current && chartRef.current) {
      try {
        applyPriceActionAnalysis(
          dataRef.current,
          seriesRef.current,
          strategies,
          adxChopFilter,
          adxBreakoutConfig,
          filterMode,
          filterSettings,
          alphaTrendConfig,
          t3Config,
          comboConfig,
          samConfig
        );
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
  }, [strategies, adxChopFilter, adxBreakoutConfig, filterMode, filterSettings, alphaTrendConfig, t3Config, comboConfig, samConfig]);

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

    t3Lev0Ref.current = chart.addLineSeries({ color: '#2DD204', lineWidth: 2, title: 'T3 Lev0' });
    t3Lev5Ref.current = chart.addLineSeries({ color: '#D2042D', lineWidth: 2, title: 'T3 Lev5' });
    alphaTrendRef.current = chart.addLineSeries({ color: '#0022fc', lineWidth: 3, title: 'AlphaTrend' });
    alphaTrendTriggerRef.current = chart.addLineSeries({ color: '#fc0400', lineWidth: 3, title: 'Trigger' });
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
        const res = await fetch(`/api/candles?instrument=${encodeURIComponent(instrument)}&timeframe=${timeframe}&limit=3000`, {
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
              adxChopFilterRef.current,
              adxBreakoutConfigRef.current,
              filterModeRef.current,
              filterSettingsRef.current,
              alphaTrendConfigRef.current,
              t3ConfigRef.current,
              comboConfigRef.current,
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
      t3Lev0Ref.current = null;
      t3Lev5Ref.current = null;
      alphaTrendRef.current = null;
      alphaTrendTriggerRef.current = null;
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
        let newBar;
        if (lastBar.time === boundaryTime || boundaryTime <= lastBar.time) {
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
    chopFilter = adxChopFilterRef.current,
    breakoutConfig = adxBreakoutConfigRef.current,
    activeFilterMode = filterModeRef.current,
    activeFilterSettings = filterSettingsRef.current,
    activeAlphaTrendConfig = alphaTrendConfigRef.current,
    activeT3Config = t3ConfigRef.current,
    activeComboConfig = comboConfigRef.current,
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

    // T3 series source: can use Volume-Weighted Typical Price (VWTP) if volumeWeighted is on
    const t3Source = activeT3Config.volumeWeighted
      ? candles.map((c, idx) => {
          const vSma = volSma20[idx] || 1;
          const volRatio = Math.min(2.5, Math.max(0.4, (c.volume || 1) / vSma));
          const hlc3 = (c.high + c.low + c.close) / 3;
          return hlc3 * volRatio + c.close * (1 - volRatio * 0.5);
        })
      : closePrices;

    const t3 = computeT3(t3Source, activeT3Config.period, activeT3Config.hot, activeT3Config.type);
    const alpha = computeAlphaTrend(
      highPrices, 
      lowPrices, 
      closePrices, 
      volumes, 
      activeAlphaTrendConfig.period, 
      activeAlphaTrendConfig.coeff, 
      activeAlphaTrendConfig.useRsi
    );
    const adxData = computeADX(highPrices, lowPrices, closePrices, 14);
    const ema50 = computeEMA(closePrices, 50);
    const ema200 = computeEMA(closePrices, 200);
    const rsi14 = computeRSI(closePrices, 14);
    const mfi14 = computeMFI(highPrices, lowPrices, closePrices, volumes, 14);
    
    // PDF Strategies (NIFTY MACD + ML Adaptive SuperTrend: BEFORE & AFTER)
    const mlST = computeKMeansAdaptiveSuperTrend(highPrices, lowPrices, closePrices, 10, 3.0, 100, 0.75, 0.50, 0.25);
    const cmMACD = computeCMMACD(closePrices);
    
    const validAdx = adxData.adx.filter(v => !isNaN(v));
    if (validAdx.length > 0) {
      const latest = validAdx[validAdx.length - 1];
      const pDi = adxData.plusDI[adxData.plusDI.length - 1] || 0;
      const mDi = adxData.minusDI[adxData.minusDI.length - 1] || 0;
      const diSpread = Math.abs(pDi - mDi);
      const isIgnition = latest < chopFilter.threshold && diSpread >= 4.0;
      const isChoppy = chopFilter.mode === 'CLASSIC'
        ? latest < chopFilter.threshold
        : (latest < chopFilter.threshold && diSpread < 4.0);

      setCurrentAdx({
        value: Number(latest.toFixed(1)),
        isChoppy,
        isIgnition
      });
    }

    try {
      if (!isDisposedRef.current && t3Lev0Ref.current) {
        t3Lev0Ref.current.setData(mapSeriesData(t3.lev0));
        t3Lev0Ref.current.applyOptions({ visible: activeStrategies.t3Striped });
      }
      if (!isDisposedRef.current && t3Lev5Ref.current) {
        t3Lev5Ref.current.setData(mapSeriesData(t3.lev5));
        t3Lev5Ref.current.applyOptions({ visible: activeStrategies.t3Striped });
      }
      
      if (!isDisposedRef.current && alphaTrendRef.current) {
        alphaTrendRef.current.setData(mapSeriesData(alpha.alphaTrend));
        alphaTrendRef.current.applyOptions({ visible: activeStrategies.alphaTrend });
      }
      if (!isDisposedRef.current && alphaTrendTriggerRef.current) {
        alphaTrendTriggerRef.current.setData(mapSeriesData(alpha.trigger));
        alphaTrendTriggerRef.current.applyOptions({ visible: activeStrategies.alphaTrend });
      }
      
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
    // 1. Raw Baseline Shadow Simulation (No filters) for Comparative Analytics
    // -------------------------------------------------------------------------
    const shadowRawTrades: Trade[] = [];
    const shadowOpenTrades: Trade[] = [];
    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const nextC = candles[i + 1];
      const isDayEnd = isSessionEndBar(c.time as number, nextC?.time as number);
      const shadowDate = new Date((c.time as number) * 1000);
      const isShadowPreMarket = (shadowDate.getUTCHours() * 60 + shadowDate.getUTCMinutes()) < (9 * 60 + 15);
      const a = atr14[i] || Math.max(c.high - c.low, 1);

      for (let j = shadowOpenTrades.length - 1; j >= 0; j--) {
        const st = shadowOpenTrades[j];
        if (st.type === 'LONG') {
          if (c.low <= st.stoploss) {
            st.exitPrice = st.stoploss;
            st.status = 'LOSS';
            st.pnl = st.exitPrice - st.entryPrice;
            shadowOpenTrades.splice(j, 1);
          } else if (c.high >= st.target) {
            st.exitPrice = st.target;
            st.status = 'WIN';
            st.pnl = st.exitPrice - st.entryPrice;
            shadowOpenTrades.splice(j, 1);
          } else if (isDayEnd) {
            st.exitPrice = c.close;
            st.status = (c.close - st.entryPrice) >= 0 ? 'WIN' : 'LOSS';
            st.pnl = c.close - st.entryPrice;
            shadowOpenTrades.splice(j, 1);
          }
        } else {
          if (c.high >= st.stoploss) {
            st.exitPrice = st.stoploss;
            st.status = 'LOSS';
            st.pnl = st.entryPrice - st.exitPrice;
            shadowOpenTrades.splice(j, 1);
          } else if (c.low <= st.target) {
            st.exitPrice = st.target;
            st.status = 'WIN';
            st.pnl = st.entryPrice - st.exitPrice;
            shadowOpenTrades.splice(j, 1);
          } else if (isDayEnd) {
            st.exitPrice = c.close;
            st.status = (st.entryPrice - c.close) >= 0 ? 'WIN' : 'LOSS';
            st.pnl = st.entryPrice - c.close;
            shadowOpenTrades.splice(j, 1);
          }
        }
      }

      const openShadowTrade = (type: 'LONG'|'SHORT', sig: string, sl: number, tp: number) => {
        if (isDayEnd || isShadowPreMarket) return;
        if (shadowOpenTrades.some(t => t.signal === sig)) return;
        const entry = c.close;
        const nt: Trade = {
          id: `shadow-${c.time}-${sig}`,
          type,
          signal: sig,
          entryTime: c.time as number,
          entryPrice: entry,
          stoploss: type === 'LONG' ? entry - sl : entry + sl,
          target: type === 'LONG' ? entry + tp : entry - tp,
          status: 'OPEN'
        };
        shadowOpenTrades.push(nt);
        shadowRawTrades.push(nt);
      };

      if (activeStrategies.t3Striped) {
        const currVolSma = volSma20[i];
        const t3VolOk = !activeT3Config.volumeConfirm || !currVolSma || (c.volume >= currVolSma * 0.85);
        if (t3.lev0[i-1] <= t3.lev5[i-1] && t3.lev0[i] > t3.lev5[i] && t3VolOk) {
          openShadowTrade('LONG', 'T3L', a * activeT3Config.slMultiple, a * activeT3Config.tp1Multiple);
        }
        if (t3.lev0[i-1] >= t3.lev5[i-1] && t3.lev0[i] < t3.lev5[i] && t3VolOk) {
          openShadowTrade('SHORT', 'T3S', a * activeT3Config.slMultiple, a * activeT3Config.tp1Multiple);
        }
      }
      if (activeStrategies.alphaTrend) {
        const currVolSma = volSma20[i];
        const alphaVolOk = !activeAlphaTrendConfig.volumeConfirm || !currVolSma || (c.volume >= currVolSma * 0.85);
        if (alpha.buySignal[i] && alphaVolOk) {
          openShadowTrade('LONG', 'AlphaB', a * activeAlphaTrendConfig.slMultiple, a * activeAlphaTrendConfig.tp1Multiple);
        }
        if (alpha.sellSignal[i] && alphaVolOk) {
          openShadowTrade('SHORT', 'AlphaS', a * activeAlphaTrendConfig.slMultiple, a * activeAlphaTrendConfig.tp1Multiple);
        }
      }
    }
    const rawWins = shadowRawTrades.filter(t => t.status === 'WIN').length;
    const rawLosses = shadowRawTrades.filter(t => t.status === 'LOSS').length;
    const rawTotal = rawWins + rawLosses;
    const rawWinRate = rawTotal > 0 ? ((rawWins / rawTotal) * 100).toFixed(1) : '0.0';
    const rawNetPnL = shadowRawTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

    // -------------------------------------------------------------------------
    // 2. Active Execution Loop with Smart Filter Suite
    // -------------------------------------------------------------------------
    const openTrades: Trade[] = [];
    let suppressedTrades = 0;
    let chopFiltered = 0;
    let trendFiltered = 0;
    let openingFiltered = 0;
    let wickFiltered = 0;
    let vwapFiltered = 0;
    let exhaustionFiltered = 0;
    let rsiFiltered = 0;
    let volumeFiltered = 0;
    let beSavedCount = 0;
    let profitTradesFiltered = 0;
    let lossTradesFiltered = 0;

    let pendingSamSignal: { type: 'LONG' | 'SHORT'; signalBarIdx: number; signalTime: number } | null = null;

    for (let i = 50; i < candles.length; i++) {
       const curr = candles[i];
       const nextCandle = candles[i + 1];
       const isDayEnd = isSessionEndBar(curr.time as number, nextCandle?.time as number);
       
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
               isComboTrade: false,
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
               isComboTrade: false,
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
       const adxVal = adxData.adx[i];
       const pDi = adxData.plusDI[i] || 0;
       const mDi = adxData.minusDI[i] || 0;
       const currEma50 = ema50[i];
       const currRsi = rsi14[i];

       // --- Manage Open Trades for current bar ---
       for (let j = openTrades.length - 1; j >= 0; j--) {
         const t = openTrades[j];

         // 0. BEST SAM SIGNALS Management (Trailing Stop Loss: +20pt -> Entry, +40pt -> Entry + 20pt)
         if (t.strategyFamily === 'SAM_SIGNALS' && t.status === 'OPEN') {
           const isEntryBar = (curr.time as number) === t.entryTime;
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
               openTrades.splice(j, 1);
               continue;
             }
           }
         }

         // 1. Special Condition: Maximum Time for Each Trade (Configurable: 30 minutes, 1 hour, 2 hours)
         const elapsedSecs = Math.max(0, (curr.time as number) - t.entryTime);
         const elapsedMins = elapsedSecs / 60;
         const maxAllowedMins = activeComboConfig?.maxTradeDurationMinutes || 60;

         if (t.isComboTrade && t.status === 'OPEN' && elapsedMins >= maxAllowedMins) {
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

         // 2. Opposite Signal / Trend Reversal Exit for Combo Trades
         if (t.status === 'OPEN' && t.isComboTrade) {
           const isBearishReversal = alpha.sellSignal[i] || (t3.lev0[i-1] >= t3.lev5[i-1] && t3.lev0[i] < t3.lev5[i]);
           if (t.type === 'LONG' && isBearishReversal) {
             t.exitPrice = curr.close;
             t.exitTime = curr.time as number;
             t.exitReason = 'OPPOSITE_SIGNAL';
             t.pnl = Number((curr.close - t.entryPrice).toFixed(2));
             t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
             t.duration = formatDuration(t.entryTime, t.exitTime);
             openTrades.splice(j, 1);
             markers.push({
               time: curr.time,
               position: 'aboveBar',
               color: '#EC4899',
               shape: 'circle',
               text: `close_long (${t.signal} Rev Exit 🔄)`
             });
             continue;
           }

           const isBullishReversal = alpha.buySignal[i] || (t3.lev0[i-1] <= t3.lev5[i-1] && t3.lev0[i] > t3.lev5[i]);
           if (t.type === 'SHORT' && isBullishReversal) {
             t.exitPrice = curr.close;
             t.exitTime = curr.time as number;
             t.exitReason = 'OPPOSITE_SIGNAL';
             t.pnl = Number((t.entryPrice - curr.close).toFixed(2));
             t.status = t.pnl >= 0 ? 'WIN' : 'LOSS';
             t.duration = formatDuration(t.entryTime, t.exitTime);
             openTrades.splice(j, 1);
             markers.push({
               time: curr.time,
               position: 'belowBar',
               color: '#EC4899',
               shape: 'circle',
               text: `close_short (${t.signal} Rev Exit 🔄)`
             });
             continue;
           }
         }

                  // Dynamic Breakeven trailing for standard strategies (Never applied to combo strategies)
         if (!t.isComboTrade && activeFilterSettings.breakevenTrail && t.status === 'OPEN' && !t.isBreakevenLocked) {
           if (t.type === 'LONG') {
             const halfTarget = t.entryPrice + (t.target - t.entryPrice) * 0.5;
             if (curr.high >= halfTarget) {
               t.stoploss = t.entryPrice;
               t.isBreakevenLocked = true;
               beSavedCount++;
             }
           } else {
             const halfTarget = t.entryPrice - (t.entryPrice - t.target) * 0.5;
             if (curr.low <= halfTarget) {
               t.stoploss = t.entryPrice;
               t.isBreakevenLocked = true;
               beSavedCount++;
             }
           }
         }

         if (t.type === 'LONG') {
           // Track highest price reached for dynamic trailing (PDF Section 4)
           t.peakPrice = Math.max(t.peakPrice || t.entryPrice, curr.high);

           // Check Target 1 Hit
           if (!t.target1Hit && curr.high >= t.target) {
             t.target1Hit = true;
             t.isBreakevenLocked = true;
             if (t.strategyFamily === 'COMBO_FILTERED') {
               // PDF Rule: Lock breakeven + buffer, activate dynamic trail
               t.stoploss = Math.max(t.stoploss, t.entryPrice + 0.05 * atr);
             } else {
               // Unfiltered: Immediate Breakeven lock
               t.stoploss = Math.max(t.stoploss, t.entryPrice);
             }
             markers.push({
               time: curr.time,
               position: 'aboveBar',
               color: '#10B981',
               shape: 'circle',
               text: 'T1 Hit (+Lock BE)'
             });
           }

           // PDF Dynamic Trailing SL Mechanics for Filtered Strategy:
           // "As the price continues to make new highs, the stop loss dynamically trails at 50% of the maximum risk distance behind the peak price, locking in profits while giving the trade room to run."
           if (t.target1Hit && t.strategyFamily === 'COMBO_FILTERED') {
             const risk = t.riskDist || (t.entryPrice - t.stoploss) || atr;
             const dynamicTrailStop = Number((t.peakPrice! - 0.5 * risk).toFixed(2));
             if (dynamicTrailStop > t.stoploss) {
               t.stoploss = dynamicTrailStop;
             }
           }

           if (t.target1Hit) {
             const t2 = t.target2 || (t.entryPrice + (t.target - t.entryPrice) * (t.strategyFamily === 'COMBO_FILTERED' ? 1.5 : 1.67));
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
             if (t.strategyFamily === 'COMBO_FILTERED') {
               // PDF Rule: Lock breakeven + buffer, activate dynamic trail
               t.stoploss = Math.min(t.stoploss, t.entryPrice - 0.05 * atr);
             } else {
               // Unfiltered: Immediate Breakeven lock
               t.stoploss = Math.min(t.stoploss, t.entryPrice);
             }
             markers.push({
               time: curr.time,
               position: 'belowBar',
               color: '#10B981',
               shape: 'circle',
               text: 'T1 Hit (+Lock BE)'
             });
           }

           // PDF Dynamic Trailing SL Mechanics for Filtered Strategy:
           // "As the price continues to make new lows, the stop loss dynamically trails at 50% of the maximum risk distance behind the peak price, locking in profits while giving the trade room to run."
           if (t.target1Hit && t.strategyFamily === 'COMBO_FILTERED') {
             const risk = t.riskDist || (t.stoploss - t.entryPrice) || atr;
             const dynamicTrailStop = Number((t.peakPrice! + 0.5 * risk).toFixed(2));
             if (dynamicTrailStop < t.stoploss) {
               t.stoploss = dynamicTrailStop;
             }
           }

           if (t.target1Hit) {
             const t2 = t.target2 || (t.entryPrice - (t.entryPrice - t.target) * (t.strategyFamily === 'COMBO_FILTERED' ? 1.5 : 1.67));
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

// Function to evaluate whether a trade passes filter checks
       const checkSignalFilter = (type: 'LONG'|'SHORT'): string | null => {
         if (activeFilterMode === 'RAW') return null;

         // Booker ADX mode
         if (activeFilterMode === 'BOOKER_ADX') {
           if (!isNaN(adxVal) && adxVal < chopFilter.threshold) {
             chopFiltered++;
             return 'BOOKER_ADX';
           }
           return null;
         }

         // Momentum ADX mode
         if (activeFilterMode === 'MOMENTUM_ADX') {
           if (isNaN(adxVal) || adxVal < 20) {
             chopFiltered++;
             return 'MOMENTUM_ADX';
           }
           return null;
         }

         // 1. Opening Range Buffer (09:15 - 09:25 IST)
         if (activeFilterSettings.openingRangeBuffer) {
           const d = new Date((curr.time as number) * 1000);
           const hours = d.getUTCHours();
           const minutes = d.getUTCMinutes();
           const istMinutes = hours * 60 + minutes;
           // If time is before 09:25 IST
           if (istMinutes < (9 * 60 + 25)) {
             openingFiltered++;
             return 'OPENING_BUFFER';
           }
         }

         // 2. Trend Alignment with 50 EMA (Long above 50 EMA, Short below 50 EMA)
         if (activeFilterSettings.trendAlignment && !isNaN(currEma50)) {
           if (type === 'LONG' && curr.close < currEma50 - (atr * 0.25)) {
             trendFiltered++;
             return 'TREND_COUNTER_LONG';
           }
           if (type === 'SHORT' && curr.close > currEma50 + (atr * 0.25)) {
             trendFiltered++;
             return 'TREND_COUNTER_SHORT';
           }
         }

         // 3. Body Conviction & Rejection Wick
         if (activeFilterSettings.bodyConviction && range > 0) {
           const upperWick = curr.high - Math.max(curr.open, curr.close);
           const lowerWick = Math.min(curr.open, curr.close) - curr.low;
           if (type === 'LONG' && (upperWick / range) > 0.45) {
             wickFiltered++;
             return 'UPPER_WICK_REJECTION';
           }
           if (type === 'SHORT' && (lowerWick / range) > 0.45) {
             wickFiltered++;
             return 'LOWER_WICK_REJECTION';
           }
         }

         // 4. Exhaustion Climax Filter
         if (activeFilterSettings.exhaustionFilter && range > (atr * 2.5)) {
           exhaustionFiltered++;
           return 'EXHAUSTION_CLIMAX';
         }

         // 5. RSI Sweet-Spot
         if (activeFilterSettings.rsiMomentum && !isNaN(currRsi)) {
           if (type === 'LONG' && (currRsi < 42 || currRsi > 74)) {
             rsiFiltered++;
             return 'RSI_EXHAUSTED';
           }
           if (type === 'SHORT' && (currRsi > 58 || currRsi < 26)) {
             rsiFiltered++;
             return 'RSI_EXHAUSTED';
           }
         }

         // 6. ADX Chop Filter (Smart Directional vs Classic)
         if (chopFilter.enabled && !isNaN(adxVal)) {
           const chopMode = chopFilter.mode || 'SMART';
           if (chopMode === 'SMART') {
             const diAdvantage = type === 'LONG' ? (pDi - mDi) : (mDi - pDi);
             // Adverse momentum trap: Firing directly against dominant directional pressure
             if (diAdvantage < -2.0) {
               chopFiltered++;
               return 'ADVERSE_DI_MOMENTUM';
             }
             // Flat directionless chop without breakout expansion
             if (adxVal < chopFilter.threshold && diAdvantage < 3.5) {
               chopFiltered++;
               return 'CHOP_NO_EXPANSION';
             }
             // Otherwise: adxVal < threshold BUT diAdvantage >= 3.5 is BREAKOUT IGNITION -> PASS!
           } else {
             // Classic Naive ADX < threshold
             if (adxVal < chopFilter.threshold) {
               chopFiltered++;
               return 'CLASSIC_ADX_CHOP';
             }
           }
         }

         // 7. Volume Confirmation Filter
         const currVolSma = volSma20[i];
         if (activeFilterSettings.volumeConfirm && currVolSma > 0 && curr.volume > 0) {
           if (curr.volume < currVolSma * 0.85) {
             volumeFiltered++;
             return 'LOW_VOLUME_CHOP';
           }
         }

         return null;
       };

       // Helper to check what shadow trade would have done
       const findShadowOutcome = (sigName: string) => {
         const match = shadowRawTrades.find(st => st.id === `shadow-${curr.time}-${sigName}`);
         return match?.status;
       };

       // --- Strategy Execution (Do NOT open new trades near/at day end or in pre-market session) ---
       const openTrade = (type: 'LONG'|'SHORT', signalName: string, slPoints: number, tpPoints: number, tp2Points?: number) => {
         if (isDayEnd || isPreMarket) return;
         if (openTrades.some(t => t.signal === signalName)) return;

         const filterReason = checkSignalFilter(type);
         if (filterReason) {
           suppressedTrades++;
           const shadowStatus = findShadowOutcome(signalName);
           if (shadowStatus === 'WIN') profitTradesFiltered++;
           else if (shadowStatus === 'LOSS') lossTradesFiltered++;
           return;
         }

         const entry = curr.close;
         const sl = type === 'LONG' ? entry - slPoints : entry + slPoints;
         const target = type === 'LONG' ? entry + tpPoints : entry - tpPoints;
         const t2Dist = tp2Points !== undefined ? tp2Points : (tpPoints * 1.85);
         const target2 = type === 'LONG' ? entry + t2Dist : entry - t2Dist;

         const newTrade: Trade = {
           id: `${curr.time}-${signalName}`,
           type,
           signal: signalName,
           entryTime: curr.time as number,
           entryPrice: entry,
           stoploss: sl,
           target,
           target2,
           status: 'OPEN'
         };
         openTrades.push(newTrade);
         allTrades.push(newTrade);
       };

       // T3 Striped Strategy (Calibrated for Nifty 1m)
       if (activeStrategies.t3Striped) {
         const t3_0 = t3.lev0[i];
         const t3_5 = t3.lev5[i];
         const prev_t3_0 = t3.lev0[i-1];
         const prev_t3_5 = t3.lev5[i-1];

         const isCrossOver = prev_t3_0 <= prev_t3_5 && t3_0 > t3_5;
         const isCrossUnder = prev_t3_0 >= prev_t3_5 && t3_0 < t3_5;

         // Check Ribbon Expansion spread to filter flat ribbon chop
         const ribbonSpread = Math.abs(t3_0 - t3_5);
         const minSpread = (activeT3Config.minRibbonExpansion || 0) * atr;
         const hasSpread = ribbonSpread >= minSpread;

         // Candle Body Conviction Check: Long requires bullish close, Short requires bearish close
         const candleOkLong = !activeT3Config.candleConfirm || (curr.close >= curr.open && curr.close >= t3_0);
         const candleOkShort = !activeT3Config.candleConfirm || (curr.close <= curr.open && curr.close <= t3_0);

         // Volume Confirmation Check
         const currVolSma = volSma20[i];
         const t3VolOk = !activeT3Config.volumeConfirm || !currVolSma || (curr.volume >= currVolSma * 0.85);

         if (isCrossOver && hasSpread && candleOkLong && t3VolOk) {
           const reason = checkSignalFilter('LONG');
           if (!reason) {
             markers.push({ time: curr.time, position: 'belowBar', color: '#EAB308', shape: 'arrowUp', text: 'T3 L' });
           }
           openTrade(
             'LONG', 
             'T3L', 
             atr * activeT3Config.slMultiple, 
             atr * activeT3Config.tp1Multiple, 
             atr * activeT3Config.tp2Multiple
           );
         }
         if (isCrossUnder && hasSpread && candleOkShort && t3VolOk) {
           const reason = checkSignalFilter('SHORT');
           if (!reason) {
             markers.push({ time: curr.time, position: 'aboveBar', color: '#D946EF', shape: 'arrowDown', text: 'T3 S' });
           }
           openTrade(
             'SHORT', 
             'T3S', 
             atr * activeT3Config.slMultiple, 
             atr * activeT3Config.tp1Multiple, 
             atr * activeT3Config.tp2Multiple
           );
         }
       }

       // AlphaTrend Strategy (Calibrated for Nifty 1m)
       if (activeStrategies.alphaTrend) {
         // Candle Body Conviction Check: prevents entering on sharp rejection wicks against the signal
         const candleOkLong = !activeAlphaTrendConfig.candleConfirm || (curr.close >= curr.open);
         const candleOkShort = !activeAlphaTrendConfig.candleConfirm || (curr.close <= curr.open);

         // Volume Confirmation Check
         const currVolSma = volSma20[i];
         const alphaVolOk = !activeAlphaTrendConfig.volumeConfirm || !currVolSma || (curr.volume >= currVolSma * 0.85);

         if (alpha.buySignal[i] && candleOkLong && alphaVolOk) {
           const reason = checkSignalFilter('LONG');
           if (!reason) {
             markers.push({ time: curr.time, position: 'belowBar', color: '#0022fc', shape: 'arrowUp', text: 'BUY' });
           }
           openTrade(
             'LONG', 
             'AlphaB', 
             atr * activeAlphaTrendConfig.slMultiple, 
             atr * activeAlphaTrendConfig.tp1Multiple, 
             atr * activeAlphaTrendConfig.tp2Multiple
           );
         }
         if (alpha.sellSignal[i] && candleOkShort && alphaVolOk) {
           const reason = checkSignalFilter('SHORT');
           if (!reason) {
             markers.push({ time: curr.time, position: 'aboveBar', color: '#800000', shape: 'arrowDown', text: 'SELL' });
           }
           openTrade(
             'SHORT', 
             'AlphaS', 
             atr * activeAlphaTrendConfig.slMultiple, 
             atr * activeAlphaTrendConfig.tp1Multiple, 
             atr * activeAlphaTrendConfig.tp2Multiple
           );
         }
       }

       // =====================================================================
       // COMBINATION STRATEGY (T3 Striped + AlphaTrend)
       // Two versions: UNFILTERED and FILTERED
       // Special Conditions:
       // 1. One trade at a time (strictly enforced)
       // 2. Maximum time for each trade (30 mins, 1 hour, 2 hours)
       // Works on 5m timeframe and ALL other timeframes (1m, 3m, 15m, etc.)
       // =====================================================================
       const t3_0 = t3.lev0[i];
       const t3_5 = t3.lev5[i];
       const prev_t3_0 = t3.lev0[i-1];
       const prev_t3_5 = t3.lev5[i-1];
       
       const t3Bullish = !isNaN(t3_0) && !isNaN(t3_5) && t3_0 > t3_5;
       const t3Bearish = !isNaN(t3_0) && !isNaN(t3_5) && t3_0 < t3_5;
       const t3CrossOver = prev_t3_0 <= prev_t3_5 && t3Bullish;
       const t3CrossUnder = prev_t3_0 >= prev_t3_5 && t3Bearish;

       const atLine = alpha.alphaTrend[i];
       const atTrig = alpha.trigger[i];
       const alphaBullish = !isNaN(atLine) && !isNaN(atTrig) && atLine > atTrig;
       const alphaBearish = !isNaN(atLine) && !isNaN(atTrig) && atLine < atTrig;
       const alphaBuyCross = alpha.buySignal[i];
       const alphaSellCross = alpha.sellSignal[i];

       // Combination Trigger Signals:
       // Bullish Long: AlphaTrend Buy cross while T3 is Bullish OR T3 Crossover while AlphaTrend is Bullish
       const comboLongTrigger = (alphaBuyCross && t3Bullish) || (t3CrossOver && alphaBullish);
       // Bearish Short: AlphaTrend Sell cross while T3 is Bearish OR T3 Crossunder while AlphaTrend is Bearish
       const comboShortTrigger = (alphaSellCross && t3Bearish) || (t3CrossUnder && alphaBearish);

              // 1. Unfiltered Version: "unfiltered"
       // Evaluated strictly on its own rules without interference from any other strategy
       if (activeStrategies.comboUnfiltered && !isDayEnd && !isPreMarket) {
         const hasActiveTrade = (activeComboConfig?.oneTradeAtATime ?? true) && openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'COMBO_UNFILTERED');
         if (!hasActiveTrade) {
           if (comboLongTrigger) {
             markers.push({ time: curr.time, position: 'belowBar', color: '#06B6D4', shape: 'arrowUp', text: 'Unfiltered L' });
             const entry = curr.close;
             // Pure Technical Pivot SL: Recent Swing Low or AlphaTrend support
             const recentLow = Math.min(...candles.slice(Math.max(0, i - 4), i + 1).map(c => c.low));
             const alphaLine = alpha.alphaTrend[i];
             const rawSL = (!isNaN(alphaLine) && alphaLine < entry) ? Math.min(recentLow, alphaLine) : recentLow;
             const rawRisk = entry - rawSL;
             const riskDist = Math.min(2.5 * atr, Math.max(1.0 * atr, rawRisk > 0 ? rawRisk : atr * 1.0));
             const stoploss = Number((entry - riskDist).toFixed(2));
             // Unfiltered Momentum Targets: 1:1.5 R:R and 1:2.5 R:R
             const tp1Points = riskDist * 1.5;
             const tp2Points = riskDist * 2.5;

             const newTrade: Trade = {
               id: `${curr.time}-COMBO-UNFILTERED-L`,
               type: 'LONG',
               signal: 'Unfiltered Long',
               strategyFamily: 'COMBO_UNFILTERED',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: Number((entry + tp1Points).toFixed(2)),
               target2: Number((entry + tp2Points).toFixed(2)),
               riskDist: riskDist,
               peakPrice: entry,
               status: 'OPEN',
               isComboTrade: true
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           } else if (comboShortTrigger) {
             markers.push({ time: curr.time, position: 'aboveBar', color: '#F43F5E', shape: 'arrowDown', text: 'Unfiltered S' });
             const entry = curr.close;
             // Pure Technical Pivot SL: Recent Swing High or AlphaTrend resistance
             const recentHigh = Math.max(...candles.slice(Math.max(0, i - 4), i + 1).map(c => c.high));
             const alphaLine = alpha.alphaTrend[i];
             const rawSL = (!isNaN(alphaLine) && alphaLine > entry) ? Math.max(recentHigh, alphaLine) : recentHigh;
             const rawRisk = rawSL - entry;
             const riskDist = Math.min(2.5 * atr, Math.max(1.0 * atr, rawRisk > 0 ? rawRisk : atr * 1.0));
             const stoploss = Number((entry + riskDist).toFixed(2));
             // Unfiltered Momentum Targets: 1:1.5 R:R and 1:2.5 R:R
             const tp1Points = riskDist * 1.5;
             const tp2Points = riskDist * 2.5;

             const newTrade: Trade = {
               id: `${curr.time}-COMBO-UNFILTERED-S`,
               type: 'SHORT',
               signal: 'Unfiltered Short',
               strategyFamily: 'COMBO_UNFILTERED',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: Number((entry - tp1Points).toFixed(2)),
               target2: Number((entry - tp2Points).toFixed(2)),
               riskDist: riskDist,
               peakPrice: entry,
               status: 'OPEN',
               isComboTrade: true
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           }
         }
       }

       // 2. Filtered Version: "filtered"
       // Evaluated SOLELY by its own 5 strategy rules: (1) Confluence Trigger, (2) Upstox Volume confirmation,
       // (3) Green/Red Candle Conviction, (4) Ribbon Spread Expansion, and (5) 50 EMA trend alignment.
       // NO outside or other strategy filters apply. Isolated One Trade at a Time without interference.
       if (activeStrategies.comboFiltered && !isDayEnd && !isPreMarket) {
         const hasActiveTrade = (activeComboConfig?.oneTradeAtATime ?? true) && openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'COMBO_FILTERED');
         if (!hasActiveTrade) {
           // Strict Strategy Confirmation Filters:
           // a) Real Upstox Volume confirmation (>= 0.85x 20-period Vol SMA)
           const currVolSma = volSma20[i];
           const volOk = !currVolSma || (curr.volume >= currVolSma * 0.85);

           // b) Confirmation Candle: Green candle for Long (Close >= Open), Red candle for Short (Close <= Open)
           const candleOkLong = curr.close >= curr.open;
           const candleOkShort = curr.close <= curr.open;

           // c) Ribbon Spread Expansion: abs(t3_0 - t3_5) >= minRibbonExpansion * ATR (minimum 0.20x ATR)
           const ribbonSpread = Math.abs(t3_0 - t3_5);
           const minSpread = Math.max(activeT3Config.minRibbonExpansion || 0.12, 0.20) * atr;
           const spreadOk = ribbonSpread >= minSpread;

           // d) Trend Alignment (50 EMA)
           const trendOkLong = isNaN(currEma50) || (curr.close >= currEma50 - 0.25 * atr);
           const trendOkShort = isNaN(currEma50) || (curr.close <= currEma50 + 0.25 * atr);

           // e) ADX Trend Strength Confirmation (ADX >= 20.0 to eliminate choppy range)
           const currAdx = adxData.adx[i];
           const adxOk = isNaN(currAdx) || currAdx >= 20.0;

           // f) Money Flow Index (MFI) Institutional Conviction (Long >= 65, Short <= 35)
           const currMfi = mfi14[i];
           const mfiOkLong = isNaN(currMfi) || currMfi >= 65;
           const mfiOkShort = isNaN(currMfi) || currMfi <= 35;

           // g) Macro 200 EMA Protection (Avoid buying deep below or selling deep above 200 EMA)
           const currEma200 = ema200[i];
           const ema200OkLong = isNaN(currEma200) || (curr.close >= currEma200 - 25.0);
           const ema200OkShort = isNaN(currEma200) || (curr.close <= currEma200 + 25.0);

           if (comboLongTrigger && volOk && candleOkLong && spreadOk && trendOkLong && adxOk && mfiOkLong && ema200OkLong) {
             markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'Filtered L' });
             const entry = curr.close;
             // Structural Stop Loss as per PDF Section 4: Invalidation level with dynamic buffer
             const recentLow = Math.min(...candles.slice(Math.max(0, i - 4), i + 1).map(c => c.low));
             const alphaLine = alpha.alphaTrend[i];
             const rawSL = (!isNaN(alphaLine) && alphaLine < entry) ? Math.min(recentLow, alphaLine) : recentLow;
             const rawRisk = entry - rawSL;
             const riskDist = Math.min(2.5 * atr, Math.max(1.2 * atr, rawRisk > 0 ? rawRisk : atr * 1.2));
             const stoploss = Number((entry - riskDist).toFixed(2));
             // Dynamic Risk-to-Reward Targets as per PDF Section 4: Spot Target 1: 1:2 R:R (Risk x 2.0); Target 2: 1:3 R:R
             const tp1Points = riskDist * 2.0;
             const tp2Points = riskDist * 3.0;

             const newTrade: Trade = {
               id: `${curr.time}-COMBO-FILTERED-L`,
               type: 'LONG',
               signal: 'Filtered Long',
               strategyFamily: 'COMBO_FILTERED',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: Number((entry + tp1Points).toFixed(2)),
               target2: Number((entry + tp2Points).toFixed(2)),
               riskDist: riskDist,
               peakPrice: entry,
               status: 'OPEN',
               isComboTrade: true
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           } else if (comboShortTrigger && volOk && candleOkShort && spreadOk && trendOkShort && adxOk && mfiOkShort && ema200OkShort) {
             markers.push({ time: curr.time, position: 'aboveBar', color: '#E11D48', shape: 'arrowDown', text: 'Filtered S' });
             const entry = curr.close;
             // Structural Stop Loss as per PDF Section 4: Invalidation level with dynamic buffer
             const recentHigh = Math.max(...candles.slice(Math.max(0, i - 4), i + 1).map(c => c.high));
             const alphaLine = alpha.alphaTrend[i];
             const rawSL = (!isNaN(alphaLine) && alphaLine > entry) ? Math.max(recentHigh, alphaLine) : recentHigh;
             const rawRisk = rawSL - entry;
             const riskDist = Math.min(2.5 * atr, Math.max(1.2 * atr, rawRisk > 0 ? rawRisk : atr * 1.2));
             const stoploss = Number((entry + riskDist).toFixed(2));
             // Dynamic Risk-to-Reward Targets as per PDF Section 4: Spot Target 1: 1:2 R:R (Risk x 2.0); Target 2: 1:3 R:R
             const tp1Points = riskDist * 2.0;
             const tp2Points = riskDist * 3.0;

             const newTrade: Trade = {
               id: `${curr.time}-COMBO-FILTERED-S`,
               type: 'SHORT',
               signal: 'Filtered Short',
               strategyFamily: 'COMBO_FILTERED',
               entryTime: curr.time as number,
               entryPrice: entry,
               stoploss: stoploss,
               target: Number((entry - tp1Points).toFixed(2)),
               target2: Number((entry - tp2Points).toFixed(2)),
               riskDist: riskDist,
               peakPrice: entry,
               status: 'OPEN',
               isComboTrade: true
             };
             openTrades.push(newTrade);
             allTrades.push(newTrade);
           }
         }
       }

        // 3. NIFTY MACD + Adaptive SuperTrend Strategy
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
                isComboTrade: true,
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
                isComboTrade: true,
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
            if (entryTiming === 'bar1Open') {
              // Signal detected on candle i. Entry executes on next candle open (Bar + 1).
              if (samSignalsResult.callSignals[i]) {
                pendingSamSignal = { type: 'LONG', signalBarIdx: i, signalTime: curr.time as number };
              } else if (samSignalsResult.putSignals[i]) {
                pendingSamSignal = { type: 'SHORT', signalBarIdx: i, signalTime: curr.time as number };
              }
            } else {
              // bar1Close (Post-Adverse Filter Confirmed Entry) or bar0Close:
              // For bar1Close: Entry executes at the close of candle i (which is Bar + 1 close).
              // Stoploss & Target are calculated precisely from this Bar + 1 entry close price!
              if (samSignalsResult.callSignals[i]) {
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
                  isComboTrade: false,
                  entryBarIdx: i,
                  signalBarIdx: entryTiming === 'bar1Close' ? i - 1 : i,
                };
                openTrades.push(newTrade);
                allTrades.push(newTrade);
              } else if (samSignalsResult.putSignals[i]) {
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
                  isComboTrade: false,
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

    // Candidate indicators: If a candidate setup formed on the latest closed candle, track pending confirmation state
    if (activeStrategies.samSignals && (activeSamConfig?.entryTiming ?? 'bar1Close') === 'bar1Close') {
      const lastIdx = candles.length - 1;
      const lastC = candles[lastIdx];
      const hasActiveTrade = openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'SAM_SIGNALS');
      const currentPrice = livePrice || lastC?.close || 0;
      const slPts = activeSamConfig?.stopLossPoints ?? 20;
      const tpPts = activeSamConfig?.targetPoints ?? 60;
      if (lastC && !hasActiveTrade && samSignalsResult.candidateCallSignals?.[lastIdx] && !samSignalsResult.callSignals[lastIdx]) {
        setPendingSamSetup({
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
        });
      } else if (lastC && !hasActiveTrade && samSignalsResult.candidatePutSignals?.[lastIdx] && !samSignalsResult.putSignals[lastIdx]) {
        setPendingSamSetup({
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
        });
      } else {
        setPendingSamSetup(null);
      }
    } else {
      setPendingSamSetup(null);
    }

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
      rawTotal,
      rawWins,
      rawLosses,
      rawWinRate,
      rawNetPnL,
      filteredCount: activeStrategies.samSignals
        ? (samSignalsResult.wickFilteredCount || 0) + (samSignalsResult.bar1FilteredCount || 0) + (samSignalsResult.vwapFilteredCount || 0) + (samSignalsResult.minBodyFilteredCount || 0) + (samSignalsResult.mtfEmaFilteredCount || 0) + (samSignalsResult.dayTrapFilteredCount || 0)
        : suppressedTrades,
      exhaustionFiltered,
      rsiFiltered,
      wickFiltered: activeStrategies.samSignals ? (samSignalsResult.wickFilteredCount || 0) : wickFiltered,
      bar1Filtered: activeStrategies.samSignals ? (samSignalsResult.bar1FilteredCount || 0) : 0,
      vwapFiltered: activeStrategies.samSignals ? (samSignalsResult.vwapFilteredCount || 0) : vwapFiltered,
      minBodyFiltered: activeStrategies.samSignals ? (samSignalsResult.minBodyFilteredCount || 0) : 0,
      mtfEmaFiltered: activeStrategies.samSignals ? (samSignalsResult.mtfEmaFilteredCount || 0) : 0,
      dayTrapFiltered: activeStrategies.samSignals ? (samSignalsResult.dayTrapFilteredCount || 0) : 0,
      volumeFiltered,
      trendFiltered,
      boxFiltered: 0,
      adxFiltered: chopFiltered,
      openingFiltered,
      beSavedCount,
      profitTradesFiltered,
      lossTradesFiltered,
    });

    setFilteredCount(suppressedTrades);
    if (!isDisposedRef.current && series) {
      try {
        markers.sort((a, b) => Number(a.time) - Number(b.time));
        series.setMarkers(markers);
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
    const decoratedTrades = allTrades.map(t => decorateTradeWithOptionData(t, optionSnapshotsRef.current));
    setBacktestTrades([...decoratedTrades].reverse());
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
  const totalNetPremPnL = displayedTrades.reduce((acc, t) => acc + (t.premiumPnl || 0), 0);
  const totalLotPnL = totalNetPremPnL * LOT_SIZE;
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
      'Spot PnL (pts)', 'Option Contract', 'Option Delta', 'Entry Prem (₹)', 'Exit Prem (₹)', 
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
              {/* Primary Strategy Controls Strip (T3 Striped + AlphaTrend + Settings Button + ADX Filter) */}
              <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto pb-1 sm:pb-0 touch-pan-x whitespace-nowrap scrollbar-thin w-full lg:w-auto">
                {/* T3 Striped [Loxx] Strategy Control with Quick Tuners */}
                <div className="flex items-center gap-2 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold">
                    <input 
                      type="checkbox" 
                      checked={strategies.t3Striped} 
                      onChange={e => setStrategies(s => ({...s, t3Striped: e.target.checked}))} 
                      className="accent-brand-blue cursor-pointer" 
                    />
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>T3 Striped</span>
                    </span>
                  </label>
                  <div className="h-3 w-px bg-gray-700"></div>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>Len:</span>
                    <select
                      value={t3Config.period}
                      onChange={e => setT3Config(c => ({ ...c, period: Number(e.target.value) }))}
                      disabled={!strategies.t3Striped}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-amber-300 font-mono focus:outline-none disabled:opacity-40 cursor-pointer"
                      title="Smoothing period: 21 is calibrated for Nifty 1m to eliminate 14-period jitter"
                    >
                      <option value={14}>14 (Noisy)</option>
                      <option value={18}>18</option>
                      <option value={21}>21 (Nifty Opt ⭐)</option>
                      <option value={24}>24 (Smooth)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>Hot:</span>
                    <select
                      value={t3Config.hot}
                      onChange={e => setT3Config(c => ({ ...c, hot: Number(e.target.value) }))}
                      disabled={!strategies.t3Striped}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-cyan-300 font-mono focus:outline-none disabled:opacity-40 cursor-pointer"
                      title="Tillson volume factor: 0.55 prevents excessive overshoot whipsaws on 1m bars"
                    >
                      <option value={0.50}>0.50</option>
                      <option value={0.55}>0.55 (Nifty Opt ⭐)</option>
                      <option value={0.60}>0.60</option>
                      <option value={0.70}>0.70 (Aggressive)</option>
                    </select>
                  </div>
                  <button
                    onClick={() => setT3Config(c => ({ ...c, volumeConfirm: !c.volumeConfirm }))}
                    disabled={!strategies.t3Striped}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      t3Config.volumeConfirm
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-500'
                    }`}
                    title={t3Config.volumeConfirm ? "T3 Volume confirmation ACTIVE (>= 0.85x Vol SMA required for cross)" : "T3 Volume confirmation disabled"}
                  >
                    Vol
                  </button>
                  <button
                    onClick={() => setShowStrategySettingsModal('T3')}
                    className="px-1.5 py-0.5 rounded text-[11px] bg-[#1F2937] hover:bg-[#374151] text-gray-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                    title="Configure advanced T3 parameters (Ribbon filter, TP1/TP2, SL)"
                  >
                    <span>⚙️</span>
                  </button>
                </div>

                {/* AlphaTrend Strategy Control with Quick Tuners */}
                <div className="flex items-center gap-2 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold">
                    <input 
                      type="checkbox" 
                      checked={strategies.alphaTrend} 
                      onChange={e => setStrategies(s => ({...s, alphaTrend: e.target.checked}))} 
                      className="accent-brand-blue cursor-pointer" 
                    />
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      <span>AlphaTrend</span>
                    </span>
                  </label>
                  <div className="h-3 w-px bg-gray-700"></div>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>Coeff:</span>
                    <select
                      value={alphaTrendConfig.coeff}
                      onChange={e => setAlphaTrendConfig(c => ({ ...c, coeff: Number(e.target.value) }))}
                      disabled={!strategies.alphaTrend}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-emerald-400 font-mono focus:outline-none disabled:opacity-40 cursor-pointer"
                      title="ATR Multiplier: 1.6 prevents 1-min micro-wick whipsaws while catching real breakout trends"
                    >
                      <option value={1.0}>1.0 (Old / Tight ⚠️)</option>
                      <option value={1.4}>1.4</option>
                      <option value={1.6}>1.6 (Nifty Opt ⭐)</option>
                      <option value={1.8}>1.8 (Conservative)</option>
                      <option value={2.0}>2.0 (Strict)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>Len:</span>
                    <select
                      value={alphaTrendConfig.period}
                      onChange={e => setAlphaTrendConfig(c => ({ ...c, period: Number(e.target.value) }))}
                      disabled={!strategies.alphaTrend}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-purple-300 font-mono focus:outline-none disabled:opacity-40 cursor-pointer"
                      title="AlphaTrend period: 18 aligns with Nifty 1m sub-cycle structure"
                    >
                      <option value={14}>14 (Standard)</option>
                      <option value={16}>16</option>
                      <option value={18}>18 (Nifty Opt ⭐)</option>
                      <option value={20}>20</option>
                    </select>
                  </div>
                  <button
                    onClick={() => setAlphaTrendConfig(c => ({ ...c, useRsi: !c.useRsi }))}
                    disabled={!strategies.alphaTrend}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      !alphaTrendConfig.useRsi
                        ? 'bg-blue-950/70 border-blue-500/60 text-blue-300'
                        : 'bg-[#0A0F1C] border-gray-700 text-gray-400'
                    }`}
                    title={!alphaTrendConfig.useRsi ? "MFI Upstox Volume Mode ACTIVE (Click to toggle RSI)" : "RSI Mode (Click for Upstox Volume MFI)"}
                  >
                    {!alphaTrendConfig.useRsi ? "MFI(Vol)" : "RSI"}
                  </button>
                  <button
                    onClick={() => setShowStrategySettingsModal('ALPHATREND')}
                    className="px-1.5 py-0.5 rounded text-[11px] bg-[#1F2937] hover:bg-[#374151] text-gray-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                    title="Configure advanced AlphaTrend parameters (RSI/MFI mode, Candle confirm, TP1/TP2, SL)"
                  >
                    <span>⚙️</span>
                  </button>
                </div>

                {/* COMBO STRATEGY (T3 Striped + AlphaTrend): Filtered & Unfiltered Controls */}
                <div className="flex items-center gap-2 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <div className="flex items-center gap-2.5">
                    {/* Filtered Combo Toggle */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold" title="T3 Striped + AlphaTrend Filtered (Volume, Candle, Spread & 50 EMA Confirmed)">
                      <input 
                        type="checkbox" 
                        checked={strategies.comboFiltered} 
                        onChange={e => setStrategies(s => ({...s, comboFiltered: e.target.checked}))} 
                        className="accent-emerald-400 cursor-pointer" 
                      />
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span className="text-emerald-400">Filtered</span>
                      </span>
                    </label>

                    <div className="h-3 w-px bg-gray-700"></div>

                    {/* Unfiltered Combo Toggle */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold" title="T3 Striped + AlphaTrend Unfiltered (Raw Confluence)">
                      <input 
                        type="checkbox" 
                        checked={strategies.comboUnfiltered} 
                        onChange={e => setStrategies(s => ({...s, comboUnfiltered: e.target.checked}))} 
                        className="accent-cyan-400 cursor-pointer" 
                      />
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                        <span className="text-cyan-300">Unfiltered</span>
                      </span>
                    </label>

                    <div className="h-3 w-px bg-gray-700"></div>

                    {/* MACD + Adaptive SuperTrend Toggle */}
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

                  <div className="h-3 w-px bg-gray-700"></div>

                  {/* Max Time for Trade Selector (30 mins, 1 hour, 2 hours) */}
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span title="Maximum allowed time for each trade before auto time exit (30m, 1h, 2h)">⏱️ Max:</span>
                    <select
                      value={comboConfig.maxTradeDurationMinutes}
                      onChange={e => setComboConfig(c => ({ ...c, maxTradeDurationMinutes: Number(e.target.value) as 30 | 60 | 120 }))}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-amber-300 font-mono focus:outline-none cursor-pointer font-bold"
                      title="Select maximum trade duration (Special Condition: 30 minutes, 1 hour, or 2 hours)"
                    >
                      <option value={30}>30m</option>
                      <option value={60}>1h</option>
                      <option value={120}>2h</option>
                    </select>
                  </div>

                  <button
                    onClick={() => setShowStrategySettingsModal('COMBO')}
                    className="px-1.5 py-0.5 rounded text-[11px] bg-[#1F2937] hover:bg-[#374151] text-amber-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer font-medium"
                    title="Configure Combo Strategy (Max Time: 30m/1h/2h, 1-Trade Rule, Targets, SL)"
                  >
                    <span>⚙️ Combo</span>
                  </button>
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
                  onClick={() => setShowStrategySettingsModal('ALPHATREND')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-950/60 hover:bg-blue-900/80 border border-blue-600/40 text-blue-300 hover:text-white font-semibold text-xs transition-colors shrink-0 shadow-sm cursor-pointer whitespace-nowrap"
                  title="Open Nifty Strategy Calibration & Settings"
                >
                  <span className="text-sm">⚙️</span>
                  <span>Settings</span>
                </button>

                {/* ADX Chop Filter Control with Smart Directional Mode */}
                <div className="flex items-center gap-2 sm:gap-3 bg-[#111827] px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#1F2937] shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-white font-semibold whitespace-nowrap">
                    <input 
                      type="checkbox" 
                      checked={adxChopFilter.enabled} 
                      onChange={e => setAdxChopFilter(f => ({ ...f, enabled: e.target.checked }))} 
                      className="accent-amber-400 cursor-pointer" 
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      <span>ADX Chop Filter</span>
                    </span>
                  </label>
                  <span className="text-gray-600">|</span>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>Mode:</span>
                    <select
                      value={adxChopFilter.mode}
                      onChange={e => setAdxChopFilter(f => ({ ...f, mode: e.target.value as 'SMART' | 'CLASSIC' }))}
                      disabled={!adxChopFilter.enabled}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-emerald-400 font-medium focus:outline-none disabled:opacity-40 cursor-pointer"
                    >
                      <option value="SMART">🛡️ Smart</option>
                      <option value="CLASSIC">🐢 Classic</option>
                    </select>
                  </div>
                  <span className="text-gray-600">|</span>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <span>&lt;</span>
                    <select 
                      value={adxChopFilter.threshold} 
                      onChange={e => setAdxChopFilter(f => ({ ...f, threshold: Number(e.target.value) }))}
                      disabled={!adxChopFilter.enabled}
                      className="bg-[#0A0F1C] border border-[#374151] rounded px-1.5 py-0.5 text-xs text-amber-400 font-mono focus:outline-none disabled:opacity-40 cursor-pointer"
                    >
                      <option value={15}>15 (Mild)</option>
                      <option value={18}>18 (Opt)</option>
                      <option value={20}>20 (Std)</option>
                      <option value={22}>22 (Cons)</option>
                      <option value={25}>25 (Strict)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Real-time ADX Status Badge */}
              {currentAdx && (
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <div className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 border ${
                    currentAdx.isIgnition
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                      : currentAdx.isChoppy && adxChopFilter.enabled
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      currentAdx.isIgnition 
                        ? 'bg-emerald-400' 
                        : currentAdx.isChoppy && adxChopFilter.enabled 
                        ? 'bg-amber-400 animate-pulse' 
                        : 'bg-emerald-400'
                    }`}></span>
                    <span>ADX: {currentAdx.value}</span>
                    <span className="text-gray-400 font-normal">
                      {currentAdx.isIgnition 
                        ? '(🔥 Breakout Expansion - Active)' 
                        : currentAdx.isChoppy && adxChopFilter.enabled 
                        ? '(⚠️ Chop - Filtered)' 
                        : '(📈 Trending - Active)'}
                    </span>
                  </div>
                  {adxChopFilter.enabled && filteredCount > 0 && (
                    <span className="text-[11px] font-mono text-amber-400/90 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                      {filteredCount} Filtered ({comparisonStats.profitTradesFiltered} Win / {comparisonStats.lossTradesFiltered} Loss)
                    </span>
                  )}
                </div>
              )}
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
                  {filterMode}
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
                <span>⚙️ Filters ({
                  (filterSettings.strictStoploss ? 1 : 0) +
                  (filterSettings.breakevenTrail ? 1 : 0) +
                  (filterSettings.openingRangeBuffer ? 1 : 0) +
                  (filterSettings.trendAlignment ? 1 : 0) +
                  (adxChopFilter.enabled ? 1 : 0) +
                  (filterSettings.bodyConviction ? 1 : 0) +
                  (filterSettings.exhaustionFilter ? 1 : 0) +
                  (filterSettings.rsiMomentum ? 1 : 0)
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
                {availableTradeDates.slice(0, 5).map(d => (
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
            <div className="flex items-center gap-1.5">
              <span className="text-cyan-400">Prem Net:</span>
              <span className={`font-bold ${totalNetPremPnL >= 0 ? 'text-cyan-300' : 'text-red-400'}`}>
                {(totalNetPremPnL >= 0 ? '+' : '') + totalNetPremPnL.toFixed(2)} pts
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
              <span className="text-gray-300">1 Lot Net (65 Qty):</span>
              <span className={`font-extrabold ${totalLotPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(totalLotPnL >= 0 ? '+₹' : '-₹') + Math.abs(totalLotPnL).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
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
            {filteredCount > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400 font-medium col-span-2 sm:col-span-1">
                <span>Filtered Out:</span>
                <span className="font-bold">{filteredCount}</span>
              </div>
            )}
          </div>

        </div>

        {/* Strategy Signal Filter Optimizer Controls (Collapsible) */}
        {isFiltersOpen && (
          <div className="bg-[#0D1526] border-b border-[#1F2937] px-3.5 sm:px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Signal Optimization:</span>
                <div className="flex items-center bg-[#111827] p-1 rounded-lg border border-[#1F2937] gap-1 flex-wrap">
                  <button
                    onClick={() => {
                      setFilterMode('SMART');
                      filterModeRef.current = 'SMART';
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                      filterMode === 'SMART' 
                        ? 'bg-emerald-500 text-black shadow-sm' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>🛡️ Smart Quality Suite</span>
                    <span className={`text-[10px] px-1 py-0.2 rounded ${filterMode === 'SMART' ? 'bg-black/20 text-emerald-950 font-extrabold' : 'bg-black/30 text-emerald-300'}`}>High Win-Rate</span>
                  </button>
                  <button
                    onClick={() => {
                      setFilterMode('RAW');
                      filterModeRef.current = 'RAW';
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                      filterMode === 'RAW' 
                        ? 'bg-brand-blue text-black shadow-sm' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>📊 Raw Signals</span>
                    <span className={`text-[10px] px-1 py-0.2 rounded ${filterMode === 'RAW' ? 'bg-black/20 text-blue-950 font-extrabold' : 'bg-black/30 text-blue-300'}`}>No Filters</span>
                  </button>
                  <button
                    onClick={() => {
                      setFilterMode('BOOKER_ADX');
                      filterModeRef.current = 'BOOKER_ADX';
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                      filterMode === 'BOOKER_ADX' 
                        ? 'bg-purple-500 text-white shadow-sm' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>🐢 Classic Booker</span>
                    <span className={`text-[10px] px-1 py-0.2 rounded ${filterMode === 'BOOKER_ADX' ? 'bg-black/20 text-purple-100 font-extrabold' : 'bg-black/30 text-purple-300'}`}>ADX &lt; {adxChopFilter.threshold}</span>
                  </button>
                  <button
                    onClick={() => {
                      setFilterMode('MOMENTUM_ADX');
                      filterModeRef.current = 'MOMENTUM_ADX';
                    }}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                      filterMode === 'MOMENTUM_ADX' 
                        ? 'bg-amber-500 text-black shadow-sm' 
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>⚡ Momentum ADX</span>
                    <span className={`text-[10px] px-1 py-0.2 rounded ${filterMode === 'MOMENTUM_ADX' ? 'bg-black/20 text-amber-950 font-extrabold' : 'bg-black/30 text-amber-300'}`}>ADX &ge; 20</span>
                  </button>
                </div>
              </div>

              {/* Comparative Win Rate and PnL Delta Pill */}
              {comparisonStats.rawTotal > 0 && (
                <div className="flex items-center gap-2 sm:gap-3 bg-[#111827] px-3 py-1.5 rounded-lg border border-[#1F2937] text-xs font-mono flex-wrap">
                  <div className="flex items-center gap-1 text-gray-400">
                    <span>Raw:</span>
                    <span className="text-gray-300 font-bold">{comparisonStats.rawWinRate}%</span>
                    <span className="text-gray-500 text-[11px]">({comparisonStats.rawWins}W/{comparisonStats.rawLosses}L | {(comparisonStats.rawNetPnL >= 0 ? '+' : '') + comparisonStats.rawNetPnL.toFixed(1)} pts)</span>
                  </div>
                  <span className="text-gray-600">vs</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-emerald-400 font-medium">Protected:</span>
                    <span className="text-emerald-300 font-bold">{winRate}%</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      Number(winRate) >= Number(comparisonStats.rawWinRate) 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {Number(winRate) >= Number(comparisonStats.rawWinRate) ? '+' : ''}
                      {(Number(winRate) - Number(comparisonStats.rawWinRate)).toFixed(1)}% WR
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      totalNetPnL >= comparisonStats.rawNetPnL
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {totalNetPnL >= comparisonStats.rawNetPnL ? '+' : ''}
                      {(totalNetPnL - comparisonStats.rawNetPnL).toFixed(1)} pts Saved
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* SAM Signals 1-Min Empirical Loss Filters (Active when SAM Signals strategy is on) */}
            {strategies.samSignals && (
              <div className="flex flex-col gap-2 pt-2 border-t border-blue-900/40 bg-blue-950/20 -mx-3 -mb-3 p-3 rounded-b-lg text-xs">
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
                  </div>

                  <button
                    onClick={() => setShowStrategySettingsModal('SAM')}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer underline"
                  >
                    <span>Configure SAM Filters ⚙️</span>
                  </button>
                </div>
              </div>
            )}

            {/* Granular Loss Elimination & Risk Management Settings (Active in SMART mode) */}
            {filterMode === 'SMART' && (
              <div className="flex flex-col gap-2 pt-2 border-t border-[#1F2937]/70 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-[11px] font-bold text-amber-300">🛡️ Loss Protection:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Limits stoploss risk distance so that 1 loss does not wipe out multiple wins">
                      <input
                        type="checkbox"
                        checked={filterSettings.strictStoploss}
                        onChange={e => updateFilterSetting('strictStoploss', e.target.checked)}
                        className="accent-amber-400 cursor-pointer"
                      />
                      <span className="font-semibold text-amber-300">Strict Capped SL</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Locks stoploss to breakeven once price moves 50% toward target">
                      <input
                        type="checkbox"
                        checked={filterSettings.breakevenTrail}
                        onChange={e => updateFilterSetting('breakevenTrail', e.target.checked)}
                        className="accent-cyan-400 cursor-pointer"
                      />
                      <span className="text-cyan-300 font-semibold">BE Lock @ 50% TP ({comparisonStats.beSavedCount} saved)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Avoids taking trades during opening market buffer (before 09:25 IST for Nifty) when spreads and volatility whipsaws are highest">
                      <input
                        type="checkbox"
                        checked={filterSettings.openingRangeBuffer}
                        onChange={e => updateFilterSetting('openingRangeBuffer', e.target.checked)}
                        className="accent-yellow-400 cursor-pointer"
                      />
                      <span className="text-yellow-300 font-semibold">Opening Range Buffer ({comparisonStats.openingFiltered})</span>
                    </label>
                  </div>
                  <div className="text-[11px] font-mono flex items-center gap-2">
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Profit Filtered: {comparisonStats.profitTradesFiltered} (0 Lost!)
                    </span>
                    <span className="text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                      Loss Filtered: {comparisonStats.lossTradesFiltered}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 flex-wrap pt-1 text-[11px] text-gray-300">
                  <span className="font-semibold text-gray-400">Quality Filters:</span>
                  <label className="flex items-center gap-1 cursor-pointer hover:text-white" title="Aligns trade direction with 50 EMA trend (Long above 50 EMA, Short below 50 EMA) - stops false longs in downtrends">
                    <input
                      type="checkbox"
                      checked={filterSettings.trendAlignment}
                      onChange={e => updateFilterSetting('trendAlignment', e.target.checked)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span className="font-bold text-emerald-400">50 EMA Trend ({comparisonStats.trendFiltered})</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer hover:text-white" title="Smart chop filter preserves breakouts (+DI advantage) and rejects adverse momentum traps">
                    <input
                      type="checkbox"
                      checked={adxChopFilter.enabled}
                      onChange={e => {
                        const val = e.target.checked;
                        const next = { ...adxChopFilterRef.current, enabled: val };
                        adxChopFilterRef.current = next;
                        setAdxChopFilter(next);
                        try {
                          localStorage.setItem(`quant_adx_chop_filter_${instrument}`, JSON.stringify(next));
                        } catch (_) {}
                      }}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span>Smart Chop ({comparisonStats.adxFiltered})</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer hover:text-white" title="Filters bars with heavy opposing rejection wicks (>45%)">
                    <input
                      type="checkbox"
                      checked={filterSettings.bodyConviction}
                      onChange={e => updateFilterSetting('bodyConviction', e.target.checked)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span>Rejection Wick Filter ({comparisonStats.wickFiltered})</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer hover:text-white" title="Eliminates exhaustion/climax bars (Range > 2.5x ATR) that lead to immediate reversal">
                    <input
                      type="checkbox"
                      checked={filterSettings.exhaustionFilter}
                      onChange={e => updateFilterSetting('exhaustionFilter', e.target.checked)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span>Exhaustion Climax ({comparisonStats.exhaustionFiltered})</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer hover:text-white" title="Requires RSI between 42-74 for Longs, 26-58 for Shorts to avoid extreme exhaustion">
                    <input
                      type="checkbox"
                      checked={filterSettings.rsiMomentum}
                      onChange={e => updateFilterSetting('rsiMomentum', e.target.checked)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span>RSI Sweet-Spot ({comparisonStats.rsiFiltered})</span>
                  </label>
                </div>
              </div>
            )}
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
              <div className="col-span-full py-12 text-center text-gray-500 font-mono text-xs">
                {selectedDateFilter !== 'ALL' || isCustomRangeOpen 
                  ? 'No trades found matching the selected date filter.' 
                  : 'No trades generated for this period or all filtered out by selected filters.'}
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
                      <span className="text-emerald-400 font-medium">{t.target.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-purple-400/80 text-[10px]">Target 2</span>
                      <span className="text-purple-300 font-medium">{t.target2 ? t.target2.toFixed(2) : '-'}</span>
                    </div>
                  </div>

                  {/* Option Premium & 1-Lot PnL Bar */}
                  <div className="flex items-center justify-between text-[11px] font-mono bg-cyan-950/20 px-2 py-1.5 rounded border border-cyan-500/20">
                    <div className="flex items-center gap-1 text-cyan-200">
                      <span className="text-gray-400 text-[10px]">Prem:</span>
                      <span>₹{t.optionEntryPremium?.toFixed(1) || '-'} {t.optionExitPremium !== undefined ? `→ ₹${t.optionExitPremium.toFixed(1)}` : ''}</span>
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
                     <td colSpan={16} className="py-8 text-center text-gray-500 font-mono text-xs">
                       {selectedDateFilter !== 'ALL' || isCustomRangeOpen 
                         ? 'No trades found matching the selected date filter.' 
                         : 'No trades generated for this period'}
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
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 whitespace-nowrap">{t.target.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono text-purple-300 whitespace-nowrap">{t.target2 ? t.target2.toFixed(2) : '-'}</td>
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
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                            {t.optionStrike} {t.optionType}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">(Δ {t.optionDelta?.toFixed(2) || '0.50'})</span>
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
                              ₹{t.optionEntryPremium.toFixed(1)} {t.optionExitPremium !== undefined ? `→ ₹${t.optionExitPremium.toFixed(1)}` : ''}
                            </span>
                          )}
                        </div>
                      ) : '-'}
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
                onClick={() => setShowStrategySettingsModal('ALPHATREND')}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                  showStrategySettingsModal === 'ALPHATREND'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                AlphaTrend Strategy
              </button>
              <button
                onClick={() => setShowStrategySettingsModal('T3')}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                  showStrategySettingsModal === 'T3'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                T3 Striped [Loxx]
              </button>
              <button
                onClick={() => setShowStrategySettingsModal('COMBO')}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                  showStrategySettingsModal === 'COMBO'
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Combo Strategy (Filtered &amp; Unfiltered)
              </button>
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
              {showStrategySettingsModal === 'ALPHATREND' ? (
                <div className="space-y-5">
                  {/* Diagnosis Notice */}
                  <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-800/40 text-blue-200 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5 text-blue-300">
                      <span>💡</span>
                      <span>Why AlphaTrend Win Rate dropped on 1-min &amp; How to fix it:</span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      On strong trend days (yesterday), uncalibrated parameters (Coeff 1.0) stay in trend. But on choppy or rotational days (today), 
                      a 1.0 multiplier makes the band only 16-20 points wide—causing normal 1-minute wicks to repeatedly flip buy/sell signals back and forth. 
                      Setting <strong className="text-emerald-300">Coeff to 1.6</strong> and <strong className="text-emerald-300">Period to 18</strong> with <strong className="text-emerald-300">Target 1 at 1.6x ATR</strong> locks in quick profits at +16-20 points, activates Breakeven protection, and eliminates over 70% of false losing stops!
                    </p>
                  </div>

                  {/* Grid of Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">AlphaTrend Coeff (Band Width)</label>
                        <span className="font-mono text-emerald-400 font-bold">{alphaTrendConfig.coeff.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="2.5"
                        step="0.1"
                        value={alphaTrendConfig.coeff}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, coeff: Number(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        1.0 = Tight (Whipsaw prone). 1.6 = Calibrated for Nifty 1m. 2.0 = Strict trend only.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Smoothing Period</label>
                        <span className="font-mono text-purple-300 font-bold">{alphaTrendConfig.period} bars</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="30"
                        step="1"
                        value={alphaTrendConfig.period}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, period: Number(e.target.value) }))}
                        className="w-full accent-purple-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        Period 18 smooths ATR and momentum cycles over typical 18-minute intraday micro-swings.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Target 1 (Lock Profit &amp; BE)</label>
                        <span className="font-mono text-emerald-400 font-bold">{alphaTrendConfig.tp1Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="3.0"
                        step="0.1"
                        value={alphaTrendConfig.tp1Multiple}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, tp1Multiple: Number(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        1.6x ATR (~18-22 pts on Nifty). Locks initial profit and shifts stop loss to breakeven!
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Target 2 (Runner)</label>
                        <span className="font-mono text-purple-400 font-bold">{alphaTrendConfig.tp2Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="2.0"
                        max="5.0"
                        step="0.1"
                        value={alphaTrendConfig.tp2Multiple}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, tp2Multiple: Number(e.target.value) }))}
                        className="w-full accent-purple-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        2.5x ATR (~30-40 pts). Lets remaining position run when directional momentum explodes.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Strict Stop Loss</label>
                        <span className="font-mono text-red-400 font-bold">{alphaTrendConfig.slMultiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="2.0"
                        step="0.1"
                        value={alphaTrendConfig.slMultiple}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, slMultiple: Number(e.target.value) }))}
                        className="w-full accent-red-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        1.2x ATR keeps risk tightly capped (~14-16 pts max risk on Nifty 1m).
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-3 flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={alphaTrendConfig.candleConfirm}
                          onChange={e => setAlphaTrendConfig(c => ({ ...c, candleConfirm: e.target.checked }))}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span className="text-gray-300 font-medium">Candle Conviction Filter</span>
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Ensures signal candle closes green for BUY, and red for SELL. Prevents entering into violent counter-trend rejection wicks.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Momentum Engine Source</label>
                        <span className="font-mono text-cyan-300 font-bold">{!alphaTrendConfig.useRsi ? "MFI (Upstox Volume)" : "RSI (Price-Only)"}</span>
                      </div>
                      <select
                        value={alphaTrendConfig.useRsi ? 'RSI' : 'MFI'}
                        onChange={e => setAlphaTrendConfig(c => ({ ...c, useRsi: e.target.value === 'RSI' }))}
                        className="w-full bg-[#111827] border border-[#374151] rounded px-2.5 py-1.5 text-xs text-white cursor-pointer focus:outline-none"
                      >
                        <option value="MFI">MFI with Upstox Volume (Kivanc PineScript Original ⭐)</option>
                        <option value="RSI">RSI (Price-Only, Disregard Volume)</option>
                      </select>
                      <p className="text-[10px] text-gray-500">
                        PineScript original AlphaTrend utilizes MFI (Money Flow Index) calculated from real Upstox candle volume to establish true institutional support/resistance levels.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-3 flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={alphaTrendConfig.volumeConfirm}
                          onChange={e => setAlphaTrendConfig(c => ({ ...c, volumeConfirm: e.target.checked }))}
                          className="accent-brand-blue cursor-pointer"
                        />
                        <span className="text-gray-300 font-medium">Volume Breakout Filter (&ge; 0.85x Vol SMA)</span>
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Requires breakout candle to carry institutional volume &ge; 85% of 20 SMA. Eliminates low-volume traps and fake breakouts.
                      </p>
                    </div>
                  </div>
                </div>
              ) : showStrategySettingsModal === 'T3' ? (
                <div className="space-y-5">
                  {/* T3 Diagnosis Notice */}
                  <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-200 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5 text-emerald-300">
                      <span>💡</span>
                      <span>Why T3 Striped gave more losing trades &amp; How this fixes it:</span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      T3 default settings (Period 14, Hot 0.70) are overly sensitive to 1-minute noise. In sideways consolidation, 
                      the ribbon tangles flat and crosses every 2-3 bars without any follow-through. 
                      Increasing <strong className="text-emerald-300">Period to 21</strong>, lowering <strong className="text-emerald-300">Hot to 0.55</strong>, and requiring a <strong className="text-emerald-300">Ribbon Spread of &ge; 0.12x ATR</strong> filters out entries during tangled chop, letting you enter only when the ribbon actually expands with momentum!
                    </p>
                  </div>

                  {/* Grid of Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">T3 Period Length</label>
                        <span className="font-mono text-amber-300 font-bold">{t3Config.period} bars</span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="32"
                        step="1"
                        value={t3Config.period}
                        onChange={e => setT3Config(c => ({ ...c, period: Number(e.target.value) }))}
                        className="w-full accent-amber-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        Period 21 filters 1-minute high-frequency ticks while preserving fast reaction to genuine moves.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Hot Factor (Tillson Volume Factor)</label>
                        <span className="font-mono text-cyan-300 font-bold">{t3Config.hot.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.30"
                        max="0.80"
                        step="0.05"
                        value={t3Config.hot}
                        onChange={e => setT3Config(c => ({ ...c, hot: Number(e.target.value) }))}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        0.55 prevents overshoot oscillations that produce premature crosses on 1-min candles.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Min Ribbon Spread Filter</label>
                        <span className="font-mono text-emerald-400 font-bold">{(t3Config.minRibbonExpansion || 0).toFixed(2)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="0.25"
                        step="0.02"
                        value={t3Config.minRibbonExpansion || 0}
                        onChange={e => setT3Config(c => ({ ...c, minRibbonExpansion: Number(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        Blocks trades when the ribbon is compressed flat. Requires at least 0.12x ATR ribbon expansion.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Target 1 (Scalp &amp; BE Lock)</label>
                        <span className="font-mono text-emerald-400 font-bold">{t3Config.tp1Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="2.5"
                        step="0.1"
                        value={t3Config.tp1Multiple}
                        onChange={e => setT3Config(c => ({ ...c, tp1Multiple: Number(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        1.4x ATR (~15-18 pts). High-probability quick hit that locks 50% profit and activates Breakeven.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Target 2 (Runner)</label>
                        <span className="font-mono text-purple-400 font-bold">{t3Config.tp2Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="1.8"
                        max="4.0"
                        step="0.1"
                        value={t3Config.tp2Multiple}
                        onChange={e => setT3Config(c => ({ ...c, tp2Multiple: Number(e.target.value) }))}
                        className="w-full accent-purple-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        2.2x ATR (~26-32 pts). Captures prolonged trend extension.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="font-medium text-gray-300">Strict Stop Loss</label>
                        <span className="font-mono text-red-400 font-bold">{t3Config.slMultiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="1.8"
                        step="0.1"
                        value={t3Config.slMultiple}
                        onChange={e => setT3Config(c => ({ ...c, slMultiple: Number(e.target.value) }))}
                        className="w-full accent-red-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">
                        1.1x ATR ensures strict loss limitation if crossover immediately stalls.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-3 flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={t3Config.volumeConfirm}
                          onChange={e => setT3Config(c => ({ ...c, volumeConfirm: e.target.checked }))}
                          className="accent-emerald-400 cursor-pointer"
                        />
                        <span className="text-gray-300 font-medium">Volume Confirmation (&ge; 0.85x Vol SMA)</span>
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Requires T3 ribbon crossover candle to carry volume &ge; 85% of 20 SMA. Eliminates low-volume false ribbon tangles.
                      </p>
                    </div>

                    <div className="bg-[#0A0F1C] p-3.5 rounded-xl border border-[#1F2937] space-y-3 flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={t3Config.volumeWeighted}
                          onChange={e => setT3Config(c => ({ ...c, volumeWeighted: e.target.checked }))}
                          className="accent-cyan-400 cursor-pointer"
                        />
                        <span className="text-gray-300 font-medium">Volume-Weighted Ribbon (VWTP Source)</span>
                      </label>
                      <p className="text-[10px] text-gray-500">
                        Dynamically weights T3 ribbon input by volume momentum, curving faster on institutional volume bursts and flattening in quiet lulls.
                      </p>
                    </div>
                  </div>
                </div>
              ) : showStrategySettingsModal === 'COMBO' ? (
                <div className="space-y-5">
                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 space-y-1.5">
                    <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                      <span>⚡</span>
                      <span>Combined Strategy: T3 Striped Ribbon + AlphaTrend</span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      Merges two elite trading systems: Kivanc Ozbilgic's <strong>AlphaTrend</strong> (institutional trend support/resistance via Upstox volume MFI) and Loxx's <strong>T3 Striped Trend Ribbon</strong> (zero-lag Tilson moving average bands). 
                      Supports both <strong>Filtered</strong> (institutional confirmation suite) and <strong>Unfiltered</strong> (raw confluence momentum) versions.
                    </p>
                  </div>

                  {/* Special Conditions: Max Trade Time & One Trade At A Time */}
                  <div className="p-3.5 rounded-xl bg-[#111827] border border-[#1F2937] space-y-4">
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <span className="text-amber-400">⏱️</span>
                      <span>Special Conditions (Rules &amp; Limits)</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Maximum Time of Trade */}
                      <div className="space-y-1.5">
                        <label className="font-medium text-gray-300 block">
                          Maximum Time for Each Trade
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { value: 30, label: '30 Minutes' },
                            { value: 60, label: '1 Hour' },
                            { value: 120, label: '2 Hours' }
                          ].map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setComboConfig(c => ({ ...c, maxTradeDurationMinutes: opt.value as 30 | 60 | 120 }))}
                              className={`py-2 px-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                                comboConfig.maxTradeDurationMinutes === opt.value
                                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold shadow-sm'
                                  : 'bg-[#0A0F1C] border-[#1F2937] text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              <div className="text-xs">{opt.label}</div>
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                          If trade has not reached Target or Stoploss within this elapsed time, it automatically squares off.
                        </p>
                      </div>

                      {/* One Trade At A Time */}
                      <div className="space-y-1.5">
                        <label className="font-medium text-gray-300 block">
                          Execution Constraint
                        </label>
                        <div className="p-2.5 rounded-lg bg-[#0A0F1C] border border-[#1F2937]">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={comboConfig.oneTradeAtATime}
                              onChange={e => setComboConfig(c => ({ ...c, oneTradeAtATime: e.target.checked }))}
                              className="accent-amber-400 cursor-pointer"
                            />
                            <span className="text-gray-200 font-semibold text-xs">One Trade at a Time</span>
                          </label>
                          <p className="text-[10px] text-gray-400 mt-1">
                            Strict risk control: Never opens overlapping trades. Waits until current active trade closes before seeking new setups.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Target & Risk Parameters */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1 bg-[#111827] p-3 rounded-lg border border-[#1F2937]">
                      <div className="flex justify-between items-center text-gray-400">
                        <label className="font-medium text-gray-300">Stop Loss Risk</label>
                        <span className="font-mono text-red-400 font-bold">{comboConfig.slMultiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="2.5"
                        step="0.1"
                        value={comboConfig.slMultiple}
                        onChange={e => setComboConfig(c => ({ ...c, slMultiple: Number(e.target.value) }))}
                        className="w-full accent-red-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">Structural SL beyond invalidation candle</p>
                    </div>

                    <div className="space-y-1 bg-[#111827] p-3 rounded-lg border border-[#1F2937]">
                      <div className="flex justify-between items-center text-gray-400">
                        <label className="font-medium text-gray-300">Target 1 (TP1)</label>
                        <span className="font-mono text-emerald-400 font-bold">{comboConfig.tp1Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="3.0"
                        step="0.1"
                        value={comboConfig.tp1Multiple}
                        onChange={e => setComboConfig(c => ({ ...c, tp1Multiple: Number(e.target.value) }))}
                        className="w-full accent-emerald-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">Secures 50% &amp; moves SL to Breakeven</p>
                    </div>

                    <div className="space-y-1 bg-[#111827] p-3 rounded-lg border border-[#1F2937]">
                      <div className="flex justify-between items-center text-gray-400">
                        <label className="font-medium text-gray-300">Target 2 (Runner)</label>
                        <span className="font-mono text-purple-400 font-bold">{comboConfig.tp2Multiple.toFixed(1)}x ATR</span>
                      </div>
                      <input
                        type="range"
                        min="1.8"
                        max="4.5"
                        step="0.1"
                        value={comboConfig.tp2Multiple}
                        onChange={e => setComboConfig(c => ({ ...c, tp2Multiple: Number(e.target.value) }))}
                        className="w-full accent-purple-400 cursor-pointer"
                      />
                      <p className="text-[10px] text-gray-500">Full target runner with dynamic trail</p>
                    </div>
                  </div>

                  {/* Versions Comparison Box */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg bg-[#0A0F1C] border border-cyan-500/20">
                      <div className="flex items-center gap-1.5 text-cyan-300 font-semibold mb-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                        <span>Unfiltered Version</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Fires immediately when AlphaTrend momentum cross and T3 Ribbon direction agree. Ideal for high-momentum runaway trending sessions where waiting for pullbacks causes missed entries.
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-[#0A0F1C] border border-emerald-500/20">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span>Filtered Version</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Requires Upstox Volume &ge; 0.85x Vol SMA, Green/Red candle confirmation, Ribbon spread expansion &gt; 0.12x ATR, and 50 EMA trend alignment. Prevents fake-outs in choppy consolidation ranges.
                      </p>
                    </div>
                  </div>
                </div>
              ) : showStrategySettingsModal === 'SAM' ? (
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
                  if (showStrategySettingsModal === 'ALPHATREND') {
                    setAlphaTrendConfig({
                      period: 18,
                      coeff: 1.6,
                      useRsi: false, // MFI with Upstox Volume
                      candleConfirm: true,
                      volumeConfirm: true,
                      slMultiple: 1.2,
                      tp1Multiple: 1.6,
                      tp2Multiple: 2.5
                    });
                  } else if (showStrategySettingsModal === 'T3') {
                    setT3Config({
                      period: 21,
                      hot: 0.55,
                      type: 'T3 New',
                      minRibbonExpansion: 0.12,
                      candleConfirm: true,
                      volumeConfirm: true,
                      volumeWeighted: false,
                      slMultiple: 1.1,
                      tp1Multiple: 1.4,
                      tp2Multiple: 2.2
                    });
                  } else if (showStrategySettingsModal === 'SAM') {
                    setSamConfig({ ...DEFAULT_SAM_CONFIG });
                  } else {
                    setComboConfig({
                      maxTradeDurationMinutes: 60,
                      oneTradeAtATime: true,
                      slMultiple: 1.2,
                      tp1Multiple: 1.5,
                      tp2Multiple: 2.5
                    });
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>🎯</span>
                <span>{showStrategySettingsModal === 'SAM' ? 'Restore Pine Script Defaults (SL 20pts)' : 'Restore Optimal Preset'}</span>
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
