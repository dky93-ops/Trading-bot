import axios from 'axios';
async function test() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  try {
    const res = await axios.get('https://api.upstox.com/v2/historical-candle/intraday/NSE_INDEX|Nifty%2050/1minute', {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    console.log(res.data.status, res.data.data?.candles?.[0]);
  } catch(e) {
    console.log(e.response?.data || e.message);
  }
}
test();
