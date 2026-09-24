const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// The faulty injected lines:
code = code.replace(/       }\n       \/\/ II pattern setup/g, '       // II pattern setup');
code = code.replace(/\/\/ II pattern setup\n       if \(activeStrategies\.alBrooks\) \{/g, '// II pattern setup');

code = code.replace(/       }\n       \/\/ Pin Bars/g, '       // Pin Bars');
code = code.replace(/\/\/ Pin Bars\n       if \(activeStrategies\.alBrooks\) \{/g, '// Pin Bars');

code = code.replace(/       }\n       \/\/ Engulfing/g, '       // Engulfing');
code = code.replace(/\/\/ Engulfing\n       if \(activeStrategies\.alBrooks\) \{/g, '// Engulfing');

code = code.replace(/       }\n       \/\/ Hammer \/ Shooting Star/g, '       // Hammer / Shooting Star');
code = code.replace(/\/\/ Hammer \/ Shooting Star\n       if \(activeStrategies\.candlesticks\) \{/g, '// Hammer / Shooting Star');

code = code.replace(/       }\n       \/\/ Doji Sandwich/g, '       // Doji Sandwich');
code = code.replace(/\/\/ Doji Sandwich\n       if \(activeStrategies\.alBrooks\) \{/g, '// Doji Sandwich');

code = code.replace(/       }\n       \/\/ Upthrust \/ Downthrust/g, '       // Upthrust / Downthrust');
code = code.replace(/\/\/ Upthrust \/ Downthrust\n       if \(activeStrategies\.alBrooks\) \{/g, '// Upthrust / Downthrust');

code = code.replace(/       }\n       \/\/ Scalping PA/g, '       // Scalping PA');
code = code.replace(/\/\/ Scalping PA\n       if \(activeStrategies\.scalping\) \{/g, '// Scalping PA');

code = code.replace(/       }\n       \/\/ Support\/Resistance SMA RSI/g, '       // Support/Resistance SMA RSI');
code = code.replace(/\/\/ Support\/Resistance SMA RSI\n       if \(activeStrategies\.srRsi\) \{/g, '// Support/Resistance SMA RSI');

code = code.replace(/       }\n       \/\/ MAEE \/ MBEE Strategies/g, '       // MAEE / MBEE Strategies');
code = code.replace(/\/\/ MAEE \/ MBEE Strategies\n       if \(activeStrategies\.mbee\) \{/g, '// MAEE / MBEE Strategies');

code = code.replace(/       }\n       \/\/ 1\. Manage open trade/g, '       // 1. Manage open trade');

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Cleaned up bad conditionals');
