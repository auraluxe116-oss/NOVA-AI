import crypto from 'crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { Pool as PgPool, type PoolConfig } from 'pg';
import { DataType, newDb } from 'pg-mem';
import {
  resolveEffectivePlan,
  type PlanTier,
  type PublicUser,
  type SourceLink,
  type UserPreferences,
  type UserRecord,
} from './types.js';

export interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlQueryAdapter {
  provider: 'neon' | 'postgresql' | 'pg-mem';
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  runStatements?(statements: Array<{ text: string; params?: unknown[] }>): Promise<void>;
  close?(): Promise<void>;
}

export interface DatabaseHealthReport {
  configured: boolean;
  connected: boolean;
  engine: 'postgresql';
  provider: 'neon' | 'postgresql' | 'pg-mem' | 'unconfigured';
  ephemeral: boolean;
  latencyMs: number | null;
  schemaVersion: number | null;
  error: string | null;
}

interface GlobalDbRegistry {
  connectionString: string | null;
  adapter: SqlQueryAdapter | null;
  migratedAdapter: SqlQueryAdapter | null;
  migrationPromise: Promise<void> | null;
  testOverrideAdapter: SqlQueryAdapter | null;
}

const GLOBAL_REGISTRY_KEY = '__novaPgRegistryV1';

function getRegistry(): GlobalDbRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_REGISTRY_KEY]) {
    g[GLOBAL_REGISTRY_KEY] = {
      connectionString: null,
      adapter: null,
      migratedAdapter: null,
      migrationPromise: null,
      testOverrideAdapter: null,
    } satisfies GlobalDbRegistry;
  }
  return g[GLOBAL_REGISTRY_KEY] as GlobalDbRegistry;
}

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL === '1' ||
      process.env.VERCEL_ENV ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

export function getConfiguredDatabaseUrl(): string | null {
  let raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  if (
    !raw ||
    raw === 'MY_DATABASE_URL' ||
    raw === 'REPLACE_WITH_NEON_DATABASE_URL' ||
    raw.includes('USER:PASSWORD@')
  ) {
    return null;
  }
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    return null;
  }
  return raw;
}

export function isNeonDatabaseUrl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('.neon.tech') || host.endsWith('.neon.build') || host.includes('neon');
  } catch {
    return false;
  }
}

export function sanitizeDbErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Erreur PostgreSQL inconnue.');
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[MASQUE]')
    .replace(/password=[^\s&'"]+/gi, 'password=[MASQUE]')
    .slice(0, 260);
}

function createNeonAdapter(connectionString: string): SqlQueryAdapter {
  const sql: NeonQueryFunction<false, true> = neon(connectionString, {
    fullResults: true,
  });

  return {
    provider: 'neon',
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: unknown[] = []
    ): Promise<QueryResult<T>> {
      const result = await sql.query(text, params);
      return {
        rows: (result.rows ?? []) as T[],
        rowCount: Number(result.rowCount ?? result.rows?.length ?? 0),
      };
    },
    async runStatements(statements: Array<{ text: string; params?: unknown[] }>): Promise<void> {
      if (statements.length === 0) return;
      await sql.transaction((tx) =>
        statements.map((stmt) => tx.query(stmt.text, stmt.params ?? []))
      );
    },
    async close(): Promise<void> {
      // HTTP stateless driver has no persistent sockets to close
    },
  };
}

