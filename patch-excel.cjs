const fs = require('fs');

let serverFile = fs.readFileSync('server.ts', 'utf8');

const excelRoute = `
  app.get("/api/option-chain/export-excel", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      if (history.length === 0) {
        return res.status(404).send("No history available to export.");
      }
      
      const xlsx = require("xlsx");
      const workbook = xlsx.utils.book_new();
      
      // We will create a worksheet for the summary and another for the raw data
      const summaryData = history.map(snap => ({
        Time: new Date(snap.timestamp).toLocaleString(),
        SpotPrice: snap.spotPrice,
        TotalCallOI: snap.totalCallOI,
        TotalPutOI: snap.totalPutOI,
        PCR: snap.pcr,
        MaxCallOIStrike: snap.maxCallOIStrike,
        MaxPutOIStrike: snap.maxPutOIStrike,
        ATMStrike: snap.atmStrike
      }));
      
      const summarySheet = xlsx.utils.json_to_sheet(summaryData);
      xlsx.utils.book_append_sheet(workbook, summarySheet, "Summary");
      
      // Let's create a detailed sheet for the ATM rows or all rows (all rows might be too big, maybe just ATM +- 5)
      const detailedData = [];
      history.forEach(snap => {
        const timeStr = new Date(snap.timestamp).toLocaleString();
        if (snap.enhancedRows && Array.isArray(snap.enhancedRows)) {
            snap.enhancedRows.forEach(row => {
               // Only include rows near ATM for excel, otherwise it gets too huge
               if (Math.abs(row.strike - snap.spotPrice) <= 500) {
                   detailedData.push({
                     Time: timeStr,
                     Spot: snap.spotPrice,
                     Strike: row.strike,
                     CE_LTP: row.ce?.ltp || 0,
                     CE_OI: row.ce?.totalOi || 0,
                     PE_LTP: row.pe?.ltp || 0,
                     PE_OI: row.pe?.totalOi || 0,
                     CE_Delta: row.ce?.delta || 0,
                     PE_Delta: row.pe?.delta || 0
                   });
               }
            });
        }
      });
      
      const detailSheet = xlsx.utils.json_to_sheet(detailedData);
      xlsx.utils.book_append_sheet(workbook, detailSheet, "Detailed (ATM +- 500)");
      
      const filename = \`option_chain_replay_\${new Date().toISOString().slice(0, 10)}.xlsx\`;
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', \`attachment; filename="\${filename}"\`);
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
`;

if (!serverFile.includes('/api/option-chain/export-excel')) {
  serverFile = serverFile.replace(
    /app\.get\("\/api\/option-chain\/export",\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\);/, 
    "$&" + excelRoute
  );
  fs.writeFileSync('server.ts', serverFile);
  console.log("Excel route added");
}
