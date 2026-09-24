const fs = require('fs');

let uiFile = fs.readFileSync('src/components/OptionChainReplay.tsx', 'utf8');

const exportExcelBtn = `
            <button
              onClick={() => window.open('/api/option-chain/export-excel', '_blank')}
              disabled={history.length === 0}
              className="flex items-center space-x-1.5 px-4 py-2 rounded bg-brand-blue hover:bg-blue-400 text-black text-xs font-extrabold transition-all shadow-[0_0_12px_rgba(59,130,246,0.3)] disabled:opacity-50 cursor-pointer"
            >
              <Download size={14} />
              <span>Export Excel</span>
            </button>
`;

if (!uiFile.includes('export-excel')) {
  uiFile = uiFile.replace(
    /(\s*)<button[^>]*onClick=\{handleExport\}[^>]*>[\s\S]*?<\/button>/,
    "$&" + exportExcelBtn
  );
  fs.writeFileSync('src/components/OptionChainReplay.tsx', uiFile);
  console.log("Excel UI added");
}
