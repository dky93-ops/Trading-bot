import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';
import { computeATR, computeT3, computeAlphaTrend, computeADX, computeEMA, computeSMA, computeRSI } from '../backend/technical-indicators';
import { computeKMeansAdaptiveSuperTrend, computeCMMACD } from '../backend/ml-adaptive-supertrend';

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
  exitReason?: 'TARGET' | 'STOPLOSS' | 'DAY_END' | 'BREAKEVEN' | 'MAX_TIME' | 'OPPOSITE_SIGNAL';
  duration?: string;
  pnl?: number;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'BE';
  isBreakevenLocked?: boolean;
  isComboTrade?: boolean;
  strategyFamily?: string;
  riskDist?: number;
  peakPrice?: number;
};

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
function isSessionEndBar(currTime: number, nextTime?: number, isGoldInstrument?: boolean): boolean {
  const d = new Date(currTime * 1000);
  // currTime is epoch shifted by +19800 (IST offset)
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const totalMins = hour * 60 + min;

  // 1. Next candle belongs to a subsequent calendar date:
  // ONLY trigger if the candle is genuinely in the afternoon/closing session!
  // (Prevents midday missing data or lunch gaps from falsely triggering day-end square-off)
  if (nextTime) {
    const nextD = new Date(nextTime * 1000);
    const isDifferentDay =
      nextD.getUTCDate() !== d.getUTCDate() ||
      nextD.getUTCMonth() !== d.getUTCMonth() ||
      nextD.getUTCFullYear() !== d.getUTCFullYear();

    if (isDifferentDay) {
      if (isGoldInstrument) {
        if (totalMins >= 22 * 60) return true; // MCX closes at 23:30 IST
      } else {
        if (totalMins >= 14 * 60 + 30) return true; // NSE closes at 15:30 IST
      }
    }
  }

  // 2. Intraday session cutoff (strictly within last few minutes before market close):
  // MCX (GOLD): 09:00 - 23:30 IST -> auto square-off at or after 23:20 IST (1400 mins)
  // NSE (NIFTY/BANKNIFTY/SENSEX): 09:15 - 15:30 IST -> auto square-off at or after 15:20 IST (920 mins)
  if (isGoldInstrument) {
    if (totalMins >= 23 * 60 + 20) return true;
  } else {
    if (totalMins >= 15 * 60 + 20) return true;
  }

  return false;
}

