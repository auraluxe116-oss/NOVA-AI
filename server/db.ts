import crypto from 'crypto';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import {
  resolveEffectivePlan,
  type BillingInterval,
  type PlanTier,
  type PublicUser,
  type SourceLink,
  type SubscriptionRow,
  type SubscriptionStatus,
  type UserRecord,
} from './types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'nova.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'free',
    billing_interval TEXT NOT NULL DEFAULT 'monthly',
    subscription_status TEXT NOT NULL DEFAULT 'inactive',
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT,
    plan TEXT NOT NULL,
    billing_interval TEXT NOT NULL DEFAULT 'monthly',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'eur',
    status TEXT NOT NULL,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    current_period_start TEXT,
    current_period_end TEXT,
    canceled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_user
    ON subscriptions(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON conversations(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    attachment_name TEXT,
    model_used TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv_created
    ON messages(conversation_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS business_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    module_key TEXT NOT NULL,
    title TEXT NOT NULL,
    sector TEXT NOT NULL,
    budget_eur REAL NOT NULL DEFAULT 0,
    goal TEXT NOT NULL,
    content_markdown TEXT NOT NULL,
    model_used TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_business_projects_user
    ON business_projects(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    ip_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    day_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user_day
    ON usage_logs(user_id, kind, day_key);

  CREATE INDEX IF NOT EXISTS idx_usage_ip_day
    ON usage_logs(ip_hash, kind, day_key);

  CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TEXT NOT NULL
  );
`);

// Safe migration if database existed before cancel_at_period_end column was added
try {
  db.exec(`ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists
}

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toPublicUser(row: UserRecord): PublicUser {
  const validPlans: PlanTier[] = ['free', 'pro', 'business'];
  const plan: PlanTier = validPlans.includes(row.plan) ? row.plan : 'free';
  const effectivePlan = resolveEffectivePlan(row);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    companyName: row.company_name || '',
    plan,
    effectivePlan,
    billingInterval: row.billing_interval === 'annual' ? 'annual' : 'monthly',
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) || 'inactive',
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    createdAt: row.created_at,
  };
}

export function findUserByEmail(email: string): UserRecord | null {
  const row = db
    .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
    .get(email.trim().toLowerCase());
  return (row as unknown as UserRecord | undefined) ?? null;
}

export function findUserById(id: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id);
  return (row as unknown as UserRecord | undefined) ?? null;
}

export function findUserByStripeCustomerId(customerId: string): UserRecord | null {
  const row = db
    .prepare('SELECT * FROM users WHERE stripe_customer_id = ? LIMIT 1')
    .get(customerId);
  return (row as unknown as UserRecord | undefined) ?? null;
}

export function findUserByStripeSubscriptionId(subscriptionId: string): UserRecord | null {
  const row = db
    .prepare('SELECT * FROM users WHERE stripe_subscription_id = ? LIMIT 1')
    .get(subscriptionId);
  return (row as unknown as UserRecord | undefined) ?? null;
}

export function createUser(params: {
  email: string;
  passwordHash: string;
  displayName: string;
  companyName?: string;
}): UserRecord {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const normalizedEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim();
  const cleanCompany = (params.companyName ?? '').trim();

  db.prepare(
    `INSERT INTO users (
      id, email, password_hash, display_name, company_name,
      plan, billing_interval, subscription_status, cancel_at_period_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'free', 'monthly', 'inactive', 0, ?, ?)`
  ).run(id, normalizedEmail, params.passwordHash, cleanName, cleanCompany, now, now);

  const created = findUserById(id);
  if (!created) {
    throw new Error('Impossible de créer le compte utilisateur.');
  }
  return created;
}

export function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string;
    companyName?: string;
    passwordHash?: string;
  }
): UserRecord | null {
  const current = findUserById(userId);
  if (!current) return null;
  const now = new Date().toISOString();
  const displayName =
    updates.displayName !== undefined ? updates.displayName.trim() : current.display_name;
  const companyName =
    updates.companyName !== undefined ? updates.companyName.trim() : current.company_name;
  const passwordHash = updates.passwordHash ?? current.password_hash;

  db.prepare(
    `UPDATE users SET display_name = ?, company_name = ?, password_hash = ?, updated_at = ? WHERE id = ?`
  ).run(displayName, companyName, passwordHash, now, userId);

  return findUserById(userId);
}