function createPgPoolAdapter(connectionString: string): SqlQueryAdapter {
  let useSsl = true;
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    if (sslMode === 'disable' || host === 'localhost' || host === '127.0.0.1') {
      useSsl = false;
    }
  } catch {
    useSsl = true;
  }

  const config: PoolConfig = {
    connectionString,
    max: isServerlessRuntime() ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  };

  const pool = new PgPool(config);
  pool.on('error', (err) => {
    console.error('[NOVA AI] Erreur pool PostgreSQL:', sanitizeDbErrorMessage(err));
  });

  return {
    provider: 'postgresql',
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: unknown[] = []
    ): Promise<QueryResult<T>> {
      const result = await pool.query(text, params);
      return {
        rows: (result.rows ?? []) as T[],
        rowCount: Number(result.rowCount ?? result.rows?.length ?? 0),
      };
    },
    async runStatements(statements: Array<{ text: string; params?: unknown[] }>): Promise<void> {
      if (statements.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const stmt of statements) {
          await client.query(stmt.text, stmt.params ?? []);
        }
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback errors
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function createMemoryPgAdapter(): SqlQueryAdapter {
  const mem = newDb();
  mem.public.registerFunction({
    name: 'substr',
    args: [DataType.text, DataType.integer, DataType.integer],
    returns: DataType.text,
    implementation: (str: string | null, start: number, len: number) => {
      const text = String(str ?? '');
      const begin = Math.max(0, Number(start) - 1);
      return text.slice(begin, begin + Math.max(0, Number(len)));
    },
  });

  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  return {
    provider: 'pg-mem',
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: unknown[] = []
    ): Promise<QueryResult<T>> {
      const result = await pool.query(text, params);
      return {
        rows: (result.rows ?? []) as T[],
        rowCount: Number(result.rowCount ?? result.rows?.length ?? 0),
      };
    },
    async runStatements(statements: Array<{ text: string; params?: unknown[] }>): Promise<void> {
      for (const stmt of statements) {
        await pool.query(stmt.text, stmt.params ?? []);
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function setDatabaseAdapterForTests(adapter: SqlQueryAdapter | null): void {
  const reg = getRegistry();
  reg.testOverrideAdapter = adapter;
  reg.migratedAdapter = null;
  reg.migrationPromise = null;
}

function getOrCreateAdapter(): SqlQueryAdapter {
  const reg = getRegistry();
  if (reg.testOverrideAdapter) {
    return reg.testOverrideAdapter;
  }

  const connectionString = getConfiguredDatabaseUrl();
  if (!connectionString) {
    if (isServerlessRuntime()) {
      throw new Error(
        'DATABASE_URL_MISSING: La variable d’environnement DATABASE_URL (Neon PostgreSQL gratuit) est requise en serverless.'
      );
    }
    if (reg.adapter && reg.connectionString === '__pg_mem_local__') {
      return reg.adapter;
    }
    const memAdapter = createMemoryPgAdapter();
    reg.connectionString = '__pg_mem_local__';
    reg.adapter = memAdapter;
    reg.migratedAdapter = null;
    reg.migrationPromise = null;
    return memAdapter;
  }

  if (reg.adapter && reg.connectionString === connectionString) {
    return reg.adapter;
  }

  if (reg.adapter?.close) {
    void reg.adapter.close().catch(() => {});
  }

  const nextAdapter = isNeonDatabaseUrl(connectionString)
    ? createNeonAdapter(connectionString)
    : createPgPoolAdapter(connectionString);

  reg.connectionString = connectionString;
  reg.adapter = nextAdapter;
  reg.migratedAdapter = null;
  reg.migrationPromise = null;
  return nextAdapter;
}

export async function closeDatabase(): Promise<void> {
  const reg = getRegistry();
  if (reg.adapter?.close) {
    await reg.adapter.close();
  }
  if (reg.testOverrideAdapter?.close) {
    await reg.testOverrideAdapter.close();
  }
  reg.adapter = null;
  reg.connectionString = null;
  reg.migratedAdapter = null;
  reg.migrationPromise = null;
}

interface MigrationStep {
  version: number;
  name: string;
  statements: string[];
}

const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    name: '001_initial_postgresql_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
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
        current_period_end TIMESTAMPTZ,
        recovery_code_hash TEXT,
        preferences_json TEXT NOT NULL DEFAULT '{}',
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        stripe_checkout_session_id TEXT,
        plan TEXT NOT NULL,
        billing_interval TEXT NOT NULL DEFAULT 'monthly',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'eur',
        status TEXT NOT NULL,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        canceled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        context_summary TEXT NOT NULL DEFAULT '',
        summarized_message_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        seq BIGSERIAL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sources_json TEXT NOT NULL DEFAULT '[]',
        attachment_name TEXT,
        model_used TEXT,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC, seq ASC)`,
      `CREATE TABLE IF NOT EXISTS business_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_key TEXT NOT NULL,
        title TEXT NOT NULL,
        sector TEXT NOT NULL,
        budget_eur DOUBLE PRECISION NOT NULL DEFAULT 0,
        goal TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        model_used TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_business_projects_user ON business_projects(user_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS company_creations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        sector TEXT NOT NULL,
        budget_eur DOUBLE PRECISION NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        logo_svg TEXT NOT NULL DEFAULT '',
        website_html TEXT NOT NULL DEFAULT '',
        published_slug TEXT,
        model_used TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_company_creations_user ON company_creations(user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS published_sites (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        html_content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_published_sites_user ON published_sites(user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS user_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doc_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_documents_user ON user_documents(user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        ip_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        day_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_logs(user_id, kind, day_key)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_ip_day ON usage_logs(ip_hash, kind, day_key)`,
      `CREATE TABLE IF NOT EXISTS stripe_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    ],
  },
  {
    version: 2,
    name: '002_safe_columns_and_lookup_indexes',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_summary TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summarized_message_count INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id)`,
    ],
  },
];

async function runMigrations(adapter: SqlQueryAdapter): Promise<void> {
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedRes = await adapter.query<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const appliedVersions = new Set(appliedRes.rows.map((r) => Number(r.version)));

  const pending = MIGRATIONS.filter((m) => !appliedVersions.has(m.version));
  if (pending.length === 0) {
    return;
  }

  const batch: Array<{ text: string; params?: unknown[] }> = [];
  if (adapter.provider !== 'pg-mem') {
    batch.push({ text: 'SELECT pg_advisory_xact_lock(79045123)' });
  }
  for (const step of pending) {
    for (const stmt of step.statements) {
      batch.push({ text: stmt });
    }
    batch.push({
      text: `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
      params: [step.version, step.name],
    });
  }

  if (adapter.runStatements) {
    await adapter.runStatements(batch);
  } else {
    for (const item of batch) {
      await adapter.query(item.text, item.params ?? []);
    }
  }
}

export async function ensureDatabaseReady(): Promise<SqlQueryAdapter> {
  const adapter = getOrCreateAdapter();
  const reg = getRegistry();

  if (reg.migratedAdapter === adapter) {
    return adapter;
  }

  if (!reg.migrationPromise || reg.migratedAdapter !== null) {
    reg.migrationPromise = runMigrations(adapter)
      .then(() => {
        reg.migratedAdapter = adapter;
      })
      .catch((err) => {
        reg.migrationPromise = null;
        reg.migratedAdapter = null;
        throw err;
      });
  }

  await reg.migrationPromise;
  return adapter;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  const reg = getRegistry();
  const hasRealUrl = Boolean(getConfiguredDatabaseUrl());
  const configured = Boolean(reg.testOverrideAdapter || hasRealUrl || !isServerlessRuntime());

  if (!configured) {
    return {
      configured: false,
      connected: false,
      engine: 'postgresql',
      provider: 'unconfigured',
      ephemeral: false,
      latencyMs: null,
      schemaVersion: null,
      error: 'Variable DATABASE_URL non configurée.',
    };
  }

  const started = Date.now();
  try {
    const adapter = await ensureDatabaseReady();
    await adapter.query('SELECT 1 AS ok');
    const verRes = await adapter.query<{ v: number }>(
      'SELECT COALESCE(MAX(version), 0)::int AS v FROM schema_migrations'
    );
    const isLocalEphemeral = !reg.testOverrideAdapter && !hasRealUrl && adapter.provider === 'pg-mem';
    return {
      configured: true,
      connected: true,
      engine: 'postgresql',
      provider: adapter.provider,
      ephemeral: isLocalEphemeral,
      latencyMs: Date.now() - started,
      schemaVersion: Number(verRes.rows[0]?.v ?? 0),
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      engine: 'postgresql',
      provider: reg.adapter?.provider ?? (isNeonDatabaseUrl(getConfiguredDatabaseUrl() || '') ? 'neon' : 'postgresql'),
      ephemeral: false,
      latencyMs: Date.now() - started,
      schemaVersion: null,
      error: sanitizeDbErrorMessage(err),
    };
  }
}

function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.trim()) return val;
  return new Date().toISOString();
}

function normalizeUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    password_hash: String(row.password_hash),
    display_name: String(row.display_name),
    company_name: String(row.company_name ?? ''),
    plan: 'free',
    recovery_code_hash: row.recovery_code_hash ? String(row.recovery_code_hash) : null,
    preferences_json: row.preferences_json ? String(row.preferences_json) : '{}',
    token_version: Number(row.token_version ?? 1),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
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
    const rawModel = typeof parsed.preferredModel === 'string' ? parsed.preferredModel.trim() : '';
    const allowedModel =
      rawModel === 'gemini-3.1-flash-lite' || rawModel === 'gemini-4-hydrogen'
        ? rawModel
        : 'gemini-4-hydrogen';
    return {
      defaultExperience:
        parsed.defaultExperience === 'intermediaire' || parsed.defaultExperience === 'confirme'
          ? parsed.defaultExperience
          : 'debutant',
      preferredProvider: 'gemini',
      preferredModel: allowedModel,
      autoWebSearch: Boolean(parsed.autoWebSearch),
    };
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

export function toPublicUser(row: UserRecord): PublicUser {
  const effectivePlan: PlanTier = resolveEffectivePlan();
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    companyName: row.company_name || '',
    plan: effectivePlan,
    effectivePlan,
    zeroCostMode: true,
    hasRecoveryCode: Boolean(row.recovery_code_hash),
    preferences: parsePreferences(row.preferences_json),
    createdAt: row.created_at,
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [
    email.trim().toLowerCase(),
  ]);
  return res.rows[0] ? normalizeUserRow(res.rows[0]) : null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return res.rows[0] ? normalizeUserRow(res.rows[0]) : null;
}

