const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /const currentDateIST = this\.getISTDateKey\(timeObj\);/;
const replacement = `const getISTDateKey = (d: Date | string | number) => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
    };
    const currentDateIST = getISTDateKey(timeObj);`;

code = code.replace(regex, replacement);

const regex2 = /const rows = \[\.\.\.chainRows\]/;
const replacement2 = `let chainRows: any[] = [];
    if (this.getOptionChain) {
      try {
         const chain = await this.getOptionChain(index);
         if (chain && chain.length > 0) chainRows = chain;
      } catch(e) {}
    }
    const rows = [...chainRows]`;

code = code.replace(regex2, replacement2);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed missing chainRows and getISTDateKey');
