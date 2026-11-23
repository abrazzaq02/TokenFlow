// Pure queue engine — a JavaScript port of backend/services/engine.py.
// All mutations run inside a storage transaction (see store.mjs).
import { randomUUID } from 'node:crypto';

export const CATEGORIES = [
  ['bank', 'Banks', 'BNK', 'Everyday banking, without the everyday wait.', 'Central Bank • City Branch', ['Cash & deposits', 'Account services'], 5],
  ['hospital', 'Hospitals', 'MED', 'Less waiting. More care.', 'City Care • Outpatient Desk', ['Consultation registration', 'Lab collection'], 8],
  ['police', 'Police Stations', 'POL', 'Your local services, a little simpler.', 'City Police • Facilitation Desk', ['Character certificate', 'Report assistance'], 7],
  ['government', 'Government / NADRA', 'GOV', 'Get the paperwork moving.', 'Citizen Center • Main Branch', ['ID card services', 'Document verification'], 6],
  ['utility', 'Utility Centers', 'UTL', 'Bills, connections, and everything between.', 'Utility Hub • Customer Services', ['Billing support', 'New connection'], 4],
];

export class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const hexId = () => randomUUID().replace(/-/g, '');
export const nowSeconds = () => Date.now() / 1000;
// Exact, correctly rounded arithmetic mean — same result as Python's statistics.mean,
// which sums floats as exact fractions. (A plain float sum can differ by one ulp and
// flip a later round(x, 1).)
const view = new DataView(new ArrayBuffer(8));
function decompose(x) { // finite double -> [BigInt mantissa, exponent] with x = m * 2**e
  view.setFloat64(0, x);
  const hi = view.getUint32(0), lo = view.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exp) m |= 1n << 52n;
  if (hi >>> 31) m = -m;
  return [m, (exp || 1) - 1075];
}
export function mean(xs) {
  if (!xs.some((x) => x !== Math.trunc(x) || Math.abs(x) > 2 ** 40)) return xs.reduce((a, b) => a + b, 0) / xs.length; // exact for integers
  const parts = xs.map(decompose);
  const emin = Math.min(...parts.map(([, e]) => e));
  let num = parts.reduce((acc, [m, e]) => acc + (m << BigInt(e - emin)), 0n);
  let den = BigInt(xs.length);
  if (emin < 0) den <<= BigInt(-emin); else num <<= BigInt(emin);
  if (num === 0n) return 0;
  const negative = num < 0n;
  if (negative) num = -num;
  // Scale so the integer quotient has ~66 bits, keep a sticky bit, let Number() round half-even.
  const shift = 66 - (num.toString(2).length - den.toString(2).length);
  const q = shift >= 0 ? (num << BigInt(shift)) / den : num / (den << BigInt(-shift));
  const r = shift >= 0 ? (num << BigInt(shift)) % den : num % (den << BigInt(-shift));
  const value = Number(r ? q | 1n : q) * 2 ** -shift;
  return negative ? -value : value;
}
// Python-compatible round(): nearest by exact binary value, ties (exactly .5) to even.
// toFixed() already rounds by exact value, but sends exact ties away from zero.
export function round(x, digits = 0) {
  if (!Number.isFinite(x)) return x;
  const [whole, frac = ''] = Math.abs(x).toFixed(100).split('.');
  const tie = frac[digits] === '5' && /^0*$/.test(frac.slice(digits + 1));
  if (tie) {
    const kept = digits ? frac.slice(0, digits) : whole;
    if (Number(kept.at(-1)) % 2 === 0) return Math.sign(x) * Number(`${whole}.${frac.slice(0, digits) || '0'}`);
  }
  return Number(x.toFixed(digits));
}
const isGlobal = (ids) => Array.isArray(ids) && ids.length === 1 && ids[0] === '*';