export async function createUser(params: {
  email: string;
  passwordHash: string;
  displayName: string;
  companyName?: string;
  recoveryCodeHash?: string | null;
}): Promise<UserRecord> {
  const db = await ensureDatabaseReady();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const normalizedEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim();
  const cleanCompany = (params.companyName ?? '').trim();

  const res = await db.query(
    `INSERT INTO users (
      id, email, password_hash, display_name, company_name,
      plan, billing_interval, subscription_status, cancel_at_period_end,
      recovery_code_hash, preferences_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'free', 'monthly', 'inactive', 0, $6, $7, $8, $9)
    RETURNING *`,
    [
      id,
      normalizedEmail,
      params.passwordHash,
      cleanName,
      cleanCompany,
      params.recoveryCodeHash ?? null,
      JSON.stringify(DEFAULT_USER_PREFERENCES),
      now,
      now,
    ]
  );

  if (!res.rows[0]) {
    throw new Error('Impossible de créer le compte utilisateur.');
  }
  return normalizeUserRow(res.rows[0]);
}

export async function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string;
    companyName?: string;
    passwordHash?: string;
    recoveryCodeHash?: string;
    bumpTokenVersion?: boolean;
    preferences?: Partial<UserPreferences>;
  }
): Promise<UserRecord | null> {
  const db = await ensureDatabaseReady();
  const current = await findUserById(userId);
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

  const res = await db.query(
    `UPDATE users SET
      display_name = $1,
      company_name = $2,
      password_hash = $3,
      recovery_code_hash = $4,
      preferences_json = $5,
      token_version = $6,
      updated_at = $7
     WHERE id = $8
     RETURNING *`,
    [
      displayName,
      companyName,
      passwordHash,
      recoveryCodeHash,
      JSON.stringify(mergedPrefs),
      nextTokenVersion,
      now,
      userId,
    ]
  );

  return res.rows[0] ? normalizeUserRow(res.rows[0]) : null;
}

export async function deleteUserAccount(userId: string): Promise<boolean> {
  const db = await ensureDatabaseReady();
  await db.query('DELETE FROM usage_logs WHERE user_id = $1', [userId]);
  const res = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
  return res.rowCount > 0 || res.rows.length > 0;
}

export async function exportUserData(userId: string): Promise<Record<string, unknown> | null> {
  const userRow = await findUserById(userId);
  if (!userRow) return null;

  const rawConvs = await listUserConversations(userId);
  const conversations = await Promise.all(
    rawConvs.map(async (conv) => ({
      ...conv,
      messages: await listConversationMessages(conv.id, 1000),
    }))
  );

  const [businessProjects, companyCreations, publishedSites, documents] =
    await Promise.all([
      listBusinessProjects(userId),
      listCompanyCreations(userId),
      listUserPublishedSites(userId),
      listUserDocuments(userId),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    account: toPublicUser(userRow),
    conversations,
    businessProjects,
    companyCreations,
    publishedSites,
    documents,
  };
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

function normalizeConversationRow(row: Record<string, unknown>): ConversationRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    category: String(row.category ?? 'general'),
    context_summary: row.context_summary ? String(row.context_summary) : '',
    summarized_message_count: Number(row.summarized_message_count ?? 0),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    message_count:
      row.message_count !== undefined ? Number(row.message_count) : undefined,
    last_message_preview:
      row.last_message_preview !== undefined && row.last_message_preview !== null
        ? String(row.last_message_preview)
        : undefined,
  };
}

function normalizeMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content ?? ''),
    sources_json: String(row.sources_json ?? '[]'),
    attachment_name: row.attachment_name ? String(row.attachment_name) : null,
    model_used: row.model_used ? String(row.model_used) : null,
    latency_ms:
      row.latency_ms !== null && row.latency_ms !== undefined
        ? Number(row.latency_ms)
        : null,
    created_at: toIsoString(row.created_at),
  };
}

export async function listUserConversations(userId: string): Promise<ConversationRow[]> {
  const db = await ensureDatabaseReady();
  const convRes = await db.query(
    `SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 150`,
    [userId]
  );
  if (convRes.rows.length === 0) return [];

  const convIds = convRes.rows.map((r) => String(r.id));
  const [countsRes, latestRes] = await Promise.all([
    db.query<{ conversation_id: string; message_count: number }>(
      `SELECT conversation_id, COUNT(*)::int AS message_count
       FROM messages
       WHERE conversation_id = ANY($1)
       GROUP BY conversation_id`,
      [convIds]
    ),
    db.query<{ conversation_id: string; preview: string }>(
      `SELECT DISTINCT ON (conversation_id)
         conversation_id, SUBSTR(content, 1, 140) AS preview
       FROM messages
       WHERE conversation_id = ANY($1)
       ORDER BY conversation_id, created_at DESC, seq DESC`,
      [convIds]
    ),
  ]);

  const countMap = new Map<string, number>();
  for (const row of countsRes.rows) {
    countMap.set(String(row.conversation_id), Number(row.message_count ?? 0));
  }
  const previewMap = new Map<string, string>();
  for (const row of latestRes.rows) {
    previewMap.set(String(row.conversation_id), String(row.preview ?? ''));
  }

  return convRes.rows.map((row) => {
    const conv = normalizeConversationRow(row);
    conv.message_count = countMap.get(conv.id) ?? 0;
    conv.last_message_preview = previewMap.get(conv.id);
    return conv;
  });
}

export async function getConversationForUser(
  conversationId: string,
  userId: string
): Promise<ConversationRow | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT * FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, userId]
  );
  return res.rows[0] ? normalizeConversationRow(res.rows[0]) : null;
}

export async function createConversation(params: {
  userId: string;
  title: string;
  category?: 'general' | 'business' | 'document';
}): Promise<ConversationRow> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanTitle = params.title.trim().slice(0, 120) || 'Nouvelle conversation';
  const category = params.category ?? 'general';

  const res = await db.query(
    `INSERT INTO conversations (id, user_id, title, category, context_summary, summarized_message_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', 0, $5, $6)
     RETURNING *`,
    [id, params.userId, cleanTitle, category, now, now]
  );

  return normalizeConversationRow(res.rows[0]!);
}

export async function updateConversationSummary(
  conversationId: string,
  summary: string,
  summarizedCount: number
): Promise<void> {
  const db = await ensureDatabaseReady();
  await db.query(
    `UPDATE conversations SET context_summary = $1, summarized_message_count = $2 WHERE id = $3`,
    [summary, summarizedCount, conversationId]
  );
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string
): Promise<ConversationRow | null> {
  const db = await ensureDatabaseReady();
  const conv = await getConversationForUser(conversationId, userId);
  if (!conv) return null;
  const cleanTitle = title.trim().slice(0, 120);
  if (!cleanTitle) return conv;
  const now = new Date().toISOString();
  const res = await db.query(
    'UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
    [cleanTitle, now, conversationId, userId]
  );
  return res.rows[0] ? normalizeConversationRow(res.rows[0]) : null;
}

