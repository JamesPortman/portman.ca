// Vercel Edge Middleware — HTTP Basic Auth gate for the admin area and stats API.
// Credentials come from environment variables, never the code:
//   ADMIN_USER, ADMIN_PASS
export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

// Constant-time string comparison. The Edge runtime has no node:crypto
// timingSafeEqual, so hash both sides with SHA-256 (fixed 32-byte output, which
// also hides length differences) and XOR every byte of the digests, never
// returning early.
const encoder = new TextEncoder();
async function safeEqual(a, b) {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export default async function middleware(req) {
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
      // Both comparisons always run (no short-circuit on the username).
      const [userOk, passOk] = await Promise.all([safeEqual(u, user), safeEqual(p, pass)]);
      if (i !== -1 && userOk && passOk) {
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
