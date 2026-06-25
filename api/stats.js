// Serverless function: reads core traffic metrics from the GA4 Data API and
// returns compact JSON for the /admin dashboard. Protected by middleware.js.
//
// Environment variables required:
//   GA_PROPERTY_ID          — numeric GA4 property id (e.g. 123456789)
//   GA_SERVICE_ACCOUNT_KEY  — the service-account JSON, raw or base64-encoded
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];
const num = (v) => Number(v || 0);

function getAuthClient() {
  const raw = process.env.GA_SERVICE_ACCOUNT_KEY || '';
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const key = JSON.parse(json);
  return new JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
}

async function runReport(token, propertyId, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`GA Data API ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  try {
    const propertyId = process.env.GA_PROPERTY_ID;
    if (!propertyId || !process.env.GA_SERVICE_ACCOUNT_KEY) {
      return res.status(503).json({ error: 'not_configured' });
    }

    const days = Math.min(Math.max(parseInt(req.query?.days ?? '28', 10) || 28, 1), 365);
    const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

    const client = getAuthClient();
    const { token } = await client.getAccessToken();

    const [totals, series, pages, sources, countries, devices] = await Promise.all([
      runReport(token, propertyId, {
        dateRanges,
        metrics: [
          { name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' },
          { name: 'averageSessionDuration' }, { name: 'engagementRate' },
        ],
      }),
      runReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      runReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      runReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
      runReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 10,
      }),
      runReport(token, propertyId, {
        dateRanges,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
    ]);

    const t = totals.rows?.[0]?.metricValues ?? [];
    const payload = {
      days,
      totals: {
        visitors: num(t[0]?.value),
        sessions: num(t[1]?.value),
        pageviews: num(t[2]?.value),
        avgSessionDuration: num(t[3]?.value),
        engagementRate: num(t[4]?.value),
      },
      timeseries: (series.rows ?? []).map((r) => ({
        date: r.dimensionValues[0].value,
        visitors: num(r.metricValues[0].value),
        pageviews: num(r.metricValues[1].value),
      })),
      topPages: (pages.rows ?? []).map((r) => ({
        path: r.dimensionValues[0].value,
        views: num(r.metricValues[0].value),
      })),
      sources: (sources.rows ?? []).map((r) => ({
        source: r.dimensionValues[0].value,
        sessions: num(r.metricValues[0].value),
      })),
      countries: (countries.rows ?? []).map((r) => ({
        country: r.dimensionValues[0].value,
        visitors: num(r.metricValues[0].value),
      })),
      devices: (devices.rows ?? []).map((r) => ({
        category: r.dimensionValues[0].value,
        visitors: num(r.metricValues[0].value),
      })),
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