export async function deleteConversation(conversationId: string, userId: string): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id',
    [conversationId, userId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

export async function listConversationMessages(
  conversationId: string,
  limit = 300
): Promise<
  Array<{
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    sources: SourceLink[];
    attachmentName: string | null;
    modelUsed: string | null;
    latencyMs: number | null;
    createdAt: string;
  }>
> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    `SELECT * FROM (
       SELECT *
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, seq DESC
       LIMIT $2
     ) sub
     ORDER BY created_at ASC, seq ASC`,
    [conversationId, limit]
  );

  return res.rows.map((raw) => {
    const row = normalizeMessageRow(raw);
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

export async function getLastConversationMessage(
  conversationId: string
): Promise<MessageRow | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, seq DESC LIMIT 1`,
    [conversationId]
  );
  return res.rows[0] ? normalizeMessageRow(res.rows[0]) : null;
}

export async function deleteConversationMessage(
  messageId: string,
  conversationId: string
): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM messages WHERE id = $1 AND conversation_id = $2 RETURNING id',
    [messageId, conversationId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

export async function addMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceLink[];
  attachmentName?: string | null;
  modelUsed?: string | null;
  latencyMs?: number | null;
}): Promise<string> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO messages (
      id, conversation_id, role, content, sources_json,
      attachment_name, model_used, latency_ms, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      params.conversationId,
      params.role,
      params.content,
      JSON.stringify(params.sources ?? []),
      params.attachmentName ?? null,
      params.modelUsed ?? null,
      params.latencyMs ?? null,
      now,
    ]
  );

  await db.query('UPDATE conversations SET updated_at = $1 WHERE id = $2', [
    now,
    params.conversationId,
  ]);

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

function normalizeBusinessProjectRow(row: Record<string, unknown>): BusinessProjectRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    module_key: String(row.module_key),
    title: String(row.title),
    sector: String(row.sector),
    budget_eur: Number(row.budget_eur ?? 0),
    goal: String(row.goal),
    content_markdown: String(row.content_markdown),
    model_used: row.model_used ? String(row.model_used) : null,
    created_at: toIsoString(row.created_at),
  };
}

export async function createBusinessProject(params: {
  userId: string;
  moduleKey: string;
  title: string;
  sector: string;
  budgetEur: number;
  goal: string;
  contentMarkdown: string;
  modelUsed?: string | null;
}): Promise<BusinessProjectRow> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const res = await db.query(
    `INSERT INTO business_projects (
      id, user_id, module_key, title, sector, budget_eur, goal,
      content_markdown, model_used, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      id,
      params.userId,
      params.moduleKey,
      params.title.trim().slice(0, 140),
      params.sector.trim().slice(0, 100),
      Number.isFinite(params.budgetEur) ? Math.max(0, params.budgetEur) : 0,
      params.goal.trim().slice(0, 300),
      params.contentMarkdown,
      params.modelUsed ?? null,
      now,
    ]
  );

  return normalizeBusinessProjectRow(res.rows[0]!);
}

export async function listBusinessProjects(userId: string): Promise<BusinessProjectRow[]> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT * FROM business_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 80',
    [userId]
  );
  return res.rows.map(normalizeBusinessProjectRow);
}

export async function deleteBusinessProject(
  projectId: string,
  userId: string
): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM business_projects WHERE id = $1 AND user_id = $2 RETURNING id',
    [projectId, userId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

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

function normalizeCompanyCreationRow(row: Record<string, unknown>): CompanyCreationRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    sector: String(row.sector),
    budget_eur: Number(row.budget_eur ?? 0),
    data_json: String(row.data_json),
    logo_svg: String(row.logo_svg ?? ''),
    website_html: String(row.website_html ?? ''),
    published_slug: row.published_slug ? String(row.published_slug) : null,
    model_used: row.model_used ? String(row.model_used) : null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export async function createCompanyCreation(params: {
  userId: string;
  title: string;
  sector: string;
  budgetEur: number;
  dataJson: string;
  logoSvg: string;
  websiteHtml: string;
  modelUsed?: string | null;
}): Promise<CompanyCreationRow> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const res = await db.query(
    `INSERT INTO company_creations (
      id, user_id, title, sector, budget_eur, data_json, logo_svg, website_html,
      published_slug, model_used, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11)
    RETURNING *`,
    [
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
      now,
    ]
  );

  return normalizeCompanyCreationRow(res.rows[0]!);
}

