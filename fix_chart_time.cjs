const fs = require('fs');

let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

const badTimeScale = `      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      localization: {
        timeFormatter: (timeValue: any) => {
          if (typeof timeValue === 'number') {
            const date = new Date(timeValue * 1000);
            return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
          }
          return timeValue;
        }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (timeValue: any) => {
          const date = new Date(timeValue * 1000);
          return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
        }
      }`;

const goodTimeScale = `      localization: {
        timeFormatter: (timeValue: any) => {
          if (typeof timeValue === 'number') {
            const date = new Date(timeValue * 1000);
            return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
          }
          return timeValue;
        }
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (timeValue: any) => {
          const date = new Date(timeValue * 1000);
          return date.toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
        }
      }`;

code = code.replace(badTimeScale, goodTimeScale);

// Fix the unclosed div or weird layout if any:
const oldHeader = `<div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-gray-400 uppercase mr-2">Timeframe:</span>
        {[
          { label: '1m', value: 1 },
          { label: '3m', value: 3 },
          { label: '5m', value: 5 },
          { label: '15m', value: 15 },
          { label: '1H', value: 60 }
        ].map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={\`px-3 py-1 rounded text-xs font-bold transition-colors \${timeframe === tf.value ? 'bg-brand-blue text-black' : 'bg-[#1F2937] text-gray-400 hover:text-white'}\`}
          >
            {tf.label}
          </button>
        ))}
        <div className="flex-1"></div>
        <div className="flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
        </div>
      </div>`;

const newHeader = `<div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-gray-400 uppercase mr-2">Timeframe:</span>
        {[
          { label: '1m', value: 1 },
          { label: '3m', value: 3 },
          { label: '5m', value: 5 },
          { label: '15m', value: 15 },
          { label: '1H', value: 60 }
        ].map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={\`px-3 py-1 rounded text-xs font-bold transition-colors \${timeframe === tf.value ? 'bg-brand-blue text-black' : 'bg-[#1F2937] text-gray-400 hover:text-white'}\`}
          >
            {tf.label}
          </button>
        ))}
        <div className="mx-4 w-px h-4 bg-[#1F2937]"></div>
        <div className="flex items-center space-x-3 text-[10px] uppercase font-bold text-gray-500">
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-blue"></span><span>Auto Entry</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span><span>Auto SL</span></div>
           <div className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-brand-green"></span><span>Auto Target</span></div>
        </div>
      </div>`;

code = code.replace(oldHeader, newHeader);

// Force resize on mount for chart container so it lays out time correctly
const resizeStr = `    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);`;

const newResizeStr = `    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
    setTimeout(handleResize, 500); // Additional safety resize`;

code = code.replace(resizeStr, newResizeStr);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed time scale visibility issues');
