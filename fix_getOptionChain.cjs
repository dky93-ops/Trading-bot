const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const chain = await this\.getOptionChain\(index\);/;
const replacement = `let expiry = '';
         if (this.getNearestExpiry) expiry = await this.getNearestExpiry(index);
         const chain = await this.getOptionChain(index, expiry);`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed getOptionChain call');