export async function listCompanyCreations(userId: string): Promise<CompanyCreationRow[]> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT * FROM company_creations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 40',
    [userId]
  );
  return res.rows.map(normalizeCompanyCreationRow);
}

export async function updateCompanyCreationAssets(
  id: string,
  userId: string,
  updates: {
    logoSvg?: string;
    websiteHtml?: string;
    publishedSlug?: string | null;
  }
): Promise<CompanyCreationRow | null> {
  const db = await ensureDatabaseReady();
  const existingRes = await db.query(
    'SELECT * FROM company_creations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  if (!existingRes.rows[0]) return null;
  const existing = normalizeCompanyCreationRow(existingRes.rows[0]);

  const now = new Date().toISOString();
  const res = await db.query(
    `UPDATE company_creations SET
      logo_svg = $1,
      website_html = $2,
      published_slug = $3,
      updated_at = $4
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [
      updates.logoSvg !== undefined ? updates.logoSvg : existing.logo_svg,
      updates.websiteHtml !== undefined ? updates.websiteHtml : existing.website_html,
      updates.publishedSlug !== undefined ? updates.publishedSlug : existing.published_slug,
      now,
      id,
      userId,
    ]
  );

  return res.rows[0] ? normalizeCompanyCreationRow(res.rows[0]) : null;
}

export async function deleteCompanyCreation(id: string, userId: string): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM company_creations WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

export interface PublishedSiteRow {
  id: string;
  slug: string;
  user_id: string | null;
  title: string;
  html_content: string;
  created_at: string;
  updated_at: string;
}

function normalizePublishedSiteRow(row: Record<string, unknown>): PublishedSiteRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    user_id: row.user_id ? String(row.user_id) : null,
    title: String(row.title),
    html_content: String(row.html_content ?? ''),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
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

export async function publishSite(params: {
  userId: string | null;
  title: string;
  htmlContent: string;
  existingSlug?: string | null;
}): Promise<PublishedSiteRow> {
  const db = await ensureDatabaseReady();
  const now = new Date().toISOString();

  if (params.existingSlug && params.userId) {
    const existing = await findUserPublishedSiteBySlug(params.existingSlug, params.userId);
    if (existing) {
      const updated = await db.query(
        'UPDATE published_sites SET title = $1, html_content = $2, updated_at = $3 WHERE id = $4 RETURNING *',
        [params.title.trim().slice(0, 140), params.htmlContent, now, existing.id]
      );
      return normalizePublishedSiteRow(updated.rows[0]!);
    }
  }

  const id = crypto.randomUUID();
  const slug = slugifyTitle(params.title);
  const inserted = await db.query(
    `INSERT INTO published_sites (id, slug, user_id, title, html_content, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, slug, params.userId, params.title.trim().slice(0, 140), params.htmlContent, now, now]
  );

  return normalizePublishedSiteRow(inserted.rows[0]!);
}

export async function getPublishedSiteBySlug(slug: string): Promise<PublishedSiteRow | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query('SELECT * FROM published_sites WHERE slug = $1 LIMIT 1', [slug]);
  return res.rows[0] ? normalizePublishedSiteRow(res.rows[0]) : null;
}

export async function findUserPublishedSiteBySlug(
  slug: string,
  userId: string
): Promise<PublishedSiteRow | null> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT * FROM published_sites WHERE slug = $1 AND user_id = $2 LIMIT 1',
    [slug, userId]
  );
  return res.rows[0] ? normalizePublishedSiteRow(res.rows[0]) : null;
}

export async function listUserPublishedSites(
  userId: string
): Promise<Array<Omit<PublishedSiteRow, 'html_content'>>> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT id, slug, user_id, title, created_at, updated_at FROM published_sites WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50',
    [userId]
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    user_id: row.user_id ? String(row.user_id) : null,
    title: String(row.title),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  }));
}

export async function countUserPublishedSites(userId: string): Promise<number> {
  const db = await ensureDatabaseReady();
  const res = await db.query<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM published_sites WHERE user_id = $1',
    [userId]
  );
  return Number(res.rows[0]?.c ?? 0);
}

