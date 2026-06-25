// Vercel Edge Middleware — HTTP Basic Auth gate for the admin area and stats API.
// Credentials come from environment variables, never the code:
//   ADMIN_USER, ADMIN_PASS
export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

export default function middleware(req) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;

  // If credentials aren't configured yet, fail closed (deny) rather than expose data.
  if (!user || !pass) {
    return new Response('Admin login not configured.', { status: 503 });
  }

  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === pass) {
        return; // authorized — continue to the requested route
      }
    } catch (_) {
      // fall through to 401
    }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="portman.ca admin", charset="UTF-8"' },
  });
}
