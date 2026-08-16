const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const importStatement = `import { getCandles } from '../db/market';
import {
  normalizeChainRows,
  readHistoricalPremium,
} from './strategy-data';
`;
code = code.replace("import { getCandles } from '../db/market';", importStatement);

const evalIndexRegex = /let chainRows: any\[\] = \[\];\s*if \(this\.getOptionChain\) \{\s*try \{\s*let expiry = '';\s*const upstoxInstrumentKey = index === 'NIFTY' \? 'NSE_INDEX\|Nifty 50' : index;\s*if \(this\.getNearestExpiry\) expiry = await this\.getNearestExpiry\(upstoxInstrumentKey\);\s*const chain = await this\.getOptionChain\(upstoxInstrumentKey, expiry\);\s*if \(chain && chain\.length > 0\) chainRows = chain;\s*\} catch\(e\) \{\}\s*\}/;

const evalIndexReplacement = `let chainRows: any[] = [];

    if (this.getOptionChain) {
      try {
        let expiry = '';
        const upstoxInstrumentKey =
          index === 'NIFTY' ? 'NSE_INDEX|Nifty 50' : index;

        if (this.getNearestExpiry) {
          expiry = await this.getNearestExpiry(upstoxInstrumentKey);
        }

        const chainResponse = await this.getOptionChain(
          upstoxInstrumentKey,
          expiry,
        );

        chainRows = normalizeChainRows(chainResponse);
      } catch (error) {
        failedFilters.push(
          \`FAILED_OPTION_CHAIN: \${
            error instanceof Error ? error.message : String(error)
          }\`,
        );
      }
    }`;

code = code.replace(evalIndexRegex, evalIndexReplacement);

const rowsRegex = /const rows = \[\.\.\.chainRows\]\s*\.filter\(\(r: any\) => Number\.isFinite\(Number\(r\.strike_price\)\)\)\s*\.sort\(\(a: any, b: any\) => Number\(a\.strike_price\) - Number\(b\.strike_price\)\);/;
const rowsReplacement = `const rows = normalizeChainRows(chainRows);

    if (rows.length === 0) {
      return this.createNoTrade(
        index,
        spotPrice,
        'FAILED_OPTION_CHAIN: No usable option-chain rows',
      );
    }`;

code = code.replace(rowsRegex, rowsReplacement);

const getHistRegex = /private getHistoricalPremium\(strike: number, type: 'CE' \| 'PE', timestamp: string\): number \| undefined \{\s*const history = this\.getOptionChainHistory \? this\.getOptionChainHistory\(\) : \[\];\s*if \(!history \|\| history\.length === 0\) return undefined;\s*const ts = new Date\(timestamp\)\.getTime\(\);\s*const recent = history\.filter\(h => \{\s*const hts = new Date\(h\.timeISO \|\| h\.timestamp\)\.getTime\(\);\s*return hts <= ts && ts - hts <= 90000;\s*\}\)\.sort\(\(a,b\) => new Date\(b\.timeISO \|\| b\.timestamp\)\.getTime\(\) - new Date\(a\.timeISO \|\| a\.timestamp\)\.getTime\(\)\);\s*if \(recent\.length === 0\) return undefined;\s*const snap = recent\[0\];\s*if \(!snap\.rows\) return undefined;\s*const row = snap\.rows\.find\(\(r: any\) => r\.strike === strike\);\s*if \(!row\) return undefined;\s*return type === 'CE' \? row\.ce\?.ltp : row\.pe\?.ltp;\s*\}/;

const getHistReplacement = `private getHistoricalPremium(
    strike: number,
    type: 'CE' | 'PE',
    timestamp: string,
  ): number | undefined {
    const history = this.getOptionChainHistory
      ? this.getOptionChainHistory()
      : [];

    return readHistoricalPremium(
      history,
      strike,
      type,
      timestamp,
    );
  }`;

code = code.replace(getHistRegex, getHistReplacement);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
