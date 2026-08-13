const fs = require('fs');

let types = fs.readFileSync('src/backend/types.ts', 'utf8');
const addProps = `
  premiumBreakOpen?: number;
  premiumBreakHigh?: number;
  premiumBreakLow?: number;
  premiumBreakClose?: number;
  premiumRetestOpen?: number;
  premiumRetestHigh?: number;
  premiumRetestLow?: number;
  premiumRetestClose?: number;
  premiumPauseHigh?: number;
  premiumPauseClose?: number;
  premiumConfirmationOpen?: number;
  oppositePremiumExpansionPercent?: number;
  selectedSpreadPercent?: number;
`;

types = types.replace(/export interface ProposedSetup \{/, "export interface ProposedSetup {" + addProps);
fs.writeFileSync('src/backend/types.ts', types);
console.log('PATCH 2 types complete');
