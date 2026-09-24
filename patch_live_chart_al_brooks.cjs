const fs = require('fs');

const code = `import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';

export function LiveChart({ livePrice, instrument }: { livePrice?: number, instrument: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<number>(1);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
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
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      localization: {
        timeFormatter: (timeValue: any) => {
          if (typeof timeValue === 'number') {
            const date = new Date(timeValue * 1000);
            return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
          }
          return timeValue;
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

    const emaSeries = chart.addLineSeries({
      color: '#F59E0B',
      lineWidth: 2,
      crosshairMarkerVisible: false,
    });
    emaRef.current = emaSeries;

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(\`/api/candles?instrument=\${encodeURIComponent(instrument)}&timeframe=\${timeframe}&limit=1000\`);
        const candles = await res.json();
        
        if (!Array.isArray(candles)) return;

        const formatted = candles.reverse().map(c => {
           const dateObj = new Date(c.timestamp);
           return {
             time: Math.floor(dateObj.getTime() / 1000) as Time,
             open: c.open,
             high: c.high,
             low: c.low,
             close: c.close,
           };
        });
        
        const sorted = formatted.sort((a, b) => (a.time as number) - (b.time as number));
        const unique = sorted.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i);

        if (unique.length > 0) {
          candlestickSeries.setData(unique);
          applyPriceActionAnalysis(unique, candlestickSeries, emaSeries);
        }

      } catch(e) {
        console.error("Failed to load chart data", e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
      }
    };

    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [instrument, timeframe]);

  useEffect(() => {
    if (livePrice && seriesRef.current) {
      const now = new Date();
      const istTime = new Date(now.getTime() + 19800000);
      const timeNum = istTime.getUTCHours() * 100 + istTime.getUTCMinutes();
      if (timeNum < 915 || timeNum > 1530) return;

      const data = seriesRef.current.data();
      if (data && data.length > 0) {
        const lastBar = data[data.length - 1] as any;
        const newBar = {
          ...lastBar,
          close: livePrice,
          high: Math.max(lastBar.high, livePrice),
          low: Math.min(lastBar.low, livePrice),
        };
        seriesRef.current.update(newBar);
      }
    }
  }, [livePrice]);
  
  const calculateEMA = (data: any[], period: number) => {
    if (data.length === 0) return [];
    const k = 2 / (period + 1);
    let ema = data[0].close;
    const emaData = [{ time: data[0].time, value: ema }];
    for (let i = 1; i < data.length; i++) {
      ema = (data[i].close - ema) * k + ema;
      emaData.push({ time: data[i].time, value: ema });
    }
    return emaData;
  };

  const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">) => {
    if (candles.length < 20) return;
    
    // Calculate 20 EMA
    const ema20 = calculateEMA(candles, 20);
    emaSeries.setData(ema20);

    priceLinesRef.current.forEach(line => series.removePriceLine(line));
    priceLinesRef.current = [];
    let markers: any[] = [];
    
    let activeSetup: any = null;

    // Al Brooks Price Action Analysis
    for (let i = 20; i < candles.length; i++) {
       const curr = candles[i];
       const prev = candles[i-1];
       const ema = ema20[i].value;
       const trendIsBull = curr.close > ema;
       const trendIsBear = curr.close < ema;

       const isBullTrendBar = curr.close > curr.open && (curr.close - curr.open) > (curr.high - curr.low) * 0.5;
       const isBearTrendBar = curr.close < curr.open && (curr.open - curr.close) > (curr.high - curr.low) * 0.5;
       
       // Reversal Bars
       const isBullReversal = curr.close > curr.open && (curr.close - curr.open) >= (curr.high - curr.low) * 0.4 && (curr.open - curr.low) > (curr.high - curr.low) * 0.3;
       const isBearReversal = curr.close < curr.open && (curr.open - curr.close) >= (curr.high - curr.low) * 0.4 && (curr.high - curr.open) > (curr.high - curr.low) * 0.3;

       // Inside / Outside
       const isInside = curr.high <= prev.high && curr.low >= prev.low;
       const isOutside = curr.high > prev.high && curr.low < prev.low;
       
       const prevIsInside = prev.high <= candles[i-2].high && prev.low >= candles[i-2].low;
       const isII = isInside && prevIsInside;
       
       // Counting Highs / Lows for Pullbacks
       // A simplified approach for H1/H2 and L1/L2
       
       // High 1 / High 2
       if (trendIsBull && curr.low < prev.low) {
         // Pullback detected
         if (curr.high > prev.high && isBullReversal) {
            markers.push({ time: curr.time, position: 'belowBar', color: '#10B981', shape: 'arrowUp', text: 'H1/Rev' });
            if (i === candles.length - 1) {
              const entry = curr.high;
              const sl = curr.low;
              const target = entry + (entry - sl) * 2;
              activeSetup = { type: 'LONG', entry, stoploss: sl, target };
            }
         }
       }
       
       // Low 1 / Low 2
       if (trendIsBear && curr.high > prev.high) {
         if (curr.low < prev.low && isBearReversal) {
            markers.push({ time: curr.time, position: 'aboveBar', color: '#EF4444', shape: 'arrowDown', text: 'L1/Rev' });
            if (i === candles.length - 1) {
              const entry = curr.low;
              const sl = curr.high;
              const target = entry - (sl - entry) * 2;
              activeSetup = { type: 'SHORT', entry, stoploss: sl, target };
            }
         }
       }

       // II pattern setup
       if (isII) {
          markers.push({ time: curr.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'ii' });
       }
    }

    if (activeSetup) {
       priceLinesRef.current.push(series.createPriceLine({
         price: activeSetup.entry, color: '#3B82F6', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: \`\${activeSetup.type} Entry\`
       }));
       priceLinesRef.current.push(series.createPriceLine({
         price: activeSetup.stoploss, color: '#EF4444', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Stoploss'
       }));
       priceLinesRef.current.push(series.createPriceLine({
         price: activeSetup.target, color: '#10B981', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Target (1:2)'
       }));
    }

    if (markers.length > 0) {
      const uniqueMarkers = markers.filter((m, i, a) => a.findIndex(t => t.time === m.time) === i);
      uniqueMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      series.setMarkers(uniqueMarkers);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center space-x-2 p-2 bg-[#0A0F1C] border-b border-[#1F2937]">
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
        <div className="flex-1"></div>
        <div className="flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
        </div>
      </div>
      
      <div className="flex-1 relative min-h-0">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
`

fs.writeFileSync('src/components/LiveChart.tsx', code);
