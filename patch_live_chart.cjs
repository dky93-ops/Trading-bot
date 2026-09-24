const fs = require('fs');

const code = `import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, LineStyle, Time } from 'lightweight-charts';

export function LiveChart({ livePrice, instrument }: { livePrice?: number, instrument: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
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

    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(\`/api/candles?instrument=\${encodeURIComponent(instrument)}&timeframe=\${timeframe}&limit=1000\`);
        const candles = await res.json();
        
        if (!Array.isArray(candles)) return;
        
        // 1. FILTER FOR MARKET HOURS ONLY (09:15 to 15:30 IST)
        const marketCandles = candles.filter(c => {
           const dateObj = new Date(c.timestamp);
           const istOffset = 5.5 * 60 * 60 * 1000;
           const istTime = new Date(dateObj.getTime() + istOffset);
           const hh = istTime.getUTCHours();
           const mm = istTime.getUTCMinutes();
           const timeNum = hh * 100 + mm;
           return timeNum >= 915 && timeNum <= 1530; // Strictly Indian Market Hours
        });

        // 2. Format to Unix Seconds
        const formatted = marketCandles.reverse().map(c => {
           const dateObj = new Date(c.timestamp);
           return {
             time: Math.floor(dateObj.getTime() / 1000) as Time,
             open: c.open,
             high: c.high,
             low: c.low,
             close: c.close,
           };
        });
        
        // Ensure ascending time & remove dupes
        const sorted = formatted.sort((a, b) => (a.time as number) - (b.time as number));
        const unique = sorted.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i);

        if (unique.length > 0) {
          candlestickSeries.setData(unique);
          applyPriceActionAnalysis(unique, candlestickSeries);
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
  
  const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">) => {
    if (candles.length < 20) return;
    
    // Clear previous lines
    priceLinesRef.current.forEach(line => series.removePriceLine(line));
    priceLinesRef.current = [];
    let markers: any[] = [];
    
    // 1. FRACTAL SWINGS
    let swingHighs: any[] = [];
    let swingLows: any[] = [];
    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      if (c.high > candles[i-1].high && c.high > candles[i-2].high && c.high > candles[i+1].high && c.high > candles[i+2].high) {
        swingHighs.push({ ...c, index: i });
      }
      if (c.low < candles[i-1].low && c.low < candles[i-2].low && c.low < candles[i+1].low && c.low < candles[i+2].low) {
        swingLows.push({ ...c, index: i });
      }
    }
    
    // Draw recent Liquidity Pools (Support/Resistance)
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);
    
    recentHighs.forEach((h, idx) => {
      priceLinesRef.current.push(series.createPriceLine({
        price: h.high, color: '#ef5350', lineWidth: 1, lineStyle: LineStyle.Dashed, title: idx === 2 ? 'Major BSL' : 'Res'
      }));
    });
    
    recentLows.forEach((l, idx) => {
      priceLinesRef.current.push(series.createPriceLine({
        price: l.low, color: '#26a69a', lineWidth: 1, lineStyle: LineStyle.Dashed, title: idx === 2 ? 'Major SSL' : 'Sup'
      }));
    });
    
    // 2. BREAK OF STRUCTURE (BoS) & CHOCH DETECTION
    let lastBoS: any = null;
    const lookback = Math.max(0, candles.length - 100);
    
    for (let i = lookback; i < candles.length; i++) {
       const c = candles[i];
       
       // Bullish BoS
       const pastSwingHighs = swingHighs.filter(sh => sh.index < i);
       if (pastSwingHighs.length > 0) {
          const lastSH = pastSwingHighs[pastSwingHighs.length - 1];
          if (c.close > lastSH.high && (!lastBoS || lastBoS.brokenLevel !== lastSH.high)) {
              // Find origin of the move
              let originLow = c.low;
              let originIdx = i;
              for(let j = lastSH.index; j <= i; j++) {
                 if (candles[j].low < originLow) { originLow = candles[j].low; originIdx = j; }
              }
              lastBoS = { type: 'BULLISH', index: i, originIdx, brokenLevel: lastSH.high, originLevel: originLow };
              markers.push({ time: c.time, position: 'aboveBar', color: '#3B82F6', shape: 'arrowUp', text: 'BoS' });
          }
       }

       // Bearish BoS
       const pastSwingLows = swingLows.filter(sl => sl.index < i);
       if (pastSwingLows.length > 0) {
          const lastSL = pastSwingLows[pastSwingLows.length - 1];
          if (c.close < lastSL.low && (!lastBoS || lastBoS.brokenLevel !== lastSL.low)) {
              let originHigh = c.high;
              let originIdx = i;
              for(let j = lastSL.index; j <= i; j++) {
                 if (candles[j].high > originHigh) { originHigh = candles[j].high; originIdx = j; }
              }
              lastBoS = { type: 'BEARISH', index: i, originIdx, brokenLevel: lastSL.low, originLevel: originHigh };
              markers.push({ time: c.time, position: 'belowBar', color: '#EF4444', shape: 'arrowDown', text: 'BoS' });
          }
       }
    }
    
    // 3. TRADE IDEA GENERATION (ENTRY, SL, TARGET)
    let activeSetup: any = null;
    
    // Only valid if BoS is recent and price hasn't already hit target
    if (lastBoS && (candles.length - lastBoS.index) < 50) { 
       if (lastBoS.type === 'BULLISH') {
          // Identify Order Block (Last down candle before impulse)
          let obIdx = lastBoS.originIdx;
          for (let j = lastBoS.index; j >= lastBoS.originIdx; j--) {
             if (candles[j].close < candles[j].open) { obIdx = j; break; }
          }
          const entry = candles[obIdx].high;
          const stoploss = lastBoS.originLevel - (entry * 0.0005); // buffer
          const target = entry + ((entry - stoploss) * 2); // 1:2 RR
          activeSetup = { type: 'LONG', entry, stoploss, target };
       } 
       else if (lastBoS.type === 'BEARISH') {
          let obIdx = lastBoS.originIdx;
          for (let j = lastBoS.index; j >= lastBoS.originIdx; j--) {
             if (candles[j].close > candles[j].open) { obIdx = j; break; }
          }
          const entry = candles[obIdx].low;
          const stoploss = lastBoS.originLevel + (entry * 0.0005);
          const target = entry - ((stoploss - entry) * 2);
          activeSetup = { type: 'SHORT', entry, stoploss, target };
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
      // Remove duplicates
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
`;

fs.writeFileSync('src/components/LiveChart.tsx', code);
