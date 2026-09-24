const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const targetStr = `    if (activeSetup) {
       priceLinesRef.current.push(series.createPriceLine({`;

const newStr = `    // Support and Resistance Calculation
    let sessionHigh = -Infinity;
    let sessionLow = Infinity;
    
    for (let j = 0; j < candles.length; j++) {
       if (candles[j].high > sessionHigh) sessionHigh = candles[j].high;
       if (candles[j].low < sessionLow) sessionLow = candles[j].low;
    }

    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    
    for (let j = 2; j < candles.length - 2; j++) {
       const current = candles[j];
       const left1 = candles[j-1];
       const left2 = candles[j-2];
       const right1 = candles[j+1];
       const right2 = candles[j+2];
       
       if (current.high > left1.high && current.high > left2.high && current.high > right1.high && current.high > right2.high) {
          swingHighs.push(current.high);
       }
       if (current.low < left1.low && current.low < left2.low && current.low < right1.low && current.low < right2.low) {
          swingLows.push(current.low);
       }
    }
    
    // Sort and get unique recent support/resistance levels
    const recentResistances = Array.from(new Set(swingHighs)).sort((a, b) => b - a).filter(h => h < sessionHigh).slice(0, 2);
    const recentSupports = Array.from(new Set(swingLows)).sort((a, b) => a - b).filter(l => l > sessionLow).slice(0, 2);

    if (sessionHigh !== -Infinity && candles.length > 0) {
       priceLinesRef.current.push(series.createPriceLine({
         price: sessionHigh, color: '#EF4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Intraday High'
       }));
    }
    if (sessionLow !== Infinity && candles.length > 0) {
       priceLinesRef.current.push(series.createPriceLine({
         price: sessionLow, color: '#10B981', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Intraday Low'
       }));
    }
    
    recentResistances.forEach((res, idx) => {
       priceLinesRef.current.push(series.createPriceLine({
         price: res, color: '#FCA5A5', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: \`Res \${idx + 1}\`
       }));
    });
    
    recentSupports.forEach((sup, idx) => {
       priceLinesRef.current.push(series.createPriceLine({
         price: sup, color: '#6EE7B7', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: \`Sup \${idx + 1}\`
       }));
    });

    if (activeSetup) {
       priceLinesRef.current.push(series.createPriceLine({`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, newStr);
    fs.writeFileSync('src/components/LiveChart.tsx', code);
    console.log('Successfully added S&R calculation and lines to LiveChart.tsx');
} else {
    console.log('Target string not found in LiveChart.tsx');
}