export function updateUserSubscription(
  userId: string,
  updates: {
    plan: PlanTier;
    billingInterval?: BillingInterval;
    subscriptionStatus: SubscriptionStatus;
    cancelAtPeriodEnd?: boolean;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
  }
): UserRecord | null {
  const current = findUserById(userId);
  if (!current) return null;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE users SET
      plan = ?,
      billing_interval = ?,
      subscription_status = ?,
      cancel_at_period_end = ?,
      stripe_customer_id = ?,
      stripe_subscription_id = ?,
      current_period_end = ?,
      updated_at = ?
    WHERE id = ?`
  ).run(
    updates.plan,
    updates.billingInterval ?? current.billing_interval,
    updates.subscriptionStatus,
    updates.cancelAtPeriodEnd !== undefined
      ? updates.cancelAtPeriodEnd
        ? 1
        : 0
      : current.cancel_at_period_end,
    updates.stripeCustomerId !== undefined
      ? updates.stripeCustomerId
      : current.stripe_customer_id,
    updates.stripeSubscriptionId !== undefined
      ? updates.stripeSubscriptionId
      : current.stripe_subscription_id,
    updates.currentPeriodEnd !== undefined
      ? updates.currentPeriodEnd
      : current.current_period_end,
    now,
    userId
  );

  return findUserById(userId);
}

export function upsertSubscriptionRecord(params: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  plan: PlanTier;
  billingInterval: BillingInterval;
  amountCents: number;
  currency?: string;
  status: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  canceledAt?: string | null;
}): SubscriptionRow {
  const now = new Date().toISOString();
  const existing = params.stripeSubscriptionId
    ? (db
        .prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ? LIMIT 1')
        .get(params.stripeSubscriptionId) as unknown as SubscriptionRow | undefined)
    : undefined;

  if (existing) {
    db.prepare(
      `UPDATE subscriptions SET
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_checkout_session_id = COALESCE(?, stripe_checkout_session_id),
        plan = ?,
        billing_interval = ?,
        amount_cents = CASE WHEN ? > 0 THEN ? ELSE amount_cents END,
        status = ?,
        cancel_at_period_end = ?,
        current_period_start = COALESCE(?, current_period_start),
        current_period_end = COALESCE(?, current_period_end),
        canceled_at = COALESCE(?, canceled_at),
        updated_at = ?
      WHERE id = ?`
    ).run(
      params.stripeCustomerId ?? null,
      params.stripeCheckoutSessionId ?? null,
      params.plan,
      params.billingInterval,
      params.amountCents,
      params.amountCents,
      params.status,
      params.cancelAtPeriodEnd ? 1 : 0,
      params.currentPeriodStart ?? null,
      params.currentPeriodEnd ?? null,
      params.canceledAt ?? null,
      now,
      existing.id
    );
    return db
      .prepare('SELECT * FROM subscriptions WHERE id = ? LIMIT 1')
      .get(existing.id) as unknown as SubscriptionRow;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO subscriptions (
      id, user_id, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id,
      plan, billing_interval, amount_cents, currency, status, cancel_at_period_end,
      current_period_start, current_period_end, canceled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.stripeCustomerId ?? null,
    params.stripeSubscriptionId ?? null,
    params.stripeCheckoutSessionId ?? null,
    params.plan,
    params.billingInterval,
    params.amountCents,
    params.currency ?? 'eur',
    params.status,
    params.cancelAtPeriodEnd ? 1 : 0,
    params.currentPeriodStart ?? null,
    params.currentPeriodEnd ?? null,
    params.canceledAt ?? null,
    now,
    now
  );

  return db
    .prepare('SELECT * FROM subscriptions WHERE id = ? LIMIT 1')
    .get(id) as unknown as SubscriptionRow;
}

export function listUserSubscriptions(userId: string): SubscriptionRow[] {
  return db
    .prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20'
    )
    .all(userId) as unknown as SubscriptionRow[];
}

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  category: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message_preview?: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources_json: string;
  attachment_name: string | null;
  model_used: string | null;
  latency_ms: number | null;
  created_at: string;
}

export function listUserConversations(userId: string): ConversationRow[] {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
        (SELECT substr(m.content, 1, 140) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview
       FROM conversations c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC
       LIMIT 100`
    )
    .all(userId);
  return rows as unknown as ConversationRow[];
}

export function getConversationForUser(
  conversationId: string,
  userId: string
): ConversationRow | null {
  const row = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ? LIMIT 1')
    .get(conversationId, userId);
  return (row as unknown as ConversationRow | undefined) ?? null;
}

