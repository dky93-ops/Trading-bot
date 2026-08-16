export type StrategyName =
  | 'OPENING_TRAP'
  | 'FAILED_RETEST'
  | 'CONTINUATION_BREAKDOWN'
  | 'CONTINUATION_BREAKOUT'
  | 'OI_WALL_REJECTION';

export type RequirementStatus =
  | 'IMPLEMENTED'
  | 'ASSUMPTION'
  | 'MISSING'
  | 'TESTED';

export interface StrategyRequirement {
  id: string;
  strategy: StrategyName;
  description: string;
  status: RequirementStatus;
  testName: string;
  source: string;
}

export const STRATEGY_REQUIREMENTS: StrategyRequirement[] = [
  {
    id: 'OT-01',
    strategy: 'OPENING_TRAP',
    description: 'Opening range must be complete before evaluation.',
    status: 'IMPLEMENTED',
    testName: 'opening range completion',
    source: 'strategy-engine.ts/checkOpeningTrap',
  },
  {
    id: 'OT-02',
    strategy: 'OPENING_TRAP',
    description: 'Break, retest, and confirmation must occur in order.',
    status: 'TESTED',
    testName: 'opening trap sequence',
    source: 'strategy-engine.ts/checkOpeningTrap',
  },
  {
    id: 'FR-01',
    strategy: 'FAILED_RETEST',
    description: 'Breakout must be followed by a valid retest within four candles.',
    status: 'IMPLEMENTED',
    testName: 'failed retest timing',
    source: 'validation-rules.ts/rule11RetestQuality',
  },
  {
    id: 'FR-02',
    strategy: 'FAILED_RETEST',
    description: 'Confirmation premium must expand at least one percent from retest low.',
    status: 'IMPLEMENTED',
    testName: 'failed retest premium confirmation',
    source: 'validation-rules.ts/rule13PremiumConfirmation',
  },
  {
    id: 'CB-01',
    strategy: 'CONTINUATION_BREAKOUT',
    description: 'Price must remain beyond the broken structure level.',
    status: 'IMPLEMENTED',
    testName: 'continuation breakout hold',
    source: 'strategy-engine.ts/checkContinuation',
  },
  {
    id: 'CD-01',
    strategy: 'CONTINUATION_BREAKDOWN',
    description: 'Price must remain below the broken structure level.',
    status: 'IMPLEMENTED',
    testName: 'continuation breakdown hold',
    source: 'strategy-engine.ts/checkContinuation',
  },
  {
    id: 'OI-01',
    strategy: 'OI_WALL_REJECTION',
    description: 'Wall OI must be at least 1.5 times surrounding average OI.',
    status: 'IMPLEMENTED',
    testName: 'dominant OI wall',
    source: 'validation-rules.ts/rule8DominantOIWall',
  },
  {
    id: 'OI-02',
    strategy: 'OI_WALL_REJECTION',
    description: 'Wall must have two distinct completed-candle reactions.',
    status: 'TESTED',
    testName: 'distinct wall tests',
    source: 'strategy-engine.ts/recordWallTests',
  },
  {
    id: 'GLOBAL-01',
    strategy: 'OPENING_TRAP',
    description: 'All strategies require valid completed candles and synchronized option data.',
    status: 'IMPLEMENTED',
    testName: 'global feed validation',
    source: 'validation-rules.ts/runGlobalPreChecks',
  },
];

export function getRequirementsForStrategy(
  strategy: StrategyName,
): StrategyRequirement[] {
  return STRATEGY_REQUIREMENTS.filter(
    (requirement) => requirement.strategy === strategy,
  );
}

export function hasUnresolvedRequirements(
  strategy: StrategyName,
): boolean {
  return getRequirementsForStrategy(strategy).some(
    (requirement) =>
      requirement.status === 'MISSING' ||
      requirement.status === 'ASSUMPTION',
  );
}
