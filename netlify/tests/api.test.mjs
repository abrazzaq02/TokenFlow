// HTTP-level tests for the Netlify API (ported from the Flask API tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.mjs';
import { MemoryStore } from '../lib/store.mjs';
import { mutate } from '../lib/engine.mjs';

const A = { uid: 'a', role: 'admin', departmentIds: ['*'] };

function client(env = {}, options = {}) {
  const store = new MemoryStore();
  const handle = createApp({ store, env: { ADMIN_SETUP_KEY: 'test-setup-key', ...env }, ...options });
  const call = async (method, path, { json, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await handle(new Request(`https://tokenflow.test${path}`, init), { ip: '127.0.0.1' });
    const body = await res.json();
    return { status: res.status, body, data: body.data, headers: res.headers };
  };
  return { store, call };
}
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const keyOf = (url) => new URL(url).hash.replace('#key=', '');

test('auth, tickets, QR tracking and admin flow', async () => {
  const { call } = client();
  assert.equal((await call('GET', '/api/health')).status, 200);
  assert.equal((await call('GET', '/api/dashboard')).status, 401);

  let r = await call('POST', '/api/auth/register', { json: { name: 'Taylor User', email: 'User@example.test', password: 'user-password' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.name, 'Taylor User');
  assert.equal(r.data.user.email, 'user@example.test');
  const h = bearer(r.data.token);
  assert.equal((await call('GET', '/api/dashboard', { headers: h })).status, 403);
  assert.equal((await call('GET', '/api/me', { headers: h })).data.role, 'customer');

  const p = { departmentId: 'bank', service: 'Cash & deposits', requestId: 'unique-request', displayName: '' };
  r = await call('POST', '/api/tokens', { headers: h, json: p });
  assert.equal(r.status, 201);
  const t = r.data;
  assert.equal(t.displayName, 'Taylor User');
  assert.equal(t.tokenNumber, 'BNK-001');
  assert.equal((await call('GET', '/api/public/tokens/' + t.id)).status, 401);

  const share = (await call('POST', `/api/tokens/${t.id}/share`, { headers: h, json: {} })).data.url;
  assert.ok(share.startsWith(`https://tokenflow.test/track/${t.id}#key=`));
  const qh = { Authorization: 'Ticket ' + keyOf(share) };
  const qr = await call('GET', '/api/public/tokens/' + t.id, { headers: qh });
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('cache-control'), 'no-store');
  const pub = qr.data;
  assert.equal(pub.displayName, 'Taylor User');
  assert.equal(pub.branch, 'Central Bank • City Branch');
  assert.equal(pub.issueTime, t.arrivalTime);
  assert.equal(pub.position, 1);
  assert.equal(pub.estimatedWaitMinutes, 0);
  assert.equal(pub.counterName, null);
  assert.deepEqual(pub.nowServing, []);
  for (const k of ['ownerUid', 'requestId', 'email', 'shareVersion']) assert.ok(!(k in pub), k);
  assert.equal((await call('POST', '/api/tokens', { headers: h, json: p })).data.id, t.id); // idempotent retry

  const other = (await call('POST', '/api/auth/register', { json: { name: 'Second User', email: 'second@example.test', password: 'other-password' } })).data.token;
  assert.equal((await call('GET', '/api/tokens/' + t.id, { headers: bearer(other) })).status, 403);
  assert.equal((await call('GET', '/api/tokens/' + t.id, { headers: h })).data.isOwner, true);
  assert.equal((await call('GET', '/api/tokens', { headers: h })).data.length, 1);

  assert.equal((await call('POST', '/api/auth/login', { json: { email: 'user@example.test', password: 'wrong-pass', role: 'customer' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { json: { email: 'user@example.test', password: 'user-password', role: 'admin' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { json: { email: 'user@example.test', password: 'user-password', role: 'staff' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { json: { email: 'USER@example.test', password: 'user-password' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/register', { json: { name: 'Taylor User', email: 'USER@example.test', password: 'user-password' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/register', { json: { name: '', email: 'empty@example.test', password: 'user-password' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { json: { name: 'Short Pass', email: 'short@example.test', password: 'tiny' } })).status, 400);
  assert.ok([404, 405].includes((await call('POST', '/api/auth/guest')).status));

  assert.equal((await call('GET', '/api/auth/admin/setup-status')).data.available, true);
  assert.equal((await call('POST', '/api/auth/admin/setup', { json: {} })).status, 403);
  const setup = await call('POST', '/api/auth/admin/setup', { json: { setupKey: 'test-setup-key' } });
  assert.equal(setup.status, 201);
  assert.ok(setup.data.email.endsWith('@tokenflow.local') && setup.data.password.length >= 20);
  assert.equal((await call('POST', '/api/auth/admin/setup', { json: { setupKey: 'test-setup-key' } })).status, 409);
  assert.equal((await call('GET', '/api/auth/admin/setup-status')).data.available, false);

  const login = await call('POST', '/api/auth/login', { json: { email: setup.data.email, password: setup.data.password, role: 'admin' } });
  assert.equal(login.status, 200);
  const ah = bearer(login.data.token);
  const dash = await call('GET', '/api/dashboard', { headers: ah });
  assert.equal(dash.status, 200);
  assert.equal(dash.data.simulationEnabled, true);
  assert.equal(dash.data.departments.length, 5);
  assert.equal((await call('POST', '/api/counters/bank-1/next', { headers: ah })).status, 200);
  const live = (await call('GET', '/api/public/tokens/' + t.id, { headers: qh })).data;
  assert.equal(live.status, 'called');
  assert.equal(live.counterName, 'Counter 01');
  assert.deepEqual(live.nowServing, [{ tokenNumber: t.tokenNumber, counterName: 'Counter 01', status: 'called' }]);
  assert.equal((await call('POST', `/api/tokens/${t.id}/start`, { headers: ah })).data.status, 'serving');
  assert.equal((await call('POST', `/api/tokens/${t.id}/complete`, { headers: ah })).data.status, 'completed');
  assert.equal((await call('POST', `/api/tokens/${t.id}/explode`, { headers: ah })).status, 404);
  assert.equal((await call('POST', '/api/tokens', { headers: h, json: { ...p, requestId: 'another-key', service: 'fake' } })).status, 400);
  assert.equal((await call('POST', '/api/simulate', { headers: ah, json: { departmentId: 'bank', count: 2 } })).data.length, 2);
  assert.equal((await call('POST', '/api/simulate', { headers: h, json: { departmentId: 'bank', count: 2 } })).status, 403);
  assert.equal((await call('GET', '/api/analytics', { headers: ah })).data.completed, 1);
  assert.equal((await call('GET', '/api/queue/bank')).data.waiting, 2);
  assert.equal((await call('GET', '/api/queue/nope')).status, 404);
  assert.equal((await call('GET', '/api/departments')).data.departments.length, 5);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('QR revocation, expiry and tampering', async () => {
  const { call } = client({ PUBLIC_ORIGIN: 'https://queue.example.test' });
  const user = (await call('POST', '/api/auth/register', { json: { name: 'Scanner Test', email: 'scan@example.test', password: 'a-long-password' } })).data;
  const h = bearer(user.token);
  const t = (await call('POST', '/api/tokens', { headers: h, json: { departmentId: 'bank', service: 'Cash & deposits', requestId: 'qr-upgrade-0001' } })).data;
  const url = (await call('POST', `/api/tokens/${t.id}/share`, { headers: h, json: {} })).data.url;
  const u = new URL(url);
  assert.equal(u.host, 'queue.example.test');
  assert.equal(u.search, '');
  const key = keyOf(url);
  const endpoint = '/api/public/tokens/' + t.id;
  assert.equal((await call('GET', endpoint, { headers: { Authorization: 'Ticket ' + key + 'bad' } })).status, 403);
  assert.equal((await call('POST', `/api/tokens/${t.id}/cancel`, { headers: { Authorization: 'Ticket ' + key }, json: {} })).status, 401);
  assert.equal((await call('POST', `/api/tokens/${t.id}/revoke-share`, { headers: h, json: {} })).status, 200);
  assert.equal((await call('GET', endpoint, { headers: { Authorization: 'Ticket ' + key } })).status, 403);
  const fresh = keyOf((await call('POST', `/api/tokens/${t.id}/share`, { headers: h, json: {} })).data.url);
  assert.equal((await call('GET', endpoint, { headers: { Authorization: 'Ticket ' + fresh } })).status, 200);
  assert.equal((await call('POST', `/api/tokens/${t.id}/cancel`, { headers: h, json: {} })).data.status, 'cancelled');
});

test('expired QR links return 410', async () => {
  const { call } = client({}, { shareTtl: -1 });
  const user = (await call('POST', '/api/auth/register', { json: { name: 'Exp', email: 'exp@example.test', password: 'a-long-password' } })).data;
  const t = (await call('POST', '/api/tokens', { headers: bearer(user.token), json: { departmentId: 'bank', service: 'Cash & deposits', requestId: 'expiry-0001' } })).data;
  const key = keyOf((await call('POST', `/api/tokens/${t.id}/share`, { headers: bearer(user.token), json: {} })).data.url);
  assert.equal((await call('GET', '/api/public/tokens/' + t.id, { headers: { Authorization: 'Ticket ' + key } })).status, 410);
});

test('validation, compare permissions, disabled simulation and admin setup without key', async () => {
  const { call, store } = client({ SIMULATION_ENABLED: 'false' });
  const user = (await call('POST', '/api/auth/register', { json: { name: 'V', email: 'v@example.test', password: 'a-long-password' } })).data;
  const h = bearer(user.token);
  assert.equal((await call('POST', '/api/simulation/compare', { headers: h, json: {} })).status, 403);
  assert.equal((await call('POST', '/api/tokens', { headers: h, json: { departmentId: 'hospital', service: 'Lab collection', requestId: 'bad-name-request', displayName: 123 } })).status, 400);
  assert.equal((await call('POST', '/api/tokens', { headers: h, json: [] })).status, 400);
  const a = await call('POST', '/api/auth/admin/setup', { json: { setupKey: 'test-setup-key' } });
  const ah = bearer(a.data.token);
  const before = await store.read();
  const cmp = await call('POST', '/api/simulation/compare', { headers: ah, json: { customers: 15 } });
  assert.equal(cmp.status, 200);
  assert.deepEqual(await store.read(), before);
  assert.equal((await call('POST', '/api/counters', { headers: ah, json: { departmentId: 'bank', name: [] } })).status, 400);
  assert.equal((await call('POST', '/api/counters', { headers: ah, json: { departmentId: 'bank', name: 'Counter 04' } })).data.isOpen, false);
  assert.equal((await call('POST', '/api/departments', { headers: ah, json: { id: 'bank', name: 'Banks', branch: 'Branch', instructions: 22 } })).status, 400);
  assert.equal((await call('POST', '/api/departments', { headers: ah, json: { id: 'bank', name: 'Banks', branch: 'Main St', instructions: 'Bring ID' } })).data.instructions, 'Bring ID');
  assert.equal((await call('GET', '/api/dashboard', { headers: ah })).data.simulationEnabled, false);
  assert.equal((await call('POST', '/api/simulate', { headers: ah, json: { departmentId: 'bank' } })).status, 403);
  assert.equal((await call('GET', '/api/me', { headers: { Authorization: 'Bearer forged.token' } })).status, 401);

  const noKey = client({ ADMIN_SETUP_KEY: '' });
  assert.equal((await noKey.call('GET', '/api/auth/admin/setup-status')).data.available, false);
  assert.equal((await noKey.call('POST', '/api/auth/admin/setup', { json: { setupKey: '' } })).status, 403);
});

test('concurrent HTTP requests keep ticket numbers unique', async () => {
  const { call, store } = client();
  const users = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/api/auth/register', { json: { name: `U${i}`, email: `u${i}@example.test`, password: 'a-long-password' } })));
  const tickets = await Promise.all(users.map((u, i) => call('POST', '/api/tokens', { headers: bearer(u.data.token), json: { departmentId: 'bank', service: 'Cash & deposits', requestId: `concurrent-${i}-req` } })));
  assert.equal(new Set(tickets.map((t) => t.data.tokenNumber)).size, 12);
  const claims = await Promise.all(['bank-1', 'bank-2'].map((c) => store.transact((s) => mutate(s, 'next', { counterId: c }, A))));
  assert.notEqual(claims[0].id, claims[1].id);
});
