// GET /api/stats?days=7|30|90|0 — the admin dashboard's numbers (0 = all time).
// The dashboard reaches it as /admin/stats (a rewrite in vercel.json), so the
// browser sends the /admin login with it; middleware.js gates both paths, and
// the handler checks the same credentials again.
import { getDb, getStats, isAdmin, RANGES } from './_lib/analytics.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function GET(request) {
  if (!(await isAdmin(request.headers))) return json({ error: 'unauthorized' }, 401);
  const query = getDb();
  if (!query) return json({ error: 'no-database' }, 503);

  let days = parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  if (!RANGES.includes(days)) days = 30;
  try {
    return json(await getStats(query, days));
  } catch {
    return json({ error: 'query-failed' }, 500);
  }
}
