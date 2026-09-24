const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

code = code.replace(
  /      timeScale: \{\n        timeVisible: true,\n        secondsVisible: false,\n      \},\n        horzLines: \{ color: '#1F2937' \},\n      \},/,
  ""
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed syntax');
