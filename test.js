const c = { timestamp: "2026-09-02T13:35:00.000Z" };
const d = new Date(c.timestamp);
const istTime = new Date(d.getTime() + 19800000);
const hh = istTime.getUTCHours();
const mm = istTime.getUTCMinutes();
const timeNum = hh * 100 + mm;
console.log({ d: d.toISOString(), istTime: istTime.toISOString(), hh, mm, timeNum });
