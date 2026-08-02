const fs = require('fs');
let content = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

content = content.replace(
  `c => c.timestamp >= today.getTime()`,
  `c => new Date(c.timestamp).getTime() >= today.getTime()`
);

content = content.replace(
  `c => c.timestamp >= today.getTime()`, // second occurrence
  `c => new Date(c.timestamp).getTime() >= today.getTime()`
);

content = content.replace(
  `this.state.signals.some(s => s.strategy === strategy && s.index === index && s.timestamp > today)`,
  `this.state.signals.some(s => s.strategy === strategy && s.index === index && new Date(s.timestamp).getTime() > today)`
);

fs.writeFileSync('src/backend/strategy-engine.ts', content);

let typesContent = fs.readFileSync('src/backend/types.ts', 'utf8');
typesContent = typesContent.replace(/timestamp: number;/g, 'timestamp: any;');
fs.writeFileSync('src/backend/types.ts', typesContent);