export async function deletePublishedSite(id: string, userId: string): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM published_sites WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

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

function normalizeUserDocumentRow(row: Record<string, unknown>): UserDocumentRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    doc_type: String(row.doc_type),
    title: String(row.title),
    content_markdown: String(row.content_markdown),
    metadata_json: String(row.metadata_json ?? '{}'),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export async function createUserDocument(params: {
  userId: string;
  docType: string;
  title: string;
  contentMarkdown: string;
  metadataJson?: string;
}): Promise<UserDocumentRow> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const res = await db.query(
    `INSERT INTO user_documents (id, user_id, doc_type, title, content_markdown, metadata_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      params.userId,
      params.docType.trim().slice(0, 50),
      params.title.trim().slice(0, 140),
      params.contentMarkdown,
      params.metadataJson ?? '{}',
      now,
      now,
    ]
  );
  return normalizeUserDocumentRow(res.rows[0]!);
}

export async function listUserDocuments(userId: string): Promise<UserDocumentRow[]> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'SELECT * FROM user_documents WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 80',
    [userId]
  );
  return res.rows.map(normalizeUserDocumentRow);
}

export async function deleteUserDocument(id: string, userId: string): Promise<boolean> {
  const db = await ensureDatabaseReady();
  const res = await db.query(
    'DELETE FROM user_documents WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return res.rowCount > 0 || res.rows.length > 0;
}

export async function recordUsage(params: {
  userId: string | null;
  ipHash: string;
  kind: 'chat' | 'business';
}): Promise<void> {
  const db = await ensureDatabaseReady();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dayKey = getTodayKey();
  await db.query(
    `INSERT INTO usage_logs (id, user_id, ip_hash, kind, day_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, params.userId, params.ipHash, params.kind, dayKey, now]
  );
}

export async function getDailyUsageCount(params: {
  userId: string | null;
  ipHash: string;
  kind: 'chat' | 'business';
}): Promise<number> {
  const db = await ensureDatabaseReady();
  const dayKey = getTodayKey();
  if (params.userId) {
    const res = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM usage_logs WHERE user_id = $1 AND kind = $2 AND day_key = $3`,
      [params.userId, params.kind, dayKey]
    );
    return Number(res.rows[0]?.total ?? 0);
  }
  const res = await db.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM usage_logs WHERE user_id IS NULL AND ip_hash = $1 AND kind = $2 AND day_key = $3`,
    [params.ipHash, params.kind, dayKey]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function getUserDashboardStats(userId: string): Promise<{
  messagesToday: number;
  businessToday: number;
  totalMessages: number;
  totalConversations: number;
  totalBusinessProjects: number;
  totalCompanyCreations: number;
  totalDocuments: number;
  totalPublishedSites: number;
}> {
  const db = await ensureDatabaseReady();
  const dayKey = getTodayKey();

  const [
    msgTodayRes,
    bizTodayRes,
    convRes,
    totalMsgRes,
    bizProjRes,
    compRes,
    docRes,
    totalPublishedSites,
  ] = await Promise.all([
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM usage_logs WHERE user_id = $1 AND kind = 'chat' AND day_key = $2`,
      [userId, dayKey]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM usage_logs WHERE user_id = $1 AND kind = 'business' AND day_key = $2`,
      [userId, dayKey]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM conversations WHERE user_id = $1`,
      [userId]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = $1 AND m.role = 'user'`,
      [userId]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM business_projects WHERE user_id = $1`,
      [userId]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM company_creations WHERE user_id = $1`,
      [userId]
    ),
    db.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM user_documents WHERE user_id = $1`,
      [userId]
    ),
    countUserPublishedSites(userId),
  ]);

  return {
    messagesToday: Number(msgTodayRes.rows[0]?.c ?? 0),
    businessToday: Number(bizTodayRes.rows[0]?.c ?? 0),
    totalMessages: Number(totalMsgRes.rows[0]?.c ?? 0),
    totalConversations: Number(convRes.rows[0]?.c ?? 0),
    totalBusinessProjects: Number(bizProjRes.rows[0]?.c ?? 0),
    totalCompanyCreations: Number(compRes.rows[0]?.c ?? 0),
    totalDocuments: Number(docRes.rows[0]?.c ?? 0),
    totalPublishedSites,
  };
}
