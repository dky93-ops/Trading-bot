const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

let depth = 0;
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    if (line[j] === '{') depth++;
    if (line[j] === '}') depth--;
  }
  if (depth < 0) {
    console.log(`Unbalanced closing brace at line ${i + 1}`);
    depth = 0;
  }
  if (i === 657) {
    console.log(`Depth at line 658 is ${depth}`);
  }
}
console.log(`Final depth: ${depth}`);
