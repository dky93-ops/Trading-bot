const fs = require('fs');
let code = fs.readFileSync('src/components/OptionChainReplay.tsx', 'utf8');

code = code.replace(
`  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/option-chain/history');
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.snapshots)) {
        setHistory(data.snapshots);
        if (data.snapshots.length > 0 && !selectedSnap) {
          setSelectedSnap(data.snapshots[data.snapshots.length - 1]);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch option chain history:', err);
    } finally {
      setLoading(false);
    }
  };`,
`  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/option-chain/history');
      if (!res.ok) return;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.snapshots)) {
          setHistory(data.snapshots);
          if (data.snapshots.length > 0 && !selectedSnap) {
            setSelectedSnap(data.snapshots[data.snapshots.length - 1]);
          }
        }
      }
    } catch (err: any) {
      // Ignore network errors gracefully without crashing the UI
    } finally {
      setLoading(false);
    }
  };`
);

fs.writeFileSync('src/components/OptionChainReplay.tsx', code);
