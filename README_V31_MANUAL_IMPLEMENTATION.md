# V31 Manual Implementation Guide: NIFTY MACD + Adaptive SuperTrend

This release implements and verifies the complete **NIFTY MACD + Adaptive SuperTrend** trading system across both backend execution and frontend visualization.

---

## 1. Components Overview

| File Path | Description |
|---|---|
| `src/backend/nifty-macd-adaptive-supertrend.ts` | Complete TypeScript strategy class with universal EventEmitter (browser + Node safe) |
| `src/backend/nifty-macd-adaptive-supertrend-v31.ts` | V31 re-export module for external callers and test runners |
| `strategies/nifty-macd-adaptive-supertrend.js` | CommonJS standalone script for scripting and CLI execution |
| `src/backend/strategy-engine.ts` | Isolated strategy dispatch under family `MACD_ADAPTIVE_SUPERTREND` with independent exit/trailing rules |
| `src/backend/types.ts` | Extended types with `MACD_ADAPTIVE_SUPERTREND` in `EngineDecision` and `AppSettings` |
| `src/db/market.ts` | Added `ensureNifty5mCandles` to support direct Upstox 5-minute historical candles with volume |
| `server.ts` | `/api/candles` endpoint enhanced to deliver direct 5m candles for NIFTY |
| `src/components/LiveChart.tsx` | Chart toolbar toggle `MACD + ST` with markers (`MACD+ST L` / `MACD+ST S`) and trade logs |
| `tests/nifty-macd-adaptive-supertrend.test.ts` | Core test suite (11 unit tests) |
| `tests/nifty-macd-adaptive-supertrend-v31.test.ts` | V31 test suite (6 unit tests) |
| `verify_macd_st_v31.sh` | Automated verification script (type check, test run, production build) |
| `docs/MACD_ST_V30_MANUAL_IMPLEMENTATION.md` | Full mathematical specification and rules document |

---

## 2. Upstox Direct 5-Minute Candles Integration

- **Endpoint**: Upstox v3/v2 historical intraday 5-minute endpoint:
  - `https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/5`
  - Fallback: `https://api.upstox.com/v2/historical-candle/NSE_INDEX%7CNifty%2050/5minute/{to}/{from}`
- **Volume Extraction**: Queries active NIFTY future contract (`NSE_FO|...`) 5-minute candles to retrieve genuine institutional trading volume.
- **Database Seeding**: Stored in SQLite under `instrument = 'NIFTY'` and `timeframe = 5`.
- **Server Delivery**: `server.ts` directly serves pre-aggregated or Upstox 5-minute candles to reduce latency and ensure candle fidelity.

---

## 3. Strategy Engine Isolation

- **Independent Family**: Tagged as `MACD_ADAPTIVE_SUPERTREND`.
- **Zero Interference**: Evaluated prior to global pre-checks, never blocks or gets blocked by `COMBO_FILTERED`, `COMBO_UNFILTERED`, or OI wall rules.
- **Dedicated Exits**: Monitored on every tick/candle for MACD or Adaptive SuperTrend trend reversal, target hit (1:2 R:R), or stop loss breach.
- **One Trade at a Time**: Enforces isolated single-position exposure without affecting other strategies.

---

## 4. Verification

Run the verification script to validate all components:
```bash
./verify_macd_st_v31.sh
```
Or run the tests directly:
```bash
npm run test
npx tsc --noEmit
npm run build
```
