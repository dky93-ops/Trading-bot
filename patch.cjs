const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// Add strategies state
code = code.replace(
  'const [timeframe, setTimeframe] = useState<number>(1);',
  `const [timeframe, setTimeframe] = useState<number>(1);
  const [strategies, setStrategies] = useState({
    alBrooks: true,
    scalping: true,
    srRsi: true,
    mbee: true,
    candlesticks: true,
    classicSR: true
  });`
);

// Add useEffect to rerun analysis
code = code.replace(
  'useEffect(() => {\n    if (!chartContainerRef.current) return;',
  `useEffect(() => {
    if (dataRef.current && dataRef.current.length > 0 && seriesRef.current && emaRef.current) {
      applyPriceActionAnalysis(dataRef.current, seriesRef.current, emaRef.current, strategies);
    }
  }, [strategies]);

  useEffect(() => {
    if (!chartContainerRef.current) return;`
);

// Update applyPriceActionAnalysis definition
code = code.replace(
  'const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">) => {',
  'const applyPriceActionAnalysis = (candles: any[], series: ISeriesApi<"Candlestick">, emaSeries: ISeriesApi<"Line">, activeStrategies = strategies) => {'
);

// Update initial call to applyPriceActionAnalysis
code = code.replace(
  'applyPriceActionAnalysis(unique, candlestickSeries, emaSeries);',
  'applyPriceActionAnalysis(unique, candlestickSeries, emaSeries, strategies);'
);

// Add Classic S/R Support
code = code.replace(
  'let markers: any[] = [];',
  `let markers: any[] = [];
    
    if (activeStrategies.classicSR) {
      const pivotHighs: any[] = [];
      const pivotLows: any[] = [];
      const PIVOT_LEN = 15;
      for (let i = PIVOT_LEN; i < candles.length - PIVOT_LEN; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= PIVOT_LEN; j++) {
          if (candles[i-j].high > candles[i].high) isHigh = false;
          if (candles[i-j].low < candles[i].low) isLow = false;
          if (candles[i+j].high > candles[i].high) isHigh = false;
          if (candles[i+j].low < candles[i].low) isLow = false;
        }
        if (isHigh) pivotHighs.push({ time: candles[i].time, price: candles[i].high });
        if (isLow) pivotLows.push({ time: candles[i].time, price: candles[i].low });
      }

      pivotHighs.slice(-3).forEach(ph => {
        const line = series.createPriceLine({ price: ph.price, color: '#EF4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Res' });
        priceLinesRef.current.push(line);
      });
      pivotLows.slice(-3).forEach(pl => {
        const line = series.createPriceLine({ price: pl.price, color: '#10B981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Sup' });
        priceLinesRef.current.push(line);
      });
    }`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Patched');
