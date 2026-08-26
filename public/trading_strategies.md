# Upstox Algorithmic Trading Bot - Strategy & Logic Documentation

## 1. Core Architecture & Timeframes
- **Decision Timeframe:** Trades are evaluated on a primary timeframe (default 5-minute candles).
- **Validation Timeframe:** 1-minute candles are used for precise chop-zone detection and structural invalidation.
- **Entry Mechanics:** The bot waits for a **Confirmation Candle (C0)** to close before entering a trade. It does not trade mid-candle to prevent false signals.
- **Operating Hours:** Trades are only taken between 09:15 IST and 15:00 IST. New setups after 15:00 IST are strictly blocked.

## 2. Global Validation Rules (Applies to all strategies)
Before any trade is executed, the setup must pass these strict criteria:
- **Chop Zone Filter:** The range (High - Low) of the last 20 1-minute candles must be at least 40 points. If the market is too compressed, no trades are taken.
- **Confirmation Candle Logic:** A CALL setup strictly requires a Green confirmation candle (Close > Open). A PUT setup strictly requires a Red confirmation candle (Close < Open).
- **Premium Expansion (Options):** The option premium must expand by at least 1% from the retest low to confirm real buying interest, avoiding fake spot movements.
- **Broken Level Reclaim:** If a broken structure level is "reclaimed" (price closes back across it) during the setup formation, the setup is invalidated.

## 3. Trade Strategies

### Strategy A: Opening Trap
**Logic:** Identifies when retail traders are trapped on a breakout of the Opening Range (ORH/ORL), and capitalizes on the sharp reversal.
- **Identification:** Price breaks the Opening Range (C2 Breakout Candle), attempts to hold (C1 Retest Candle), but fails, trapping breakout traders. The C0 Confirmation Candle aggressively reverses back inside the range.
- **Entry:** On the close of C0 (Confirmation Candle) moving in the opposite direction of the initial fake breakout.
- **Target:** The opposite side of the Opening Range.

### Strategy B: Failed Retest
**Logic:** Price breaks a significant level (Previous Day High/Low, or Opening Range), comes back to retest it, and successfully bounces off the level, proving it as new support/resistance.
- **Identification:** 
  1. Breakout Candle (C2) cleanly breaks the level.
  2. Retest Candle(s) (C1) pull back to touch or closely approach the broken level.
  3. Confirmation Candle (C0) bounces off the level and closes in the direction of the original breakout.
- **Entry:** At the close of C0.

### Strategy C: Continuation (Breakout / Breakdown)
**Logic:** High momentum breakouts that do not pull back for a deep retest, but instead consolidate briefly and continue.
- **Identification:** Price breaks a major structural level and remains beyond it without falling back. The premium must not decay significantly during the brief consolidation.
- **Entry:** Triggered when the confirmation candle closes decisively in the breakout direction, ensuring the momentum is intact.

### Strategy D: OI Wall Rejection
**Logic:** Trades reversals at massive Open Interest (OI) concentrations where institutional option sellers are defending their strikes.
- **Identification:** 
  - An "OI Wall" is detected when a strike's Open Interest is at least 1.5x the surrounding average OI.
  - The price must test this wall at least **two distinct times** (Requires 2 test candles) to prove the wall is defended.
- **Entry:** Once the wall holds twice, a C0 confirmation candle closing away from the wall triggers the entry.

## 4. Risk Management & Trade Management

### Stop Loss (SL)
- **Structural Spot SL:** Placed slightly beyond the invalidation level (e.g., just below the broken support line), utilizing a dynamic buffer (default 10 points).
- **Option Premium Max SL:** Hard-capped at a maximum of 35% loss of the option premium to protect against black swan spikes, but generally the structural SL triggers first.

### Targets (Dynamic Risk-to-Reward)
Targets are dynamically calculated based on the actual physical distance between the Entry Spot and the Structural Invalidation Level (Risk).
- **Spot Target:** Calculated at exactly 1:2 R:R (Risk x 2). 
- **Option Target 1:** Calculated to map to a standard 1:1 Option Premium R:R based on the delta.
- **Option Target 2:** 1.5x of the Option Risk.

### Trailing Stop Loss Mechanics
1. **Activation:** Once Option Target 1 is hit, the trailing stop loss is activated.
2. **Breakeven:** The option stop loss is instantly moved to the breakeven Entry Price.
3. **Dynamic Trail:** As the option premium continues to make new highs, the stop loss dynamically trails at 50% of the maximum risk distance behind the peak price, locking in profits while giving the trade room to run.
