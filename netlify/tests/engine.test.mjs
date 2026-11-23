// Ported from backend/tests/test_queue.py, test_engine_stdlib.py and test_upgrades.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, mutate, estimates, analytics, publicTicket, Problem, hexId } from '../lib/engine.mjs';
import { recommendations, compare } from '../lib/insights.mjs';
import { MemoryStore } from '../lib/store.mjs';

const ADMIN = { uid: 'admin', role: 'admin', departmentIds: ['*'] };
const ticket = (s, uid, now = 1000, key) =>
  mutate(s, 'create', { departmentId: 'bank', service: 'Cash & deposits', requestId: key || hexId() }, { uid: uid || hexId(), role: 'customer' }, now);

test('FIFO estimates and idempotent create', () => {
  const s = initial();
  const a = ticket(s, 'u', 1000, 'request-0001');
  assert.equal(ticket(s, 'u', 1000, 'request-0001').id, a.id);
  assert.throws(() => ticket(s, 'u', 1000, 'request-0002'), Problem);
  const b = ticket(s), c = ticket(s);
  const e = estimates(s, 1000);
  assert.deepEqual([a, b, c].map((t) => e[t.id].estimatedWaitMinutes), [0, 0, 5]);
  assert.equal(mutate(s, 'next', { counterId: 'bank-1' }, ADMIN, 1000).id, a.id);
  assert.equal(mutate(s, 'next', { counterId: 'bank-2' }, ADMIN, 1000).id, b.id);
  assert.throws(() => mutate(s, 'next', { counterId: 'bank-1' }, ADMIN), Problem);
});

test('waiting estimates react to opening a counter', () => {
  const s = initial();
  const ts = Array.from({ length: 7 }, () => ticket(s));
  assert.deepEqual(ts.map((t) => estimates(s, 1000)[t.id].estimatedWaitMinutes), [0, 0, 5, 5, 10, 10, 15]);
  mutate(s, 'open', { counterId: 'bank-3' }, ADMIN, 1000);
  assert.equal(estimates(s, 1000)[ts.at(-1).id].estimatedWaitMinutes, 10);
});

test('closed counter, busy closure and completion records', () => {
  const s = initial();
  const t = ticket(s);
  assert.throws(() => mutate(s, 'next', { counterId: 'bank-3' }, ADMIN), Problem);
  mutate(s, 'next', { counterId: 'bank-1' }, ADMIN, 1060);
  mutate(s, 'start', { tokenId: t.id }, ADMIN, 1120);
  mutate(s, 'close', { counterId: 'bank-1' }, ADMIN, 1121);
  assert.equal(s.counters[0].currentTokenId, t.id);
  mutate(s, 'complete', { tokenId: t.id }, ADMIN, 1420);
  assert.equal(s.records[0].actualServiceMinutes, 5);
  const stats = analytics(s, ['*']);
  assert.equal(stats.averageWait, 2);
  assert.equal(stats.averageService, 5);
  assert.equal(stats.completed, 1);
  assert.throws(() => mutate(s, 'complete', { tokenId: t.id }, ADMIN, 1450), Problem);
});

test('no open counters pauses estimates; notifications stamp once', () => {
  const s = initial();
  for (const c of ['bank-1', 'bank-2']) mutate(s, 'close', { counterId: c }, ADMIN, 900);
  const t = ticket(s);
  assert.equal(estimates(s)[t.id].estimatedWaitMinutes, null);
  assert.equal(t.notificationState, false);
  mutate(s, 'open', { counterId: 'bank-1' }, ADMIN, 1000);
  const first = t.notificationAt;
  ticket(s, undefined, 1020);
  assert.equal(t.notificationAt, first);
  assert.equal(t.notificationState, true);
});

test('roles, recall goes to the back, owner-only cancel', () => {
  const s = initial();
  const t = ticket(s, 'owner');
  const staff = { uid: 'staff', role: 'staff', departmentIds: ['hospital'] };
  assert.throws(() => mutate(s, 'next', { counterId: 'bank-1' }, staff), Problem);
  assert.throws(() => mutate(s, 'cancel', { tokenId: t.id }, { uid: 'other', role: 'customer' }), Problem);
  assert.throws(() => mutate(s, 'department', { name: 'x', branch: 'y' }, { role: 'staff' }), Problem);
  mutate(s, 'next', { counterId: 'bank-1' }, ADMIN);
  mutate(s, 'skip', { tokenId: t.id }, ADMIN);
  assert.equal(t.assignedCounterId, null);
  const second = ticket(s);
  mutate(s, 'recall', { tokenId: t.id }, ADMIN);
  assert.equal(mutate(s, 'next', { counterId: 'bank-1' }, ADMIN).id, second.id);
});

