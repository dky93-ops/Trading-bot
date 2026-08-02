import axios from 'axios';
const token = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJDSDQ1ODIiLCJqdGkiOiI2YTNjMGE1ZTU0ZjIyZjBkMzQzYjAwNzciLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgyMzE5NzEwLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTM4NzQ0MDB9.hdLqe8bdkWS0zcc4pASjX8nJSJ_WjwbE_diOwGqHQ8Y";

async function test() {
  const d = "2026-07-30";
  try {
    const res = await axios.get(`https://api.upstox.com/v2/option/chain?instrument_key=NSE_INDEX|Nifty%2050&expiry_date=${d}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error(`Error:`, e.response ? e.response.data : e.message);
  }
}
test();
