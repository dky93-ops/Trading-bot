const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// 1. Add timeScale options to chart creation
code = code.replace(
  /grid: {[\s\S]*?},/,
  `grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },`
);

// 2. Increase chart size
code = code.replace(
  'className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col h-[500px]"',
  'className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col h-[75vh] min-h-[600px]"'
);

// 3. Add visual series for the consensus indicators
const refsInjection = `  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const upperBbRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerBbRef = useRef<ISeriesApi<"Line"> | null>(null);
  const superTrendRef = useRef<ISeriesApi<"Line"> | null>(null);`;

code = code.replace('  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);', refsInjection);

const seriesInitInjection = `      emaRef.current = chart.addLineSeries({ color: '#F59E0B', lineWidth: 1 });
      ema9Ref.current = chart.addLineSeries({ color: '#3B82F6', lineWidth: 1, title: 'EMA 9' });
      ema21Ref.current = chart.addLineSeries({ color: '#EAB308', lineWidth: 1, title: 'EMA 21' });
      upperBbRef.current = chart.addLineSeries({ color: '#6366F1', lineWidth: 1, lineStyle: 2, title: 'BB Upper' });
      lowerBbRef.current = chart.addLineSeries({ color: '#6366F1', lineWidth: 1, lineStyle: 2, title: 'BB Lower' });
      superTrendRef.current = chart.addLineSeries({ color: '#10B981', lineWidth: 2, title: 'SuperTrend' });`;

code = code.replace('      emaRef.current = chart.addLineSeries({ color: \'#F59E0B\', lineWidth: 1 });', seriesInitInjection);

// 4. Update the visual series in applyPriceActionAnalysis
const renderInjection = `    emaSeries.setData(ema20);

    const mapSeriesData = (dataArray) => dataArray.map((v, i) => ({ time: candles[i].time, value: v })).filter(d => !isNaN(d.value) && d.time);

    if (ema9Ref.current) ema9Ref.current.setData(mapSeriesData(ema9));
    if (ema21Ref.current) ema21Ref.current.setData(mapSeriesData(ema21));
    if (upperBbRef.current) upperBbRef.current.setData(mapSeriesData(upper));
    if (lowerBbRef.current) lowerBbRef.current.setData(mapSeriesData(lower));
    if (superTrendRef.current) {
       superTrendRef.current.setData(mapSeriesData(superTrendDir.map((d, i) => stLine[i])));
    }`;

code = code.replace('    emaSeries.setData(ema20);', renderInjection);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed chart visuals');