test('atomic concurrent allocation and rollback on error', async () => {
  const db = new MemoryStore();
  const ts = await Promise.all(Array.from({ length: 30 }, () => db.transact((s) => ticket(s))));
  assert.equal(new Set(ts.map((t) => t.tokenNumber)).size, 30);
  const assigned = await Promise.all(['bank-1', 'bank-2'].map((c) => db.transact((s) => mutate(s, 'next', { counterId: c }, ADMIN))));
  assert.notEqual(assigned[0].id, assigned[1].id);
  assert.equal((await db.read()).tokens.length, 30);
  await assert.rejects(db.transact((s) => mutate(s, 'create', { departmentId: 'bank', service: 'invalid', requestId: 'request-1' }, { uid: 'u', role: 'customer' })), Problem);
  assert.equal((await db.read()).tokens.length, 30);
});

test('concurrent identical requests create one ticket; one counter claim wins', async () => {
  const db = new MemoryStore();
  const payload = { departmentId: 'bank', service: 'Cash & deposits', requestId: 'same-network-retry' };
  const r = await Promise.all(Array.from({ length: 8 }, () => db.transact((s) => mutate(s, 'create', payload, { uid: 'same', role: 'customer' }))));
  assert.equal(new Set(r.map((x) => x.id)).size, 1);
  assert.equal((await db.read()).tokens.length, 1);
  const claim = (c) => db.transact((s) => mutate(s, 'next', { counterId: c }, ADMIN)).then((t) => t.id, () => null);
  const claims = await Promise.all(['bank-1', 'bank-2'].map(claim));
  assert.equal(claims.filter(Boolean).length, 1);
});

test('recommendations are pure and scoped', () => {
  const s = initial();
  for (let i = 0; i < 12; i++) ticket(s);
  const rev = s.revision;
  const r = recommendations(s, ['bank'], 1000);
  assert.equal(r.length, 1);
  assert.ok(r[0].projectedAverageEstimate < r[0].currentAverageEstimate);
  assert.equal(s.revision, rev);
  assert.equal(s.counters[2].isOpen, false);
  assert.deepEqual(recommendations(s, ['hospital'], 1000), []);
  for (const c of ['bank-1', 'bank-2']) mutate(s, 'close', { counterId: c }, ADMIN, 1000);
  const paused = recommendations(s, ['bank'], 1000)[0];
  assert.equal(paused.currentAverageEstimate, null);
  assert.ok(paused.projectedAverageEstimate >= 0);
});

test('repeatable comparison uses identical workloads (matches the Python output)', () => {
  const a = compare({ seed: 42 });
  assert.deepEqual(a, compare({ seed: 42 }));
  assert.deepEqual(a.baseline.records.map((r) => [r.arrival, r.serviceDuration]), a.improved.records.map((r) => [r.arrival, r.serviceDuration]));
  assert.ok(a.improved.averageWait < a.baseline.averageWait);
  assert.ok(a.improved.completedByHorizon > a.baseline.completedByHorizon);
  // Reference values produced by backend/services/insights.py compare({'seed': 42}).
  assert.equal(a.baseline.averageWait, 33.29);
  assert.equal(a.improved.averageWait, 9.44);
  assert.equal(a.reductionPercent, 71.6);
  assert.equal(compare({ baselineCounters: 2, improvedCounters: 2 }).reductionPercent, 0);
  const one = compare({ customers: 1 });
  assert.equal(one.baseline.averageWait, 0);
  assert.equal(one.reductionPercent, 0);
  assert.throws(() => compare({ customers: true }), Problem);
  assert.throws(() => compare({ serviceMinutes: Number.NaN }), Problem);
});

test('recall gives a new alert cycle; paused ticket has no turn time', () => {
  const s = initial();
  const t = ticket(s);
  const v = publicTicket(s, t, 1000);
  const first = v.notificationEventId;
  assert.equal(v.notificationState, true);
  mutate(s, 'next', { counterId: 'bank-1' }, ADMIN, 1001);
  assert.notEqual(publicTicket(s, t, 1001).notificationEventId, first);
  mutate(s, 'skip', { tokenId: t.id }, ADMIN, 1002);
  mutate(s, 'recall', { tokenId: t.id }, ADMIN, 1003);
  assert.notEqual(publicTicket(s, t, 1003).notificationEventId, first);
  for (const c of ['bank-1', 'bank-2']) mutate(s, 'close', { counterId: c }, ADMIN, 1004);
  const view = publicTicket(s, t, 1004);
  assert.equal(view.estimatedTurnTime, null);
  assert.equal(view.notificationState, false);
  assert.match(view.message, /paused/);
});