export function initial() {
  const s = { departments: [], counters: [], tokens: [], records: [], events: [], revision: 0 };
  for (const [id, name, prefix, description, branch, services, duration] of CATEGORIES) {
    s.departments.push({ id, name, prefix, description, branch, services: [...services], duration, active: true, sequence: 0 });
    for (let n = 1; n < 4; n++) {
      s.counters.push({ id: `${id}-${n}`, departmentId: id, name: `Counter ${String(n).padStart(2, '0')}`, isOpen: n < 3, currentTokenId: null });
    }
  }
  return s;
}

export function get(items, id) {
  const v = items.find((x) => x.id === id);
  if (!v) throw new Problem('Record not found', 404);
  return v;
}

export function allowed(actor, department) {
  if (actor.role !== 'admin') throw new Problem('Admin access required', 403);
  if (!isGlobal(actor.departmentIds) && !(actor.departmentIds || []).includes(department)) {
    throw new Problem('This branch is outside your access', 403);
  }
}

export function average(s, d) {
  const rs = s.records.filter((r) => r.departmentId === d && r.actualServiceMinutes > 0).map((r) => r.actualServiceMinutes).slice(-30);
  return rs.length ? mean(rs) : get(s.departments, d).duration;
}

// Min-heap of [minutes, counterId] — tiny, so a sorted array is enough.
const heapPop = (heap) => {
  heap.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return heap.shift();
};

export function estimates(s, now = nowSeconds()) {
  const result = {};
  for (const d of s.departments) {
    const avg = average(s, d.id);
    const heap = [];
    for (const c of s.counters) {
      if (c.departmentId !== d.id || !c.isOpen) continue;
      let remaining = 0;
      if (c.currentTokenId) {
        const t = get(s.tokens, c.currentTokenId);
        const start = t.serviceStartTime || t.calledAt || now;
        remaining = Math.max(0.5, avg - (now - start) / 60);
      }
      heap.push([remaining, c.id]);
    }
    const waiting = s.tokens.filter((t) => t.departmentId === d.id && t.status === 'waiting').sort((a, b) => a.queueSequence - b.queueSequence);
    waiting.forEach((t, i) => {
      let wait = null;
      if (heap.length) {
        const [w, cid] = heapPop(heap);
        wait = w;
        heap.push([w + avg, cid]);
      }
      result[t.id] = { position: i + 1, estimatedWaitMinutes: wait !== null ? round(wait, 1) : null };
    });
  }
  return result;
}

const eventId = (t) => `${t.id}:${t.queueCycle || 0}:${t.status === 'called' ? 'called' : 'approaching'}`;

export function tokenView(s, t, now) {
  const view = { ...t, ...(estimates(s, now)[t.id] || { position: 0, estimatedWaitMinutes: 0 }) };
  const counter = s.counters.find((c) => c.id === t.assignedCounterId);
  view.counterName = counter ? counter.name : null;
  view.notificationState = t.status === 'waiting' && view.position > 0 && view.position <= 4 && view.estimatedWaitMinutes !== null;
  view.notificationEventId = eventId(t);
  delete view.smsStatus;
  return view;
}

export function serving(s, departmentId) {
  const tokens = Object.fromEntries(s.tokens.map((t) => [t.id, t]));
  return s.counters
    .filter((c) => c.departmentId === departmentId && tokens[c.currentTokenId] && ['called', 'serving'].includes(tokens[c.currentTokenId].status))
    .map((c) => ({ tokenNumber: tokens[c.currentTokenId].tokenNumber, counterName: c.name, status: tokens[c.currentTokenId].status }));
}

export function instruction(status, counter = null, position = 0, wait = null) {
  if (status === 'waiting') {
    if (wait === null) return 'Service is paused. Waiting for an available counter.';
    if (position > 0 && position <= 4) return 'Your turn is approaching. Please stay near the service area.';
    return 'Your place is saved. We will keep you updated.';
  }
  return {
    called: `It is your turn. Please proceed to ${counter || 'your assigned counter'}.`,
    serving: 'Your service is in progress.',
    completed: 'Your service is complete. Thank you.',
    cancelled: 'This ticket has been cancelled and is no longer active.',
    skipped: 'You missed your call. Contact staff to rejoin the queue.',
  }[status] || 'Please contact the service desk.';
}

