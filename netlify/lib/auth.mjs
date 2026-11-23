// Accounts, password hashing, signed session tokens and signed QR share links.
// Port of backend/auth.py + backend/sharing.py (HMAC-SHA256 instead of itsdangerous).
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Problem, hexId, nowSeconds } from './engine.mjs';

const scrypt = promisify(scryptCb);
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const SESSION_MAX_AGE = 86400;
export const SHARE_SALT = 'tokenflow-readonly-ticket-v1';
const SESSION_SALT = 'tokenflow-session-v1';

// ---- signing -------------------------------------------------------------
const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (secret, salt, data) => createHmac('sha256', secret).update(`${salt}.${data}`).digest('base64url');

export function sign(secret, salt, payload) {
  const body = b64(JSON.stringify({ d: payload, t: Math.floor(nowSeconds()) }));
  return `${body}.${mac(secret, salt, body)}`;
}

export class BadSignature extends Error {}
export class SignatureExpired extends Error {}

export function unsign(secret, salt, token, maxAge) {
  if (typeof token !== 'string') throw new BadSignature();
  const dot = token.lastIndexOf('.');
  if (dot < 1) throw new BadSignature();
  const body = token.slice(0, dot);
  const expected = Buffer.from(mac(secret, salt, body));
  const given = Buffer.from(token.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new BadSignature();
  let parsed;
  try { parsed = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new BadSignature(); }
  if (nowSeconds() - parsed.t > maxAge) throw new SignatureExpired();
  return parsed.d;
}

// ---- passwords -----------------------------------------------------------
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function checkPassword(stored, password) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

// ---- accounts ------------------------------------------------------------
export function credentials(email, password) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Problem('Enter a valid email address');
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Problem('Password must contain 8 to 256 characters');
  return { email, password };
}

export async function registerUser(store, name, email, password) {
  name = typeof name === 'string' ? name.trim() : '';
  if (!name || name.length > 60) throw new Problem('Name must contain 1 to 60 characters');
  ({ email, password } = credentials(email, password));
  const user = { uid: hexId(), name, email, role: 'customer' };
  const created = await store.createAccount({ ...user, passwordHash: await hashPassword(password), createdAt: Math.floor(nowSeconds()) });
  if (!created) throw new Problem('An account with this email already exists', 409);
  return user;
}

export async function authenticate(store, email, password, role) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  password = typeof password === 'string' ? password : '';
  const account = email ? await store.account(email) : null;
  if (!account || account.role !== role || !(await checkPassword(account.passwordHash, password))) {
    throw new Problem('Email or password is incorrect', 401);
  }
  return { uid: account.uid, name: account.name, email: account.email, role: account.role };
}

export async function createAdmin(store) {
  const email = `admin-${randomBytes(5).toString('hex')}@tokenflow.local`;
  const password = randomBytes(18).toString('base64url');
  const user = { uid: hexId(), name: 'Administrator', email, role: 'admin' };
  const created = await store.createAdmin({ ...user, passwordHash: await hashPassword(password), createdAt: Math.floor(nowSeconds()) });
  if (!created) throw new Problem('Admin setup has already been completed', 409);
  return { user, password };
}

export function issue(secret, user) {
  const info = { uid: user.uid, role: user.role, displayName: user.name || '', departmentIds: user.role === 'admin' ? ['*'] : [] };
  return { token: sign(secret, SESSION_SALT, info), user };
}

export function actor(secret, request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Problem('Sign in to continue', 401);
  let info;
  try {
    info = unsign(secret, SESSION_SALT, header.slice(7), SESSION_MAX_AGE);
  } catch {
    throw new Problem('Your session expired. Sign in again.', 401);
  }
  if (!info || info.uid === 'demo-admin' || !['admin', 'customer'].includes(info.role)) throw new Problem('Sign in again with your account', 401);
  return info;
}

// ---- read-only QR share links (key travels in the URL fragment) ---------
export function shareLink(secret, origin, t, ttl) {
  const key = sign(secret, SHARE_SALT, { id: t.id, v: t.shareVersion || 0 });
  return { url: `${origin}/track/${t.id}#key=${key}`, expiresInSeconds: ttl };
}

export function verifyShare(secret, t, key, ttl) {
  if (!key) throw new Problem('Open a current QR link, or sign in as the ticket owner.', 401);
  let data;
  try {
    data = unsign(secret, SHARE_SALT, key, ttl);
  } catch (e) {
    if (e instanceof SignatureExpired) throw new Problem('This QR link has expired. Ask the ticket owner for a new QR.', 410);
    throw new Problem('This QR link is invalid.', 403);
  }
  if (data.id !== t.id || data.v !== (t.shareVersion || 0)) throw new Problem('This QR link has been revoked or is invalid.', 403);
  const terminal = t.serviceEndTime || t.updatedAt || t.arrivalTime;
  if (['completed', 'cancelled'].includes(t.status) && nowSeconds() - terminal > 86400) throw new Problem('This ticket link is no longer available.', 410);
}