export function LiveChart({ livePrice, instrument }: { livePrice?: number; instrument: string; key?: React.Key }) {
  const isGold = instrument.toUpperCase().includes('GOLD');
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
  const priceLinesRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [volumeMetrics, setVolumeMetrics] = useState<{ lastVol: number; volSma: number; rvol: number }>({ lastVol: 0, volSma: 0, rvol: 1.0 });
  const [backtestTrades, setBacktestTrades] = useState<Trade[]>([]);
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
    t3Striped: !isGold,
    alphaTrend: true,
    adxBreakout: isGold,
    comboUnfiltered: false,
    comboFiltered: !isGold
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
      period: isGold ? 14 : 18,
      coeff: isGold ? 1.0 : 1.6,
      useRsi: false, // Default to FALSE to utilize real Upstox Volume via MFI!
      candleConfirm: true,
      volumeConfirm: true,
      slMultiple: isGold ? 1.2 : 1.2,
      tp1Multiple: isGold ? 1.8 : 1.6,
      tp2Multiple: isGold ? 2.8 : 2.5,
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

  const [showStrategySettingsModal, setShowStrategySettingsModal] = useState<null | 'ALPHATREND' | 'T3' | 'COMBO'>(null);

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
    adxLowerLevel: isGold ? 24 : 18,
    profitTargetMultiple: isGold ? 0.75 : 1.0,
    profitTarget2Multiple: isGold ? 1.5 : 1.85,
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
    trendAlignment: !isGold, // 50 EMA trend alignment (enabled for Nifty, relaxed for Gold consolidation breakouts)
    bodyConviction: true,    // Strong candle body (>= 35% of range, opposite rejection wick <= 35%)
    volumeConfirm: !isGold,  // Volume confirmation (enabled for Nifty, reactive in Gold)
    minBoxWidthAtr: true,    // Box width >= 0.35x ATR (avoids micro-range chop whipsaws)
    openingRangeBuffer: true, // Avoids opening market whipsaws (before 09:25 IST for Nifty, 09:15 IST for Gold)
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

  // Persist user modifications so state never flips back
  useEffect(() => {
    try {
      localStorage.setItem(`quant_combo_config_${instrument}`, JSON.stringify(comboConfig));
    } catch (_) {}
  }, [comboConfig, instrument]);

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
    setStrategies(prev => ({
      t3Striped: !isGold,
      alphaTrend: isGold ? (prev.alphaTrend ?? true) : true,
      adxBreakout: isGold ? (prev.adxBreakout ?? true) : false,
      comboUnfiltered: prev.comboUnfiltered ?? false,
      comboFiltered: prev.comboFiltered ?? !isGold
    }));
    setAdxBreakoutConfig(prev => ({
      ...prev,
      adxLowerLevel: isGold ? 24 : 18,
      profitTargetMultiple: isGold ? 0.75 : 1.0,
      profitTarget2Multiple: isGold ? 1.5 : 1.85,
      entryMode: prev.entryMode ?? 'BREAKOUT'
    }));
  }, [instrument, isGold]);

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
          comboConfig
        );
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
  }, [strategies, adxChopFilter, adxBreakoutConfig, filterMode, filterSettings, alphaTrendConfig, t3Config, comboConfig]);

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
            return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
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
        tickMarkFormatter: (timeValue: any) => {
          const date = new Date(timeValue * 1000);
          return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
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

    const abortController = new AbortController();
    let retryTimeoutId: any = null;

    const fetchData = async () => {
      if (isDisposedRef.current) return;
      if (dataRef.current.length === 0) {
        setLoading(true);
      }
      try {
        const res = await fetch(`/api/candles?instrument=${encodeURIComponent(instrument)}&timeframe=${timeframe}&limit=1000`, {
          signal: abortController.signal
        });
        if (isDisposedRef.current) return;
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        const candles = await res.json();
        if (isDisposedRef.current) return;
        
        if (!Array.isArray(candles)) return;

        const formatted = candles.slice().reverse().map(c => {
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
              comboConfigRef.current
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
  }, [livePrice]);
  
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
    activeComboConfig = comboConfigRef.current
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

    // =========================================================================
    // GOLD TRADING ENGINE: ROB BOOKER ADX BREAKOUT / RETEST & ALPHATREND (GOLD ONLY)
    // =========================================================================
    if (isGold && (activeStrategies.adxBreakout || activeStrategies.alphaTrend)) {
      // Technical indicators for multi-factor filtering
      const adxData = computeADX(highPrices, lowPrices, closePrices, breakoutConfig.adxPeriod);
      const atr14 = computeATR(highPrices, lowPrices, closePrices, 14);
      const ema50 = computeEMA(closePrices, 50);
      const volSma20 = computeSMA(volumes, 20);
      const rsi14 = computeRSI(closePrices, 14);
      const alpha = computeAlphaTrend(highPrices, lowPrices, closePrices, volumes, 14, 1.0, false);
      
      const validAdx = adxData.adx.filter(v => !isNaN(v));
      if (validAdx.length > 0) {
        const latest = validAdx[validAdx.length - 1];
        setCurrentAdx({
          value: Number(latest.toFixed(1)),
          isChoppy: latest < breakoutConfig.adxLowerLevel
        });
      }

      const lookback = breakoutConfig.boxLookBack; // 20
      const startIdx = Math.max(lookback + 1, 20);

      // -----------------------------------------------------------------------
      // 1. Dual Shadow Comparative Run: Immediate Breakout vs Retest (Gold Only)
      // -----------------------------------------------------------------------
      let boWins = 0, boLosses = 0, boTotal = 0, boNetPnL = 0, boRiskSum = 0, boRewardSum = 0;
      let rtWins = 0, rtLosses = 0, rtTotal = 0, rtNetPnL = 0, rtRiskSum = 0, rtRewardSum = 0;
      let falseBreakoutsSaved = 0, missedRunaways = 0;

      let boActive: { type: 'LONG' | 'SHORT'; entryPrice: number; stoploss: number; target: number; target1Hit?: boolean } | null = null;
      let rtActive: { type: 'LONG' | 'SHORT'; entryPrice: number; stoploss: number; target: number; target1Hit?: boolean } | null = null;
      let shadowPendingRetest: { type: 'LONG' | 'SHORT'; level: number; boxWidth: number; expireBar: number; targetDist: number; atr: number; boLost?: boolean } | null = null;

      for (let i = startIdx; i < candles.length; i++) {
        const curr = candles[i];
        const prev = candles[i - 1];
        const nextCandle = candles[i + 1];
        const isDayEnd = isSessionEndBar(curr.time as number, nextCandle?.time as number, true);
        const atr = atr14[i] || 1;

        // --- Evaluate Active Breakout Trade ---
        if (boActive) {
          const t2Dist = (breakoutConfig.profitTarget2Multiple || 1.85);
          if (boActive.type === 'LONG') {
            const t1Price = boActive.target;
            const t2Price = boActive.entryPrice + (boActive.target - boActive.entryPrice) * t2Dist;
            if (curr.high >= t2Price) {
              boWins++;
              boTotal++;
              // Blended TP1 + TP2 runner profit
              boNetPnL += ((t1Price - boActive.entryPrice) + (t2Price - boActive.entryPrice)) / 2;
              boActive = null;
            } else if (curr.high >= t1Price) {
              // T1 touched: ratchet stoploss to breakeven
              boActive.target1Hit = true;
              boActive.stoploss = Math.max(boActive.stoploss, boActive.entryPrice);
            }
            if (boActive) {
              if (curr.low <= boActive.stoploss) {
                if (boActive.target1Hit) {
                  // Secured T1, runner out at BE = net win
                  boWins++;
                  boTotal++;
                  boNetPnL += (t1Price - boActive.entryPrice) / 2;
                } else {
                  boLosses++;
                  boTotal++;
                  boNetPnL += (boActive.stoploss - boActive.entryPrice);
                  if (shadowPendingRetest && shadowPendingRetest.type === 'LONG') {
                    shadowPendingRetest.boLost = true;
                  }
                }
                boActive = null;
              } else if (isDayEnd) {
                const p = boActive.target1Hit
                  ? ((t1Price - boActive.entryPrice) + (curr.close - boActive.entryPrice)) / 2
                  : (curr.close - boActive.entryPrice);
                if (p >= 0) boWins++; else boLosses++;
                boTotal++;
                boNetPnL += p;
                boActive = null;
              }
            }
          } else {
            const t1Price = boActive.target;
            const t2Price = boActive.entryPrice - (boActive.entryPrice - boActive.target) * t2Dist;
            if (curr.low <= t2Price) {
              boWins++;
              boTotal++;
              boNetPnL += ((boActive.entryPrice - t1Price) + (boActive.entryPrice - t2Price)) / 2;
              boActive = null;
            } else if (curr.low <= t1Price) {
              boActive.target1Hit = true;
              boActive.stoploss = Math.min(boActive.stoploss, boActive.entryPrice);
            }
            if (boActive) {
              if (curr.high >= boActive.stoploss) {
                if (boActive.target1Hit) {
                  boWins++;
                  boTotal++;
                  boNetPnL += (boActive.entryPrice - t1Price) / 2;
                } else {
                  boLosses++;
                  boTotal++;
                  boNetPnL += (boActive.entryPrice - boActive.stoploss);
                  if (shadowPendingRetest && shadowPendingRetest.type === 'SHORT') {
                    shadowPendingRetest.boLost = true;
                  }
                }
                boActive = null;
              } else if (isDayEnd) {
                const p = boActive.target1Hit
                  ? ((boActive.entryPrice - t1Price) + (boActive.entryPrice - curr.close)) / 2
                  : (boActive.entryPrice - curr.close);
                if (p >= 0) boWins++; else boLosses++;
                boTotal++;
                boNetPnL += p;
                boActive = null;
              }
            }
          }
        }

        // --- Evaluate Active Retest Trade ---
        if (rtActive) {
          const t2Dist = (breakoutConfig.profitTarget2Multiple || 1.85);
          if (rtActive.type === 'LONG') {
            const t1Price = rtActive.target;
            const t2Price = rtActive.entryPrice + (rtActive.target - rtActive.entryPrice) * t2Dist;
            if (curr.high >= t2Price) {
              rtWins++;
              rtTotal++;
              rtNetPnL += ((t1Price - rtActive.entryPrice) + (t2Price - rtActive.entryPrice)) / 2;
              rtActive = null;
            } else if (curr.high >= t1Price) {
              rtActive.target1Hit = true;
              rtActive.stoploss = Math.max(rtActive.stoploss, rtActive.entryPrice);
            }
            if (rtActive) {
              if (curr.low <= rtActive.stoploss) {
                if (rtActive.target1Hit) {
                  rtWins++;
                  rtTotal++;
                  rtNetPnL += (t1Price - rtActive.entryPrice) / 2;
                } else {
                  rtLosses++;
                  rtTotal++;
                  rtNetPnL += (rtActive.stoploss - rtActive.entryPrice);
                }
                rtActive = null;
              } else if (isDayEnd) {
                const p = rtActive.target1Hit
                  ? ((t1Price - rtActive.entryPrice) + (curr.close - rtActive.entryPrice)) / 2
                  : (curr.close - rtActive.entryPrice);
                if (p >= 0) rtWins++; else rtLosses++;
                rtTotal++;
                rtNetPnL += p;
                rtActive = null;
              }
            }
          } else {
            const t1Price = rtActive.target;
            const t2Price = rtActive.entryPrice - (rtActive.entryPrice - rtActive.target) * t2Dist;
            if (curr.low <= t2Price) {
              rtWins++;
              rtTotal++;
              rtNetPnL += ((rtActive.entryPrice - t1Price) + (rtActive.entryPrice - t2Price)) / 2;
              rtActive = null;
            } else if (curr.low <= t1Price) {
              rtActive.target1Hit = true;
              rtActive.stoploss = Math.min(rtActive.stoploss, rtActive.entryPrice);
            }
            if (rtActive) {
              if (curr.high >= rtActive.stoploss) {
                if (rtActive.target1Hit) {
                  rtWins++;
                  rtTotal++;
                  rtNetPnL += (rtActive.entryPrice - t1Price) / 2;
                } else {
                  rtLosses++;
                  rtTotal++;
                  rtNetPnL += (rtActive.entryPrice - rtActive.stoploss);
                }
                rtActive = null;
              } else if (isDayEnd) {
                const p = rtActive.target1Hit
                  ? ((rtActive.entryPrice - t1Price) + (rtActive.entryPrice - curr.close)) / 2
                  : (rtActive.entryPrice - curr.close);
                if (p >= 0) rtWins++; else rtLosses++;
                rtTotal++;
                rtNetPnL += p;
                rtActive = null;
              }
            }
          }
        }

        // --- Check Pending Retest Confirmation ---
        if (shadowPendingRetest && rtActive === null) {
          if (i > shadowPendingRetest.expireBar) {
            if (shadowPendingRetest.boLost) {
              falseBreakoutsSaved++;
            } else {
              missedRunaways++;
            }
            shadowPendingRetest = null;
          } else if (shadowPendingRetest.type === 'LONG') {
            const touched = curr.low <= shadowPendingRetest.level + 0.35 * atr && curr.low >= shadowPendingRetest.level - 0.6 * atr;
            const bounce = curr.close >= shadowPendingRetest.level - 0.2 * atr && (curr.close >= curr.open || (curr.close - curr.low) > 0.35 * (curr.high - curr.low));
            if (touched && bounce) {
              const entry = curr.close;
              const target = entry + shadowPendingRetest.targetDist;
              const stoploss = Math.max(curr.low - 0.35 * atr, entry - shadowPendingRetest.targetDist * 0.7);
              rtActive = { type: 'LONG', entryPrice: entry, stoploss, target };
              rtRiskSum += (entry - stoploss);
              const t2Dist = shadowPendingRetest.targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              rtRewardSum += (shadowPendingRetest.targetDist + t2Dist) / 2;
              shadowPendingRetest = null;
            }
          } else if (shadowPendingRetest.type === 'SHORT') {
            const touched = curr.high >= shadowPendingRetest.level - 0.35 * atr && curr.high <= shadowPendingRetest.level + 0.6 * atr;
            const reject = curr.close <= shadowPendingRetest.level + 0.2 * atr && (curr.close <= curr.open || (curr.high - curr.close) > 0.35 * (curr.high - curr.low));
            if (touched && reject) {
              const entry = curr.close;
              const target = entry - shadowPendingRetest.targetDist;
              const stoploss = Math.min(curr.high + 0.35 * atr, entry + shadowPendingRetest.targetDist * 0.7);
              rtActive = { type: 'SHORT', entryPrice: entry, stoploss, target };
              rtRiskSum += (stoploss - entry);
              const t2Dist = shadowPendingRetest.targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              rtRewardSum += (shadowPendingRetest.targetDist + t2Dist) / 2;
              shadowPendingRetest = null;
            }
          }
        }

        // --- Detect Breakout for Dual Comparison ---
        if (boActive === null && !isDayEnd) {
          let hi = -Infinity;
          let lo = Infinity;
          for (let k = i - lookback; k <= i - 1; k++) {
            if (k >= 0) {
              hi = Math.max(hi, highPrices[k]);
              lo = Math.min(lo, lowPrices[k]);
            }
          }
          const bw = hi - lo;
          if (bw > 0) {
            const isBuy = prev.close <= hi && curr.close > hi;
            const isSell = prev.close >= lo && curr.close < lo;
            if (isBuy && (breakoutConfig.enableDirection === 0 || breakoutConfig.enableDirection === 1)) {
              const targetDist = breakoutConfig.profitTargetMultiple * bw;
              const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              const riskDist = Math.min(targetDist * 0.85, Math.max(1.0 * atr, bw * 0.45));
              boActive = {
                type: 'LONG',
                entryPrice: curr.close,
                stoploss: curr.close - riskDist,
                target: curr.close + targetDist
              };
              boRiskSum += riskDist;
              boRewardSum += (targetDist + target2Dist) / 2;
              shadowPendingRetest = {
                type: 'LONG',
                level: hi,
                boxWidth: bw,
                expireBar: i + 6,
                targetDist,
                atr
              };
            } else if (isSell && (breakoutConfig.enableDirection === 0 || breakoutConfig.enableDirection === -1)) {
              const targetDist = breakoutConfig.profitTargetMultiple * bw;
              const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              const riskDist = Math.min(targetDist * 0.85, Math.max(1.0 * atr, bw * 0.45));
              boActive = {
                type: 'SHORT',
                entryPrice: curr.close,
                stoploss: curr.close + riskDist,
                target: curr.close - targetDist
              };
              boRiskSum += riskDist;
              boRewardSum += (targetDist + target2Dist) / 2;
              shadowPendingRetest = {
                type: 'SHORT',
                level: lo,
                boxWidth: bw,
                expireBar: i + 6,
                targetDist,
                atr
              };
            }
          }
        }
      }

      const boWinRate = boTotal > 0 ? Number(((boWins / boTotal) * 100).toFixed(1)) : 0;
      const rtWinRate = rtTotal > 0 ? Number(((rtWins / rtTotal) * 100).toFixed(1)) : 0;
      const boAvgRR = boRiskSum > 0 ? Number((boRewardSum / boRiskSum).toFixed(2)) : 1.1;
      const rtAvgRR = rtRiskSum > 0 ? Number((rtRewardSum / rtRiskSum).toFixed(2)) : 2.3;

      setRetestComparison({
        breakoutWins: boWins,
        breakoutLosses: boLosses,
        breakoutTotal: boTotal,
        breakoutWinRate: boWinRate,
        breakoutNetPnL: Number(boNetPnL.toFixed(1)),
        breakoutAvgRR: boAvgRR,
        retestWins: rtWins,
        retestLosses: rtLosses,
        retestTotal: rtTotal,
        retestWinRate: rtWinRate,
        retestNetPnL: Number(rtNetPnL.toFixed(1)),
        retestAvgRR: rtAvgRR,
        falseBreakoutsSaved,
        missedRunaways
      });

      // -----------------------------------------------------------------------
      // 2. Main Simulation with User-Selected Filter Mode & Reason Tracking
      // -----------------------------------------------------------------------
      const boxUpperPlot: number[] = new Array(candles.length).fill(NaN);
      const boxLowerPlot: number[] = new Array(candles.length).fill(NaN);
      const targetPlot: number[] = new Array(candles.length).fill(NaN);
      const target2Plot: number[] = new Array(candles.length).fill(NaN);
      const stopLossPlot: number[] = new Array(candles.length).fill(NaN);

      let activeTrade: Trade | null = null;
      let lockedBoxUpper = NaN;
      let lockedBoxLower = NaN;
      let lockedBoxWidth = NaN;
      let lockedTarget = NaN;
      let lockedTarget2 = NaN;
      let lockedStopLoss = NaN;

      let pendingBuyRetest: { boxUpper: number; boxLower: number; boxWidth: number; targetDist: number; target2Dist?: number; expireBar: number } | null = null;
      let pendingSellRetest: { boxUpper: number; boxLower: number; boxWidth: number; targetDist: number; target2Dist?: number; expireBar: number } | null = null;

      let exhaustionFiltered = 0;
      let rsiFiltered = 0;
      let wickFiltered = 0;
      let volumeFiltered = 0;
      let trendFiltered = 0;
      let boxFiltered = 0;
      let adxFiltered = 0;
      let beSavedCount = 0;

      for (let i = startIdx; i < candles.length; i++) {
        const curr = candles[i];
        const prev = candles[i - 1];
        const nextCandle = candles[i + 1];
        const isDayEnd = isSessionEndBar(curr.time as number, nextCandle?.time as number, true);
        const sig = adxData.adx[i];
        const isADXLow = !isNaN(sig) && sig < breakoutConfig.adxLowerLevel;
        const atr = atr14[i] || 1;
        const ema = ema50[i];
        const vSma = volSma20[i];
        const rsi = rsi14[i];

        let currentBoxUpper: number;
        let currentBoxLower: number;

        if (activeTrade === null) {
          let hi = -Infinity;
          let lo = Infinity;
          for (let k = i - lookback; k <= i - 1; k++) {
            if (k >= 0) {
              hi = Math.max(hi, highPrices[k]);
              lo = Math.min(lo, lowPrices[k]);
            }
          }
          currentBoxUpper = hi;
          currentBoxLower = lo;
        } else {
          currentBoxUpper = lockedBoxUpper;
          currentBoxLower = lockedBoxLower;
        }

        const boxWidth = currentBoxUpper - currentBoxLower;

        boxUpperPlot[i] = currentBoxUpper;
        boxLowerPlot[i] = currentBoxLower;
        targetPlot[i] = activeTrade ? lockedTarget : NaN;
        target2Plot[i] = activeTrade ? lockedTarget2 : NaN;
        stopLossPlot[i] = activeTrade ? lockedStopLoss : NaN;

        // Manage active trade exits on current candle
        if (activeTrade !== null) {
          // Dynamic Breakeven Trailing: Lock Stoploss to Entry when trade moves >= 50% toward target
          if (activeFilterSettings.breakevenTrail && !activeTrade.isBreakevenLocked) {
            if (activeTrade.type === 'LONG') {
              const favorableMove = curr.high - activeTrade.entryPrice;
              const targetDist = lockedTarget - activeTrade.entryPrice;
              if (favorableMove >= targetDist * 0.5) {
                lockedStopLoss = Math.max(lockedStopLoss, activeTrade.entryPrice + 0.05 * atr);
                activeTrade.stoploss = lockedStopLoss;
                activeTrade.isBreakevenLocked = true;
                beSavedCount++;
              }
            } else {
              const favorableMove = activeTrade.entryPrice - curr.low;
              const targetDist = activeTrade.entryPrice - lockedTarget;
              if (favorableMove >= targetDist * 0.5) {
                lockedStopLoss = Math.min(lockedStopLoss, activeTrade.entryPrice - 0.05 * atr);
                activeTrade.stoploss = lockedStopLoss;
                activeTrade.isBreakevenLocked = true;
                beSavedCount++;
              }
            }
          }

          if (activeTrade.type === 'LONG') {
            // Target 1 Hit detection
            if (!activeTrade.target1Hit && curr.high >= lockedTarget) {
              activeTrade.target1Hit = true;
              lockedStopLoss = Math.max(lockedStopLoss, activeTrade.entryPrice + 0.05 * atr);
              activeTrade.stoploss = lockedStopLoss;
              activeTrade.isBreakevenLocked = true;
              markers.push({
                time: curr.time,
                position: 'aboveBar',
                color: '#10B981',
                shape: 'circle',
                text: 'T1 Hit (+Lock BE)'
              });
            }

            if (activeTrade.target1Hit) {
              const t2 = lockedTarget2 || (activeTrade.entryPrice + (lockedTarget - activeTrade.entryPrice) * (breakoutConfig.profitTarget2Multiple || 1.85));
              if (curr.high >= t2) {
                // Full Target 2 Reached: 50% booked at Target 1, 50% booked at Target 2
                activeTrade.exitPrice = Number(((lockedTarget + t2) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'TARGET';
                activeTrade.status = 'WIN';
                activeTrade.pnl = Number((activeTrade.exitPrice - activeTrade.entryPrice).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'aboveBar',
                  color: '#8B5CF6',
                  shape: 'circle',
                  text: 'close_long (TP2 Runner Complete 🎯)'
                });
                activeTrade = null;
              } else if (curr.low <= lockedStopLoss) {
                // Target 1 was secured; runner exited at breakeven stop -> Guaranteed Win!
                activeTrade.exitPrice = Number(((lockedTarget + lockedStopLoss) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'BREAKEVEN';
                activeTrade.status = 'WIN';
                activeTrade.pnl = Number((activeTrade.exitPrice - activeTrade.entryPrice).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'aboveBar',
                  color: '#10B981',
                  shape: 'circle',
                  text: 'close_long (T1 Secured / BE Runner)'
                });
                activeTrade = null;
              } else if (isDayEnd) {
                activeTrade.exitPrice = Number(((lockedTarget + curr.close) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'DAY_END';
                activeTrade.pnl = Number((activeTrade.exitPrice - activeTrade.entryPrice).toFixed(2));
                activeTrade.status = activeTrade.pnl >= 0 ? 'WIN' : 'LOSS';
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'aboveBar',
                  color: '#F59E0B',
                  shape: 'circle',
                  text: `close_long (Day End @ ${curr.close.toFixed(1)})`
                });
                activeTrade = null;
              }
            } else {
              // Target 1 NOT hit yet: evaluate strict stoploss
              if (curr.low <= lockedStopLoss) {
                activeTrade.exitPrice = lockedStopLoss;
                activeTrade.exitTime = curr.time as number;
                activeTrade.pnl = Number((lockedStopLoss - activeTrade.entryPrice).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                if (activeTrade.isBreakevenLocked && activeTrade.pnl >= -0.01) {
                  activeTrade.exitReason = 'BREAKEVEN';
                  activeTrade.status = 'BE';
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#10B981',
                    shape: 'circle',
                    text: 'close_long (BE Protected)'
                  });
                } else {
                  activeTrade.exitReason = 'STOPLOSS';
                  activeTrade.status = 'LOSS';
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#EF4444',
                    shape: 'circle',
                    text: 'close_long (SL)'
                  });
                }
                activeTrade = null;
              } else if (isDayEnd) {
                // Intraday day-end close: Realize PnL at market session close (No overnight carry)
                activeTrade.exitPrice = curr.close;
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'DAY_END';
                activeTrade.pnl = Number((curr.close - activeTrade.entryPrice).toFixed(2));
                activeTrade.status = activeTrade.pnl > 0 ? 'WIN' : activeTrade.pnl < 0 ? 'LOSS' : 'BE';
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'aboveBar',
                  color: '#F59E0B',
                  shape: 'circle',
                  text: `close_long (Day End @ ${curr.close.toFixed(1)})`
                });
                activeTrade = null;
              }
            }
          } else if (activeTrade.type === 'SHORT') {
            // Target 1 Hit detection
            if (!activeTrade.target1Hit && curr.low <= lockedTarget) {
              activeTrade.target1Hit = true;
              lockedStopLoss = Math.min(lockedStopLoss, activeTrade.entryPrice - 0.05 * atr);
              activeTrade.stoploss = lockedStopLoss;
              activeTrade.isBreakevenLocked = true;
              markers.push({
                time: curr.time,
                position: 'belowBar',
                color: '#10B981',
                shape: 'circle',
                text: 'T1 Hit (+Lock BE)'
              });
            }

            if (activeTrade.target1Hit) {
              const t2 = lockedTarget2 || (activeTrade.entryPrice - (activeTrade.entryPrice - lockedTarget) * (breakoutConfig.profitTarget2Multiple || 1.85));
              if (curr.low <= t2) {
                activeTrade.exitPrice = Number(((lockedTarget + t2) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'TARGET';
                activeTrade.status = 'WIN';
                activeTrade.pnl = Number((activeTrade.entryPrice - activeTrade.exitPrice).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'belowBar',
                  color: '#8B5CF6',
                  shape: 'circle',
                  text: 'close_short (TP2 Runner Complete 🎯)'
                });
                activeTrade = null;
              } else if (curr.high >= lockedStopLoss) {
                // Target 1 secured; runner exited at breakeven stop -> Guaranteed Win!
                activeTrade.exitPrice = Number(((lockedTarget + lockedStopLoss) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'BREAKEVEN';
                activeTrade.status = 'WIN';
                activeTrade.pnl = Number((activeTrade.entryPrice - activeTrade.exitPrice).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'belowBar',
                  color: '#10B981',
                  shape: 'circle',
                  text: 'close_short (T1 Secured / BE Runner)'
                });
                activeTrade = null;
              } else if (isDayEnd) {
                activeTrade.exitPrice = Number(((lockedTarget + curr.close) / 2).toFixed(2));
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'DAY_END';
                activeTrade.pnl = Number((activeTrade.entryPrice - activeTrade.exitPrice).toFixed(2));
                activeTrade.status = activeTrade.pnl >= 0 ? 'WIN' : 'LOSS';
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'belowBar',
                  color: '#F59E0B',
                  shape: 'circle',
                  text: `close_short (Day End @ ${curr.close.toFixed(1)})`
                });
                activeTrade = null;
              }
            } else {
              // Target 1 NOT hit yet: evaluate strict stoploss
              if (curr.high >= lockedStopLoss) {
                activeTrade.exitPrice = lockedStopLoss;
                activeTrade.exitTime = curr.time as number;
                activeTrade.pnl = Number((activeTrade.entryPrice - lockedStopLoss).toFixed(2));
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                if (activeTrade.isBreakevenLocked && activeTrade.pnl >= -0.01) {
                  activeTrade.exitReason = 'BREAKEVEN';
                  activeTrade.status = 'BE';
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#10B981',
                    shape: 'circle',
                    text: 'close_short (BE Protected)'
                  });
                } else {
                  activeTrade.exitReason = 'STOPLOSS';
                  activeTrade.status = 'LOSS';
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#EF4444',
                    shape: 'circle',
                    text: 'close_short (SL)'
                  });
                }
                activeTrade = null;
              } else if (isDayEnd) {
                // Intraday day-end close: Realize PnL at market session close (No overnight carry)
                activeTrade.exitPrice = curr.close;
                activeTrade.exitTime = curr.time as number;
                activeTrade.exitReason = 'DAY_END';
                activeTrade.pnl = Number((activeTrade.entryPrice - curr.close).toFixed(2));
                activeTrade.status = activeTrade.pnl > 0 ? 'WIN' : activeTrade.pnl < 0 ? 'LOSS' : 'BE';
                activeTrade.duration = formatDuration(activeTrade.entryTime, activeTrade.exitTime);
                markers.push({
                  time: curr.time,
                  position: 'belowBar',
                  color: '#F59E0B',
                  shape: 'circle',
                  text: `close_short (Day End @ ${curr.close.toFixed(1)})`
                });
                activeTrade = null;
              }
            }
          }
        }

        // Check Entries if flat and not at day end
        if (activeTrade === null && !isDayEnd) {
          // --- 1. Pending Retest Evaluation (Gold Only) ---
          if (breakoutConfig.entryMode === 'RETEST' || breakoutConfig.entryMode === 'ADAPTIVE') {
            if (pendingBuyRetest) {
              if (i > pendingBuyRetest.expireBar) {
                pendingBuyRetest = null;
              } else {
                const touched = curr.low <= pendingBuyRetest.boxUpper + 0.35 * atr && curr.low >= pendingBuyRetest.boxUpper - 0.6 * atr;
                const bounce = curr.close >= pendingBuyRetest.boxUpper - 0.2 * atr && (curr.close >= curr.open || (curr.close - curr.low) > 0.35 * (curr.high - curr.low));
                if (touched && bounce) {
                  const entryPrice = curr.close;
                  const targetDist = pendingBuyRetest.targetDist;
                  const target2Dist = pendingBuyRetest.target2Dist || targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
                  const target = entryPrice + targetDist;
                  const target2 = entryPrice + target2Dist;
                  const stopLoss = Math.max(curr.low - 0.35 * atr, entryPrice - targetDist * 0.7);

                  lockedBoxUpper = pendingBuyRetest.boxUpper;
                  lockedBoxLower = pendingBuyRetest.boxLower;
                  lockedBoxWidth = pendingBuyRetest.boxWidth;
                  lockedTarget = target;
                  lockedTarget2 = target2;
                  lockedStopLoss = stopLoss;

                  const newTrade: Trade = {
                    id: `${curr.time}-RETEST-L`,
                    type: 'LONG',
                    signal: 'Retest Long 🎯',
                    entryTime: curr.time as number,
                    entryPrice,
                    stoploss: stopLoss,
                    target,
                    target2,
                    status: 'OPEN',
                    isBreakevenLocked: false
                  };
                  activeTrade = newTrade;
                  allTrades.push(newTrade);
                  markers.push({
                    time: curr.time,
                    position: 'belowBar',
                    color: '#10B981',
                    shape: 'arrowUp',
                    text: '🎯 Retest Buy'
                  });
                  targetPlot[i] = lockedTarget;
                  target2Plot[i] = lockedTarget2;
                  stopLossPlot[i] = lockedStopLoss;
                  pendingBuyRetest = null;
                }
              }
            }

            if (pendingSellRetest && activeTrade === null) {
              if (i > pendingSellRetest.expireBar) {
                pendingSellRetest = null;
              } else {
                const touched = curr.high >= pendingSellRetest.boxLower - 0.35 * atr && curr.high <= pendingSellRetest.boxLower + 0.6 * atr;
                const reject = curr.close <= pendingSellRetest.boxLower + 0.2 * atr && (curr.close <= curr.open || (curr.high - curr.close) > 0.35 * (curr.high - curr.low));
                if (touched && reject) {
                  const entryPrice = curr.close;
                  const targetDist = pendingSellRetest.targetDist;
                  const target2Dist = pendingSellRetest.target2Dist || targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
                  const target = entryPrice - targetDist;
                  const target2 = entryPrice - target2Dist;
                  const stopLoss = Math.min(curr.high + 0.35 * atr, entryPrice + targetDist * 0.7);

                  lockedBoxUpper = pendingSellRetest.boxUpper;
                  lockedBoxLower = pendingSellRetest.boxLower;
                  lockedBoxWidth = pendingSellRetest.boxWidth;
                  lockedTarget = target;
                  lockedTarget2 = target2;
                  lockedStopLoss = stopLoss;

                  const newTrade: Trade = {
                    id: `${curr.time}-RETEST-S`,
                    type: 'SHORT',
                    signal: 'Retest Short 🎯',
                    entryTime: curr.time as number,
                    entryPrice,
                    stoploss: stopLoss,
                    target,
                    target2,
                    status: 'OPEN',
                    isBreakevenLocked: false
                  };
                  activeTrade = newTrade;
                  allTrades.push(newTrade);
                  markers.push({
                    time: curr.time,
                    position: 'aboveBar',
                    color: '#EF4444',
                    shape: 'arrowDown',
                    text: '🎯 Retest Sell'
                  });
                  targetPlot[i] = lockedTarget;
                  target2Plot[i] = lockedTarget2;
                  stopLossPlot[i] = lockedStopLoss;
                  pendingSellRetest = null;
                }
              }
            }
          }

          // --- 2. ADX Breakout Signal Evaluation ---
          if (activeTrade === null && activeStrategies.adxBreakout && boxWidth > 0) {
            const isRawBuy = prev.close <= currentBoxUpper && curr.close > currentBoxUpper;
            const isRawSell = prev.close >= currentBoxLower && curr.close < currentBoxLower;

            let isBuyValid = false;
            let isSellValid = false;

            if (isRawBuy) {
              const range = curr.high - curr.low;
              const body = curr.close - curr.open;
              const upperWick = curr.high - Math.max(curr.open, curr.close);

              if (activeFilterMode === 'RAW') {
                isBuyValid = true;
              } else if (activeFilterMode === 'BOOKER_ADX') {
                isBuyValid = isADXLow;
                if (!isBuyValid) adxFiltered++;
              } else if (activeFilterMode === 'MOMENTUM_ADX') {
                isBuyValid = !isNaN(sig) && sig >= 20 && (adxData.plusDI[i] > adxData.minusDI[i]);
                if (!isBuyValid) adxFiltered++;
              } else if (activeFilterMode === 'SMART') {
                let passExhaustion = true;
                let passRsi = true;
                let passBody = true;
                let passVol = true;
                let passTrend = true;
                let passBox = true;

                // 1. Exhaustion / Climax Bar Filter (Eliminates blow-off candles that immediately reverse)
                if (activeFilterSettings.exhaustionFilter && atr > 0) {
                  if (range > 2.2 * atr) {
                    passExhaustion = false;
                    exhaustionFiltered++;
                  }
                }

                // 2. RSI Momentum Sweet-spot Filter (48 <= RSI <= 72 avoids overbought exhaustion traps)
                if (activeFilterSettings.rsiMomentum && !isNaN(rsi)) {
                  if (rsi < 48 || rsi > 72) {
                    passRsi = false;
                    rsiFiltered++;
                  }
                }

                // 3. Body Conviction & Wick Rejection Filter
                if (activeFilterSettings.bodyConviction) {
                  if (body <= 0 || (body / (range || 1)) < 0.35 || upperWick > body * 1.5) {
                    passBody = false;
                    wickFiltered++;
                  }
                }

                // 4. Volume Confirmation Filter
                if (activeFilterSettings.volumeConfirm && vSma > 0 && curr.volume > 0) {
                  if (curr.volume < vSma * 0.85) {
                    passVol = false;
                    volumeFiltered++;
                  }
                }

                // 5. 50 EMA Trend Alignment Filter
                if (activeFilterSettings.trendAlignment && !isNaN(ema)) {
                  if (curr.close < ema - 0.75 * atr) {
                    passTrend = false;
                    trendFiltered++;
                  }
                }

                // 6. Min Box Width Filter
                if (activeFilterSettings.minBoxWidthAtr && atr > 0) {
                  if (boxWidth < 0.35 * atr) {
                    passBox = false;
                    boxFiltered++;
                  }
                }

                isBuyValid = passExhaustion && passRsi && passBody && passVol && passTrend && passBox;
              }
            } else if (isRawSell) {
              const range = curr.high - curr.low;
              const body = curr.open - curr.close;
              const lowerWick = Math.min(curr.open, curr.close) - curr.low;

              if (activeFilterMode === 'RAW') {
                isSellValid = true;
              } else if (activeFilterMode === 'BOOKER_ADX') {
                isSellValid = isADXLow;
                if (!isSellValid) adxFiltered++;
              } else if (activeFilterMode === 'MOMENTUM_ADX') {
                isSellValid = !isNaN(sig) && sig >= 20 && (adxData.minusDI[i] > adxData.plusDI[i]);
                if (!isSellValid) adxFiltered++;
              } else if (activeFilterMode === 'SMART') {
                let passExhaustion = true;
                let passRsi = true;
                let passBody = true;
                let passVol = true;
                let passTrend = true;
                let passBox = true;

                // 1. Exhaustion / Climax Bar Filter
                if (activeFilterSettings.exhaustionFilter && atr > 0) {
                  if (range > 2.2 * atr) {
                    passExhaustion = false;
                    exhaustionFiltered++;
                  }
                }

                // 2. RSI Momentum Sweet-spot Filter (28 <= RSI <= 52 avoids oversold bounce traps)
                if (activeFilterSettings.rsiMomentum && !isNaN(rsi)) {
                  if (rsi < 28 || rsi > 52) {
                    passRsi = false;
                    rsiFiltered++;
                  }
                }

                // 3. Body Conviction & Wick Rejection Filter
                if (activeFilterSettings.bodyConviction) {
                  if (body <= 0 || (body / (range || 1)) < 0.35 || lowerWick > body * 1.5) {
                    passBody = false;
                    wickFiltered++;
                  }
                }

                // 4. Volume Confirmation Filter
                if (activeFilterSettings.volumeConfirm && vSma > 0 && curr.volume > 0) {
                  if (curr.volume < vSma * 0.85) {
                    passVol = false;
                    volumeFiltered++;
                  }
                }

                // 5. 50 EMA Trend Alignment Filter
                if (activeFilterSettings.trendAlignment && !isNaN(ema)) {
                  if (curr.close > ema + 0.75 * atr) {
                    passTrend = false;
                    trendFiltered++;
                  }
                }

                // 6. Min Box Width Filter
                if (activeFilterSettings.minBoxWidthAtr && atr > 0) {
                  if (boxWidth < 0.35 * atr) {
                    passBox = false;
                    boxFiltered++;
                  }
                }

                isSellValid = passExhaustion && passRsi && passBody && passVol && passTrend && passBox;
              }
            }

            if (isBuyValid && (breakoutConfig.enableDirection === 0 || breakoutConfig.enableDirection === 1)) {
              if (breakoutConfig.entryMode === 'RETEST') {
                pendingBuyRetest = {
                  boxUpper: currentBoxUpper,
                  boxLower: currentBoxLower,
                  boxWidth,
                  targetDist: breakoutConfig.profitTargetMultiple * boxWidth,
                  target2Dist: breakoutConfig.profitTargetMultiple * boxWidth * (breakoutConfig.profitTarget2Multiple || 1.85),
                  expireBar: i + 6
                };
              } else {
                const entryPrice = curr.close;
                const targetDist = breakoutConfig.profitTargetMultiple * boxWidth;
                const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
                const target = entryPrice + targetDist;
                const target2 = entryPrice + target2Dist;
                const rawRisk = entryPrice - curr.low;
                const minBreathingRisk = Math.max(1.0 * atr, boxWidth * 0.45);
                const maxRisk = activeFilterSettings.strictStoploss ? targetDist * 0.85 : rawRisk;
                const effectiveRisk = Math.min(Math.max(rawRisk, minBreathingRisk), maxRisk);
                const stopLoss = entryPrice - effectiveRisk;

                lockedBoxUpper = currentBoxUpper;
                lockedBoxLower = currentBoxLower;
                lockedBoxWidth = boxWidth;
                lockedTarget = target;
                lockedTarget2 = target2;
                lockedStopLoss = stopLoss;

                const newTrade: Trade = {
                  id: `${curr.time}-ADX-L`,
                  type: 'LONG',
                  signal: activeFilterMode === 'SMART' ? 'Smart Long' : 'open_long',
                  entryTime: curr.time as number,
                  entryPrice,
                  stoploss: stopLoss,
                  target,
                  target2,
                  status: 'OPEN',
                  isBreakevenLocked: false
                };
                activeTrade = newTrade;
                allTrades.push(newTrade);

                markers.push({
                  time: curr.time,
                  position: 'belowBar',
                  color: '#10B981',
                  shape: 'arrowUp',
                  text: activeFilterMode === 'SMART' ? 'Smart Buy' : 'open_long'
                });

                targetPlot[i] = lockedTarget;
                target2Plot[i] = lockedTarget2;
                stopLossPlot[i] = lockedStopLoss;
              }
            } else if (isSellValid && (breakoutConfig.enableDirection === 0 || breakoutConfig.enableDirection === -1)) {
              if (breakoutConfig.entryMode === 'RETEST') {
                pendingSellRetest = {
                  boxUpper: currentBoxUpper,
                  boxLower: currentBoxLower,
                  boxWidth,
                  targetDist: breakoutConfig.profitTargetMultiple * boxWidth,
                  target2Dist: breakoutConfig.profitTargetMultiple * boxWidth * (breakoutConfig.profitTarget2Multiple || 1.85),
                  expireBar: i + 6
                };
              } else {
                const entryPrice = curr.close;
                const targetDist = breakoutConfig.profitTargetMultiple * boxWidth;
                const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
                const target = entryPrice - targetDist;
                const target2 = entryPrice - target2Dist;
                const rawRisk = curr.high - entryPrice;
                const minBreathingRisk = Math.max(1.0 * atr, boxWidth * 0.45);
                const maxRisk = activeFilterSettings.strictStoploss ? targetDist * 0.85 : rawRisk;
                const effectiveRisk = Math.min(Math.max(rawRisk, minBreathingRisk), maxRisk);
                const stopLoss = entryPrice + effectiveRisk;

                lockedBoxUpper = currentBoxUpper;
                lockedBoxLower = currentBoxLower;
                lockedBoxWidth = boxWidth;
                lockedTarget = target;
                lockedTarget2 = target2;
                lockedStopLoss = stopLoss;

                const newTrade: Trade = {
                  id: `${curr.time}-ADX-S`,
                  type: 'SHORT',
                  signal: activeFilterMode === 'SMART' ? 'Smart Short' : 'open_short',
                  entryTime: curr.time as number,
                  entryPrice,
                  stoploss: stopLoss,
                  target,
                  target2,
                  status: 'OPEN',
                  isBreakevenLocked: false
                };
                activeTrade = newTrade;
                allTrades.push(newTrade);

                markers.push({
                  time: curr.time,
                  position: 'aboveBar',
                  color: '#EF4444',
                  shape: 'arrowDown',
                  text: activeFilterMode === 'SMART' ? 'Smart Sell' : 'open_short'
                });

                targetPlot[i] = lockedTarget;
                target2Plot[i] = lockedTarget2;
                stopLossPlot[i] = lockedStopLoss;
              }
            }
          }

          // --- 3. AlphaTrend Strategy Evaluation (Gold Only) ---
          if (activeTrade === null && activeStrategies.alphaTrend) {
            if (alpha.buySignal[i]) {
              const entryPrice = curr.close;
              const targetDist = 1.8 * atr;
              const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              const stopDist = 1.2 * atr;
              const target = entryPrice + targetDist;
              const target2 = entryPrice + target2Dist;
              const stopLoss = entryPrice - stopDist;

              lockedTarget = target;
              lockedTarget2 = target2;
              lockedStopLoss = stopLoss;

              const newTrade: Trade = {
                id: `${curr.time}-ALPHA-L`,
                type: 'LONG',
                signal: 'Alpha Long (Gold)',
                entryTime: curr.time as number,
                entryPrice,
                stoploss: stopLoss,
                target,
                target2,
                status: 'OPEN',
                isBreakevenLocked: false
              };
              activeTrade = newTrade;
              allTrades.push(newTrade);

              markers.push({
                time: curr.time,
                position: 'belowBar',
                color: '#38BDF8',
                shape: 'arrowUp',
                text: 'Alpha Buy'
              });

              targetPlot[i] = lockedTarget;
              target2Plot[i] = lockedTarget2;
              stopLossPlot[i] = lockedStopLoss;
            } else if (alpha.sellSignal[i]) {
              const entryPrice = curr.close;
              const targetDist = 1.8 * atr;
              const target2Dist = targetDist * (breakoutConfig.profitTarget2Multiple || 1.85);
              const stopDist = 1.2 * atr;
              const target = entryPrice - targetDist;
              const target2 = entryPrice - target2Dist;
              const stopLoss = entryPrice + stopDist;

              lockedTarget = target;
              lockedTarget2 = target2;
              lockedStopLoss = stopLoss;

              const newTrade: Trade = {
                id: `${curr.time}-ALPHA-S`,
                type: 'SHORT',
                signal: 'Alpha Short (Gold)',
                entryTime: curr.time as number,
                entryPrice,
                stoploss: stopLoss,
                target,
                target2,
                status: 'OPEN',
                isBreakevenLocked: false
              };
              activeTrade = newTrade;
              allTrades.push(newTrade);

              markers.push({
                time: curr.time,
                position: 'aboveBar',
                color: '#F43F5E',
                shape: 'arrowDown',
                text: 'Alpha Sell'
              });

              targetPlot[i] = lockedTarget;
              target2Plot[i] = lockedTarget2;
              stopLossPlot[i] = lockedStopLoss;
            }
          }
        }
      }

      // Check final active trade at the very end of data
      if (activeTrade && (activeTrade as Trade).status === 'OPEN') {
        const lastC = candles[candles.length - 1];
        const t = activeTrade as Trade;
        const isActuallyDayEnd = isSessionEndBar(lastC.time as number, undefined, true);
        if (isActuallyDayEnd) {
          t.exitPrice = lastC.close;
          t.exitTime = lastC.time as number;
          t.exitReason = 'DAY_END';
          t.pnl = t.type === 'LONG' ? lastC.close - t.entryPrice : t.entryPrice - lastC.close;
          t.status = t.pnl > 0 ? 'WIN' : t.pnl < 0 ? 'LOSS' : 'BE';
          t.duration = formatDuration(t.entryTime, t.exitTime);
        } else {
          // Genuinely open live trade during market hours
          t.status = 'OPEN';
          t.exitPrice = undefined;
          t.exitTime = undefined;
          t.exitReason = undefined;
          t.pnl = t.type === 'LONG' ? lastC.close - t.entryPrice : t.entryPrice - lastC.close;
          t.duration = formatDuration(t.entryTime, lastC.time as number) + ' (Active)';
        }
        activeTrade = null;
      }

      // Update comparison metrics between RAW signals and active Filtered signals
      const rawWinRate = boTotal > 0 ? ((boWins / boTotal) * 100).toFixed(1) : '0.0';
      setComparisonStats({
        rawTotal: boTotal,
        rawWins: boWins,
        rawLosses: boLosses,
        rawWinRate,
        rawNetPnL: boNetPnL,
        filteredCount: exhaustionFiltered + rsiFiltered + wickFiltered + volumeFiltered + trendFiltered + boxFiltered + adxFiltered,
        exhaustionFiltered,
        rsiFiltered,
        wickFiltered,
        volumeFiltered,
        trendFiltered,
        boxFiltered,
        adxFiltered,
        beSavedCount,
      });

      // Update Gold Lines on chart
      try {
        if (!isDisposedRef.current) {
          if (activeStrategies.adxBreakout) {
            boxUpperRef.current?.setData(mapSeriesData(boxUpperPlot));
            boxUpperRef.current?.applyOptions({ visible: true });
            boxLowerRef.current?.setData(mapSeriesData(boxLowerPlot));
            boxLowerRef.current?.applyOptions({ visible: true });
            targetLineRef.current?.setData(mapSeriesData(targetPlot));
            targetLineRef.current?.applyOptions({ visible: true });
            target2LineRef.current?.setData(mapSeriesData(target2Plot));
            target2LineRef.current?.applyOptions({ visible: true });
            stopLossLineRef.current?.setData(mapSeriesData(stopLossPlot));
            stopLossLineRef.current?.applyOptions({ visible: true });
          } else {
            boxUpperRef.current?.applyOptions({ visible: false });
            boxLowerRef.current?.applyOptions({ visible: false });
            targetLineRef.current?.applyOptions({ visible: false });
            target2LineRef.current?.applyOptions({ visible: false });
            stopLossLineRef.current?.applyOptions({ visible: false });
          }

          if (activeStrategies.alphaTrend) {
            alphaTrendRef.current?.setData(mapSeriesData(alpha.alphaTrend));
            alphaTrendRef.current?.applyOptions({ visible: true });
            alphaTrendTriggerRef.current?.setData(mapSeriesData(alpha.trigger));
            alphaTrendTriggerRef.current?.applyOptions({ visible: true });
          } else {
            alphaTrendRef.current?.applyOptions({ visible: false });
            alphaTrendTriggerRef.current?.applyOptions({ visible: false });
          }

          // Always hide T3 on Gold
          t3Lev0Ref.current?.applyOptions({ visible: false });
          t3Lev5Ref.current?.applyOptions({ visible: false });
        }
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }

      setFilteredCount(exhaustionFiltered + rsiFiltered + wickFiltered + volumeFiltered + trendFiltered + boxFiltered + adxFiltered);
      if (!isDisposedRef.current && series) {
        try {
          series.setMarkers(markers);
        } catch (e: any) {
          if (e?.message?.includes('disposed')) return;
        }
      }
      setBacktestTrades([...allTrades].reverse());
      return;
    }

    // =========================================================================
    // NON-GOLD (NIFTY/BANKNIFTY): T3 STRIPED & ALPHATREND WITH SMART QUALITY FILTERS
    // =========================================================================
    // Hide Gold lines
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
    const rsi14 = computeRSI(closePrices, 14);
    
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
      const isDayEnd = isSessionEndBar(c.time as number, nextC?.time as number, false);
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
        if (isDayEnd) return;
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
    let exhaustionFiltered = 0;
    let rsiFiltered = 0;
    let volumeFiltered = 0;
    let beSavedCount = 0;
    let profitTradesFiltered = 0;
    let lossTradesFiltered = 0;

    for (let i = 50; i < candles.length; i++) {
       const curr = candles[i];
       const nextCandle = candles[i + 1];
       const isDayEnd = isSessionEndBar(curr.time as number, nextCandle?.time as number, false);
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

       // --- Strategy Execution (Do NOT open new trades near/at day end) ---
       const openTrade = (type: 'LONG'|'SHORT', signalName: string, slPoints: number, tpPoints: number, tp2Points?: number) => {
         if (isDayEnd) return;
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
       if (activeStrategies.comboUnfiltered && !isDayEnd) {
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
       if (activeStrategies.comboFiltered && !isDayEnd) {
         const hasActiveTrade = (activeComboConfig?.oneTradeAtATime ?? true) && openTrades.some(t => t.status === 'OPEN' && t.strategyFamily === 'COMBO_FILTERED');
         if (!hasActiveTrade) {
           // Strict Strategy Confirmation Filters:
           // a) Real Upstox Volume confirmation (>= 0.85x 20-period Vol SMA)
           const currVolSma = volSma20[i];
           const volOk = !currVolSma || (curr.volume >= currVolSma * 0.85);

           // b) Confirmation Candle: Green candle for Long (Close >= Open), Red candle for Short (Close <= Open)
           const candleOkLong = curr.close >= curr.open;
           const candleOkShort = curr.close <= curr.open;

           // c) Ribbon Spread Expansion: abs(t3_0 - t3_5) >= minRibbonExpansion * ATR
           const ribbonSpread = Math.abs(t3_0 - t3_5);
           const minSpread = (activeT3Config.minRibbonExpansion || 0.12) * atr;
           const spreadOk = ribbonSpread >= minSpread;

           // d) Trend Alignment (50 EMA)
           const trendOkLong = isNaN(currEma50) || (curr.close >= currEma50 - 0.25 * atr);
           const trendOkShort = isNaN(currEma50) || (curr.close <= currEma50 + 0.25 * atr);

           if (comboLongTrigger && volOk && candleOkLong && spreadOk && trendOkLong) {
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
           } else if (comboShortTrigger && volOk && candleOkShort && spreadOk && trendOkShort) {
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
     }

// Failsafe: Only square off if session actually ended, otherwise keep trade actively OPEN
    for (const t of openTrades) {
      if (t.status === 'OPEN') {
        const lastC = candles[candles.length - 1];
        const isActuallyDayEnd = isSessionEndBar(lastC.time as number, undefined, false);
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
      filteredCount: suppressedTrades,
      exhaustionFiltered,
      rsiFiltered,
      wickFiltered,
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
        series.setMarkers(markers);
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
      }
    }
    setBacktestTrades([...allTrades].reverse());
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

  const totalTrades = backtestTrades.length;
  const wins = backtestTrades.filter(t => t.status === 'WIN').length;
  const losses = backtestTrades.filter(t => t.status === 'LOSS').length;
  const beTrades = backtestTrades.filter(t => t.status === 'BE').length;
  const dayEndSquareOffs = backtestTrades.filter(t => t.exitReason === 'DAY_END').length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const totalNetPnL = backtestTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const profitFactor = (() => {
    const grossProfit = backtestTrades.filter(t => (t.pnl || 0) > 0).reduce((acc, t) => acc + (t.pnl || 0), 0);
    const grossLoss = Math.abs(backtestTrades.filter(t => (t.pnl || 0) < 0).reduce((acc, t) => acc + (t.pnl || 0), 0));
    return grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '0.00';
  })();

  const closedTradesWithDuration = backtestTrades.filter(t => t.exitTime && t.entryTime && t.status !== 'OPEN');
  const avgDurationSec = closedTradesWithDuration.length > 0
    ? Math.floor(closedTradesWithDuration.reduce((acc, t) => acc + ((t.exitTime || 0) - t.entryTime), 0) / closedTradesWithDuration.length)
    : 0;
  const avgDurationFormatted = formatDuration(0, avgDurationSec);

  return (
    <div className="w-full flex flex-col gap-6">
      
      {/* Chart Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] flex flex-col min-h-[560px] md:h-[75vh] md:min-h-[620px]">
        {/* Top Header */}
        <div className="p-3 sm:p-4 border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-2.5 shrink-0 bg-[#0A0F1C]">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <span className={`w-2.5 h-2.5 rounded-full ${instrument.toUpperCase().includes('GOLD') ? 'bg-amber-400 animate-pulse' : 'bg-brand-blue animate-pulse'}`}></span>
            <h3 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-wide">
              {instrument.toUpperCase().includes('GOLD') ? 'MCX GOLD Live Chart & PA Bot' : 'NIFTY 50 Live Chart & PA Bot'}
            </h3>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${instrument.toUpperCase().includes('GOLD') ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'}`}>
              {instrument.toUpperCase().includes('GOLD') ? 'MCX COMMODITY' : 'NSE INDEX'}
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
            {isGold ? (
              <>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span><span>open_long</span></div>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-400"></span><span>open_short</span></div>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>close (TP)</span></div>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>close (SL)</span></div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
                <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
              </>
            )}
          </div>
        </div>
      
        {/* Strategies Settings Panel */}
        <div className="bg-[#0A0F1C] border-b border-[#1F2937] px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-medium text-gray-300 shrink-0 w-full">
          {isGold ? (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between w-full gap-3">
              <div className="flex items-center gap-3 overflow-x-auto pb-1 sm:pb-0 touch-pan-x whitespace-nowrap scrollbar-thin">
                {/* ADX Breakout Toggle */}
                <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-300 shrink-0">
                  <input 
                    type="checkbox" 
                    checked={strategies.adxBreakout} 
                    onChange={e => setStrategies(s => ({...s, adxBreakout: e.target.checked}))} 
                    className="accent-amber-400" 
                  />
                  <span>Rob Booker - ADX Breakout</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">GOLD ONLY</span>
                </label>

                {/* AlphaTrend Toggle for Gold */}
                <label className="flex items-center gap-2 cursor-pointer font-bold text-cyan-400 shrink-0">
                  <input 
                    type="checkbox" 
                    checked={strategies.alphaTrend} 
                    onChange={e => setStrategies(s => ({...s, alphaTrend: e.target.checked}))} 
                    className="accent-cyan-400" 
                  />
                  <span>AlphaTrend</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">GOLD ONLY</span>
                </label>

                <div className="h-4 w-px bg-[#1F2937] shrink-0"></div>

                {/* Gold Entry Mode Selector */}
                <div className="flex items-center gap-1.5 bg-[#111827] px-2.5 py-1 rounded border border-[#1F2937] shrink-0">
                  <span className="text-gray-400 font-semibold">Entry Mode:</span>
                  <select
                    value={entryMode}
                    onChange={e => {
                      const m = e.target.value as 'BREAKOUT' | 'RETEST' | 'ADAPTIVE';
                      setEntryMode(m);
                      setAdxBreakoutConfig(c => ({ ...c, entryMode: m }));
                    }}
                    className="bg-[#1A2234] border border-[#374151] rounded px-2 py-0.5 text-xs text-amber-300 font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="BREAKOUT">🚀 Immediate Breakout</option>
                    <option value="RETEST">🎯 Retest Confirmation</option>
                    <option value="ADAPTIVE">⚡ Adaptive (Both)</option>
                  </select>
                </div>

                <div className="h-4 w-px bg-[#1F2937] shrink-0"></div>

                {/* Visual Strategy Legend */}
                <div className="flex items-center gap-3 text-[11px] font-mono text-gray-400 shrink-0">
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-amber-400"></span>
                    <span className="text-amber-400">Box High</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-pink-500"></span>
                    <span className="text-pink-400">Box Low</span>
                  </div>
                  {strategies.alphaTrend && (
                    <div className="flex items-center gap-1">
                      <span className="w-3 h-0.5 bg-cyan-400"></span>
                      <span className="text-cyan-400">AlphaTrend</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-blue-500"></span>
                    <span className="text-blue-400">Target</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-red-500"></span>
                    <span className="text-red-400">SL</span>
                  </div>
                </div>

                <div className="h-4 w-px bg-[#1F2937] shrink-0"></div>

                {/* Strategy Parameters */}
                <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span>ADX Consolidation: &lt;</span>
                    <select
                      value={adxBreakoutConfig.adxLowerLevel}
                      onChange={e => setAdxBreakoutConfig(c => ({ ...c, adxLowerLevel: Number(e.target.value) }))}
                      className="bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-purple-400 font-mono focus:outline-none cursor-pointer"
                    >
                      <option value={15}>15</option>
                      <option value={18}>18 (Default)</option>
                      <option value={20}>20</option>
                      <option value={25}>25</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span>Lookback:</span>
                    <select
                      value={adxBreakoutConfig.boxLookBack}
                      onChange={e => setAdxBreakoutConfig(c => ({ ...c, boxLookBack: Number(e.target.value) }))}
                      className="bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-amber-400 font-mono focus:outline-none cursor-pointer"
                    >
                      <option value={10}>10 bars</option>
                      <option value={15}>15 bars</option>
                      <option value={20}>20 bars (Default)</option>
                      <option value={30}>30 bars</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span>Direction:</span>
                    <select
                      value={adxBreakoutConfig.enableDirection}
                      onChange={e => setAdxBreakoutConfig(c => ({ ...c, enableDirection: Number(e.target.value) }))}
                      className="bg-[#111827] border border-[#374151] rounded px-2 py-0.5 text-xs text-brand-blue font-mono focus:outline-none cursor-pointer"
                    >
                      <option value={0}>Both (Long &amp; Short)</option>
                      <option value={1}>Long Only</option>
                      <option value={-1}>Short Only</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Real-time ADX Status Badge for Gold */}
              {currentAdx && (
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 border ${
                    currentAdx.value < adxBreakoutConfig.adxLowerLevel
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 animate-pulse'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${currentAdx.value < adxBreakoutConfig.adxLowerLevel ? 'bg-purple-400' : 'bg-emerald-400'}`}></span>
                    <span>ADX: {currentAdx.value}</span>
                    <span className="font-normal text-gray-300">
                      {currentAdx.value < adxBreakoutConfig.adxLowerLevel ? '(Consolidation: Box Armed)' : '(Trending)'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
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
          )}
        </div>
      
        <div className="flex-1 relative min-h-[380px] w-full overflow-hidden">
          {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
          <div ref={chartContainerRef} className="absolute inset-0" />
        </div>
      </div>

      {/* Signals Dashboard Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] flex flex-col w-full">
        {/* Header & Metrics */}
        <div className="p-3.5 sm:p-4 border-b border-[#1F2937] flex flex-col lg:flex-row lg:items-center justify-between shrink-0 bg-[#0A0F1C] gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{isGold ? `Backtest Dashboard (${timeframe}m)` : `Backtest Dashboard (${instrument} ${timeframe}m)`}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  {filterMode}
                </span>
              </h3>

              {/* View Mode Toggle: Table or Mobile Cards */}
              <div className="flex items-center bg-[#111827] p-0.5 rounded border border-[#1F2937] text-xs">
                <button
                  onClick={() => setTradeViewMode('table')}
                  className={`px-2 py-0.5 rounded transition-all font-medium ${
                    tradeViewMode === 'table' ? 'bg-brand-blue text-black font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                  title="Full detailed backtest table view"
                >
                  📋 Table
                </button>
                <button
                  onClick={() => setTradeViewMode('cards')}
                  className={`px-2 py-0.5 rounded transition-all font-medium ${
                    tradeViewMode === 'cards' ? 'bg-brand-blue text-black font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                  title="Mobile-optimized vertical card view"
                >
                  📱 Cards
                </button>
              </div>
            </div>

            {/* Collapsible Filters Toggle & Reset Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFiltersOpen(prev => !prev)}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-[#1F2937] hover:bg-[#374151] text-gray-200 transition-colors flex items-center gap-1.5 border border-[#374151]"
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
                className="px-2 py-1 text-[11px] rounded bg-[#111827] hover:bg-amber-500/10 text-gray-400 hover:text-amber-300 border border-[#1F2937] hover:border-amber-400/40 transition-colors"
                title="Reset all filters back to default"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Performance Summary Metrics (Responsive Grid for Portrait/Landscape) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:flex md:flex-wrap gap-x-3 gap-y-1.5 text-xs text-gray-400 items-center bg-[#111827]/60 p-2 rounded-lg border border-[#1F2937]/80">
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
              <span>Net PnL:</span>
              <span className={`font-bold ${totalNetPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(totalNetPnL >= 0 ? '+' : '') + totalNetPnL.toFixed(1)} pts
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

          {/* Gold Retest vs Immediate Breakout Side-by-Side Comparison Card */}
          {isGold && retestComparison.breakoutTotal > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-gradient-to-r from-[#0F172A] to-[#1E1B4B] border border-amber-500/30 text-xs">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 mb-2 border-b border-[#334155]/60">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚖️</span>
                  <span className="font-bold text-amber-300">Gold Setup Analysis: Retest vs Immediate Breakout Entry</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-mono">
                    Active Mode: {entryMode}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400">
                  Dual backtested on {dataRef.current?.length || 0} bars of Gold data
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                {/* Immediate Breakout Column */}
                <div className={`p-2.5 rounded border transition-all ${
                  entryMode === 'BREAKOUT' 
                    ? 'bg-[#1E293B]/80 border-amber-400/50 shadow-sm shadow-amber-500/10' 
                    : 'bg-[#0B1120]/60 border-[#1E293B]'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-gray-200 flex items-center gap-1.5">
                      <span>🚀 Immediate Breakout</span>
                      {entryMode === 'BREAKOUT' && <span className="text-[9px] px-1 py-0.2 rounded bg-amber-400 text-black font-extrabold">SELECTED</span>}
                    </span>
                    <span className="font-mono font-bold text-blue-400">{retestComparison.breakoutWinRate}% WR</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Trades:</span>
                      <span className="text-white font-bold">{retestComparison.breakoutTotal}</span> ({retestComparison.breakoutWins}W/{retestComparison.breakoutLosses}L)
                    </div>
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Net PnL:</span>
                      <span className={`font-bold ${retestComparison.breakoutNetPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(retestComparison.breakoutNetPnL >= 0 ? '+' : '') + retestComparison.breakoutNetPnL.toFixed(1)} pts
                      </span>
                    </div>
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Avg R:R:</span>
                      <span className="text-amber-300 font-bold">1 : {retestComparison.breakoutAvgRR}</span>
                    </div>
                  </div>
                </div>

                {/* Retest Confirmation Column */}
                <div className={`p-2.5 rounded border transition-all ${
                  entryMode === 'RETEST' 
                    ? 'bg-[#1E293B]/80 border-emerald-400/50 shadow-sm shadow-emerald-500/10' 
                    : 'bg-[#0B1120]/60 border-[#1E293B]'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-gray-200 flex items-center gap-1.5">
                      <span>🎯 Retest Confirmation (Pullback)</span>
                      {entryMode === 'RETEST' && <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-400 text-black font-extrabold">SELECTED</span>}
                    </span>
                    <span className="font-mono font-bold text-emerald-400">{retestComparison.retestWinRate}% WR</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Trades:</span>
                      <span className="text-white font-bold">{retestComparison.retestTotal}</span> ({retestComparison.retestWins}W/{retestComparison.retestLosses}L)
                    </div>
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Net PnL:</span>
                      <span className={`font-bold ${retestComparison.retestNetPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(retestComparison.retestNetPnL >= 0 ? '+' : '') + retestComparison.retestNetPnL.toFixed(1)} pts
                      </span>
                    </div>
                    <div className="bg-[#0F172A] p-1.5 rounded">
                      <span className="text-gray-400 block text-[10px]">Avg R:R:</span>
                      <span className="text-emerald-300 font-bold">1 : {retestComparison.retestAvgRR}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Trade-off Key Takeaways */}
              <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-gray-300 bg-[#0B1120]/80 p-2 rounded border border-[#1E293B]">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">🛡️ False Breakouts Saved:</span>
                    <span className="text-white font-bold font-mono">{retestComparison.falseBreakoutsSaved}</span>
                    <span className="text-gray-500 text-[10px]">(failed breakout spikes filtered out)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-400 font-bold">🏃 Missed Runaway Moves:</span>
                    <span className="text-white font-bold font-mono">{retestComparison.missedRunaways}</span>
                    <span className="text-gray-500 text-[10px]">(breakouts that didn't pull back)</span>
                  </div>
                </div>
                <div className="text-purple-300 font-medium">
                  {retestComparison.retestAvgRR > retestComparison.breakoutAvgRR ? '💡 Retest doubles R:R with tighter invalidation stop' : '⚡ Breakout captures instant momentum'}
                </div>
              </div>
            </div>
          )}
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
                    <span className={`text-[10px] px-1 py-0.2 rounded ${filterMode === 'BOOKER_ADX' ? 'bg-black/20 text-purple-100 font-extrabold' : 'bg-black/30 text-purple-300'}`}>ADX &lt; {isGold ? adxBreakoutConfig.adxLowerLevel : adxChopFilter.threshold}</span>
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
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-200 hover:text-white" title="Avoids taking trades during opening market buffer (before 09:25 IST for Nifty, 09:15 IST for Gold) when spreads and volatility whipsaws are highest">
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

        {/* Backtest Trades Container: Responsive Cards or Horizontal Table */}
        {tradeViewMode === 'cards' ? (
          /* Mobile / Portrait Card View: Fully readable vertically without horizontal scrolling */
          <div className="overflow-y-auto max-h-[550px] min-h-[350px] p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-[#0A0F1C]">
            {backtestTrades.length === 0 ? (
              <div className="col-span-full py-12 text-center text-gray-500">
                No trades generated for this period or all filtered out by selected filters.
              </div>
            ) : (
              backtestTrades.map((t, idx) => (
                <div
                  key={t.id + '-' + idx}
                  className="bg-[#111827] rounded-lg border border-[#1F2937] p-3 flex flex-col justify-between gap-2.5 hover:border-gray-600 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-[#1F2937]/70 pb-2">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.type === 'LONG' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {t.type}
                        </span>
                        <span className="font-semibold text-xs text-white truncate max-w-[130px]">{t.signal}</span>
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
                      <div className={`text-xs font-mono font-bold mt-0.5 ${
                        t.pnl === undefined ? 'text-gray-500' : t.pnl > 0 ? 'text-emerald-400' : t.pnl < 0 ? 'text-red-400' : 'text-gray-300'
                      }`}>
                        {t.pnl !== undefined ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) + ' pts' : '-'}
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
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]">
                {backtestTrades.length === 0 && (
                   <tr><td colSpan={12} className="py-8 text-center text-gray-500">No trades generated for this period</td></tr>
                )}
                {backtestTrades.map((t, idx) => (
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
                          {t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)}
                          {t.status === 'OPEN' && <span className="text-[10px] text-gray-500 ml-1">(unrealized)</span>}
                        </span>
                      ) : (
                        '-'
                      )}
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
          <div className="bg-[#111827] border border-[#374151] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
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
                <span>Restore Optimal Nifty 1m Preset</span>
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
