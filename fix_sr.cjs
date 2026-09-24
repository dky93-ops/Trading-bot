const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const targetStr = `    // Support and Resistance Calculation
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
    });`;

const newStr = `    // Support and Resistance Calculation (Updated based on Chris Padgett's rules)
    const getBodyHigh = (c: any) => Math.max(c.open, c.close);
    const getBodyLow = (c: any) => Math.min(c.open, c.close);

    let sessionBodyHigh = -Infinity;
    let sessionBodyLow = Infinity;
    
    for (let j = 0; j < candles.length; j++) {
       const bh = getBodyHigh(candles[j]);
       const bl = getBodyLow(candles[j]);
       if (bh > sessionBodyHigh) sessionBodyHigh = bh;
       if (bl < sessionBodyLow) sessionBodyLow = bl;
    }

    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    
    for (let j = 2; j < candles.length - 2; j++) {
       const current = candles[j];
       const left1 = candles[j-1];
       const left2 = candles[j-2];
       const right1 = candles[j+1];
       const right2 = candles[j+2];
       
       const cBh = getBodyHigh(current);
       if (cBh >= getBodyHigh(left1) && cBh >= getBodyHigh(left2) && cBh >= getBodyHigh(right1) && cBh >= getBodyHigh(right2)) {
          swingHighs.push(cBh);
       }
       
       const cBl = getBodyLow(current);
       if (cBl <= getBodyLow(left1) && cBl <= getBodyLow(left2) && cBl <= getBodyLow(right1) && cBl <= getBodyLow(right2)) {
          swingLows.push(cBl);
       }
    }
    
    // Filter close levels: Chris Padgett Rule - avoid clustered lines, prefer conservative (deeper) levels.
    // For resistances, deeper means higher. For supports, deeper means lower.
    const filterCloseLevels = (levels: number[], isResistance: boolean, threshold: number = 15) => {
       // Sort from most conservative to least conservative
       const sorted = isResistance ? [...levels].sort((a, b) => b - a) : [...levels].sort((a, b) => a - b);
       const filtered: number[] = [];
       for (const level of sorted) {
          if (filtered.length === 0) {
             filtered.push(level);
          } else {
             // Check if it's too close to an already accepted (more conservative) level
             const isTooClose = filtered.some(acceptedLevel => Math.abs(acceptedLevel - level) < threshold);
             if (!isTooClose) {
                filtered.push(level);
             }
          }
       }
       return filtered;
    };

    const THRESHOLD = 15;
    const recentResistances = filterCloseLevels(Array.from(new Set(swingHighs)), true, THRESHOLD)
         .filter(h => h < sessionBodyHigh).slice(0, 2);
    const recentSupports = filterCloseLevels(Array.from(new Set(swingLows)), false, THRESHOLD)
         .filter(l => l > sessionBodyLow).slice(0, 2);

    if (sessionBodyHigh !== -Infinity && candles.length > 0) {
       priceLinesRef.current.push(series.createPriceLine({
         price: sessionBodyHigh, color: '#EF4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Overall High (Body)'
       }));
    }
    if (sessionBodyLow !== Infinity && candles.length > 0) {
       priceLinesRef.current.push(series.createPriceLine({
         price: sessionBodyLow, color: '#10B981', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Overall Low (Body)'
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
    });`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, newStr);
    fs.writeFileSync('src/components/LiveChart.tsx', code);
    console.log('Fixed S&R calculation logic successfully');
} else {
    console.log('Target string not found');
}
