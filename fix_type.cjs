const fs = require('fs');

let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const regex = /export type FetchOptionDataFn = \(instrumentKey: string\) => Promise<any>;/;
const replacement = "export type FetchOptionDataFn = (index: string, type: 'CE'|'PE', spotPrice: number, strikeOffset?: number) => Promise<any>;";

code = code.replace(regex, replacement);
fs.writeFileSync('src/backend/strategy-engine.ts', code);
console.log('Fixed FetchOptionDataFn');
