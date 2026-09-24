const fs = require('fs');

let serverFile = fs.readFileSync('server.ts', 'utf8');

const signalsExcelRoute = `
  app.get("/api/signals/export-excel", async (req, res) => {
    try {
      const state = upstoxService.getState();
      const settings = upstoxService.getPublicSettings();
      
      if (!state.signals || state.signals.length === 0) {
        return res.status(404).send("No execution signals available to export.");
      }
      
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();
      
      const data = state.signals.map((sig) => {
        const stratKey = (sig.strategy_family || sig.strategy || '').toLowerCase();
        const lots = settings?.strategies?.[stratKey]?.lotSize || 1;
        const qty = 75 * lots;
        
        let tradePnL = 0;
        if (sig.status === 'CLOSED') {
          tradePnL = sig.realizedPnL !== undefined ? sig.realizedPnL : ((sig.exitPrice || sig.latestPrice || sig.entryPrice) - sig.entryPrice) * qty;
        } else {
          const curP = sig.latestPrice || sig.entryPrice;
          tradePnL = (curP - sig.entryPrice) * qty;
        }
        
        const formatTimestamp = (ts) => {
          if (!ts) return '-';
          if (typeof ts === 'number') return new Date(ts).toLocaleString();
          const d = new Date(ts);
          if (!isNaN(d.getTime())) return d.toLocaleString();
          return String(ts);
        };
        
        return {
          "Timestamp": formatTimestamp(sig.timestamp || sig.entryTime),
          "Status": sig.status || 'ACTIVE',
          "Signal": sig.signal,
          "Strategy Family": sig.strategy_family || sig.strategy,
          "Spot": sig.spot || sig.entryPrice,
          "Broken Level": sig.broken_level || '-',
          "CE Wall": sig.wall_above || '-',
          "PE Wall": sig.wall_below || '-',
          "Strike": sig.strike ? \`\${sig.strike} \${sig.option_type}\` : sig.contract,
          "Entry Price": sig.entry || sig.entryPrice,
          "Current/Exit Price": sig.status === 'CLOSED' ? (sig.exitPrice !== undefined ? sig.exitPrice : (sig.latestPrice || sig.entryPrice)) : (sig.latestPrice || sig.entryPrice),
          "P&L (₹)": tradePnL,
          "Stoploss": sig.stoploss || sig.stopLoss,
          "Target 1": sig.target1 || sig.target,
          "Target 2": sig.target2 || '-',
          "Confidence (%)": sig.confidence || '-',
          "Reasons & Filters": sig.reason && Array.isArray(sig.reason) ? sig.reason.join(' | ') : '-'
        };
      });
      
      const sheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, sheet, "Execution Signals");
      
      const filename = \`execution_signals_log_\${new Date().toISOString().slice(0, 10)}.xlsx\`;
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', \`attachment; filename="\${filename}"\`);
      res.send(buffer);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
`;

if (!serverFile.includes('/api/signals/export-excel')) {
  // insert it before the /api/option-chain/export-excel route
  serverFile = serverFile.replace(
    /app\.get\("\/api\/option-chain\/export-excel",/,
    signalsExcelRoute + "\n  app.get(\"/api/option-chain/export-excel\","
  );
  fs.writeFileSync('server.ts', serverFile);
  console.log("Signals Excel route added");
}
