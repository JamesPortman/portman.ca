// POST /api/track — records one pageview or visitor action. Cookie-free; see
// api/_lib/analytics.js. Always answers 204 so a beacon never shows an error,
// and anything it doesn't recognise (unknown page or action, bots) is dropped.
import { getDb, parseEvent, isBot, parseUA, visitorHash, geo, insertEvent } from './_lib/analytics.js';

const MAX_BODY = 2048; // a real beacon is ~150 bytes

export async function POST(request) {
  const done = () => new Response(null, { status: 204 });
  const query = getDb();
  if (!query) return done();
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return done();

  let body = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return done();
    body = JSON.parse(text);
  } catch { return done(); }

  const event = parseEvent(body);
  if (!event) return done();
  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return done();

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';
  try {
    await insertEvent(query, {
      ...event,
      ...geo(request.headers),
      ...parseUA(ua),
      visitor: await visitorHash(ip, ua),
    });
  } catch {
    // never break a page over analytics
  }
  return done();
}
