import axios from 'axios';
const token = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJDSDQ1ODIiLCJqdGkiOiI2YTNjMGE1ZTU0ZjIyZjBkMzQzYjAwNzciLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgyMzE5NzEwLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTM4NzQ0MDB9.hdLqe8bdkWS0zcc4pASjX8nJSJ_WjwbE_diOwGqHQ8Y";

async function test() {
  const dates = ["2026-07-23", "2026-07-24", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"];
  for (const d of dates) {
      try {
        const res = await axios.get(`https://api.upstox.com/v2/option/chain?instrument_key=NSE_INDEX|Nifty%2050&expiry_date=${d}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.data.data.length > 0) {
            console.log(`Success on ${d}:`, JSON.stringify(res.data.data.slice(0,1), null, 2));
            break;
        }
      } catch (e) {
        // console.error(`Error ${d}:`, e.response ? e.response.status : e.message);
      }
  }
}
test();
