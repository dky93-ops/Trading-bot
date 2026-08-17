const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
`  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(\`/api/option-chain?instrument=\${encodeURIComponent(instrument)}&expiry=\${encodeURIComponent(expiry)}\`);
      const json = await res.json();
      if (json && json.status === 'success' && Array.isArray(json.data) && json.data.length > 0) {
        setData(json.data);
        setFetchError(null);
      } else {
        if (json && json.message) {
          setFetchError(json.message);
        } else {
          setFetchError("No option chain data returned from Upstox API");
        }
      }
    } catch (e: any) {
      console.error("Error fetching option chain data:", e);
      setFetchError(e.message || "Failed to reach backend option chain API");
    }
    setLoading(false);
  };`,
`  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(\`/api/option-chain?instrument=\${encodeURIComponent(instrument)}&expiry=\${encodeURIComponent(expiry)}\`);
      if (!res.ok) {
        setFetchError(\`Server Error: \${res.status}\`);
        return;
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || contentType.indexOf("application/json") === -1) {
        // Silently ignore non-JSON responses during server restart
        return;
      }
      const json = await res.json();
      if (json && json.status === 'success' && Array.isArray(json.data) && json.data.length > 0) {
        setData(json.data);
        setFetchError(null);
      } else {
        if (json && json.message) {
          setFetchError(json.message);
        } else {
          setFetchError("No option chain data returned from Upstox API");
        }
      }
    } catch (e: any) {
      // Don't crash UI, just show a temporary fetch error
      setFetchError("Connection interrupted (server restarting or offline)");
    } finally {
      setLoading(false);
    }
  };`
);

fs.writeFileSync('src/App.tsx', code);
