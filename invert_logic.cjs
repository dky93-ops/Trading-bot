const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const markerProxy = `let markers: any[] = [];
    const originalPush = markers.push.bind(markers);
    markers.push = function(marker: any) {
       let invertedMarker = { ...marker };
       if (marker.position === 'belowBar') invertedMarker.position = 'aboveBar';
       else if (marker.position === 'aboveBar') invertedMarker.position = 'belowBar';
       
       if (marker.shape === 'arrowUp') invertedMarker.shape = 'arrowDown';
       else if (marker.shape === 'arrowDown') invertedMarker.shape = 'arrowUp';

       const greenBlues = ['#10B981', '#3B82F6', '#8B5CF6', '#0EA5E9', '#06B6D4'];
       const redOranges = ['#EF4444', '#F97316', '#D946EF', '#EAB308', '#F43F5E'];
       if (greenBlues.includes(marker.color)) invertedMarker.color = '#EF4444';
       else if (redOranges.includes(marker.color)) invertedMarker.color = '#10B981';

       originalPush(invertedMarker);
       return markers.length;
    };`;

code = code.replace('let markers: any[] = [];', markerProxy);

const openTradeInvert = `const openTrade = (type: 'LONG'|'SHORT', signalName: string, slPoints: number, tpPoints: number) => {
         type = type === 'LONG' ? 'SHORT' : 'LONG';
         if (openTrades.some(t => t.signal === signalName)) return;`;

code = code.replace(/const openTrade = \([^)]+\) => \{\n         \/\/ Don't open if we already have an open trade for this signal to avoid spam\n         if \(openTrades\.some\(t => t\.signal === signalName\)\) return;/g, openTradeInvert);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Inverted logic applied');
