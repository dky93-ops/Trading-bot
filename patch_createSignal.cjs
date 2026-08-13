const fs = require('fs');
let code = fs.readFileSync('src/backend/strategy-engine.ts', 'utf8');

const createSignalRegex = /private createSignal\(index: string, spot: number, setupType: string, direction: 'CALL' \| 'PUT', chainRows: any\[\], sess: LocalSessionState, passed: string\[\], failed: string\[\]\): InternalSignal \| null \{[\s\S]*?const targets = this\.computeSpotTargets\(direction, spot, spot, chainRows, sess\);\n\s*if \(!targets\) return null;[\s\S]*?const opt = this\.selectStrike\(direction, spot, chainRows\);\n\s*if \(!opt\) \{\n\s*failed\.push\('FAILED_NO_STRIKE'\);\n\s*return null;\n\s*\}/m;

const newCreateSignal = `private createSignal(
  index: string,
  spot: number,
  setupType: string,
  direction: 'CALL' | 'PUT',
  brokenLevel: number,
  chainRows: any[],
  sess: LocalSessionState,
  passed: string[],
  failed: string[],
): InternalSignal | null {
  const targets = this.computeSpotTargets(direction, spot, brokenLevel, chainRows, sess);
  if (!targets) return null;

  const opt = this.selectStrike(direction, spot, chainRows);
  if (!opt) {
    failed.push('FAILED_NO_STRIKE');
    return null;
  }`;

code = code.replace(createSignalRegex, newCreateSignal);

const optionPricingRegex = /const optionEntry = Number\(opt\.price\);\n\s*const optionStoploss = Number\(\(optionEntry \* 0\.65\)\.toFixed\(2\)\);\n\s*const optionTarget1 = Number\(\(optionEntry \* 1\.5\)\.toFixed\(2\)\);\n\s*const optionTarget2 = Number\(\(optionEntry \* 2\.0\)\.toFixed\(2\)\);\n\s*if \(!\(optionEntry > 0\)\) return null;\n\s*const prices = \{\n\s*spotEntry: spot,\n\s*spotInvalidation: targets\.structuralStopSpot,\n\s*spotTarget1: targets\.target1Spot,\n\s*spotTarget2: targets\.target2Spot,\n\s*optionEntry,\n\s*optionStoploss,\n\s*optionTarget1,\n\s*optionTarget2,\n\s*\};/m;

const newOptionPricing = `const optionEntry = Number(opt.price);
const lossPercent = this.settings.MAX_OPTION_LOSS_PERCENT || 35;
const optionStoploss = Number(
  (optionEntry * (1 - lossPercent / 100)).toFixed(2),
);
const optionRisk = optionEntry - optionStoploss;
if (!(optionEntry > 0) || !(optionRisk > 0)) return null;

const prices = {
  spotEntry: spot,
  spotInvalidation: targets.structuralStopSpot,
  spotTarget1: targets.target1Spot,
  spotTarget2: targets.target2Spot,
  optionEntry,
  optionStoploss,
  optionTarget1: Number((optionEntry + optionRisk).toFixed(2)),
  optionTarget2: Number((optionEntry + optionRisk * 1.5).toFixed(2)),
};

const riskSpot = Math.abs(prices.spotEntry - prices.spotInvalidation);
const rewardSpot = Math.abs(prices.spotTarget1 - prices.spotEntry);
if (!(riskSpot > 0) || rewardSpot / riskSpot < 0.8) {
  failed.push('FAILED_ROOM_TO_TARGET: Target 1 is less than 0.8R');
  return null;
}`;

code = code.replace(optionPricingRegex, newOptionPricing);

const signalAssignmentsRegex = /stoploss: targets\.structuralStopSpot,\n\s*target1: targets\.target1Spot,\n\s*target2: targets\.target2Spot,/m;
const newSignalAssignments = `entry: prices.optionEntry,
entryPrice: prices.optionEntry,
stoploss: prices.optionStoploss,
target1: prices.optionTarget1,
target2: prices.optionTarget2,
broken_level: brokenLevel,
optionEntry: prices.optionEntry,
optionStoploss: prices.optionStoploss,
optionTarget1: prices.optionTarget1,
optionTarget2: prices.optionTarget2,`;

code = code.replace(signalAssignmentsRegex, newSignalAssignments);

fs.writeFileSync('src/backend/strategy-engine.ts', code);
