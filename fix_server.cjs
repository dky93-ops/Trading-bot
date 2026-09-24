const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The excelRoute string from earlier
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
      
      const detailedData = [];
      history.forEach(snap => {
        const timeStr = new Date(snap.timestamp).toLocaleString();
        if (snap.enhancedRows && Array.isArray(snap.enhancedRows)) {
            snap.enhancedRows.forEach(row => {
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
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
`;

// Remove the badly injected code.
const regex = /  app\.get\("\/api\/option-chain\/export-excel"[\s\S]*?res\.status\(500\)\.json\(\{ error: e\.message \}\);\s*\}\s*\}\);\s*\}\);\s*`/g;
// Actually, it's easier to find the exact replacement.

// Let's just find the `export` route and replace the whole thing properly.
const badString = `    } catch (e: any) {
      res.status(500).json({ error: e.message });
  app.get("/api/option-chain/export-excel", (req, res) => {`;
  
if (code.includes(badString)) {
   console.log("Found bad string, replacing...");
   
   // It's probably a mess. Let's rebuild the export route block.
   const toReplace = `  app.get("/api/option-chain/export", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      const filename = \`option_chain_replay_\${new Date().toISOString().slice(0, 10)}.json\`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', \`attachment; filename="\${filename}"\`);
      res.send(JSON.stringify(history, null, 2));
    } catch (e: any) {
      res.status(500).json({ error: e.message });`;
      
   const index = code.indexOf(toReplace);
   
   if (index !== -1) {
       // Find the end of the injected excel block
       const nextAppGet = code.indexOf("  app.get(", index + 100);
       // Wait, the next route is "app.get('/api/market-news'" which we can search for
       const endOfExcelIndex = code.indexOf("  // Market News & OI Context API");
       
       if (endOfExcelIndex !== -1) {
           const before = code.substring(0, index);
           const after = code.substring(endOfExcelIndex);
           
           const properCode = `  app.get("/api/option-chain/export", (req, res) => {
    try {
      const history = upstoxService.getOptionChainHistory();
      const filename = \`option_chain_replay_\${new Date().toISOString().slice(0, 10)}.json\`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', \`attachment; filename="\${filename}"\`);
      res.send(JSON.stringify(history, null, 2));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

${excelRoute}

`;
           code = before + properCode + after;
           fs.writeFileSync("server.ts", code);
           console.log("Fixed!");
       }
   }
}

