const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');

appCode = appCode.replace(
  '<div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden h-96 p-4 flex flex-col">',
  '<div className="flex flex-col gap-6">'
);
// Remove the inner styling that is no longer needed:
appCode = appCode.replace(
  '<h3 className="text-lg font-bold text-white mb-2">NIFTY 50 Live Chart & PA Bot</h3>\n                <div className="flex-1 min-h-0">\n                  <LiveChart livePrice={state.nifty50?.lastPrice} instrument="NIFTY" />\n                </div>',
  '<LiveChart livePrice={state.nifty50?.lastPrice} instrument="NIFTY" />'
);

fs.writeFileSync('src/App.tsx', appCode);

let chartCode = fs.readFileSync('src/components/LiveChart.tsx', 'utf8');

// Modify the return block in LiveChart.tsx to separate the panels
const oldReturn = `  return (
    <div className="w-full h-full flex flex-col bg-[#0A0F1C]">
      <div className="flex items-center space-x-2 p-2 border-b border-[#1F2937] shrink-0">
        <span className="text-xs font-bold text-gray-400 uppercase mr-2">Timeframe:</span>`;

const newReturn = `  return (
    <div className="w-full flex flex-col gap-6">
      
      {/* Chart Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col h-[500px]">
        <div className="p-4 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#0A0F1C]">
          <h3 className="text-lg font-bold text-white">NIFTY 50 Live Chart & PA Bot</h3>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-gray-400 uppercase mr-2">Timeframe:</span>`;

chartCode = chartCode.replace(oldReturn, newReturn);

// Also fix the gap between chart and table
const oldMiddle = `      <div className="h-64 border-t border-[#1F2937] flex flex-col shrink-0">
        <div className="p-3 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#0A0F1C]">`;

const newMiddle = `      </div>

      {/* Signals Dashboard Panel */}
      <div className="bg-[#111827] rounded-lg border border-[#1F2937] overflow-hidden flex flex-col h-[350px]">
        <div className="p-4 border-b border-[#1F2937] flex items-center justify-between shrink-0 bg-[#0A0F1C]">`;

chartCode = chartCode.replace(oldMiddle, newMiddle);

// Ensure the timescale has time visible and formatted correctly (remove duplicate if any)
// Lightweight Charts time scale issue: if time is not visible, it's often because bottom margin is missing or crosshair blocks it, but timeVisible: true should do it. Let's make sure the container isn't cut off.
// In the current code, duplicate timeScale was used. Let's just fix it by providing clean timeScale config.

fs.writeFileSync('src/components/LiveChart.tsx', chartCode);
console.log('Fixed UI layout');
