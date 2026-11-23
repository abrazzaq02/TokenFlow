// Transparent estimates and repeatable counter comparisons — port of backend/services/insights.py.
import { estimates, get, mean, round, nowSeconds, Problem } from './engine.mjs';

export function recommendations(s, ids, now = nowSeconds()) {
  const base = estimates(s, now);
  const out = [];
  for (const d of s.departments) {
    if (!ids.includes('*') && !ids.includes(d.id)) continue;
    const waiting = s.tokens.filter((t) => t.departmentId === d.id && t.status === 'waiting');
    const closed = s.counters.filter((c) => c.departmentId === d.id && !c.isOpen);
    if (!waiting.length || !closed.length) continue;
    const candidate = closed[0];
    const after = structuredClone(s);
    get(after.counters, candidate.id).isOpen = true;
    const projected = estimates(after, now);
    const current = waiting.map((t) => base[t.id].estimatedWaitMinutes);
    const future = waiting.map((t) => projected[t.id].estimatedWaitMinutes);
    const before = current.some((v) => v === null) ? null : round(mean(current), 1);
    const later = round(mean(future), 1);
    const saving = before === null ? null : round(before - later, 1);
    if (before !== null && saving < 1) continue;
    out.push({
      departmentId: d.id,
      counterId: candidate.id,
      counterName: candidate.name,
      waiting: waiting.length,
      currentAverageEstimate: before,
      projectedAverageEstimate: later,
      estimatedMinutesSaved: saving,
      reason: `${waiting.length} people are waiting. Opening ${candidate.name} ` + (before === null ? 'would resume this queue.' : `could reduce average estimated wait from ${before} to ${later} minutes.`),
      assumption: 'Assumes staff are available, unchanged service durations, and no new arrivals. Estimates, not measured savings.',
    });
  }
  return out;
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export function compare(payload) {
  const integer = (name, fallback, low, high) => {
    const v = payload[name] === undefined ? fallback : payload[name];
    if (!Number.isInteger(v) || v < low || v > high) throw new Problem(`${name} must be an integer between ${low} and ${high}`);
    return v;
  };
  const seed = integer('seed', 42, 0, 999999);
  const n = integer('customers', 15, 1, 200);
  const a = integer('baselineCounters', 1, 1, 10);
  const b = integer('improvedCounters', 3, 1, 10);
  const duration = payload.serviceMinutes === undefined ? 5 : payload.serviceMinutes;
  const gap = payload.arrivalInterval === undefined ? 0 : payload.arrivalInterval;
  if (!isNumber(duration) || duration < 0.5 || duration > 60) throw new Problem('serviceMinutes must be between 0.5 and 60');
  if (!isNumber(gap) || gap < 0 || gap > 30) throw new Problem('arrivalInterval must be between 0 and 30');
  let state = seed;
  const rng = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const customers = Array.from({ length: n }, (_, i) => ({ arrival: round(i * gap, 2), duration: round(duration * (0.8 + 0.4 * rng()), 2) }));
  const horizon = 30;
  const run = (count) => {
    const available = Array.from({ length: count }, (_, c) => [0, c]);
    const rows = customers.map((customer, i) => {
      available.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const [free, c] = available.shift();
      const start = Math.max(free, customer.arrival);
      const finish = start + customer.duration;
      available.push([finish, c]);
      return { token: i + 1, arrival: customer.arrival, serviceDuration: customer.duration, start: round(start, 2), finish: round(finish, 2), wait: round(start - customer.arrival, 2), counter: c + 1 };
    });
    return {
      counters: count,
      averageWait: round(mean(rows.map((r) => r.wait)), 2),
      maxWait: Math.max(...rows.map((r) => r.wait)),
      completedByHorizon: rows.filter((r) => r.finish <= horizon).length,
      totalCompletionMinutes: Math.max(...rows.map((r) => r.finish)),
      records: rows,
    };
  };
  const baseline = run(a);
  const improved = run(b);
  const reduction = round(baseline.averageWait - improved.averageWait, 2);
  return {
    seed, customers: n, horizonMinutes: horizon, arrivalInterval: gap, serviceMinutes: duration, baseline, improved,
    averageWaitReductionMinutes: reduction,
    reductionPercent: baseline.averageWait ? round((100 * reduction) / baseline.averageWait, 1) : 0,
    label: 'Simulated service outcomes, not real-world measurements. Both runs use identical arrivals and service durations. No live tickets were changed.',
  };
}
