import crypto from 'crypto';
import type express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, findUserById, toPublicUser } from './db.js';
import type { PublicUser, UserRecord } from './types.js';

const SESSION_COOKIE_NAME = 'nova_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

function getSessionSecret(): Buffer {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret !== 'REPLACE_WITH_LONG_RANDOM_SECRET' && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }

  const keyFile = path.join(DATA_DIR, '.session_key');
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) {
        return Buffer.from(existing, 'hex');
      }
    }
    const seedMaterial =
      process.env.VERCEL === '1'
        ? crypto
            .createHash('sha256')
            .update(
              `nova-vercel:${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'default'}:${process.env.GEMINI_API_KEY || 'local'}`
            )
            .digest('hex')
        : crypto.randomBytes(32).toString('hex');

    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, seedMaterial, { mode: 0o600 });
    return Buffer.from(seedMaterial, 'hex');
  } catch {
    const fallbackMaterial =
      process.env.GEMINI_API_KEY ||
      process.env.VERCEL_URL ||
      crypto.randomBytes(32).toString('hex');
    return crypto.createHash('sha256').update(`nova-session:${fallbackMaterial}`).digest();
  }
}

const SESSION_SECRET_KEY = getSessionSecret();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

interface SessionPayload {
  uid: string;
  exp: number;
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET_KEY)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET_KEY)
    .update(encodedPayload)
    .digest('base64url');

  const bufA = Buffer.from(providedSig, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (!parsed.uid || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function setSessionCookie(req: express.Request, res: express.Response, userId: string): void {
  const token = createSessionToken(userId);
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1';

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1';

  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function hashIp(ip: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET_KEY)
    .update(ip)
    .digest('hex')
    .slice(0, 24);
}

export function getAuthenticatedUserRecord(req: express.Request): UserRecord | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return findUserById(payload.uid);
}

export function getAuthenticatedPublicUser(req: express.Request): PublicUser | null {
  const record = getAuthenticatedUserRecord(req);
  return record ? toPublicUser(record) : null;
}

// Sliding window burst rate limiter against brute force and flood requests
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = rateBuckets.get(bucketKey) ?? [];
  const active = existing.filter((t) => t > cutoff);

  if (active.length >= maxRequests) {
    const oldest = active[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    rateBuckets.set(bucketKey, active);
    return { allowed: false, retryAfterSec };
  }

  active.push(now);
  rateBuckets.set(bucketKey, active);

  // Periodic cleanup if map grows
  if (rateBuckets.size > 5000) {
    for (const [k, times] of rateBuckets.entries()) {
      if (times.every((t) => t <= cutoff)) {
        rateBuckets.delete(k);
      }
    }
  }

  return { allowed: true, retryAfterSec: 0 };
}
