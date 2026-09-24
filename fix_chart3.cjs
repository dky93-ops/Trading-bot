const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

code = code.replace(
  /if \(ema9Ref\.current\) ema9Ref\.current\.setData\(mapSeriesData\(ema9\)\);/,
  `if (ema9Ref.current) {
      ema9Ref.current.setData(mapSeriesData(ema9));
      ema9Ref.current.applyOptions({ visible: activeStrategies.consensus });
    }`
);

code = code.replace(
  /if \(ema21Ref\.current\) ema21Ref\.current\.setData\(mapSeriesData\(ema21\)\);/,
  `if (ema21Ref.current) {
      ema21Ref.current.setData(mapSeriesData(ema21));
      ema21Ref.current.applyOptions({ visible: activeStrategies.consensus });
    }`
);

code = code.replace(
  /if \(upperBbRef\.current\) upperBbRef\.current\.setData\(mapSeriesData\(upper\)\);/,
  `if (upperBbRef.current) {
      upperBbRef.current.setData(mapSeriesData(upper));
      upperBbRef.current.applyOptions({ visible: activeStrategies.consensus });
    }`
);

code = code.replace(
  /if \(lowerBbRef\.current\) lowerBbRef\.current\.setData\(mapSeriesData\(lower\)\);/,
  `if (lowerBbRef.current) {
      lowerBbRef.current.setData(mapSeriesData(lower));
      lowerBbRef.current.applyOptions({ visible: activeStrategies.consensus });
    }`
);

code = code.replace(
  /if \(superTrendRef\.current\) superTrendRef\.current\.setData\(mapSeriesData\(stLine\)\);/,
  `if (superTrendRef.current) {
      superTrendRef.current.setData(mapSeriesData(stLine));
      superTrendRef.current.applyOptions({ visible: activeStrategies.consensus });
    }`
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed line visibility');
