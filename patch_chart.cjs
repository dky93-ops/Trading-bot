const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const importChart = `import { LiveChart } from './components/LiveChart';\n`;
if (!code.includes('LiveChart')) {
  code = code.replace("import { cn } from './lib/utils';", "import { cn } from './lib/utils';\n" + importChart);
}

const target = `
              {/* Performance Matrix */}
              <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">`;

const replacement = `
              {/* Live Candlestick Chart */}
              <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden h-96 p-4 flex flex-col">
                <h3 className="text-lg font-bold text-white mb-4">NIFTY 50 Live Intraday (1m)</h3>
                <div className="flex-1 min-h-0">
                  <LiveChart livePrice={state.nifty50?.lastPrice} instrument="NIFTY" />
                </div>
              </div>

              {/* Performance Matrix */}
              <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden">`;

code = code.replace(target, replacement);

fs.writeFileSync('src/App.tsx', code);
console.log('patched live chart');