export function publicTicket(s, t, now = nowSeconds()) {
  const view = tokenView(s, t, now);
  const department = get(s.departments, t.departmentId);
  const assigned = s.counters.find((c) => c.id === t.assignedCounterId);
  const counter = assigned ? assigned.name : null;
  const waiting = t.status === 'waiting';
  const wait = view.estimatedWaitMinutes;
  const approaching = waiting && view.position > 0 && view.position <= 4 && wait !== null;
  return {
    displayName: t.displayName || '',
    tokenNumber: t.tokenNumber,
    service: t.service,
    category: department.name,
    branch: department.branch,
    issueTime: t.arrivalTime,
    timezone: department.timezone || 'Asia/Karachi',
    estimatedWaitMinutes: waiting ? wait : null,
    position: view.position,
    peopleAhead: waiting ? Math.max(0, view.position - 1) : 0,
    estimatedTurnTime: waiting && wait !== null ? now + wait * 60 : null,
    counterName: counter,
    status: t.status,
    notificationState: approaching,
    notificationEventId: eventId(t),
    nowServing: serving(s, t.departmentId),
    message: instruction(t.status, counter, view.position, wait),
    branchInstructions: department.instructions || '',
    updatedAt: now,
  };
}

export function summary(s, now) {
  const est = estimates(s, now);
  const departments = s.departments.map((d) => {
    const ts = s.tokens.filter((t) => t.departmentId === d.id);
    const cs = s.counters.filter((c) => c.departmentId === d.id);
    const waits = ts.filter((t) => t.status === 'waiting').map((t) => est[t.id].estimatedWaitMinutes).filter((x) => x !== null);
    const anyOpen = cs.some((c) => c.isOpen);
    return {
      ...d,
      nowServing: serving(s, d.id),
      waiting: ts.filter((t) => t.status === 'waiting').length,
      openCounters: cs.filter((c) => c.isOpen).length,
      estimatedWait: anyOpen ? (waits.length ? Math.max(...waits) : 0) : null,
    };
  });
  return { departments, revision: s.revision };
}

export function analytics(s, ids) {
  const scoped = (x) => ids.includes('*') || ids.includes(x.departmentId);
  const ts = s.tokens.filter(scoped);
  const rs = s.records.filter(scoped);
  const startedTokens = ts.filter((t) => t.serviceStartTime !== null && t.serviceStartTime !== undefined);
  const started = startedTokens.map((t) => (t.serviceStartTime - t.arrivalTime) / 60);
  const errors = startedTokens
    .filter((t) => t.initialEstimatedWait !== null && t.initialEstimatedWait !== undefined)
    .map((t) => Math.abs((t.serviceStartTime - t.arrivalTime) / 60 - t.initialEstimatedWait));
  const count = (status) => ts.filter((t) => status.includes(t.status)).length;
  return {
    waitSampleCount: started.length,
    serviceSampleCount: rs.length,
    predictionSampleCount: errors.length,
    predictionMae: errors.length ? round(mean(errors), 2) : null,
    issued: ts.length,
    waiting: count(['waiting']),
    serving: count(['called', 'serving']),
    completed: count(['completed']),
    skipped: count(['skipped']),
    averageWait: started.length ? round(mean(started), 1) : 0,
    averageService: rs.length ? round(mean(rs.map((r) => r.actualServiceMinutes)), 1) : 0,
    byCounter: s.counters.filter(scoped).map((c) => ({ name: c.name, id: c.id, completed: rs.filter((r) => r.counterId === c.id).length })),
    history: s.events.slice(-40).map((e) => ({
      time: e.time,
      waiting: Object.entries(e.byDepartment).filter(([k]) => ids.includes('*') || ids.includes(k)).reduce((a, [, v]) => a + v, 0),
    })),
  };
}