export function createConversation(params: {
  userId: string;
  title: string;
  category?: 'general' | 'business' | 'document';
}): ConversationRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanTitle = params.title.trim().slice(0, 120) || 'Nouvelle conversation';
  const category = params.category ?? 'general';

  db.prepare(
    `INSERT INTO conversations (id, user_id, title, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.userId, cleanTitle, category, now, now);

  return {
    id,
    user_id: params.userId,
    title: cleanTitle,
    category,
    created_at: now,
    updated_at: now,
  };
}

export function renameConversation(
  conversationId: string,
  userId: string,
  title: string
): ConversationRow | null {
  const conv = getConversationForUser(conversationId, userId);
  if (!conv) return null;
  const cleanTitle = title.trim().slice(0, 120);
  if (!cleanTitle) return conv;
  const now = new Date().toISOString();
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    cleanTitle,
    now,
    conversationId,
    userId
  );
  return getConversationForUser(conversationId, userId);
}

export function deleteConversation(conversationId: string, userId: string): boolean {
  const result = db
    .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
    .run(conversationId, userId);
  return Number(result.changes) > 0;
}

export function listConversationMessages(
  conversationId: string,
  limit = 60
): Array<{
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: SourceLink[];
  attachmentName: string | null;
  modelUsed: string | null;
  latencyMs: number | null;
  createdAt: string;
}> {
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
    )
    .all(conversationId, limit) as unknown as MessageRow[];

  return rows.map((row) => {
    let sources: SourceLink[] = [];
    try {
      const parsed = JSON.parse(row.sources_json);
      if (Array.isArray(parsed)) sources = parsed;
    } catch {
      sources = [];
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      sources,
      attachmentName: row.attachment_name,
      modelUsed: row.model_used,
      latencyMs: row.latency_ms,
      createdAt: row.created_at,
    };
  });
}

export function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceLink[];
  attachmentName?: string | null;
  modelUsed?: string | null;
  latencyMs?: number | null;
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, role, content, sources_json,
      attachment_name, model_used, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.conversationId,
    params.role,
    params.content,
    JSON.stringify(params.sources ?? []),
    params.attachmentName ?? null,
    params.modelUsed ?? null,
    params.latencyMs ?? null,
    now
  );

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    now,
    params.conversationId
  );

  return id;
}

export interface BusinessProjectRow {
  id: string;
  user_id: string;
  module_key: string;
  title: string;
  sector: string;
  budget_eur: number;
  goal: string;
  content_markdown: string;
  model_used: string | null;
  created_at: string;
}

export function createBusinessProject(params: {
  userId: string;
  moduleKey: string;
  title: string;
  sector: string;
  budgetEur: number;
  goal: string;
  contentMarkdown: string;
  modelUsed?: string | null;
}): BusinessProjectRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO business_projects (
      id, user_id, module_key, title, sector, budget_eur, goal,
      content_markdown, model_used, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.moduleKey,
    params.title.trim().slice(0, 140),
    params.sector.trim().slice(0, 100),
    Number.isFinite(params.budgetEur) ? Math.max(0, params.budgetEur) : 0,
    params.goal.trim().slice(0, 300),
    params.contentMarkdown,
    params.modelUsed ?? null,
    now
  );

  return db
    .prepare('SELECT * FROM business_projects WHERE id = ? LIMIT 1')
    .get(id) as unknown as BusinessProjectRow;
}

export function listBusinessProjects(userId: string): BusinessProjectRow[] {
  return db
    .prepare(
      'SELECT * FROM business_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    )
    .all(userId) as unknown as BusinessProjectRow[];
}

export function deleteBusinessProject(projectId: string, userId: string): boolean {
  const result = db
    .prepare('DELETE FROM business_projects WHERE id = ? AND user_id = ?')
    .run(projectId, userId);
  return Number(result.changes) > 0;
}

export function recordUsage(params: {
  userId: string | null;
  ipHash: string;
  kind: 'chat' | 'business';
}): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dayKey = getTodayKey();
  db.prepare(
    `INSERT INTO usage_logs (id, user_id, ip_hash, kind, day_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.userId, params.ipHash, params.kind, dayKey, now);
}

export function getDailyUsageCount(params: {
  userId: string | null;
  ipHash: string;
  kind: 'chat' | 'business';
}): number {
  const dayKey = getTodayKey();
  if (params.userId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM usage_logs WHERE user_id = ? AND kind = ? AND day_key = ?`
      )
      .get(params.userId, params.kind, dayKey) as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM usage_logs WHERE user_id IS NULL AND ip_hash = ? AND kind = ? AND day_key = ?`
    )
    .get(params.ipHash, params.kind, dayKey) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
}

export function getUserDashboardStats(userId: string): {
  messagesToday: number;
  businessToday: number;
  totalMessages: number;
  totalConversations: number;
  totalBusinessProjects: number;
} {
  const dayKey = getTodayKey();
  const messagesToday = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM usage_logs WHERE user_id = ? AND kind = 'chat' AND day_key = ?`
        )
        .get(userId, dayKey) as { c?: number } | undefined
    )?.c ?? 0
  );
  const businessToday = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM usage_logs WHERE user_id = ? AND kind = 'business' AND day_key = ?`
        )
        .get(userId, dayKey) as { c?: number } | undefined
    )?.c ?? 0
  );
  const totalConversations = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM conversations WHERE user_id = ?`)
        .get(userId) as { c?: number } | undefined
    )?.c ?? 0
  );
  const totalMessages = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.user_id = ? AND m.role = 'user'`
        )
        .get(userId) as { c?: number } | undefined
    )?.c ?? 0
  );
  const totalBusinessProjects = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM business_projects WHERE user_id = ?`)
        .get(userId) as { c?: number } | undefined
    )?.c ?? 0
  );

  return {
    messagesToday,
    businessToday,
    totalMessages,
    totalConversations,
    totalBusinessProjects,
  };
}

export function isStripeEventProcessed(eventId: string): boolean {
  const row = db
    .prepare('SELECT id FROM stripe_events WHERE id = ? LIMIT 1')
    .get(eventId);
  return Boolean(row);
}

export function markStripeEventProcessed(eventId: string, eventType: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, event_type, processed_at) VALUES (?, ?, ?)`
  ).run(eventId, eventType, now);
}
