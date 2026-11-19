import crypto from 'crypto';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import {
  resolveEffectivePlan,
  type BillingInterval,
  type PlanTier,
  type PublicUser,
  type SourceLink,
  type SubscriptionRow,
  type SubscriptionStatus,
  type UserPreferences,
  type UserRecord,
} from './types.js';

function isReadOnlyRuntime(): boolean {
  return Boolean(
    process.env.VERCEL === '1' ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

function tryEnsureWritableDir(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDataDir(): { dir: string; isEphemeral: boolean } {
  const customDir = process.env.NOVA_DATA_DIR?.trim();
  if (customDir && tryEnsureWritableDir(customDir)) {
    return { dir: path.resolve(customDir), isEphemeral: isReadOnlyRuntime() };
  }

  if (!isReadOnlyRuntime()) {
    const localDir = path.resolve(process.cwd(), 'data');
    if (tryEnsureWritableDir(localDir)) {
      return { dir: localDir, isEphemeral: false };
    }
  }

  const tmpDir = path.join(os.tmpdir(), 'nova-data');
  tryEnsureWritableDir(tmpDir);
  return { dir: tmpDir, isEphemeral: true };
}

const resolvedStorage = resolveDataDir();
export const DATA_DIR = resolvedStorage.dir;
export const IS_EPHEMERAL_STORAGE = resolvedStorage.isEphemeral;

const customDbPath = process.env.SQLITE_DB_PATH?.trim();
const DB_PATH = customDbPath ? path.resolve(customDbPath) : path.join(DATA_DIR, 'nova.db');
const db = new DatabaseSync(DB_PATH);

export function getDbStorageInfo(): { dbPath: string; isEphemeral: boolean } {
  return { dbPath: DB_PATH, isEphemeral: IS_EPHEMERAL_STORAGE };
}

try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch {
  // Ignore WAL errors on restricted/ephemeral filesystems
}

db.exec(`
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
    recovery_code_hash TEXT,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    token_version INTEGER NOT NULL DEFAULT 1,
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
    context_summary TEXT NOT NULL DEFAULT '',
    summarized_message_count INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS company_creations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sector TEXT NOT NULL,
    budget_eur REAL NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    logo_svg TEXT NOT NULL DEFAULT '',
    website_html TEXT NOT NULL DEFAULT '',
    published_slug TEXT,
    model_used TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_company_creations_user
    ON company_creations(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS published_sites (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    user_id TEXT,
    title TEXT NOT NULL,
    html_content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_published_sites_user
    ON published_sites(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS user_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content_markdown TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_documents_user
    ON user_documents(user_id, updated_at DESC);

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

// Safe migrations for existing databases
const safeMigrations = [
  `ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN recovery_code_hash TEXT`,
  `ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE conversations ADD COLUMN context_summary TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE conversations ADD COLUMN summarized_message_count INTEGER NOT NULL DEFAULT 0`,
];
for (const sql of safeMigrations) {
  try {
    db.exec(sql);
  } catch {
    // Column already exists
  }
}

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultExperience: 'debutant',
  preferredProvider: 'gemini',
  preferredModel: 'gemini-4-hydrogen',
  autoWebSearch: false,
};

function parsePreferences(raw: string | null | undefined): UserPreferences {
  if (!raw) return { ...DEFAULT_USER_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      defaultExperience:
        parsed.defaultExperience === 'intermediaire' || parsed.defaultExperience === 'confirme'
          ? parsed.defaultExperience
          : 'debutant',
      preferredProvider:
        parsed.preferredProvider === 'openai' ||
        parsed.preferredProvider === 'anthropic' ||
        parsed.preferredProvider === 'mistral'
          ? parsed.preferredProvider
          : 'gemini',
      preferredModel:
        typeof parsed.preferredModel === 'string' && parsed.preferredModel.trim()
          ? parsed.preferredModel.trim()
          : 'gemini-4-hydrogen',
      autoWebSearch: Boolean(parsed.autoWebSearch),
    };
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
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
    hasRecoveryCode: Boolean(row.recovery_code_hash),
    preferences: parsePreferences(row.preferences_json),
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
  recoveryCodeHash?: string | null;
}): UserRecord {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const normalizedEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim();
  const cleanCompany = (params.companyName ?? '').trim();

  db.prepare(
    `INSERT INTO users (
      id, email, password_hash, display_name, company_name,
      plan, billing_interval, subscription_status, cancel_at_period_end,
      recovery_code_hash, preferences_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'free', 'monthly', 'inactive', 0, ?, ?, ?, ?)`
  ).run(
    id,
    normalizedEmail,
    params.passwordHash,
    cleanName,
    cleanCompany,
    params.recoveryCodeHash ?? null,
    JSON.stringify(DEFAULT_USER_PREFERENCES),
    now,
    now
  );

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
    recoveryCodeHash?: string;
    bumpTokenVersion?: boolean;
    preferences?: Partial<UserPreferences>;
  }
): UserRecord | null {
  const current = findUserById(userId);
  if (!current) return null;
  const now = new Date().toISOString();
  const displayName =
    updates.displayName !== undefined
      ? updates.displayName.trim().slice(0, 80)
      : current.display_name;
  const companyName =
    updates.companyName !== undefined
      ? updates.companyName.trim().slice(0, 100)
      : current.company_name;
  const passwordHash = updates.passwordHash ?? current.password_hash;
  const recoveryCodeHash =
    updates.recoveryCodeHash !== undefined
      ? updates.recoveryCodeHash
      : current.recovery_code_hash ?? null;
  const shouldBumpToken = Boolean(updates.bumpTokenVersion || updates.passwordHash);
  const nextTokenVersion = (current.token_version ?? 1) + (shouldBumpToken ? 1 : 0);
  const mergedPrefs: UserPreferences = {
    ...parsePreferences(current.preferences_json),
    ...(updates.preferences ?? {}),
  };

  db.prepare(
    `UPDATE users SET
      display_name = ?,
      company_name = ?,
      password_hash = ?,
      recovery_code_hash = ?,
      preferences_json = ?,
      token_version = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    displayName,
    companyName,
    passwordHash,
    recoveryCodeHash,
    JSON.stringify(mergedPrefs),
    nextTokenVersion,
    now,
    userId
  );

  return findUserById(userId);
}

export function deleteUserAccount(userId: string): boolean {
  db.prepare('DELETE FROM usage_logs WHERE user_id = ?').run(userId);
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return Number(result.changes) > 0;
}

export function exportUserData(userId: string): Record<string, unknown> | null {
  const userRow = findUserById(userId);
  if (!userRow) return null;
  const conversations = listUserConversations(userId).map((conv) => ({
    ...conv,
    messages: listConversationMessages(conv.id, 1000),
  }));
  return {
    exportedAt: new Date().toISOString(),
    account: toPublicUser(userRow),
    conversations,
    businessProjects: listBusinessProjects(userId),
    companyCreations: listCompanyCreations(userId),
    publishedSites: listUserPublishedSites(userId),
    documents: listUserDocuments(userId),
    subscriptions: listUserSubscriptions(userId),
  };
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
  context_summary?: string;
  summarized_message_count?: number;
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
        (SELECT substr(m.content, 1, 140) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message_preview
       FROM conversations c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC
       LIMIT 150`
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
    `INSERT INTO conversations (id, user_id, title, category, context_summary, summarized_message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 0, ?, ?)`
  ).run(id, params.userId, cleanTitle, category, now, now);

  return {
    id,
    user_id: params.userId,
    title: cleanTitle,
    category,
    context_summary: '',
    summarized_message_count: 0,
    created_at: now,
    updated_at: now,
  };
}

export function updateConversationSummary(
  conversationId: string,
  summary: string,
  summarizedCount: number
): void {
  db.prepare(
    `UPDATE conversations SET context_summary = ?, summarized_message_count = ? WHERE id = ?`
  ).run(summary, summarizedCount, conversationId);
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
  limit = 300
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
      `SELECT * FROM (
         SELECT *, rowid AS _rid
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?
       ) sub
       ORDER BY created_at ASC, _rid ASC`
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

export function getLastConversationMessage(conversationId: string): MessageRow | null {
  const row = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(conversationId);
  return (row as unknown as MessageRow | undefined) ?? null;
}

export function deleteConversationMessage(
  messageId: string,
  conversationId: string
): boolean {
  const result = db
    .prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?')
    .run(messageId, conversationId);
  return Number(result.changes) > 0;
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
      'SELECT * FROM business_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 80'
    )
    .all(userId) as unknown as BusinessProjectRow[];
}

export function deleteBusinessProject(projectId: string, userId: string): boolean {
  const result = db
    .prepare('DELETE FROM business_projects WHERE id = ? AND user_id = ?')
    .run(projectId, userId);
  return Number(result.changes) > 0;
}

// Company Creations (Brand + Logo SVG + Commercial Offer + Business Plan + Website HTML)
export interface CompanyCreationRow {
  id: string;
  user_id: string;
  title: string;
  sector: string;
  budget_eur: number;
  data_json: string;
  logo_svg: string;
  website_html: string;
  published_slug: string | null;
  model_used: string | null;
  created_at: string;
  updated_at: string;
}

export function createCompanyCreation(params: {
  userId: string;
  title: string;
  sector: string;
  budgetEur: number;
  dataJson: string;
  logoSvg: string;
  websiteHtml: string;
  modelUsed?: string | null;
}): CompanyCreationRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO company_creations (
      id, user_id, title, sector, budget_eur, data_json, logo_svg, website_html,
      published_slug, model_used, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.title.trim().slice(0, 140),
    params.sector.trim().slice(0, 100),
    Number.isFinite(params.budgetEur) ? Math.max(0, params.budgetEur) : 0,
    params.dataJson,
    params.logoSvg,
    params.websiteHtml,
    params.modelUsed ?? null,
    now,
    now
  );

  return db
    .prepare('SELECT * FROM company_creations WHERE id = ? LIMIT 1')
    .get(id) as unknown as CompanyCreationRow;
}

export function listCompanyCreations(userId: string): CompanyCreationRow[] {
  return db
    .prepare(
      'SELECT * FROM company_creations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 40'
    )
    .all(userId) as unknown as CompanyCreationRow[];
}

export function updateCompanyCreationAssets(
  id: string,
  userId: string,
  updates: {
    logoSvg?: string;
    websiteHtml?: string;
    publishedSlug?: string | null;
  }
): CompanyCreationRow | null {
  const existing = db
    .prepare('SELECT * FROM company_creations WHERE id = ? AND user_id = ? LIMIT 1')
    .get(id, userId) as unknown as CompanyCreationRow | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE company_creations SET
      logo_svg = ?,
      website_html = ?,
      published_slug = ?,
      updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    updates.logoSvg !== undefined ? updates.logoSvg : existing.logo_svg,
    updates.websiteHtml !== undefined ? updates.websiteHtml : existing.website_html,
    updates.publishedSlug !== undefined ? updates.publishedSlug : existing.published_slug,
    now,
    id,
    userId
  );

  return db
    .prepare('SELECT * FROM company_creations WHERE id = ? LIMIT 1')
    .get(id) as unknown as CompanyCreationRow;
}

export function deleteCompanyCreation(id: string, userId: string): boolean {
  const res = db
    .prepare('DELETE FROM company_creations WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return Number(res.changes) > 0;
}

// Published Sites (Real live URL hosting on /sites/:slug)
export interface PublishedSiteRow {
  id: string;
  slug: string;
  user_id: string | null;
  title: string;
  html_content: string;
  created_at: string;
  updated_at: string;
}

function slugifyTitle(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'site-nova'}-${suffix}`;
}

export function publishSite(params: {
  userId: string | null;
  title: string;
  htmlContent: string;
  existingSlug?: string | null;
}): PublishedSiteRow {
  const now = new Date().toISOString();
  if (params.existingSlug && params.userId) {
    const existing = db
      .prepare('SELECT * FROM published_sites WHERE slug = ? AND user_id = ? LIMIT 1')
      .get(params.existingSlug, params.userId) as unknown as PublishedSiteRow | undefined;
    if (existing) {
      db.prepare(
        'UPDATE published_sites SET title = ?, html_content = ?, updated_at = ? WHERE id = ?'
      ).run(params.title.trim().slice(0, 140), params.htmlContent, now, existing.id);
      return db
        .prepare('SELECT * FROM published_sites WHERE id = ? LIMIT 1')
        .get(existing.id) as unknown as PublishedSiteRow;
    }
  }

  const id = crypto.randomUUID();
  const slug = slugifyTitle(params.title);
  db.prepare(
    `INSERT INTO published_sites (id, slug, user_id, title, html_content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, slug, params.userId, params.title.trim().slice(0, 140), params.htmlContent, now, now);

  return db
    .prepare('SELECT * FROM published_sites WHERE id = ? LIMIT 1')
    .get(id) as unknown as PublishedSiteRow;
}

export function getPublishedSiteBySlug(slug: string): PublishedSiteRow | null {
  const row = db
    .prepare('SELECT * FROM published_sites WHERE slug = ? LIMIT 1')
    .get(slug);
  return (row as unknown as PublishedSiteRow | undefined) ?? null;
}

export function listUserPublishedSites(userId: string): Array<Omit<PublishedSiteRow, 'html_content'>> {
  return db
    .prepare(
      'SELECT id, slug, user_id, title, created_at, updated_at FROM published_sites WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
    )
    .all(userId) as unknown as Array<Omit<PublishedSiteRow, 'html_content'>>;
}

export function countUserPublishedSites(userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM published_sites WHERE user_id = ?')
    .get(userId) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export function deletePublishedSite(id: string, userId: string): boolean {
  const res = db
    .prepare('DELETE FROM published_sites WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return Number(res.changes) > 0;
}

// User Documents (Invoices, Quotes, Proposals, Business Plans, Reports)
export interface UserDocumentRow {
  id: string;
  user_id: string;
  doc_type: string;
  title: string;
  content_markdown: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export function createUserDocument(params: {
  userId: string;
  docType: string;
  title: string;
  contentMarkdown: string;
  metadataJson?: string;
}): UserDocumentRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_documents (id, user_id, doc_type, title, content_markdown, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.docType.trim().slice(0, 50),
    params.title.trim().slice(0, 140),
    params.contentMarkdown,
    params.metadataJson ?? '{}',
    now,
    now
  );
  return db
    .prepare('SELECT * FROM user_documents WHERE id = ? LIMIT 1')
    .get(id) as unknown as UserDocumentRow;
}

export function listUserDocuments(userId: string): UserDocumentRow[] {
  return db
    .prepare(
      'SELECT * FROM user_documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 80'
    )
    .all(userId) as unknown as UserDocumentRow[];
}

export function deleteUserDocument(id: string, userId: string): boolean {
  const res = db
    .prepare('DELETE FROM user_documents WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return Number(res.changes) > 0;
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
  totalCompanyCreations: number;
  totalDocuments: number;
  totalPublishedSites: number;
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
  const totalCompanyCreations = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM company_creations WHERE user_id = ?`)
        .get(userId) as { c?: number } | undefined
    )?.c ?? 0
  );
  const totalDocuments = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM user_documents WHERE user_id = ?`)
        .get(userId) as { c?: number } | undefined
    )?.c ?? 0
  );
  const totalPublishedSites = countUserPublishedSites(userId);

  return {
    messagesToday,
    businessToday,
    totalMessages,
    totalConversations,
    totalBusinessProjects,
    totalCompanyCreations,
    totalDocuments,
    totalPublishedSites,
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
