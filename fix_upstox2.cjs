const fs = require('fs');
let code = fs.readFileSync('src/backend/upstox-service.ts', 'utf8');

code = code.replace(/const instrumentKey = index === 'NIFTY' \? 'NSE_INDEX\|Nifty 50' : 'NSE_INDEX\|Nifty Bank';/g, "const instrumentKey = 'NSE_INDEX|Nifty 50';");
code = code.replace(/const strikeStep = index === 'NIFTY' \? 50 : 100;/g, "const strikeStep = 50;");

code = code.replace(/price: optObj\.market_data\?\.ltp \|\| 0,/g, "ltp: optObj.market_data?.ltp || 0,\ntotalOi: optObj.market_data?.oi || 0,\noiChange: optObj.market_data?.oi_change || 0,\nvolume: optObj.market_data?.volume || 0,\niv: optObj.option_greeks?.iv || 0,\ndelta: optObj.option_greeks?.delta || 0,\ntheta: optObj.option_greeks?.theta || 0,\ngamma: optObj.option_greeks?.gamma || 0,\nvega: optObj.option_greeks?.vega || 0,");

code = code.replace(/import \{ AppSettings, AppState, OptionChainSnapshot \} from '\.\/types';/g, "import { AppSettings, AppState, OptionChainSnapshot, TradingSymbol } from './types';");
code = code.replace(/private async fetchOptionData\(index: string,/g, "private async fetchOptionData(index: TradingSymbol,");
code = code.replace(/\|\| index === 'BANKNIFTY'/g, "");

fs.writeFileSync('src/backend/upstox-service.ts', code);
