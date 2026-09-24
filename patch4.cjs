const fs = require('fs');
let code = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

code = code.replace(
  '        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}',
  `        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}`
);

// Actually, I can see there's a stray `</div>` at line 868 and missing one at the top.
// Let's just do a string replacement for the unbalanced tags.

let target = `      <div className="flex-1 relative min-h-0 min-h-[400px]">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>

      </div>`;
let replacement = `      <div className="flex-1 relative min-h-0 min-h-[400px]">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 bg-[#111827]/80 backdrop-blur-sm">Analyzing Price Action...</div>}
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>
      </div>`;

code = code.replace(target, replacement);

fs.writeFileSync('src/components/LiveChart.tsx', code);
console.log('Fixed');
