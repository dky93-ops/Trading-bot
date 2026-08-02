const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  `{ id: 'settings', label: 'Configure 5 Strategies' },`,
  `{ id: 'settings', label: 'Configure 8 Strategies' },`
);

content = content.replace(
  /const strategyDetails: Record<string, any> = \{[\s\S]*?\};\s*const detail = strategyDetails\[key\]/,
  `const strategyDetails: Record<string, any> = {
                    'oiDivergence': { name: '1. Option Chain OI Divergence & Unwinding', desc: 'Triggers when Call or Put writers panic-unwind (-Change in OI) near key round strikes, sparking explosive gamma breakouts.', rr: '1:3 to 1:5', win: 'Post 12:30 PM IST' },
                    'straddle130': { name: '2. 1:30 PM Expiry Day "Hero or Zero"', desc: 'Exploits gamma expansion on expiry day by buying OTM/ATM straddles when theta decay is maximized.', rr: '1:4+', win: '1:15 - 1:30 PM IST' },
                    'bbSqueeze': { name: '3. Bollinger Band Squeeze + VIX', desc: 'Captures volatility expansion by waiting for extreme BB squeeze and an uptick in India VIX from historical lows.', rr: '1:3', win: 'Any (Low VIX)' },
                    'orb': { name: '4. Opening Range Breakout (ORB)', desc: 'Trades the 15-minute opening range breakout confirmed by VWAP and Volume Delta for morning momentum.', rr: '1:2.5', win: '9:15 - 10:15 AM' },
                    'adx9Ema': { name: '5. ADX-Filtered 9 EMA Trend Rider', desc: 'High-frequency scalping along the 9 EMA, filtered strictly by ADX > 25 to avoid sideways chop.', rr: '1:2', win: 'Any (ADX > 25)' },
                    'vwapBounce': { name: '6. VWAP Bounce / Rejection', desc: ' Institutional accumulation zone. Trades Hammer or Shooting Star patterns directly on the VWAP line for tight stop losses.', rr: '1:3', win: 'Any' },
                    'insideBar': { name: '7. Inside Bar Breakout', desc: '15-min Mother-Baby candle pattern. Entering on breakout of mother candle for rapid momentum spikes.', rr: '1:2.5', win: 'Any' },
                    'gammaScalping': { name: '8. 2:00 PM Zero-to-Hero (Expiry)', desc: 'Expiry day gamma scalping buying slightly OTM options after 2:00 PM when premiums are cheapest but delta changes fastest.', rr: '1:5+', win: '2:00 - 3:00 PM (Wed/Thu)' }
                  };
                  
                  const detail = strategyDetails[key]`
);

fs.writeFileSync('src/App.tsx', content);
