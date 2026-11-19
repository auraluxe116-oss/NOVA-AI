import crypto from 'crypto';
import 'dotenv/config';
import express from 'express';
import type Stripe from 'stripe';
import {
  checkRateLimit,
  clearSessionCookie,
  getAuthenticatedPublicUser,
  getAuthenticatedUserRecord,
  getClientIp,
  hashIp,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from './auth.js';
import {
  addMessage,
  countUserPublishedSites,
  createBusinessProject,
  createCompanyCreation,
  createConversation,
  createUser,
  createUserDocument,
  deleteBusinessProject,
  deleteCompanyCreation,
  deleteConversation,
  deleteConversationMessage,
  deletePublishedSite,
  deleteUserAccount,
  deleteUserDocument,
  exportUserData,
  findUserByEmail,
  getConversationForUser,
  getDailyUsageCount,
  getDbStorageInfo,
  getLastConversationMessage,
  getPublishedSiteBySlug,
  getUserDashboardStats,
  listBusinessProjects,
  listCompanyCreations,
  listConversationMessages,
  listUserConversations,
  listUserDocuments,
  listUserPublishedSites,
  listUserSubscriptions,
  publishSite,
  recordUsage,
  renameConversation,
  toPublicUser,
  updateCompanyCreationAssets,
  updateConversationSummary,
  updateUserProfile,
} from './db.js';
import {
  GEMINI_MODELS,
  generateCompanyCreationSuite,
  generateLogoSvgOnly,
  generateMarketingContent,
  generateStructuredDocument,
  generateVideoStoryboard,
  getAvailableAIProviders,
  getGeminiApiKey,
  getProviderApiKey,
  mapGeminiErrorMessage,
  normalizeBusinessModuleKey,
  regenerateWebsiteHtmlOnly,
  streamBusinessProject,
  streamConversationResponse,
  summarizeConversationHistory,
} from './gemini.js';
import {
  createBillingPortalForUser,
  createCheckoutSessionForUser,
  getResolvedStripeConfigStatus,
  getStripeConfigStatus,
  listStripeInvoicesForUser,
  processStripeWebhook,
  resolveAppBaseUrl,
  setSubscriptionCancellation,
  verifyCheckoutSessionForUser,
} from './stripe.js';
import {
  PLAN_SPECS,
  resolveEffectivePlan,
  type AIProviderId,
  type BillingInterval,
  type ExperienceLevel,
  type PlanTier,
  type PublicUser,
} from './types.js';

function buildQuotaSnapshot(user: PublicUser | null, ipHash: string) {
  const plan: PlanTier = user ? resolveEffectivePlan(user) : 'free';
  const spec = PLAN_SPECS[plan];

  const chatUsedToday = getDailyUsageCount({
    userId: user?.id ?? null,
    ipHash,
    kind: 'chat',
  });
  const businessUsedToday = getDailyUsageCount({
    userId: user?.id ?? null,
    ipHash,
    kind: 'business',
  });

  return {
    plan,
    isAuthenticated: Boolean(user),
    unlimitedInAppMessages: true,
    chatUsedToday,
    businessUsedToday,
    maxAttachmentBytes: spec.maxAttachmentBytes,
    maxPublishedSites: spec.maxPublishedSites,
    exportEnabled: spec.exportEnabled,
    fullBusinessSuite: spec.fullBusinessSuite,
    companyCreationSuite: spec.companyCreationSuite,
  };
}

function sendSseEvent(res: express.Response, payload: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function sendMappedGeminiJsonError(res: express.Response, err: unknown): void {
  const mapped = mapGeminiErrorMessage(err);
  if (mapped.retryAfterSec) {
    res.setHeader('Retry-After', String(mapped.retryAfterSec));
  }
  res.status(mapped.status).json({
    code: mapped.code,
    error: mapped.message,
    retryAfterSec: mapped.retryAfterSec ?? null,
  });
}

export interface CreateAppOptions {
  streamConversation?: typeof streamConversationResponse;
  streamBusiness?: typeof streamBusinessProject;
  summarizeHistory?: typeof summarizeConversationHistory;
  providerKeyChecker?: typeof getProviderApiKey;
  generateCompanySuite?: typeof generateCompanyCreationSuite;
  stripeClient?: Stripe;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const runConversationStream = options.streamConversation ?? streamConversationResponse;
  const runBusinessStream = options.streamBusiness ?? streamBusinessProject;
  const runSummarizeHistory = options.summarizeHistory ?? summarizeConversationHistory;
  const resolveProviderKey = options.providerKeyChecker ?? getProviderApiKey;
  const runCompanySuite = options.generateCompanySuite ?? generateCompanyCreationSuite;
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 1. Stripe Webhook MUST receive raw Buffer BEFORE express.json()
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json', limit: '2mb' }),
    async (req, res) => {
      try {
        const sigHeader = req.headers['stripe-signature'];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        if (!Buffer.isBuffer(req.body)) {
          res.status(400).json({ error: 'Corps brut Webhook Stripe requis.' });
          return;
        }
        const result = await processStripeWebhook(req.body, signature, options.stripeClient);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur Webhook Stripe.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.use(express.json({ limit: '4mb' }));

  // Public Published Website Hosting (/sites/:slug)
  app.get('/sites/:slug', (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
      res.status(404).send('Site introuvable.');
      return;
    }
    const site = getPublishedSiteBySlug(slug);
    if (!site) {
      res.status(404).send('<!doctype html><html lang="fr"><body style="font-family:sans-serif;background:#08080b;color:#fff;padding:40px"><h1>Site introuvable</h1><p>Ce site publié n’existe plus ou a été supprimé.</p></body></html>');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(site.html_content);
  });

  // 2. System Health & AI Providers
  app.get('/api/health', (_req, res) => {
    const aiConfigured = Boolean(getGeminiApiKey());
    const stripe = getStripeConfigStatus();
    const storage = getDbStorageInfo();
    res.json({
      ok: true,
      brand: 'NOVA AI PRO',
      runtime: process.env.VERCEL === '1' ? 'vercel-serverless' : 'node-server',
      aiConfigured,
      stripeConfigured: stripe.stripeConfigured,
      webhookConfigured: stripe.webhookConfigured,
      checkoutReady: stripe.checkoutReady,
      storage: {
        engine: 'sqlite',
        ephemeral: storage.isEphemeral,
      },
      models: GEMINI_MODELS,
    });
  });

  app.get('/api/ai/providers', (_req, res) => {
    res.json({ providers: getAvailableAIProviders() });
  });

  // 3. Authentication, Recovery & Profile
  app.post('/api/auth/register', (req, res) => {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const limit = checkRateLimit(`auth:register:${ipHash}`, 12, 15 * 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        code: 'RATE_LIMITED',
        retryAfterSec: limit.retryAfterSec,
        error: `Trop de tentatives d'inscription. Réessaie dans ${limit.retryAfterSec} secondes.`,
      });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const displayName = String(req.body?.displayName ?? '').trim();
    const companyName = String(req.body?.companyName ?? '').trim().slice(0, 100);

    if (!isValidEmail(email)) {
      res.status(400).json({ code: 'INVALID_EMAIL', error: 'Adresse e-mail invalide.' });
      return;
    }
    if (displayName.length < 2 || displayName.length > 80) {
      res.status(400).json({
        code: 'INVALID_NAME',
        error: 'Le nom complet doit contenir entre 2 et 80 caractères.',
      });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({
        code: 'WEAK_PASSWORD',
        error: 'Le mot de passe doit contenir au moins 8 caractères.',
      });
      return;
    }

    if (findUserByEmail(email)) {
      res.status(409).json({
        code: 'EMAIL_EXISTS',
        error: 'Un compte existe déjà avec cette adresse e-mail.',
      });
      return;
    }

    // Generate personal cryptographic recovery code (shown once on signup)
    const rawRecoveryCode = `NOVA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const userRecord = createUser({
      email,
      passwordHash: hashPassword(password),
      displayName,
      companyName,
      recoveryCodeHash: hashPassword(rawRecoveryCode),
    });
    const publicUser = toPublicUser(userRecord);
    setSessionCookie(req, res, publicUser.id, userRecord.token_version ?? 1);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(201).json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
      recoveryCode: rawRecoveryCode,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const limit = checkRateLimit(`auth:login:${ipHash}`, 20, 15 * 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        code: 'RATE_LIMITED',
        retryAfterSec: limit.retryAfterSec,
        error: `Trop de tentatives de connexion. Réessaie dans ${limit.retryAfterSec} secondes.`,
      });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      res.status(400).json({
        code: 'MISSING_CREDENTIALS',
        error: 'Renseigne ton adresse e-mail et ton mot de passe.',
      });
      return;
    }

    const userRecord = findUserByEmail(email);
    if (!userRecord || !verifyPassword(password, userRecord.password_hash)) {
      res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        error: 'Identifiants incorrects. Vérifie ton e-mail et ton mot de passe.',
      });
      return;
    }

    const publicUser = toPublicUser(userRecord);
    setSessionCookie(req, res, publicUser.id, userRecord.token_version ?? 1);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const limit = checkRateLimit(`auth:reset:${ipHash}`, 10, 15 * 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        code: 'RATE_LIMITED',
        retryAfterSec: limit.retryAfterSec,
        error: `Trop de tentatives. Réessaie dans ${limit.retryAfterSec} secondes.`,
      });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const recoveryCode = String(req.body?.recoveryCode ?? '').trim().toUpperCase();
    const newPassword = String(req.body?.newPassword ?? '');

    if (!isValidEmail(email) || !recoveryCode || newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({
        code: 'INVALID_RESET_PAYLOAD',
        error:
          'Renseigne un e-mail valide, ton code de récupération personnel et un nouveau mot de passe (8 caractères min.).',
      });
      return;
    }

    const userRecord = findUserByEmail(email);
    if (
      !userRecord ||
      !userRecord.recovery_code_hash ||
      !verifyPassword(recoveryCode, userRecord.recovery_code_hash)
    ) {
      res.status(401).json({
        code: 'INVALID_RECOVERY_CODE',
        error: 'E-mail ou code de récupération invalide.',
      });
      return;
    }

    const nextRecoveryCode = `NOVA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    updateUserProfile(userRecord.id, {
      passwordHash: hashPassword(newPassword),
      recoveryCodeHash: hashPassword(nextRecoveryCode),
    });

    res.json({
      ok: true,
      nextRecoveryCode,
      message: 'Mot de passe réinitialisé avec succès. Conserve ton nouveau code de récupération.',
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      user,
      quota: buildQuotaSnapshot(user, ipHash),
    });
  });

  app.patch('/api/auth/profile', (req, res) => {
    const userRecord = getAuthenticatedUserRecord(req);
    if (!userRecord) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }

    const displayName =
      req.body?.displayName !== undefined
        ? String(req.body.displayName).trim()
        : undefined;
    const companyName =
      req.body?.companyName !== undefined
        ? String(req.body.companyName).trim()
        : undefined;
    const currentPassword =
      typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const regenerateRecovery = Boolean(req.body?.regenerateRecoveryCode);
    const rawPreferences =
      req.body?.preferences && typeof req.body.preferences === 'object'
        ? (req.body.preferences as Record<string, unknown>)
        : undefined;

    if (displayName !== undefined && (displayName.length < 2 || displayName.length > 80)) {
      res.status(400).json({
        code: 'INVALID_NAME',
        error: 'Le nom doit contenir entre 2 et 80 caractères.',
      });
      return;
    }

    let nextPasswordHash: string | undefined;
    if (newPassword) {
      if (!currentPassword || !verifyPassword(currentPassword, userRecord.password_hash)) {
        res.status(400).json({
          code: 'WRONG_PASSWORD',
          error: 'Le mot de passe actuel est incorrect.',
        });
        return;
      }
      if (newPassword.length < 8 || newPassword.length > 128) {
        res.status(400).json({
          code: 'WEAK_PASSWORD',
          error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.',
        });
        return;
      }
      nextPasswordHash = hashPassword(newPassword);
    }

    let generatedRecoveryCode: string | undefined;
    let nextRecoveryCodeHash: string | undefined;
    if (regenerateRecovery) {
      generatedRecoveryCode = `NOVA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      nextRecoveryCodeHash = hashPassword(generatedRecoveryCode);
    }

    const updated = updateUserProfile(userRecord.id, {
      displayName,
      companyName,
      passwordHash: nextPasswordHash,
      recoveryCodeHash: nextRecoveryCodeHash,
      preferences: rawPreferences
        ? {
            defaultExperience:
              rawPreferences.defaultExperience === 'intermediaire' ||
              rawPreferences.defaultExperience === 'confirme'
                ? rawPreferences.defaultExperience
                : rawPreferences.defaultExperience === 'debutant'
                ? 'debutant'
                : undefined,
            preferredProvider:
              rawPreferences.preferredProvider === 'openai' ||
              rawPreferences.preferredProvider === 'anthropic' ||
              rawPreferences.preferredProvider === 'mistral' ||
              rawPreferences.preferredProvider === 'gemini'
                ? rawPreferences.preferredProvider
                : undefined,
            preferredModel:
              typeof rawPreferences.preferredModel === 'string'
                ? rawPreferences.preferredModel
                : undefined,
            autoWebSearch:
              typeof rawPreferences.autoWebSearch === 'boolean'
                ? rawPreferences.autoWebSearch
                : undefined,
          }
        : undefined,
    });

    if (!updated) {
      res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Compte introuvable.' });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const publicUser = toPublicUser(updated);
    if (nextPasswordHash) {
      setSessionCookie(req, res, publicUser.id, updated.token_version ?? 1);
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
      recoveryCode: generatedRecoveryCode ?? null,
    });
  });

  app.get('/api/auth/export', (req, res) => {
    const userRecord = getAuthenticatedUserRecord(req);
    if (!userRecord) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const payload = exportUserData(userRecord.id);
    if (!payload) {
      res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Compte introuvable.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="nova-ai-pro-mes-donnees.json"'
    );
    res.json(payload);
  });

  app.delete('/api/auth/account', (req, res) => {
    const userRecord = getAuthenticatedUserRecord(req);
    if (!userRecord) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const password = String(req.body?.password ?? '');
    if (!password || !verifyPassword(password, userRecord.password_hash)) {
      res.status(400).json({
        code: 'WRONG_PASSWORD',
        error: 'Mot de passe requis pour supprimer définitivement ton compte.',
      });
      return;
    }
    deleteUserAccount(userRecord.id);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // 4. Dashboard Overview
  app.get('/api/dashboard', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const effectivePlan = resolveEffectivePlan(user);
    const stats = getUserDashboardStats(user.id);
    const quota = buildQuotaSnapshot(user, ipHash);
    const recentConversations = listUserConversations(user.id).slice(0, 6);
    const recentProjects = listBusinessProjects(user.id).slice(0, 5);
    const recentCompanyCreations = listCompanyCreations(user.id).slice(0, 5);
    const publishedSites = listUserPublishedSites(user.id).slice(0, 8);
    const recentDocuments = listUserDocuments(user.id).slice(0, 6);
    const subscriptions = listUserSubscriptions(user.id);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      user,
      planSpec: PLAN_SPECS[effectivePlan],
      quota,
      stats,
      recentConversations,
      recentProjects,
      recentCompanyCreations,
      publishedSites,
      recentDocuments,
      subscriptions,
    });
  });

  // 5. Conversations & History
  app.get('/api/conversations', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ conversations: listUserConversations(user.id) });
  });

  app.post('/api/conversations', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const title = String(req.body?.title ?? 'Nouvelle conversation').trim();
    const rawCat = String(req.body?.category ?? 'general');
    const category =
      rawCat === 'business' || rawCat === 'document' ? rawCat : 'general';
    const conv = createConversation({ userId: user.id, title, category });
    res.status(201).json({ conversation: conv });
  });

  app.get('/api/conversations/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const conv = getConversationForUser(req.params.id, user.id);
    if (!conv) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Conversation introuvable.' });
      return;
    }
    const messages = listConversationMessages(conv.id, 300);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ conversation: conv, messages });
  });

  app.patch('/api/conversations/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const title = String(req.body?.title ?? '').trim();
    if (!title) {
      res.status(400).json({ code: 'INVALID_TITLE', error: 'Titre requis.' });
      return;
    }
    const updated = renameConversation(req.params.id, user.id, title);
    if (!updated) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Conversation introuvable.' });
      return;
    }
    res.json({ conversation: updated });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const deleted = deleteConversation(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Conversation introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  // 6. Real-Time SSE Streaming Chat Assistant (No Artificial Daily/Monthly Caps!)
  app.post('/api/chat', async (req, res) => {
    const rawProvider = String(req.body?.provider ?? 'gemini').trim() as AIProviderId;
    const provider: AIProviderId =
      rawProvider === 'openai' ||
      rawProvider === 'anthropic' ||
      rawProvider === 'mistral'
        ? rawProvider
        : 'gemini';
    const requestedModel =
      typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;

    if (!resolveProviderKey(provider)) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error:
          provider === 'gemini'
            ? 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Ajoute-la dans Settings > Secrets.'
            : `Fournisseur ${provider} non configuré côté serveur (clé API manquante).`,
      });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);

    // Anti-abuse burst flood protection ONLY (never blocks legitimate total message counts)
    const burst = checkRateLimit(
      `chat:burst:${user ? user.id : ipHash}`,
      45,
      60_000
    );
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Cadence de requêtes trop rapide (anti-flood). Patientez ${burst.retryAfterSec} seconde(s).`,
      });
      return;
    }

    const quota = buildQuotaSnapshot(user, ipHash);

    const message = String(req.body?.message ?? '').trim();
    if (!message || message.length > 24_000) {
      res.status(400).json({
        code: 'INVALID_MESSAGE',
        error: 'Écris un message valide (entre 1 et 24 000 caractères).',
      });
      return;
    }

    let attachment: { name: string; content: string } | null = null;
    if (req.body?.attachment && typeof req.body.attachment === 'object') {
      const attName = String(req.body.attachment.name ?? 'document.txt').trim().slice(0, 120);
      const attContent = String(req.body.attachment.content ?? '');
      if (attContent.length > quota.maxAttachmentBytes) {
        res.status(413).json({
          code: 'ATTACHMENT_TOO_LARGE',
          error: `Le document joint dépasse la limite de ta formule (${Math.round(
            quota.maxAttachmentBytes / 1024
          )} Ko).`,
        });
        return;
      }
      if (attContent.trim().length > 0) {
        attachment = { name: attName, content: attContent };
      }
    }

    const useWebSearch = Boolean(req.body?.useWebSearch);
    const rawChatLevel = String(
      req.body?.experienceLevel ?? user?.preferences?.defaultExperience ?? 'debutant'
    ).trim();
    const experienceLevel: ExperienceLevel =
      rawChatLevel === 'intermediaire' || rawChatLevel === 'confirme'
        ? rawChatLevel
        : 'debutant';
    const requestedConvId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : null;

    let activeConversationId: string | null = null;
    let historyForModel: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let contextSummary = '';

    if (user) {
      if (requestedConvId) {
        const existing = getConversationForUser(requestedConvId, user.id);
        if (!existing) {
          res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', error: 'Conversation introuvable.' });
          return;
        }
        activeConversationId = existing.id;
        contextSummary = existing.context_summary || '';

        const isRetry = Boolean(req.body?.isRetry);
        const lastMsg = getLastConversationMessage(existing.id);
        const allMsgs = listConversationMessages(existing.id, 300);
        const prevBeforeLast =
          allMsgs.length >= 2 ? allMsgs[allMsgs.length - 2] : undefined;

        const alreadyTrailingSameUserPrompt =
          lastMsg !== null &&
          lastMsg.role === 'user' &&
          lastMsg.content.trim() === message;

        const regeneratingLastAssistantReply =
          isRetry &&
          lastMsg !== null &&
          lastMsg.role === 'assistant' &&
          prevBeforeLast !== undefined &&
          prevBeforeLast.role === 'user' &&
          prevBeforeLast.content.trim() === message;

        if (isRetry && alreadyTrailingSameUserPrompt && lastMsg) {
          historyForModel = allMsgs
            .filter((m) => m.id !== lastMsg.id)
            .map((m) => ({ role: m.role, content: m.content }));
        } else if (regeneratingLastAssistantReply && lastMsg && prevBeforeLast) {
          deleteConversationMessage(lastMsg.id, existing.id);
          historyForModel = allMsgs
            .filter((m) => m.id !== lastMsg.id && m.id !== prevBeforeLast.id)
            .map((m) => ({ role: m.role, content: m.content }));
        } else {
          historyForModel = allMsgs.map((m) => ({
            role: m.role,
            content: m.content,
          }));
          addMessage({
            conversationId: activeConversationId,
            role: 'user',
            content: message,
            attachmentName: attachment?.name ?? null,
          });
        }

        // Smart context summarization for long conversations (> 14 messages)
        const summarizedCount = existing.summarized_message_count ?? 0;
        if (historyForModel.length > 14 && historyForModel.length - 10 > summarizedCount + 3) {
          const olderSlice = historyForModel.slice(summarizedCount, historyForModel.length - 10);
          const updatedSummary = await runSummarizeHistory({
            existingSummary: contextSummary,
            turnsToSummarize: olderSlice,
          });
          if (updatedSummary) {
            contextSummary = updatedSummary;
            updateConversationSummary(
              existing.id,
              updatedSummary,
              historyForModel.length - 10
            );
          }
        }
      } else {
        const autoTitle = message.replace(/\s+/g, ' ').slice(0, 64);
        const created = createConversation({
          userId: user.id,
          title: autoTitle,
          category: attachment ? 'document' : 'general',
        });
        activeConversationId = created.id;
        addMessage({
          conversationId: activeConversationId,
          role: 'user',
          content: message,
          attachmentName: attachment?.name ?? null,
        });
      }
    } else if (Array.isArray(req.body?.guestHistory)) {
      const guestAll = req.body.guestHistory.filter(
        (item: unknown): item is { role: 'user' | 'assistant'; content: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          ((item as { role?: string }).role === 'user' ||
            (item as { role?: string }).role === 'assistant') &&
          typeof (item as { content?: unknown }).content === 'string'
      );
      if (guestAll.length > 14) {
        const olderGuest = guestAll.slice(0, guestAll.length - 10);
        const guestSummary = await runSummarizeHistory({
          existingSummary: '',
          turnsToSummarize: olderGuest,
        });
        if (guestSummary) {
          contextSummary = guestSummary;
        }
      }
      historyForModel = guestAll.slice(-12);
    }

    // Prepare SSE stream immediately with TCP_NODELAY
    res.socket?.setNoDelay(true);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 12_000);

    res.on('close', () => {
      clearInterval(keepaliveTimer);
      if (!res.writableEnded) {
        abortController.abort(new Error('CLIENT_ABORTED'));
      }
    });

    sendSseEvent(res, {
      type: 'status',
      label: 'NOVA réfléchit...',
      conversationId: activeConversationId,
    });

    try {
      const result = await runConversationStream({
        history: historyForModel,
        contextSummary,
        userMessage: message,
        attachment,
        useWebSearch,
        experienceLevel,
        provider,
        model: requestedModel,
        plan: user ? resolveEffectivePlan(user) : 'free',
        externalSignal: abortController.signal,
        callbacks: {
          onStatus: (label) => {
            sendSseEvent(res, { type: 'status', label, conversationId: activeConversationId });
          },
          onModelSelected: (model) => {
            sendSseEvent(res, { type: 'meta', model, conversationId: activeConversationId });
          },
          onDelta: (text) => {
            sendSseEvent(res, { type: 'delta', text });
          },
        },
      });

      recordUsage({
        userId: user?.id ?? null,
        ipHash,
        kind: 'chat',
      });

      if (user && activeConversationId) {
        addMessage({
          conversationId: activeConversationId,
          role: 'assistant',
          content: result.fullText,
          sources: result.sources,
          modelUsed: result.modelUsed,
          latencyMs: result.latencyMs,
        });
      }

      const nextQuota = buildQuotaSnapshot(user, ipHash);
      sendSseEvent(res, {
        type: 'sources',
        sources: result.sources,
      });
      sendSseEvent(res, {
        type: 'done',
        conversationId: activeConversationId,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        quota: nextQuota,
        summarizedActive: Boolean(contextSummary),
      });
      res.end();
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg === 'CLIENT_ABORTED') {
        res.end();
        return;
      }
      const mapped = mapGeminiErrorMessage(err);
      sendSseEvent(res, {
        type: 'error',
        status: mapped.status,
        code: mapped.code,
        error: mapped.message,
        retryAfterSec: mapped.retryAfterSec ?? null,
      });
      res.end();
    } finally {
      clearInterval(keepaliveTimer);
    }
  });

  // 7. Mode Business Routes (18 Modules + Generator + Company Creation Studio)
  app.get('/api/business/projects', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.json({ projects: listBusinessProjects(user.id) });
  });

  app.delete('/api/business/projects/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const deleted = deleteBusinessProject(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Projet introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/business/generate', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error:
          'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Ajoute-la dans Settings > Secrets.',
      });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);

    const burst = checkRateLimit(
      `biz:burst:${user ? user.id : ipHash}`,
      25,
      60_000
    );
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Cadence élevée. Patientez ${burst.retryAfterSec} seconde(s).`,
      });
      return;
    }

    const rawModuleKey = String(req.body?.moduleKey ?? 'business_ideas').trim();
    const moduleKey = normalizeBusinessModuleKey(rawModuleKey);
    if (!moduleKey) {
      res.status(400).json({
        code: 'INVALID_MODULE',
        error: 'Module Mode Business inconnu.',
      });
      return;
    }

    const projectTitle = String(req.body?.title ?? '').trim();
    const sector = String(req.body?.sector ?? '').trim();
    const budgetEur = Number(req.body?.budgetEur ?? 0);
    const goal = String(req.body?.goal ?? '').trim();
    const skills = String(req.body?.skills ?? '').trim().slice(0, 500);
    const weeklyHours = req.body?.weeklyHours ? Number(req.body.weeklyHours) : undefined;
    const rawLevel = String(req.body?.experienceLevel ?? 'debutant').trim();
    const experienceLevel: ExperienceLevel =
      rawLevel === 'intermediaire' || rawLevel === 'confirme' ? rawLevel : 'debutant';
    const contextDetails = String(req.body?.contextDetails ?? '').trim().slice(0, 2000);
    const useWebSearch = Boolean(req.body?.useWebSearch);

    if (!projectTitle || !sector || !goal) {
      res.status(400).json({
        code: 'MISSING_FIELDS',
        error: 'Renseigne le titre du projet, le secteur et l’objectif principal.',
      });
      return;
    }

    res.socket?.setNoDelay(true);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 12_000);

    res.on('close', () => {
      clearInterval(keepaliveTimer);
      if (!res.writableEnded) {
        abortController.abort(new Error('CLIENT_ABORTED'));
      }
    });

    sendSseEvent(res, { type: 'status', label: 'NOVA structure votre plan en 7 étapes...' });

    try {
      const result = await runBusinessStream({
        moduleKey,
        projectTitle,
        sector,
        budgetEur: Number.isFinite(budgetEur) ? Math.max(0, budgetEur) : 0,
        goal,
        skills,
        weeklyHours: Number.isFinite(weeklyHours) ? weeklyHours : undefined,
        experienceLevel,
        contextDetails,
        useWebSearch,
        externalSignal: abortController.signal,
        callbacks: {
          onStatus: (label) => {
            sendSseEvent(res, { type: 'status', label });
          },
          onModelSelected: (model) => {
            sendSseEvent(res, { type: 'meta', model });
          },
          onDelta: (text) => {
            sendSseEvent(res, { type: 'delta', text });
          },
        },
      });

      recordUsage({
        userId: user?.id ?? null,
        ipHash,
        kind: 'business',
      });

      let savedProject = null;
      if (user) {
        savedProject = createBusinessProject({
          userId: user.id,
          moduleKey,
          title: projectTitle,
          sector,
          budgetEur: Number.isFinite(budgetEur) ? Math.max(0, budgetEur) : 0,
          goal,
          contentMarkdown: result.fullText,
          modelUsed: result.modelUsed,
        });
      }

      sendSseEvent(res, { type: 'sources', sources: result.sources });
      sendSseEvent(res, {
        type: 'done',
        project: savedProject,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        quota: buildQuotaSnapshot(user, ipHash),
      });
      res.end();
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg === 'CLIENT_ABORTED') {
        res.end();
        return;
      }
      const mapped = mapGeminiErrorMessage(err);
      sendSseEvent(res, {
        type: 'error',
        status: mapped.status,
        code: mapped.code,
        error: mapped.message,
        retryAfterSec: mapped.retryAfterSec ?? null,
      });
      res.end();
    } finally {
      clearInterval(keepaliveTimer);
    }
  });

  // 7B. Real Company Creation Studio (Logo PNG/SVG + Website HTML + Brand Kit + Commercial Offer + Business Plan)
  app.get('/api/business/company-creations', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.json({ creations: listCompanyCreations(user.id) });
  });

  app.delete('/api/business/company-creations/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const deleted = deleteCompanyCreation(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Création introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/business/company-suite', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`company:burst:${user ? user.id : ipHash}`, 10, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes avant de relancer une génération complète.`,
      });
      return;
    }

    const projectTitle = String(req.body?.title ?? '').trim();
    const sector = String(req.body?.sector ?? '').trim();
    const budgetEur = Number(req.body?.budgetEur ?? 0);
    const goal = String(req.body?.goal ?? '').trim();
    const skills = String(req.body?.skills ?? '').trim().slice(0, 500);
    const weeklyHours = req.body?.weeklyHours ? Number(req.body.weeklyHours) : undefined;
    const rawLevel = String(req.body?.experienceLevel ?? 'debutant').trim();
    const experienceLevel: ExperienceLevel =
      rawLevel === 'intermediaire' || rawLevel === 'confirme' ? rawLevel : 'debutant';
    const contextDetails = String(req.body?.contextDetails ?? '').trim().slice(0, 2000);

    if (!projectTitle || !sector || !goal) {
      res.status(400).json({
        code: 'MISSING_FIELDS',
        error: 'Renseigne le nom du projet, le secteur et l’objectif principal.',
      });
      return;
    }

    try {
      const { suite, modelUsed } = await runCompanySuite({
        projectTitle,
        sector,
        budgetEur: Number.isFinite(budgetEur) ? Math.max(0, budgetEur) : 0,
        goal,
        skills,
        weeklyHours: Number.isFinite(weeklyHours) ? weeklyHours : undefined,
        experienceLevel,
        contextDetails,
      });

      recordUsage({
        userId: user?.id ?? null,
        ipHash,
        kind: 'business',
      });

      let saved = null;
      if (user) {
        saved = createCompanyCreation({
          userId: user.id,
          title: suite.brandIdentity.brandName || projectTitle,
          sector,
          budgetEur: Number.isFinite(budgetEur) ? Math.max(0, budgetEur) : 0,
          dataJson: JSON.stringify({
            brandIdentity: suite.brandIdentity,
            commercialOffer: suite.commercialOffer,
            businessPlan: suite.businessPlan,
          }),
          logoSvg: suite.logoSvg,
          websiteHtml: suite.websiteHtml,
          modelUsed,
        });
      }

      res.json({
        suite,
        creationId: saved?.id ?? null,
        modelUsed,
        quota: buildQuotaSnapshot(user, ipHash),
      });
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  app.post('/api/business/generate-logo', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`logo:burst:${user ? user.id : ipHash}`, 15, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const brandName = String(req.body?.brandName ?? '').trim();
    const sector = String(req.body?.sector ?? '').trim();
    const primaryColor = String(req.body?.primaryColor ?? '#3B82F6').trim();
    const secondaryColor = String(req.body?.secondaryColor ?? '#7C3AED').trim();
    const styleHint = String(req.body?.styleHint ?? '').trim();
    const creationId = typeof req.body?.creationId === 'string' ? req.body.creationId : null;

    if (!brandName) {
      res.status(400).json({ code: 'MISSING_BRAND', error: 'Nom de marque requis.' });
      return;
    }

    try {
      const { logoSvg, modelUsed } = await generateLogoSvgOnly({
        brandName,
        sector: sector || 'Services numériques',
        primaryColor,
        secondaryColor,
        styleHint,
      });
      if (user && creationId) {
        updateCompanyCreationAssets(creationId, user.id, { logoSvg });
      }
      res.json({ logoSvg, modelUsed });
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  app.post('/api/business/generate-website', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`sitegen:burst:${user ? user.id : ipHash}`, 12, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const brandName = String(req.body?.brandName ?? '').trim();
    const slogan = String(req.body?.slogan ?? '').trim();
    const sector = String(req.body?.sector ?? '').trim();
    const primaryColor = String(req.body?.primaryColor ?? '#3B82F6').trim();
    const secondaryColor = String(req.body?.secondaryColor ?? '#111827').trim();
    const accentColor = String(req.body?.accentColor ?? '#7C3AED').trim();
    const packagesText = String(req.body?.packagesText ?? '').trim();
    const logoSvg = String(req.body?.logoSvg ?? '').trim();
    const customInstructions = String(req.body?.customInstructions ?? '').trim();
    const creationId = typeof req.body?.creationId === 'string' ? req.body.creationId : null;

    if (!brandName) {
      res.status(400).json({ code: 'MISSING_BRAND', error: 'Nom de marque requis.' });
      return;
    }

    try {
      const { websiteHtml, modelUsed } = await regenerateWebsiteHtmlOnly({
        brandName,
        slogan,
        sector: sector || 'Entreprise',
        primaryColor,
        secondaryColor,
        accentColor,
        packagesText,
        logoSvg,
        customInstructions,
      });
      if (user && creationId) {
        updateCompanyCreationAssets(creationId, user.id, { websiteHtml });
      }
      res.json({ websiteHtml, modelUsed });
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  // 7C. Live Website Publishing
  app.post('/api/sites/publish', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    const title = String(req.body?.title ?? 'Site NOVA').trim();
    const htmlContent = String(req.body?.htmlContent ?? '').trim();
    const existingSlug = typeof req.body?.existingSlug === 'string' ? req.body.existingSlug.trim() : null;
    const creationId = typeof req.body?.creationId === 'string' ? req.body.creationId.trim() : null;

    if (!htmlContent || htmlContent.length < 50) {
      res.status(400).json({
        code: 'INVALID_HTML',
        error: 'Aucun code HTML valide à publier.',
      });
      return;
    }

    if (user && !existingSlug) {
      const plan = resolveEffectivePlan(user);
      const maxSites = PLAN_SPECS[plan].maxPublishedSites;
      if (maxSites !== null && countUserPublishedSites(user.id) >= maxSites) {
        res.status(403).json({
          code: 'SITES_LIMIT_REACHED',
          error: `Votre formule ${plan.toUpperCase()} permet jusqu'à ${maxSites} sites publiés simultanément. Supprimez-en un ou passez à une formule supérieure.`,
        });
        return;
      }
    }

    const site = publishSite({
      userId: user?.id ?? null,
      title,
      htmlContent,
      existingSlug,
    });

    if (user && creationId) {
      updateCompanyCreationAssets(creationId, user.id, {
        websiteHtml: htmlContent,
        publishedSlug: site.slug,
      });
    }

    const originUrl = resolveAppBaseUrl(req.headers.origin as string | undefined);
    res.json({
      site: {
        id: site.id,
        slug: site.slug,
        title: site.title,
        created_at: site.created_at,
        updated_at: site.updated_at,
      },
      publicPath: `/sites/${site.slug}`,
      publicUrl: `${originUrl}/sites/${site.slug}`,
    });
  });

  app.get('/api/sites', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.json({ sites: listUserPublishedSites(user.id) });
  });

  app.delete('/api/sites/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const deleted = deletePublishedSite(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Site introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  // 7D. Content Creation Studio
  app.post('/api/content/generate', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`content:burst:${user ? user.id : ipHash}`, 25, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const formatKey = String(req.body?.formatKey ?? 'tiktok_script').trim();
    const topic = String(req.body?.topic ?? '').trim();
    const targetAudience = String(req.body?.targetAudience ?? '').trim();
    const tone = String(req.body?.tone ?? '').trim();
    const callToAction = String(req.body?.callToAction ?? '').trim();

    if (!topic) {
      res.status(400).json({ code: 'MISSING_TOPIC', error: 'Précise le sujet du contenu.' });
      return;
    }

    try {
      const result = await generateMarketingContent({
        formatKey,
        topic,
        targetAudience,
        tone,
        callToAction,
      });
      res.json(result);
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  // 7E. Video Storyboard Creation
  app.post('/api/video/storyboard', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`video:burst:${user ? user.id : ipHash}`, 15, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const topic = String(req.body?.topic ?? '').trim();
    const format = req.body?.format === '16:9' ? '16:9' : '9:16';
    const tone = String(req.body?.tone ?? 'Dynamique et professionnel').trim();
    const durationTargetSec = Number(req.body?.durationTargetSec ?? 25);
    const sourceScript = String(req.body?.sourceScript ?? '').trim();

    if (!topic && !sourceScript) {
      res.status(400).json({
        code: 'MISSING_TOPIC',
        error: 'Renseigne un sujet ou colle un script vidéo.',
      });
      return;
    }

    try {
      const result = await generateVideoStoryboard({
        topic: topic || sourceScript.slice(0, 80),
        format,
        tone,
        durationTargetSec: Number.isFinite(durationTargetSec) ? durationTargetSec : 25,
        sourceScript,
      });
      res.json(result);
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  // 7F. Documents Studio (CRUD + AI Generation)
  app.get('/api/documents', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.json({ documents: listUserDocuments(user.id) });
  });

  app.post('/api/documents', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const docType = String(req.body?.docType ?? 'rapport').trim();
    const title = String(req.body?.title ?? '').trim();
    const contentMarkdown = String(req.body?.contentMarkdown ?? '').trim();
    if (!title || !contentMarkdown) {
      res.status(400).json({ code: 'MISSING_FIELDS', error: 'Titre et contenu requis.' });
      return;
    }
    const doc = createUserDocument({
      userId: user.id,
      docType,
      title,
      contentMarkdown,
      metadataJson: JSON.stringify(req.body?.metadata ?? {}),
    });
    res.status(201).json({ document: doc });
  });

  app.delete('/api/documents/:id', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const deleted = deleteUserDocument(req.params.id, user.id);
    if (!deleted) {
      res.status(404).json({ code: 'NOT_FOUND', error: 'Document introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/documents/generate', async (req, res) => {
    if (!resolveProviderKey('gemini')) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error: 'Clé API Gemini manquante côté serveur (GEMINI_API_KEY).',
      });
      return;
    }
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
    const burst = checkRateLimit(`doc:burst:${user ? user.id : ipHash}`, 20, 60_000);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(burst.retryAfterSec));
      res.status(429).json({
        code: 'BURST_LIMIT',
        retryAfterSec: burst.retryAfterSec,
        error: `Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const docType = String(req.body?.docType ?? 'Proposition commerciale').trim();
    const title = String(req.body?.title ?? '').trim();
    const companyName = String(req.body?.companyName ?? '').trim();
    const clientName = String(req.body?.clientName ?? '').trim();
    const context = String(req.body?.context ?? '').trim();

    if (!title || !context) {
      res.status(400).json({
        code: 'MISSING_FIELDS',
        error: 'Renseigne le titre et le contexte du document.',
      });
      return;
    }

    try {
      const { contentMarkdown, modelUsed } = await generateStructuredDocument({
        docType,
        title,
        companyName,
        clientName,
        context,
      });

      let saved = null;
      if (user) {
        saved = createUserDocument({
          userId: user.id,
          docType,
          title,
          contentMarkdown,
          metadataJson: JSON.stringify({ companyName, clientName, modelUsed }),
        });
      }

      res.json({ contentMarkdown, modelUsed, document: saved });
    } catch (err) {
      sendMappedGeminiJsonError(res, err);
    }
  });

  // 8. Stripe Billing Routes
  app.get('/api/stripe/status', async (_req, res) => {
    const status = await getResolvedStripeConfigStatus(options.stripeClient);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(status);
  });

  app.post('/api/stripe/create-checkout-session', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        error: 'Connecte-toi ou crée un compte avant de souscrire à une formule.',
      });
      return;
    }

    const rawPlan = String(req.body?.plan ?? '');
    const plan: Exclude<PlanTier, 'free'> | null =
      rawPlan === 'pro' || rawPlan === 'business' ? rawPlan : null;
    const interval: BillingInterval =
      req.body?.interval === 'annual' ? 'annual' : 'monthly';

    if (!plan) {
      res.status(400).json({ code: 'INVALID_PLAN', error: 'Formule invalide.' });
      return;
    }

    try {
      const reqOrigin = req.headers.origin as string | undefined;
      const originUrl = resolveAppBaseUrl(reqOrigin);
      const session = await createCheckoutSessionForUser({
        user,
        plan,
        interval,
        originUrl,
        stripeClient: options.stripeClient,
      });
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur Stripe Checkout.';
      const isConfigErr =
        message.startsWith('STRIPE_NON_CONFIGURE') ||
        message.startsWith('STRIPE_PRICE_MANQUANT') ||
        message.startsWith('STRIPE_LIVE_NON_AUTORISE');
      const code = message.startsWith('STRIPE_LIVE_NON_AUTORISE')
        ? 'STRIPE_LIVE_LOCKED'
        : message.startsWith('STRIPE_PRICE_MANQUANT')
        ? 'STRIPE_PRICE_NOT_CONFIGURED'
        : isConfigErr
        ? 'STRIPE_NOT_CONFIGURED'
        : 'STRIPE_CHECKOUT_ERROR';
      res.status(isConfigErr ? 503 : 400).json({
        code,
        error: message,
      });
    }
  });

  app.post('/api/stripe/create-portal-session', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    try {
      const reqOrigin = req.headers.origin as string | undefined;
      const originUrl = resolveAppBaseUrl(reqOrigin);
      const portal = await createBillingPortalForUser({
        user,
        originUrl,
        stripeClient: options.stripeClient,
      });
      res.json(portal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur portail Stripe.';
      res.status(400).json({ code: 'STRIPE_PORTAL_ERROR', error: message });
    }
  });

  app.get('/api/stripe/verify-session', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    const sessionId = String(req.query.session_id ?? '').trim();
    if (!sessionId) {
      res.status(400).json({ code: 'MISSING_SESSION_ID', error: 'Identifiant de session manquant.' });
      return;
    }
    try {
      const ipHash = hashIp(getClientIp(req));
      const result = await verifyCheckoutSessionForUser({
        user,
        sessionId,
        stripeClient: options.stripeClient,
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        ...result,
        quota: buildQuotaSnapshot(result.user, ipHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de vérifier le paiement Stripe.';
      res.status(400).json({ code: 'VERIFY_SESSION_ERROR', error: message });
    }
  });

  app.post('/api/stripe/cancel-subscription', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    try {
      const ipHash = hashIp(getClientIp(req));
      const updatedUser = await setSubscriptionCancellation({
        userId: user.id,
        cancelAtPeriodEnd: true,
        stripeClient: options.stripeClient,
      });
      res.json({
        user: updatedUser,
        quota: buildQuotaSnapshot(updatedUser, ipHash),
        subscriptions: listUserSubscriptions(user.id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la résiliation.';
      res.status(400).json({ code: 'CANCEL_SUBSCRIPTION_ERROR', error: message });
    }
  });

  app.post('/api/stripe/reactivate-subscription', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    try {
      const ipHash = hashIp(getClientIp(req));
      const updatedUser = await setSubscriptionCancellation({
        userId: user.id,
        cancelAtPeriodEnd: false,
        stripeClient: options.stripeClient,
      });
      res.json({
        user: updatedUser,
        quota: buildQuotaSnapshot(updatedUser, ipHash),
        subscriptions: listUserSubscriptions(user.id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la réactivation.';
      res.status(400).json({ code: 'REACTIVATE_SUBSCRIPTION_ERROR', error: message });
    }
  });

  app.get('/api/stripe/subscriptions', (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ subscriptions: listUserSubscriptions(user.id) });
  });

  app.get('/api/stripe/invoices', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    try {
      const result = await listStripeInvoicesForUser(user, options.stripeClient);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de charger les factures Stripe.';
      res.status(400).json({ code: 'STRIPE_INVOICES_ERROR', error: message });
    }
  });

  // 9. API 404 & Error Handlers
  app.use('/api', (req, res) => {
    res.status(404).json({
      code: 'API_ROUTE_NOT_FOUND',
      error: `Route API introuvable : ${req.method} ${req.originalUrl}`,
    });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.originalUrl.startsWith('/api')) {
        const message = err instanceof Error ? err.message : 'Erreur serveur.';
        res.status(400).json({ code: 'SERVER_ERROR', error: message });
        return;
      }
      next(err);
    }
  );

  return app;
}
