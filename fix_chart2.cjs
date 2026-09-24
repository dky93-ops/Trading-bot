const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// 1. Initialize the missing series
code = code.replace(
  /    emaRef\.current = emaSeries;/g,
  `    emaRef.current = emaSeries;

    ema9Ref.current = chart.addLineSeries({ color: '#3B82F6', lineWidth: 1, title: 'EMA 9' });
    ema21Ref.current = chart.addLineSeries({ color: '#EAB308', lineWidth: 1, title: 'EMA 21' });
    upperBbRef.current = chart.addLineSeries({ color: '#6366F1', lineWidth: 1, lineStyle: 2, title: 'BB Upper' });
    lowerBbRef.current = chart.addLineSeries({ color: '#6366F1', lineWidth: 1, lineStyle: 2, title: 'BB Lower' });
    superTrendRef.current = chart.addLineSeries({ color: '#10B981', lineWidth: 2, title: 'SuperTrend' });`
);

// 2. Remove the old incorrectly placed mapSeriesData logic
code = code.replace(
  /    const mapSeriesData = \([\s\S]*?    \}/,
  ""
);

// 3. Destructure stLine and place the rendering logic correctly
code = code.replace(
  /const \{ direction: superTrendDir \} = computeSuperTrend\(highPrices, lowPrices, closePrices, 10, 3\.0\);/,
  `const { direction: superTrendDir, stLine } = computeSuperTrend(highPrices, lowPrices, closePrices, 10, 3.0);
    
    const mapSeriesData = (dataArray: number[]) => dataArray.map((v, i) => ({ time: candles[i].time, value: v })).filter(d => !isNaN(d.value) && d.time !== undefined) as any[];

    if (ema9Ref.current) ema9Ref.current.setData(mapSeriesData(ema9));
    if (ema21Ref.current) ema21Ref.current.setData(mapSeriesData(ema21));
    if (upperBbRef.current) upperBbRef.current.setData(mapSeriesData(upper));
    if (lowerBbRef.current) lowerBbRef.current.setData(mapSeriesData(lower));
    if (superTrendRef.current) superTrendRef.current.setData(mapSeriesData(stLine));`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed chart logic');
