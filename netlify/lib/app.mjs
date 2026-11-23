// HTTP routing for the TokenFlow API — mirrors the routes of backend/app.py.
import { Problem, mutate, summary, tokenView, publicTicket, get, allowed, analytics, hexId } from './engine.mjs';
import { recommendations, compare } from './insights.mjs';
import { actor, registerUser, authenticate, createAdmin, issue, shareLink, verifyShare } from './auth.mjs';

const MAX_BODY = 16384;
const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
const ok = (data, status = 200) => json({ success: true, data }, status);

const constantTimeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};

/**
 * @param {object} options
 * @param {import('./store.mjs').BlobStore} options.store
 * @param {Record<string,string|undefined>} options.env
 * @param {number} [options.shareTtl]
 */
export function createApp({ store, env, shareTtl = 172800 }) {
  let secretPromise;
  const secret = () => (secretPromise ??= env.SECRET_KEY ? Promise.resolve(env.SECRET_KEY) : store.sessionSecret());
  const simulationEnabled = () => (env.SIMULATION_ENABLED ?? 'true') === 'true';
  const limits = new Map(); // best-effort per-instance POST throttle (120/min/IP), like Flask

  function throttle(ip) {
    const now = Date.now();
    const q = (limits.get(ip) || []).filter((t) => t > now - 60000);
    if (q.length >= 120) throw new Problem('Too many requests; wait a minute', 429);
    q.push(now);
    limits.set(ip, q);
    if (limits.size > 5000) limits.clear();
  }

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, regex, keys, handler });
  };

  async function body(req) {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new Problem('Request body too large', 413);
    let p;
    try { p = JSON.parse(text); } catch { p = null; }
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Problem('A JSON object is required');
    return p;
  }
  const who = async (req) => actor(await secret(), req);
  const requireAdmin = (a) => { if (a.role !== 'admin') throw new Problem('Admin access required', 403); };
  const originOf = (req) => (env.PUBLIC_ORIGIN || env.URL || new URL(req.url).origin).replace(/\/$/, '');

  route('GET', '/api/health', () => ok({ status: 'ok', storage: 'netlify-blobs', demo: true }));

  route('POST', '/api/auth/register', async (req) => {
    const p = await body(req);
    const user = await registerUser(store, p.name, p.email, p.password);
    return ok(issue(await secret(), user), 201);
  });

  route('POST', '/api/auth/login', async (req) => {
    const p = await body(req);
    const role = p.role ?? 'customer';
    if (!['customer', 'admin'].includes(role)) throw new Problem('Unknown account type');
    return ok(issue(await secret(), await authenticate(store, p.email, p.password, role)));
  });

  route('GET', '/api/auth/admin/setup-status', async () => ok({ available: Boolean(env.ADMIN_SETUP_KEY) && !(await store.hasAdmin()) }));

  route('POST', '/api/auth/admin/setup', async (req) => {
    const expected = env.ADMIN_SETUP_KEY || '';
    const p = await body(req);
    if (!expected || !constantTimeEqual(p.setupKey ?? '', expected)) throw new Problem('Enter the ADMIN_SETUP_KEY configured for this site', 403);
    const { user, password } = await createAdmin(store);
    return ok({ email: user.email, password, ...issue(await secret(), user) }, 201);
  });

  route('GET', '/api/me', async (req) => ok(await who(req)));
  route('GET', '/api/departments', async () => ok(summary(await store.read())));
  route('GET', '/api/queue/:id', async (_req, { id }) => ok(get(summary(await store.read()).departments, id)));

  route('GET', '/api/public/tokens/:id', async (req, { id }) => {
    const s = await store.read();
    const t = get(s.tokens, id);
    const key = (req.headers.get('authorization') || '').replace(/^Ticket /, '');
    verifyShare(await secret(), t, key, shareTtl);
    return ok(publicTicket(s, t));
  });

  route('GET', '/api/tokens', async (req) => {
    const a = await who(req);
    const s = await store.read();
    return ok(s.tokens.filter((t) => t.ownerUid === a.uid).map((t) => tokenView(s, t)));
  });

  route('GET', '/api/tokens/:id', async (req, { id }) => {
    const a = await who(req);
    const s = await store.read();
    const t = get(s.tokens, id);
    if (a.uid !== t.ownerUid) allowed(a, t.departmentId);
    return ok({ ...tokenView(s, t), ticket: publicTicket(s, t), isOwner: a.uid === t.ownerUid });
  });

  route('POST', '/api/tokens', async (req) => {
    const a = await who(req);
    const p = await body(req);
    if (p.displayName === undefined || p.displayName === null || p.displayName === '') p.displayName = a.displayName || '';
    const r = await store.transact((s) => mutate(s, 'create', p, a));
    return ok(tokenView(await store.read(), r), 201);
  });

  route('GET', '/api/dashboard', async (req) => {
    const a = await who(req);
    requireAdmin(a);
    const s = await store.read();
    const ids = a.departmentIds;
    const permitted = (x) => ids.includes('*') || ids.includes(x.departmentId);
    return ok({
      ...summary(s),
      counters: s.counters.filter(permitted),
      tokens: s.tokens.filter(permitted).map((t) => tokenView(s, t)),
      analytics: analytics(s, ids),
      recommendations: recommendations(s, ids),
      simulationEnabled: simulationEnabled(),
    });
  });

  route('POST', '/api/tokens/:id/share', async (req, { id }) => {
    const a = await who(req);
    const t = get((await store.read()).tokens, id);
    if (a.uid !== t.ownerUid) throw new Problem('Only the ticket owner may create this QR', 403);
    return ok(shareLink(await secret(), originOf(req), t, shareTtl));
  });

  route('POST', '/api/tokens/:id/revoke-share', async (req, { id }) => {
    const a = await who(req);
    await store.transact((s) => mutate(s, 'revoke_share', { tokenId: id }, a));
    return ok({ revoked: true });
  });

  route('POST', '/api/simulation/compare', async (req) => {
    const a = await who(req);
    requireAdmin(a);
    return ok(compare(await body(req)));
  });

  route('GET', '/api/analytics', async (req) => {
    const a = await who(req);
    requireAdmin(a);
    return ok(analytics(await store.read(), a.departmentIds));
  });

  route('POST', '/api/queue/next', async (req) => {
    const a = await who(req);
    const p = await body(req);
    return ok(await store.transact((s) => mutate(s, 'next', p, a)));
  });

  route('POST', '/api/counters/:id/:action', async (req, { id, action }) => {
    if (!['open', 'close', 'next'].includes(action)) throw new Problem('Unknown counter action', 404);
    const a = await who(req);
    return ok(await store.transact((s) => mutate(s, action, { counterId: id }, a)));
  });

  route('POST', '/api/tokens/:id/:action', async (req, { id, action }) => {
    if (!['start', 'complete', 'skip', 'recall', 'cancel'].includes(action)) throw new Problem('Unknown ticket action', 404);
    const a = await who(req);
    return ok(await store.transact((s) => mutate(s, action, { tokenId: id }, a)));
  });

  route('POST', '/api/departments', async (req) => {
    const a = await who(req);
    const p = await body(req);
    return ok(await store.transact((s) => mutate(s, 'department', p, a)));
  });

  route('POST', '/api/counters', async (req) => {
    const a = await who(req);
    const p = await body(req);
    return ok(await store.transact((s) => mutate(s, 'counter', p, a)));
  });

  route('POST', '/api/simulate', async (req) => {
    if (!simulationEnabled()) throw new Problem('Simulation is disabled', 403);
    const a = await who(req);
    const p = await body(req);
    allowed(a, p.departmentId);
    const count = p.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Problem('Count must be between 1 and 10');
    return ok(await store.transact((s) => {
      const d = get(s.departments, p.departmentId);
      return Array.from({ length: count }, () => mutate(s, 'create', { departmentId: d.id, service: d.services[0], requestId: hexId(), displayName: 'Simulated visitor' }, { uid: hexId(), role: 'customer' }));
    }));
  });

  /** @param {Request} req @param {{ip?: string}} [context] */
  return async function handle(req, context = {}) {
    try {
      const path = new URL(req.url).pathname;
      if (req.method === 'POST') throttle(context.ip || 'unknown');
      const length = Number(req.headers.get('content-length') || 0);
      if (length > MAX_BODY) throw new Problem('Request body too large', 413);
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.regex.exec(path);
        if (!m) continue;
        if (r.method !== req.method) { methodMismatch = true; continue; }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return await r.handler(req, params);
      }
      if (methodMismatch) throw new Problem('The method is not allowed for the requested URL.', 405);
      throw new Problem('API route not found', 404);
    } catch (e) {
      if (e instanceof Problem) return json({ success: false, message: e.message }, e.status);
      console.error('API request failed', e);
      return json({ success: false, message: 'Unable to save changes. Please try again.' }, 500);
    }
  };
}
