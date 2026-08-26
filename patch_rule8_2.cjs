const fs = require('fs');
let code = fs.readFileSync('src/backend/validation-rules.ts', 'utf-8');

code = code.replace(
  "const now = Date.now();",
  "const nowStr = ctx.candles1m && ctx.candles1m.length > 0 ? ctx.candles1m[ctx.candles1m.length - 1].timestamp : Date.now();\n    const now = typeof nowStr === 'string' ? new Date(nowStr).getTime() : (typeof nowStr === 'number' ? nowStr : Date.now());"
);

fs.writeFileSync('src/backend/validation-rules.ts', code);