const isText = (v) => typeof v === 'string';

export function mutate(s, action, p, actor, now = nowSeconds()) {
  let result = null;
  if (action === 'create') {
    const d = get(s.departments, p.departmentId);
    if (!d.active) throw new Problem('This service is unavailable');
    if (!d.services.includes(p.service)) throw new Problem('Choose a valid service');
    const key = p.requestId;
    if (!isText(key) || key.length < 8 || key.length > 100) throw new Problem('A valid request ID is required');
    const old = s.tokens.find((t) => t.ownerUid === actor.uid && t.requestId === key);
    if (old) return old;
    if (s.tokens.some((t) => t.ownerUid === actor.uid && t.departmentId === d.id && ['waiting', 'called', 'serving'].includes(t.status))) {
      throw new Problem('You already have an active ticket for this branch', 409);
    }
    if (s.tokens.length >= 250) throw new Problem('Demo capacity reached (250 tickets). Archive/reset the demo before continuing.', 409);
    let name = p.displayName === undefined ? '' : p.displayName;
    if (!isText(name)) throw new Problem('Name must be text');
    name = name.trim();
    if (name.length > 60) throw new Problem('Name must be 60 characters or fewer');
    d.sequence += 1;
    result = {
      id: hexId(), ownerUid: actor.uid, departmentId: d.id, service: p.service, displayName: name,
      tokenNumber: `${d.prefix}-${String(d.sequence).padStart(3, '0')}`, queueSequence: d.sequence, requestId: key,
      status: 'waiting', arrivalTime: now, serviceStartTime: null, serviceEndTime: null, assignedCounterId: null,
      notificationState: false, shareVersion: 0, queueCycle: 0, createdAt: now, updatedAt: now,
    };
    s.tokens.push(result);
    result.initialEstimatedWait = estimates(s, now)[result.id].estimatedWaitMinutes;
  } else if (['open', 'close', 'next'].includes(action)) {
    const c = get(s.counters, p.counterId);
    allowed(actor, c.departmentId);
    if (action !== 'next') {
      c.isOpen = action === 'open';
      result = c;
    } else {
      if (!c.isOpen) throw new Problem('Open this counter first', 409);
      if (c.currentTokenId) throw new Problem('Finish the current ticket first', 409);
      const q = s.tokens.filter((t) => t.departmentId === c.departmentId && t.status === 'waiting').sort((a, b) => a.queueSequence - b.queueSequence);
      if (!q.length) throw new Problem('No waiting tickets', 409);
      result = q[0];
      Object.assign(result, { status: 'called', calledAt: now, assignedCounterId: c.id, updatedAt: now });
      c.currentTokenId = result.id;
    }
  } else if (['start', 'complete', 'skip', 'recall', 'cancel'].includes(action)) {
    const t = get(s.tokens, p.tokenId);
    result = t;
    if (action === 'cancel') {
      if (t.ownerUid !== actor.uid) throw new Problem('This ticket belongs to another user', 403);
      if (t.status !== 'waiting') throw new Problem('Only waiting tickets may be cancelled', 409);
      t.status = 'cancelled';
    } else {
      allowed(actor, t.departmentId);
      if (action === 'recall') {
        if (t.status !== 'skipped') throw new Problem('Only skipped tickets may rejoin', 409);
        const d = get(s.departments, t.departmentId);
        d.sequence += 1;
        Object.assign(t, { status: 'waiting', queueSequence: d.sequence, assignedCounterId: null, notificationState: false, queueCycle: (t.queueCycle || 0) + 1 });
      } else {
        const c = get(s.counters, t.assignedCounterId);
        if (c.currentTokenId !== t.id) throw new Problem('Ticket is not assigned to this counter', 409);
        if (action === 'start') {
          if (t.status !== 'called') throw new Problem('Call this ticket first', 409);
          Object.assign(t, { status: 'serving', serviceStartTime: now });
        } else if (action === 'complete') {
          if (t.status !== 'serving') throw new Problem('Start service before completing', 409);
          Object.assign(t, { status: 'completed', serviceEndTime: now });
          c.currentTokenId = null;
          s.records.push({
            id: hexId(), tokenId: t.id, departmentId: t.departmentId, counterId: c.id, arrivalTime: t.arrivalTime,
            serviceStartTime: t.serviceStartTime, serviceEndTime: now,
            actualWaitingMinutes: (t.serviceStartTime - t.arrivalTime) / 60,
            actualServiceMinutes: (now - t.serviceStartTime) / 60, finalStatus: 'completed',
          });
        } else if (action === 'skip') {
          if (t.status !== 'called') throw new Problem('Only called tickets may be marked no-show', 409);
          Object.assign(t, { status: 'skipped', assignedCounterId: null });
          c.currentTokenId = null;
        }
      }
    }
    t.updatedAt = now;
  } else if (action === 'department') {
    if (actor.role !== 'admin') throw new Problem('Admin access required', 403);
    if (['name', 'branch'].some((k) => !isText(p[k]) || !p[k].trim())) throw new Problem('Name and branch must be non-empty text');
    const instructions = p.instructions === undefined ? '' : p.instructions;
    if (!isText(instructions) || instructions.length > 500) throw new Problem('Instructions must be text of at most 500 characters');
    if (p.id) {
      const d = get(s.departments, p.id);
      allowed(actor, d.id);
      Object.assign(d, { name: p.name.slice(0, 60), branch: p.branch.trim().slice(0, 100), instructions: p.instructions === undefined ? d.instructions || '' : p.instructions });
      result = d;
    } else {
      if (!isGlobal(actor.departmentIds)) throw new Problem('Global admin required to create a department', 403);
      if (s.departments.length >= 20) throw new Problem('MVP department capacity reached', 409);
      result = { id: hexId(), name: p.name.slice(0, 60), branch: p.branch.slice(0, 100), prefix: 'NEW', description: 'Public service desk', services: ['General assistance'], duration: 5, active: true, sequence: 0 };
      s.departments.push(result);
    }
  } else if (action === 'counter') {
    if (actor.role !== 'admin') throw new Problem('Admin access required', 403);
    const d = get(s.departments, p.departmentId);
    allowed(actor, d.id);
    if (!isText(p.name) || !p.name.trim()) throw new Problem('Counter name must be non-empty text');
    if (s.counters.length >= 60) throw new Problem('MVP counter capacity reached', 409);
    result = { id: hexId(), departmentId: d.id, name: p.name.slice(0, 40), isOpen: false, currentTokenId: null };
    s.counters.push(result);
  } else if (action === 'revoke_share') {
    const t = get(s.tokens, p.tokenId);
    if (t.ownerUid !== actor.uid) throw new Problem('Only the ticket owner may revoke its QR link', 403);
    t.shareVersion = (t.shareVersion || 0) + 1;
    result = t;
  } else {
    throw new Problem('Unknown action');
  }
  s.revision += 1;
  for (const [id, e] of Object.entries(estimates(s, now))) {
    if (e.position <= 4 && e.estimatedWaitMinutes !== null) {
      const t = get(s.tokens, id);
      if (!t.notificationState) {
        t.notificationState = true;
        t.notificationAt = now;
      }
    }
  }
  s.events.push({
    time: now,
    byDepartment: Object.fromEntries(s.departments.map((d) => [d.id, s.tokens.filter((t) => t.status === 'waiting' && t.departmentId === d.id).length])),
  });
  s.events = s.events.slice(-100);
  return result;
}
