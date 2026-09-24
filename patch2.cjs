const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// Al Brooks
code = code.replace(
  '// H1/L1, H2/L2',
  '// H1/L1, H2/L2\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// II pattern setup',
  '}\n       // II pattern setup'
);

code = code.replace(
  '// II pattern setup',
  '// II pattern setup\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// Pin Bars',
  '}\n       // Pin Bars'
);

code = code.replace(
  '// Pin Bars',
  '// Pin Bars\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// Engulfing',
  '}\n       // Engulfing'
);

code = code.replace(
  '// Engulfing',
  '// Engulfing\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// Hammer / Shooting Star',
  '}\n       // Hammer / Shooting Star'
);

code = code.replace(
  '// Hammer / Shooting Star',
  '// Hammer / Shooting Star\n       if (activeStrategies.candlesticks) {'
);
code = code.replace(
  '// Doji Sandwich',
  '}\n       // Doji Sandwich'
);

code = code.replace(
  '// Doji Sandwich',
  '// Doji Sandwich\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// Upthrust / Downthrust',
  '}\n       // Upthrust / Downthrust'
);

code = code.replace(
  '// Upthrust / Downthrust',
  '// Upthrust / Downthrust\n       if (activeStrategies.alBrooks) {'
);
code = code.replace(
  '// Scalping PA',
  '}\n       // Scalping PA'
);

code = code.replace(
  '// Scalping PA',
  '// Scalping PA\n       if (activeStrategies.scalping) {'
);
code = code.replace(
  '// Support/Resistance SMA RSI',
  '}\n       // Support/Resistance SMA RSI'
);

code = code.replace(
  '// Support/Resistance SMA RSI',
  '// Support/Resistance SMA RSI\n       if (activeStrategies.srRsi) {'
);
code = code.replace(
  '// MAEE / MBEE Strategies',
  '}\n       // MAEE / MBEE Strategies'
);

code = code.replace(
  '// MAEE / MBEE Strategies',
  '// MAEE / MBEE Strategies\n       if (activeStrategies.mbee) {'
);
code = code.replace(
  '// 1. Manage open trade',
  '}\n       // 1. Manage open trade'
);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Patched conditionals');
