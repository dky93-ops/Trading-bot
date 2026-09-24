const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newDetailedLogic = `
      // Let's create a detailed sheet for the ATM rows (wider range: ATM +- 2000)
      const detailedData = [];
      history.forEach(snap => {
        const timeStr = new Date(snap.timestamp).toLocaleString();
        if (snap.enhancedRows && Array.isArray(snap.enhancedRows)) {
            snap.enhancedRows.forEach(row => {
               // Expanding range and adding all relevant columns
               if (Math.abs(row.strike - snap.spotPrice) <= 2000) {
                   detailedData.push({
                     Time: timeStr,
                     Spot: snap.spotPrice,
                     Strike: row.strike,
                     
                     // Calls
                     CE_LTP: row.ce?.ltp || 0,
                     CE_Volume: row.ce?.volume || 0,
                     CE_OI: row.ce?.totalOi || 0,
                     CE_OI_Change: row.ce?.oiChange || 0,
                     CE_IV: row.ce?.iv || 0,
                     CE_Delta: row.ce?.delta || 0,
                     CE_Theta: row.ce?.theta || 0,
                     CE_Gamma: row.ce?.gamma || 0,
                     CE_Vega: row.ce?.vega || 0,
                     CE_Bid: row.ce?.bid || 0,
                     CE_Ask: row.ce?.ask || 0,

                     // Puts
                     PE_LTP: row.pe?.ltp || 0,
                     PE_Volume: row.pe?.volume || 0,
                     PE_OI: row.pe?.totalOi || 0,
                     PE_OI_Change: row.pe?.oiChange || 0,
                     PE_IV: row.pe?.iv || 0,
                     PE_Delta: row.pe?.delta || 0,
                     PE_Theta: row.pe?.theta || 0,
                     PE_Gamma: row.pe?.gamma || 0,
                     PE_Vega: row.pe?.vega || 0,
                     PE_Bid: row.pe?.bid || 0,
                     PE_Ask: row.pe?.ask || 0
                   });
               }
            });
        }
      });
      
      const detailSheet = xlsx.utils.json_to_sheet(detailedData);
      xlsx.utils.book_append_sheet(workbook, detailSheet, "Detailed (ATM +- 2000)");
`;

// replace from `const detailedData = [];` down to `xlsx.utils.book_append_sheet(workbook, detailSheet, "Detailed (ATM +- 500)");`

code = code.replace(
  /const detailedData = \[\];[\s\S]*?xlsx\.utils\.book_append_sheet\(workbook, detailSheet, "Detailed \(ATM \+- 500\)"\);/,
  newDetailedLogic.trim()
);

fs.writeFileSync('server.ts', code);
console.log("Updated Excel columns and range.");
