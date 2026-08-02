const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('https://api.upstox.com/v2/option/contract?instrument_key=NSE_INDEX|Nifty 50', {
        headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJDSDQ1ODIiLCJqdGkiOiI2YTNjMGE1ZTU0ZjIyZjBkMzQzYjAwNzciLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgyMzE5NzEwLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTM4NzQ0MDB9.hdLqe8bdkWS0zcc4pASjX8nJSJ_WjwbE_diOwGqHQ8Y'
        }
    });
    console.log(res.data);
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
test();
