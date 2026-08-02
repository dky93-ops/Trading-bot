const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

let stack = [];
for (let i = 0; i < code.length; i++) {
  if (code[i] === '{') stack.push(i);
  else if (code[i] === '}') {
    if (stack.length === 0) { console.log('Extra } at', i); }
    stack.pop();
  }
}
console.log('Unclosed { at:', stack);
