# Strategy Requirements

This document tracks all formal strategy requirements and their current status.
A strategy cannot be marked COMPLIANT while it has an ASSUMPTION or MISSING requirement.

## OPENING_TRAP
* **OT-01**: Opening range must be complete before evaluation. (Status: IMPLEMENTED, Test: opening range completion, Source: strategy-engine.ts/checkOpeningTrap)
* **OT-02**: Break, retest, and confirmation must occur in order. (Status: TESTED, Test: opening trap sequence, Source: strategy-engine.ts/checkOpeningTrap)
* **GLOBAL-01**: All strategies require valid completed candles and synchronized option data. (Status: IMPLEMENTED, Test: global feed validation, Source: validation-rules.ts/runGlobalPreChecks)

## FAILED_RETEST
* **FR-01**: Breakout must be followed by a valid retest within four candles. (Status: ASSUMPTION, Test: failed retest timing, Source: validation-rules.ts/rule11RetestQuality)
* **FR-02**: Confirmation premium must expand at least one percent from retest low. (Status: IMPLEMENTED, Test: failed retest premium confirmation, Source: validation-rules.ts/rule13PremiumConfirmation)

## CONTINUATION_BREAKOUT
* **CB-01**: Price must remain beyond the broken structure level. (Status: IMPLEMENTED, Test: continuation breakout hold, Source: strategy-engine.ts/checkContinuation)

## CONTINUATION_BREAKDOWN
* **CD-01**: Price must remain below the broken structure level. (Status: IMPLEMENTED, Test: continuation breakdown hold, Source: strategy-engine.ts/checkContinuation)

## OI_WALL_REJECTION
* **OI-01**: Wall OI must be at least 1.5 times surrounding average OI. (Status: IMPLEMENTED, Test: dominant OI wall, Source: validation-rules.ts/rule8DominantOIWall)
* **OI-02**: Wall must have two distinct completed-candle reactions. (Status: TESTED, Test: distinct wall tests, Source: strategy-engine.ts/recordWallTests)
