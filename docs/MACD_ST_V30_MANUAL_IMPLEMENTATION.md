# NIFTY MACD + Adaptive SuperTrend Strategy Specification (V30/V31)

## 1. Strategy Overview
The **NIFTY MACD + Adaptive SuperTrend Strategy** is a systematic trend-following and momentum system tailored for NIFTY intraday trading. It combines:
1. **MACD (12, 26, 9)** for directional momentum and crossover confirmation.
2. **Adaptive SuperTrend (ATR 10, Multiplier 3)** for volatility-adjusted dynamic support/resistance and trend tracking.
3. **Dynamic Position Sizing & Risk Controls** to limit maximum loss per trade and enforce daily circuit breakers.

---

## 2. Core Mathematical Specifications

### 2.1 MACD Calculation
- **Fast EMA**: $\text{EMA}_{12}(\text{Close})$
- **Slow EMA**: $\text{EMA}_{26}(\text{Close})$
- **MACD Line**: $\text{EMA}_{12} - \text{EMA}_{26}$
- **Signal Line**: $\text{EMA}_9(\text{MACD Line})$
- **Histogram**: $\text{MACD Line} - \text{Signal Line}$

### 2.2 Adaptive SuperTrend Calculation
- **True Range**: $\text{TR} = \max(\text{High} - \text{Low}, |\text{High} - \text{Close}_{\text{prev}}|, |\text{Low} - \text{Close}_{\text{prev}}|)$
- **ATR**: 10-period Average True Range
- **Median Price**: $\text{HL2} = \frac{\text{High} + \text{Low}}{2}$
- **Volatility Scaling**:
  $$\text{Volatility} = \text{StdDev}(\text{Returns}_{20}) \times 100$$
  $$\text{Multiplier}_{\text{adaptive}} = \text{Multiplier}_{\text{base}} \times (1 + \frac{\text{Volatility}}{100})$$
- **Upper Band**: $\text{BasicUB} = \text{HL2} + \text{Multiplier} \times \text{ATR}$
- **Lower Band**: $\text{BasicLB} = \text{HL2} - \text{Multiplier} \times \text{ATR}$
- **Trend State**:
  - `uptrend`: $\text{Close} > \text{FinalLB}$
  - `downtrend`: $\text{Close} \le \text{FinalUB}$

---

## 3. Signal Logic

### 3.1 BUY Signal (Long Entry)
- **SuperTrend Trend**: `uptrend`
- **MACD Condition**: Bullish crossover ($\text{MACD}_{\text{prev}} \le \text{Signal}_{\text{prev}}$ and $\text{MACD} > \text{Signal}$)
- **Histogram**: $\text{Histogram} > 0$
- **Stop Loss**: Set to the SuperTrend `lowerBand`
- **Take Profit (1:2 R:R)**: $\text{Entry} + (\text{Entry} - \text{StopLoss}) \times 2$
- **Position Size**: $\lfloor \frac{\text{AccountBalance} \times 0.02}{|\text{Entry} - \text{StopLoss}|} \rfloor$

### 3.2 SELL Signal (Short Entry)
- **SuperTrend Trend**: `downtrend`
- **MACD Condition**: Bearish crossover ($\text{MACD}_{\text{prev}} \ge \text{Signal}_{\text{prev}}$ and $\text{MACD} < \text{Signal}$)
- **Histogram**: $\text{Histogram} < 0$
- **Stop Loss**: Set to the SuperTrend `upperBand`
- **Take Profit (1:2 R:R)**: $\text{Entry} - (\text{StopLoss} - \text{Entry}) \times 2$
- **Position Size**: $\lfloor \frac{\text{AccountBalance} \times 0.02}{|\text{StopLoss} - \text{Entry}|} \rfloor$

---

## 4. Exit Rules & Risk Safeguards
1. **Target Hit**: Automatically closes when price reaches `takeProfit`.
2. **Stop Loss Hit**: Automatically closes when price hits or crosses `stopLoss`.
3. **Trend Reversal**: Immediately exits if SuperTrend flips direction.
4. **Max Daily Loss**: Trading halts for the day if cumulative loss exceeds 5% of account balance.
5. **Time Window**: Enforces trading strictly within active session hours (09:15 to 15:30 IST).
