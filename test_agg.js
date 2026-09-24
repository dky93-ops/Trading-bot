const raw = [
  '2026-09-02T10:00:00.000Z',
  '2026-09-02T09:59:00.000Z',
  '2026-09-02T09:58:00.000Z',
  '2026-09-02T09:57:00.000Z',
  '2026-09-02T09:56:00.000Z',
  '2026-09-02T09:55:00.000Z',
  '2026-09-02T09:54:00.000Z',
  '2026-09-02T09:53:00.000Z',
  '2026-09-02T09:52:00.000Z',
  '2026-09-02T09:51:00.000Z',
  '2026-09-02T09:50:00.000Z',
  '2026-09-02T09:49:00.000Z'
];
const periodMs = 5 * 60 * 1000;
for (const t of raw) {
  const ts = new Date(t).getTime();
  const boundary = Math.floor((ts + 19800000) / periodMs) * periodMs - 19800000;
  console.log(t, '->', new Date(boundary).toISOString());
}
