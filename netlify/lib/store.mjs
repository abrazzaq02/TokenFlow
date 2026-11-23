// Storage for the Netlify API.
//
// The queue is one bounded JSON aggregate (≤250 tickets), exactly like the Flask
// SQLite/Firestore stores. On Netlify it lives in a Blobs store and every write is
// an optimistic compare-and-swap (`onlyIfMatch` on the ETag), retried on conflict,
// so concurrent function invocations cannot lose updates or double-assign tickets.
// Accounts are one blob per email, created with `onlyIfNew` for uniqueness.
import { createHash, randomBytes } from 'node:crypto';
import { initial, Problem } from './engine.mjs';

const STATE = 'state/queue';
const ADMIN = 'config/admin';
const SECRET = 'config/session-secret';
const accountKey = (email) => `accounts/${createHash('sha256').update(email).digest('hex')}`;
const MAX_ATTEMPTS = 10;
const pause = (attempt) => new Promise((r) => setTimeout(r, Math.random() * 25 * 2 ** attempt));

export class BlobStore {
  constructor(blobs) {
    this.blobs = blobs;
  }

  async read() {
    return (await this.blobs.get(STATE, { type: 'json' })) ?? initial();
  }

  async transact(fn) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.blobs.getWithMetadata(STATE, { type: 'json' });
      const state = current?.data ?? initial();
      const result = fn(state); // a thrown Problem aborts without writing (rollback)
      const write = await this.blobs.setJSON(STATE, state, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
      if (write.modified) return result;
      await pause(attempt);
    }
    throw new Problem('The queue is busy. Please try again.', 503);
  }

  async createAccount(account) {
    return (await this.blobs.setJSON(accountKey(account.email), account, { onlyIfNew: true })).modified;
  }

  async account(email) {
    return this.blobs.get(accountKey(email), { type: 'json' });
  }

  async hasAdmin() {
    return (await this.blobs.get(ADMIN, { type: 'json' })) !== null;
  }

  async createAdmin(account) {
    const claimed = await this.blobs.setJSON(ADMIN, { uid: account.uid, email: account.email }, { onlyIfNew: true });
    if (!claimed.modified) return false;
    return this.createAccount(account);
  }

  // Used only when SECRET_KEY is not configured: one random secret shared by all instances.
  async sessionSecret() {
    const fresh = randomBytes(32).toString('hex');
    await this.blobs.set(SECRET, fresh, { onlyIfNew: true });
    return this.blobs.get(SECRET);
  }
}

// In-memory store with the same compare-and-swap semantics, for tests.
export class MemoryStore {
  constructor() {
    this.state = JSON.stringify(initial());
    this.version = 0;
    this.accounts = new Map();
    this.admin = null;
    this.secret = randomBytes(32).toString('hex');
  }
  async read() { return JSON.parse(this.state); }
  async transact(fn) {
    for (;;) {
      const seen = this.version;
      const state = JSON.parse(this.state);
      await null; // yield, so concurrent transactions genuinely interleave
      const result = fn(state);
      await null;
      if (seen === this.version) {
        this.state = JSON.stringify(state);
        this.version++;
        return result;
      }
    }
  }
  async createAccount(account) {
    if (this.accounts.has(account.email)) return false;
    this.accounts.set(account.email, account);
    return true;
  }
  async account(email) { return this.accounts.get(email) ?? null; }
  async hasAdmin() { return this.admin !== null; }
  async createAdmin(account) {
    if (this.admin) return false;
    this.admin = account.uid;
    return this.createAccount(account);
  }
  async sessionSecret() { return this.secret; }
}
