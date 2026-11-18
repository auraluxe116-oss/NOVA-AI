import 'dotenv/config';
import express from 'express';
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
  createBusinessProject,
  createConversation,
  createUser,
  deleteBusinessProject,
  deleteConversation,
  findUserByEmail,
  getConversationForUser,
  getDailyUsageCount,
  getDbStorageInfo,
  getLastConversationMessage,
  getUserDashboardStats,
  listBusinessProjects,
  listConversationMessages,
  listUserConversations,
  listUserSubscriptions,
  recordUsage,
  renameConversation,
  toPublicUser,
  updateUserProfile,
} from './db.js';
import {
  BUSINESS_MODULE_LABELS,
  GEMINI_MODELS,
  getGeminiApiKey,
  mapGeminiErrorMessage,
  streamBusinessProject,
  streamConversationResponse,
} from './gemini.js';
import {
  createBillingPortalForUser,
  createCheckoutSessionForUser,
  getStripeConfigStatus,
  listStripeInvoicesForUser,
  processStripeWebhook,
  resolveAppBaseUrl,
  setSubscriptionCancellation,
  verifyCheckoutSessionForUser,
} from './stripe.js';
import {
  GUEST_DAILY_BUSINESS_LIMIT,
  GUEST_DAILY_CHAT_LIMIT,
  PLAN_SPECS,
  resolveEffectivePlan,
  type BillingInterval,
  type ExperienceLevel,
  type PlanTier,
  type PublicUser,
} from './types.js';

