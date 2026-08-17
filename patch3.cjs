const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
`    const fetchExpiries = async () => {
      try {
        const res = await fetch(\`/api/expirys?instrument=\${encodeURIComponent(instrument)}\`);
        const json = await res.json();
        if (json.expirys && json.expirys.length > 0) {
          setExpirys(json.expirys);
          setExpiry(json.expirys[0]);
        }
      } catch (e) {
        console.error("Error fetching expiries:", e);
      }
    };`,
`    const fetchExpiries = async () => {
      try {
        const res = await fetch(\`/api/expirys?instrument=\${encodeURIComponent(instrument)}\`);
        if (!res.ok) return;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          const json = await res.json();
          if (json.expirys && json.expirys.length > 0) {
            setExpirys(json.expirys);
            setExpiry(json.expirys[0]);
          }
        }
      } catch (e) {
        // Ignore network errors smoothly
      }
    };`
);

code = code.replace(
`  const fetchMarketNews = async () => {
    setNewsLoading(true);
    try {
      const res = await fetch('/api/market-news');
      const json = await res.json();
      if (json.news) {
        setNewsList(json.news);
      }
    } catch (e) {
      console.error("News fetch error", e);
    }
    setNewsLoading(false);
  };`,
`  const fetchMarketNews = async () => {
    setNewsLoading(true);
    try {
      const res = await fetch('/api/market-news');
      if (!res.ok) return;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const json = await res.json();
        if (json.news) {
          setNewsList(json.news);
        }
      }
    } catch (e) {
      // Ignore network errors smoothly
    } finally {
      setNewsLoading(false);
    }
  };`
);

fs.writeFileSync('src/App.tsx', code);
