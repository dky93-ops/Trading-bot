const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
console.log(code.substring(500, 530));