function buildQuotaSnapshot(user: PublicUser | null, ipHash: string) {
  const plan: PlanTier = user ? resolveEffectivePlan(user) : 'free';
  const spec = PLAN_SPECS[plan];
  const chatLimit = user ? spec.dailyChatLimit : GUEST_DAILY_CHAT_LIMIT;
  const businessLimit = user ? spec.dailyBusinessLimit : GUEST_DAILY_BUSINESS_LIMIT;

  const chatUsed = getDailyUsageCount({
    userId: user?.id ?? null,
    ipHash,
    kind: 'chat',
  });
  const businessUsed = getDailyUsageCount({
    userId: user?.id ?? null,
    ipHash,
    kind: 'business',
  });

  return {
    plan,
    isAuthenticated: Boolean(user),
    chatUsed,
    chatLimit,
    chatRemaining: Math.max(0, chatLimit - chatUsed),
    businessUsed,
    businessLimit,
    businessRemaining: Math.max(0, businessLimit - businessUsed),
    maxAttachmentBytes: spec.maxAttachmentBytes,
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

const PRO_ONLY_BUSINESS_MODULES = new Set([
  'business_plan',
  'competitor_analysis',
  'sales_strategy',
  'ecommerce_store',
]);

export function createApp(): express.Express {
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
        const result = await processStripeWebhook(req.body, signature);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur Webhook Stripe.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.use(express.json({ limit: '2mb' }));

  // 2. System Health
  app.get('/api/health', (_req, res) => {
    const aiConfigured = Boolean(getGeminiApiKey());
    const stripe = getStripeConfigStatus();
    const storage = getDbStorageInfo();
    res.json({
      ok: true,
      brand: 'NOVA AI',
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

  // 3. Authentication & Profile
  app.post('/api/auth/register', (req, res) => {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const limit = checkRateLimit(`auth:register:${ipHash}`, 12, 15 * 60_000);
    if (!limit.allowed) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        error: `Trop de tentatives d'inscription. Réessaie dans ${limit.retryAfterSec} secondes.`,
      });
      return;
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const displayName = String(req.body?.displayName ?? '').trim();
    const companyName = String(req.body?.companyName ?? '').trim();

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

    const userRecord = createUser({
      email,
      passwordHash: hashPassword(password),
      displayName,
      companyName,
    });
    const publicUser = toPublicUser(userRecord);
    setSessionCookie(req, res, publicUser.id);
    res.status(201).json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = getClientIp(req);
    const ipHash = hashIp(ip);
    const limit = checkRateLimit(`auth:login:${ipHash}`, 20, 15 * 60_000);
    if (!limit.allowed) {
      res.status(429).json({
        code: 'RATE_LIMITED',
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
    setSessionCookie(req, res, publicUser.id);
    res.json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);
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

    const updated = updateUserProfile(userRecord.id, {
      displayName,
      companyName,
      passwordHash: nextPasswordHash,
    });

    if (!updated) {
      res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Compte introuvable.' });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const publicUser = toPublicUser(updated);
    res.json({
      user: publicUser,
      quota: buildQuotaSnapshot(publicUser, ipHash),
    });
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
    const subscriptions = listUserSubscriptions(user.id);

    res.json({
      user,
      planSpec: PLAN_SPECS[effectivePlan],
      quota,
      stats,
      recentConversations,
      recentProjects,
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
    const messages = listConversationMessages(conv.id, 120);
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

  // 6. Real-Time SSE Streaming Chat Assistant
  app.post('/api/chat', async (req, res) => {
    if (!getGeminiApiKey()) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error:
          'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Ajoutez-la dans les variables d’environnement Vercel (Settings > Environment Variables) puis redéployez.',
      });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);

    const burst = checkRateLimit(
      `chat:burst:${user ? user.id : ipHash}`,
      25,
      60_000
    );
    if (!burst.allowed) {
      res.status(429).json({
        code: 'BURST_LIMIT',
        error: `Cadence de requêtes trop élevée. Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const quota = buildQuotaSnapshot(user, ipHash);
    if (quota.chatRemaining <= 0) {
      res.status(429).json({
        code: 'DAILY_QUOTA_REACHED',
        error: user
          ? `Limite quotidienne atteinte pour la formule ${quota.plan.toUpperCase()} (${quota.chatLimit} messages/jour). Passe à une formule supérieure pour continuer.`
          : `Limite découverte atteinte (${GUEST_DAILY_CHAT_LIMIT} messages/jour sans compte). Inscris-toi gratuitement pour obtenir ${PLAN_SPECS.free.dailyChatLimit} messages/jour et l'historique complet.`,
      });
      return;
    }

    const message = String(req.body?.message ?? '').trim();
    if (!message || message.length > 16_000) {
      res.status(400).json({
        code: 'INVALID_MESSAGE',
        error: 'Écris un message valide (entre 1 et 16 000 caractères).',
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
    const requestedConvId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : null;

    let activeConversationId: string | null = null;
    let historyForModel: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (user) {
      if (requestedConvId) {
        const existing = getConversationForUser(requestedConvId, user.id);
        if (!existing) {
          res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', error: 'Conversation introuvable.' });
          return;
        }
        activeConversationId = existing.id;

        const isRetry = Boolean(req.body?.isRetry);
        const lastMsg = getLastConversationMessage(existing.id);
        const alreadyTrailingSameUserPrompt =
          lastMsg &&
          lastMsg.role === 'user' &&
          lastMsg.content.trim() === message;

        if (isRetry && alreadyTrailingSameUserPrompt) {
          // Load previous turns excluding the trailing unanswered user message so Gemini sees clean history
          historyForModel = listConversationMessages(existing.id, 15)
            .filter((m) => m.id !== lastMsg.id)
            .slice(-14)
            .map((m) => ({
              role: m.role,
              content: m.content,
            }));
        } else {
          historyForModel = listConversationMessages(existing.id, 14).map((m) => ({
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
      historyForModel = req.body.guestHistory
        .slice(-12)
        .filter(
          (item: unknown): item is { role: 'user' | 'assistant'; content: string } =>
            Boolean(item) &&
            typeof item === 'object' &&
            ((item as { role?: string }).role === 'user' ||
              (item as { role?: string }).role === 'assistant') &&
            typeof (item as { content?: unknown }).content === 'string'
        );
    }

    // Prepare SSE stream immediately with TCP_NODELAY
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

    sendSseEvent(res, {
      type: 'status',
      label: 'NOVA réfléchit...',
      conversationId: activeConversationId,
    });

    try {
      const result = await streamConversationResponse({
        history: historyForModel,
        userMessage: message,
        attachment,
        useWebSearch,
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
        code: mapped.code,
        error: mapped.message,
      });
      res.end();
    } finally {
      clearInterval(keepaliveTimer);
    }
  });

  // 7. Mode Business Routes
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
    if (!getGeminiApiKey()) {
      res.status(503).json({
        code: 'AI_NOT_CONFIGURED',
        error:
          'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Ajoutez-la dans les variables d’environnement Vercel (Settings > Environment Variables) puis redéployez.',
      });
      return;
    }

    const ipHash = hashIp(getClientIp(req));
    const user = getAuthenticatedPublicUser(req);

    const burst = checkRateLimit(
      `biz:burst:${user ? user.id : ipHash}`,
      12,
      60_000
    );
    if (!burst.allowed) {
      res.status(429).json({
        code: 'BURST_LIMIT',
        error: `Cadence élevée. Patiente ${burst.retryAfterSec} secondes.`,
      });
      return;
    }

    const moduleKey = String(req.body?.moduleKey ?? 'business_ideas').trim();
    if (!Object.prototype.hasOwnProperty.call(BUSINESS_MODULE_LABELS, moduleKey)) {
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

    const plan: PlanTier = user ? resolveEffectivePlan(user) : 'free';
    if (moduleKey === 'company_creation' && plan !== 'business') {
      res.status(403).json({
        code: 'PLAN_UPGRADE_REQUIRED',
        error:
          "Le module Création d'entreprise & Étude de marché approfondie nécessite un abonnement BUSINESS actif (19,99 €/mois).",
      });
      return;
    }
    if (PRO_ONLY_BUSINESS_MODULES.has(moduleKey) && plan === 'free') {
      res.status(403).json({
        code: 'PLAN_UPGRADE_REQUIRED',
        error:
          'Ce module stratégique avancé nécessite un abonnement PRO (9,99 €/mois) ou BUSINESS actif.',
      });
      return;
    }

    const quota = buildQuotaSnapshot(user, ipHash);
    if (quota.businessRemaining <= 0) {
      res.status(429).json({
        code: 'BUSINESS_QUOTA_REACHED',
        error: user
          ? `Limite quotidienne Mode Business atteinte (${quota.businessLimit}/jour pour ${quota.plan.toUpperCase()}).`
          : `Limite découverte Mode Business atteinte (${GUEST_DAILY_BUSINESS_LIMIT}/jour sans compte). Crée un compte gratuit ou passe en Pro.`,
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
      const result = await streamBusinessProject({
        moduleKey,
        projectTitle,
        sector,
        budgetEur: Number.isFinite(budgetEur) ? Math.max(0, budgetEur) : 0,
        goal,
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
        code: mapped.code,
        error: mapped.message,
      });
      res.end();
    } finally {
      clearInterval(keepaliveTimer);
    }
  });

  // 8. Stripe Billing Routes
  app.get('/api/stripe/status', (_req, res) => {
    res.json(getStripeConfigStatus());
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
      });
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur Stripe Checkout.';
      const isConfigErr =
        message.startsWith('STRIPE_NON_CONFIGURE') ||
        message.startsWith('STRIPE_PRICE_MANQUANT');
      res.status(isConfigErr ? 503 : 400).json({
        code: isConfigErr ? 'STRIPE_NOT_CONFIGURED' : 'STRIPE_CHECKOUT_ERROR',
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
      const portal = await createBillingPortalForUser({ user, originUrl });
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
      const result = await verifyCheckoutSessionForUser({ user, sessionId });
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
    res.json({ subscriptions: listUserSubscriptions(user.id) });
  });

  app.get('/api/stripe/invoices', async (req, res) => {
    const user = getAuthenticatedPublicUser(req);
    if (!user) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Connexion requise.' });
      return;
    }
    try {
      const result = await listStripeInvoicesForUser(user);
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
