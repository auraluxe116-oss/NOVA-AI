import Stripe from 'stripe';
import {
  findUserById,
  findUserByStripeCustomerId,
  findUserByStripeSubscriptionId,
  isStripeEventProcessed,
  markStripeEventProcessed,
  toPublicUser,
  updateUserSubscription,
  upsertSubscriptionRecord,
} from './db.js';
import type {
  BillingInterval,
  PlanTier,
  PublicUser,
  StripeInvoiceSummary,
  SubscriptionStatus,
} from './types.js';

function cleanEnv(name: string): string | null {
  let val = process.env[name]?.trim();
  if (!val) return null;
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  if (
    !val ||
    val === 'price_pro' ||
    val === 'price_business' ||
    val === 'price_pro_monthly' ||
    val === 'price_pro_annual' ||
    val === 'price_business_monthly' ||
    val === 'price_business_annual' ||
    val === 'sk_test_or_live_key' ||
    val === 'whsec_your_webhook_secret'
  ) {
    return null;
  }
  return val;
}

type StripeRecurringInterval = 'month' | 'year' | null;

function getExplicitIntervalPriceId(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval
): string | null {
  if (plan === 'pro' && interval === 'monthly') return cleanEnv('STRIPE_PRICE_PRO_MONTHLY');
  if (plan === 'pro' && interval === 'annual') return cleanEnv('STRIPE_PRICE_PRO_ANNUAL');
  if (plan === 'business' && interval === 'monthly') return cleanEnv('STRIPE_PRICE_BUSINESS_MONTHLY');
  if (plan === 'business' && interval === 'annual') return cleanEnv('STRIPE_PRICE_BUSINESS_ANNUAL');
  return null;
}

function getSinglePlanPriceId(plan: Exclude<PlanTier, 'free'>): string | null {
  return cleanEnv(plan === 'pro' ? 'STRIPE_PRICE_PRO' : 'STRIPE_PRICE_BUSINESS');
}

function getStripeClient(override?: Stripe): Stripe | null {
  if (override) return override;
  const key = cleanEnv('STRIPE_SECRET_KEY');
  if (!key) return null;
  return new Stripe(key);
}

export function getStripeMode(): 'test' | 'live' | 'unconfigured' {
  const key = cleanEnv('STRIPE_SECRET_KEY');
  if (!key) return 'unconfigured';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  return 'test';
}

export function isLiveModeAuthorized(): boolean {
  return process.env.STRIPE_ALLOW_LIVE?.trim().toLowerCase() === 'true';
}

export function getPriceIdForPlan(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval,
  singlePriceRecurringHint?: StripeRecurringInterval
): string | null {
  const explicit = getExplicitIntervalPriceId(plan, interval);
  if (explicit) return explicit;

  const singlePriceId = getSinglePlanPriceId(plan);
  if (!singlePriceId) return null;

  const cachedHint = priceCache.get(singlePriceId)?.recurringInterval ?? null;
  const effectiveHint =
    singlePriceRecurringHint !== undefined ? singlePriceRecurringHint : cachedHint;

  if (effectiveHint === 'year') {
    return interval === 'annual' ? singlePriceId : null;
  }
  return interval === 'monthly' ? singlePriceId : null;
}

export function getConfiguredAmountCentsForPlan(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval
): number | null {
  const envKey =
    plan === 'pro'
      ? interval === 'annual'
        ? 'STRIPE_PRO_ANNUAL_CENTS'
        : 'STRIPE_PRO_MONTHLY_CENTS'
      : interval === 'annual'
      ? 'STRIPE_BUSINESS_ANNUAL_CENTS'
      : 'STRIPE_BUSINESS_MONTHLY_CENTS';

  const raw = process.env[envKey]?.trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export interface PlanPricingSnapshot {
  monthlyCents: number | null;
  annualCents: number | null;
  currency: string;
  monthlyConfigured: boolean;
  annualConfigured: boolean;
  source: 'stripe_price' | 'env_cents' | 'unconfigured';
}

export interface StripeConfigStatusPayload {
  stripeConfigured: boolean;
  stripeMode: 'test' | 'live' | 'unconfigured';
  liveAuthorized: boolean;
  webhookConfigured: boolean;
  checkoutReady: boolean;
  usingConfiguredPriceIds: boolean;
  prices: {
    proMonthly: boolean;
    proAnnual: boolean;
    businessMonthly: boolean;
    businessAnnual: boolean;
  };
  catalog: {
    pro: PlanPricingSnapshot;
    business: PlanPricingSnapshot;
  };
}

const priceCache = new Map<
  string,
  {
    amount: number | null;
    currency: string;
    recurringInterval: StripeRecurringInterval;
    expiresAt: number;
  }
>();

interface ResolvedPriceMeta {
  amountCents: number | null;
  currency: string;
  configured: boolean;
  recurringInterval: StripeRecurringInterval;
  source: 'stripe_price' | 'env_cents' | 'unconfigured';
}

async function resolveStripePriceMeta(
  stripe: Stripe | null,
  priceId: string | null,
  fallbackEnvCents: number | null
): Promise<ResolvedPriceMeta> {
  if (priceId && stripe) {
    const cached = priceCache.get(priceId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        amountCents: cached.amount,
        currency: cached.currency,
        configured: true,
        recurringInterval: cached.recurringInterval,
        source: 'stripe_price',
      };
    }
    try {
      const price = await stripe.prices.retrieve(priceId);
      const amount = typeof price.unit_amount === 'number' ? price.unit_amount : fallbackEnvCents;
      const currency = (price.currency || 'eur').toLowerCase();
      const rawRec = price.recurring?.interval;
      const recurringInterval: StripeRecurringInterval =
        rawRec === 'year' ? 'year' : rawRec === 'month' ? 'month' : null;
      priceCache.set(priceId, {
        amount,
        currency,
        recurringInterval,
        expiresAt: Date.now() + 5 * 60_000,
      });
      return {
        amountCents: amount,
        currency,
        configured: true,
        recurringInterval,
        source: 'stripe_price',
      };
    } catch {
      return {
        amountCents: fallbackEnvCents,
        currency: 'eur',
        configured: true,
        recurringInterval: null,
        source: 'stripe_price',
      };
    }
  }

  if (priceId) {
    return {
      amountCents: fallbackEnvCents,
      currency: 'eur',
      configured: true,
      recurringInterval: priceCache.get(priceId)?.recurringInterval ?? null,
      source: 'stripe_price',
    };
  }

  if (fallbackEnvCents !== null) {
    return {
      amountCents: fallbackEnvCents,
      currency: 'eur',
      configured: true,
      recurringInterval: null,
      source: 'env_cents',
    };
  }

  return {
    amountCents: null,
    currency: 'eur',
    configured: false,
    recurringInterval: null,
    source: 'unconfigured',
  };
}

export function getStripeConfigStatus(): StripeConfigStatusPayload {
  const secretKeyPresent = Boolean(cleanEnv('STRIPE_SECRET_KEY'));
  const stripeMode = getStripeMode();
  const liveAuthorized = isLiveModeAuthorized();
  const webhookSecretPresent = Boolean(cleanEnv('STRIPE_WEBHOOK_SECRET'));

  const proMonthlyPriceId = getPriceIdForPlan('pro', 'monthly');
  const proAnnualPriceId = getPriceIdForPlan('pro', 'annual');
  const bizMonthlyPriceId = getPriceIdForPlan('business', 'monthly');
  const bizAnnualPriceId = getPriceIdForPlan('business', 'annual');

  const proMonthlyCents = getConfiguredAmountCentsForPlan('pro', 'monthly');
  const proAnnualCents = getConfiguredAmountCentsForPlan('pro', 'annual');
  const bizMonthlyCents = getConfiguredAmountCentsForPlan('business', 'monthly');
  const bizAnnualCents = getConfiguredAmountCentsForPlan('business', 'annual');

  const proMonthlyConfigured = Boolean(proMonthlyPriceId || proMonthlyCents !== null);
  const proAnnualConfigured = Boolean(proAnnualPriceId || proAnnualCents !== null);
  const bizMonthlyConfigured = Boolean(bizMonthlyPriceId || bizMonthlyCents !== null);
  const bizAnnualConfigured = Boolean(bizAnnualPriceId || bizAnnualCents !== null);

  const anyPriceConfigured =
    proMonthlyConfigured || proAnnualConfigured || bizMonthlyConfigured || bizAnnualConfigured;

  const modeAllowed = stripeMode === 'test' || (stripeMode === 'live' && liveAuthorized);

  return {
    stripeConfigured: secretKeyPresent,
    stripeMode,
    liveAuthorized,
    webhookConfigured: webhookSecretPresent,
    checkoutReady: secretKeyPresent && modeAllowed && anyPriceConfigured,
    usingConfiguredPriceIds: Boolean(
      (proMonthlyPriceId || proAnnualPriceId) && (bizMonthlyPriceId || bizAnnualPriceId)
    ),
    prices: {
      proMonthly: Boolean(proMonthlyPriceId),
      proAnnual: Boolean(proAnnualPriceId),
      businessMonthly: Boolean(bizMonthlyPriceId),
      businessAnnual: Boolean(bizAnnualPriceId),
    },
    catalog: {
      pro: {
        monthlyCents: proMonthlyCents,
        annualCents: proAnnualCents,
        currency: 'eur',
        monthlyConfigured: proMonthlyConfigured,
        annualConfigured: proAnnualConfigured,
        source:
          proMonthlyPriceId || proAnnualPriceId
            ? 'stripe_price'
            : proMonthlyCents || proAnnualCents
            ? 'env_cents'
            : 'unconfigured',
      },
      business: {
        monthlyCents: bizMonthlyCents,
        annualCents: bizAnnualCents,
        currency: 'eur',
        monthlyConfigured: bizMonthlyConfigured,
        annualConfigured: bizAnnualConfigured,
        source:
          bizMonthlyPriceId || bizAnnualPriceId
            ? 'stripe_price'
            : bizMonthlyCents || bizAnnualCents
            ? 'env_cents'
            : 'unconfigured',
      },
    },
  };
}

async function resolvePlanPricingSnapshot(
  stripe: Stripe,
  plan: Exclude<PlanTier, 'free'>
): Promise<{
  snapshot: PlanPricingSnapshot;
  monthlyPricePresent: boolean;
  annualPricePresent: boolean;
}> {
  const explicitMonthly = getExplicitIntervalPriceId(plan, 'monthly');
  const explicitAnnual = getExplicitIntervalPriceId(plan, 'annual');
  const singlePriceId = getSinglePlanPriceId(plan);

  const fallbackMonthlyCents = getConfiguredAmountCentsForPlan(plan, 'monthly');
  const fallbackAnnualCents = getConfiguredAmountCentsForPlan(plan, 'annual');

  const singleMeta =
    singlePriceId && (!explicitMonthly || !explicitAnnual)
      ? await resolveStripePriceMeta(stripe, singlePriceId, null)
      : null;

  const singleHint = singleMeta?.recurringInterval ?? null;
  const effectiveMonthlyPriceId = getPriceIdForPlan(plan, 'monthly', singleHint);
  const effectiveAnnualPriceId = getPriceIdForPlan(plan, 'annual', singleHint);

  const [monthlyMeta, annualMeta] = await Promise.all([
    resolveStripePriceMeta(stripe, effectiveMonthlyPriceId, fallbackMonthlyCents),
    resolveStripePriceMeta(stripe, effectiveAnnualPriceId, fallbackAnnualCents),
  ]);

  return {
    snapshot: {
      monthlyCents: monthlyMeta.amountCents,
      annualCents: annualMeta.amountCents,
      currency: monthlyMeta.configured ? monthlyMeta.currency : annualMeta.currency,
      monthlyConfigured: monthlyMeta.configured,
      annualConfigured: annualMeta.configured,
      source: monthlyMeta.configured ? monthlyMeta.source : annualMeta.source,
    },
    monthlyPricePresent: Boolean(effectiveMonthlyPriceId),
    annualPricePresent: Boolean(effectiveAnnualPriceId),
  };
}

export async function getResolvedStripeConfigStatus(
  stripeClientOverride?: Stripe
): Promise<StripeConfigStatusPayload> {
  const base = getStripeConfigStatus();
  const stripe = getStripeClient(stripeClientOverride);
  if (!stripe) return base;

  const [proResolved, bizResolved] = await Promise.all([
    resolvePlanPricingSnapshot(stripe, 'pro'),
    resolvePlanPricingSnapshot(stripe, 'business'),
  ]);

  const anyPriceConfigured =
    proResolved.snapshot.monthlyConfigured ||
    proResolved.snapshot.annualConfigured ||
    bizResolved.snapshot.monthlyConfigured ||
    bizResolved.snapshot.annualConfigured;

  const modeAllowed =
    base.stripeMode === 'test' || (base.stripeMode === 'live' && base.liveAuthorized);

  return {
    ...base,
    checkoutReady: base.stripeConfigured && modeAllowed && anyPriceConfigured,
    usingConfiguredPriceIds: Boolean(
      (proResolved.monthlyPricePresent || proResolved.annualPricePresent) &&
        (bizResolved.monthlyPricePresent || bizResolved.annualPricePresent)
    ),
    prices: {
      proMonthly: proResolved.monthlyPricePresent,
      proAnnual: proResolved.annualPricePresent,
      businessMonthly: bizResolved.monthlyPricePresent,
      businessAnnual: bizResolved.annualPricePresent,
    },
    catalog: {
      pro: proResolved.snapshot,
      business: bizResolved.snapshot,
    },
  };
}

export function resolveAppBaseUrl(reqOrigin?: string): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  if (reqOrigin) {
    return reqOrigin.replace(/\/+$/, '');
  }
  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProdUrl) {
    return `https://${vercelProdUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  return 'http://localhost:3000';
}

export async function createCheckoutSessionForUser(params: {
  user: PublicUser;
  plan: Exclude<PlanTier, 'free'>;
  interval: BillingInterval;
  originUrl: string;
  stripeClient?: Stripe;
}): Promise<{ url: string; sessionId: string; mode: 'test' | 'live' }> {
  const stripe = getStripeClient(params.stripeClient);
  if (!stripe) {
    throw new Error(
      'STRIPE_NON_CONFIGURE: Stripe n’est pas encore activé côté serveur. Ajoutez STRIPE_SECRET_KEY (clé test sk_test_...) et STRIPE_WEBHOOK_SECRET (whsec_...) dans vos variables d’environnement.'
    );
  }

  const mode = getStripeMode();
  if (mode === 'live' && !isLiveModeAuthorized()) {
    throw new Error(
      'STRIPE_LIVE_NON_AUTORISE: Une clé Stripe live a été détectée mais la mise en production n’est pas encore autorisée (STRIPE_ALLOW_LIVE=true requis après vérification complète en mode Test).'
    );
  }

  let singlePriceHint: StripeRecurringInterval = null;
  const explicitPriceId = getExplicitIntervalPriceId(params.plan, params.interval);
  const singlePriceId = !explicitPriceId ? getSinglePlanPriceId(params.plan) : null;
  if (singlePriceId) {
    const meta = await resolveStripePriceMeta(stripe, singlePriceId, null);
    singlePriceHint = meta.recurringInterval;
  }

  const configuredPriceId =
    explicitPriceId ?? getPriceIdForPlan(params.plan, params.interval, singlePriceHint);
  const configuredAmountCents = getConfiguredAmountCentsForPlan(params.plan, params.interval);
  const planEnvUpper = params.plan.toUpperCase();
  const intervalEnvUpper = params.interval.toUpperCase();

  if (mode === 'live' && !configuredPriceId) {
    throw new Error(
      `STRIPE_PRICE_MANQUANT: En mode production, un identifiant Stripe Price officiel (STRIPE_PRICE_${planEnvUpper} ou STRIPE_PRICE_${planEnvUpper}_${intervalEnvUpper}) est obligatoire.`
    );
  }

  if (!configuredPriceId && configuredAmountCents === null) {
    throw new Error(
      `STRIPE_PRICE_MANQUANT: Aucun tarif configuré pour ${planEnvUpper} (${params.interval}). Définissez STRIPE_PRICE_${planEnvUpper} ou STRIPE_PRICE_${planEnvUpper}_${intervalEnvUpper} (ou STRIPE_${planEnvUpper}_${intervalEnvUpper}_CENTS en test).`
    );
  }

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = configuredPriceId
    ? { price: configuredPriceId, quantity: 1 }
    : {
        price_data: {
          currency: 'eur',
          unit_amount: configuredAmountCents!,
          recurring: {
            interval: params.interval === 'annual' ? 'year' : 'month',
          },
          product_data: {
            name: params.plan === 'pro' ? 'NOVA AI — Abonnement PRO' : 'NOVA AI — Abonnement BUSINESS',
            description:
              params.plan === 'pro'
                ? 'Fonctionnalités avancées, jusqu’à 25 sites publiés, pièces jointes 512 Ko et portail client Stripe.'
                : 'Fonctionnalités professionnelles, sites publiés illimités, pièces jointes 2 Mo et priorité maximale.',
            metadata: {
              plan: params.plan,
              interval: params.interval,
            },
          },
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [lineItem],
    customer: params.user.stripeCustomerId ?? undefined,
    customer_email: params.user.stripeCustomerId ? undefined : params.user.email,
    client_reference_id: params.user.id,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    metadata: {
      userId: params.user.id,
      plan: params.plan,
      interval: params.interval,
    },
    subscription_data: {
      metadata: {
        userId: params.user.id,
        plan: params.plan,
        interval: params.interval,
      },
    },
    success_url: `${params.originUrl}/?view=paiement-succes&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.originUrl}/?view=paiement-echec`,
  });

  if (!session.url) {
    throw new Error('Stripe Checkout n’a pas renvoyé d’URL de paiement sécurisée.');
  }

  return {
    url: session.url,
    sessionId: session.id,
    mode: mode === 'live' ? 'live' : 'test',
  };
}

export async function verifyCheckoutSessionForUser(params: {
  user: PublicUser;
  sessionId: string;
  stripeClient?: Stripe;
}): Promise<{
  verified: boolean;
  paymentStatus: string;
  plan: PlanTier;
  interval: BillingInterval;
  user: PublicUser;
}> {
  const stripe = getStripeClient(params.stripeClient);
  if (!stripe) {
    throw new Error('STRIPE_NON_CONFIGURE: Clé serveur Stripe manquante.');
  }

  const session = await stripe.checkout.sessions.retrieve(params.sessionId, {
    expand: ['subscription'],
  });

  const ownerMatch =
    session.client_reference_id === params.user.id ||
    session.metadata?.userId === params.user.id ||
    (Boolean(params.user.stripeCustomerId) &&
      (typeof session.customer === 'string'
        ? session.customer === params.user.stripeCustomerId
        : session.customer?.id === params.user.stripeCustomerId));

  if (!ownerMatch) {
    throw new Error('SESSION_INVALIDE: Cette session de paiement ne correspond pas à votre compte.');
  }

  const rawPlan = session.metadata?.plan;
  const plan: PlanTier =
    rawPlan === 'business' ? 'business' : rawPlan === 'pro' ? 'pro' : 'free';
  const interval: BillingInterval =
    session.metadata?.interval === 'annual' ? 'annual' : 'monthly';
  const isPaid = session.payment_status === 'paid';

  if (!isPaid || plan === 'free') {
    const freshUser = findUserById(params.user.id);
    return {
      verified: false,
      paymentStatus: session.payment_status || 'unpaid',
      plan: freshUser ? toPublicUser(freshUser).effectivePlan : params.user.effectivePlan,
      interval,
      user: freshUser ? toPublicUser(freshUser) : params.user,
    };
  }

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null;

  const subObj =
    typeof session.subscription === 'object' && session.subscription
      ? (session.subscription as Stripe.Subscription)
      : null;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : subObj?.id ?? null;

  const subRaw = subObj as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
  } | null;

  const periodStartIso =
    typeof subRaw?.current_period_start === 'number'
      ? new Date(subRaw.current_period_start * 1000).toISOString()
      : new Date().toISOString();
  const periodEndIso =
    typeof subRaw?.current_period_end === 'number'
      ? new Date(subRaw.current_period_end * 1000).toISOString()
      : null;

  const updated = updateUserSubscription(params.user.id, {
    plan,
    billingInterval: interval,
    subscriptionStatus: 'active',
    cancelAtPeriodEnd: Boolean(subRaw?.cancel_at_period_end),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd: periodEndIso,
  });

  upsertSubscriptionRecord({
    userId: params.user.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: session.id,
    plan,
    billingInterval: interval,
    amountCents:
      typeof session.amount_total === 'number'
        ? session.amount_total
        : getConfiguredAmountCentsForPlan(plan, interval) ?? 0,
    currency: session.currency ?? 'eur',
    status: 'active',
    cancelAtPeriodEnd: Boolean(subRaw?.cancel_at_period_end),
    currentPeriodStart: periodStartIso,
    currentPeriodEnd: periodEndIso,
  });

  return {
    verified: true,
    paymentStatus: 'paid',
    plan,
    interval,
    user: updated ? toPublicUser(updated) : params.user,
  };
}

export async function createBillingPortalForUser(params: {
  user: PublicUser;
  originUrl: string;
  stripeClient?: Stripe;
}): Promise<{ url: string }> {
  const stripe = getStripeClient(params.stripeClient);
  if (!stripe) {
    throw new Error(
      'STRIPE_NON_CONFIGURE: Ajoutez STRIPE_SECRET_KEY dans vos variables d’environnement pour gérer la facturation Stripe.'
    );
  }
  if (!params.user.stripeCustomerId) {
    throw new Error(
      'AUCUN_ABONNEMENT_STRIPE: Aucun identifiant client Stripe n’est encore associé à ce compte.'
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: params.user.stripeCustomerId,
    return_url: `${params.originUrl}/?view=profil`,
  });

  return { url: session.url };
}

export async function listStripeInvoicesForUser(
  user: PublicUser,
  stripeClientOverride?: Stripe
): Promise<{ invoices: StripeInvoiceSummary[]; stripeConfigured: boolean }> {
  const stripe = getStripeClient(stripeClientOverride);
  if (!stripe) {
    return { invoices: [], stripeConfigured: false };
  }
  if (!user.stripeCustomerId) {
    return { invoices: [], stripeConfigured: true };
  }

  const list = await stripe.invoices.list({
    customer: user.stripeCustomerId,
    limit: 12,
  });

  const invoices: StripeInvoiceSummary[] = list.data.map((inv) => ({
    id: inv.id,
    number: inv.number ?? null,
    status: inv.status ?? null,
    amountPaidCents: inv.amount_paid ?? inv.amount_due ?? 0,
    currency: inv.currency ?? 'eur',
    createdAt: new Date(inv.created * 1000).toISOString(),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
  }));

  return { invoices, stripeConfigured: true };
}

export async function setSubscriptionCancellation(params: {
  userId: string;
  cancelAtPeriodEnd: boolean;
  stripeClient?: Stripe;
}): Promise<PublicUser> {
  const stripe = getStripeClient(params.stripeClient);
  if (!stripe) {
    throw new Error('STRIPE_NON_CONFIGURE: Clé Stripe manquante côté serveur.');
  }
  const userRecord = findUserById(params.userId);
  if (!userRecord || !userRecord.stripe_subscription_id) {
    throw new Error('AUCUN_ABONNEMENT_ACTIF: Aucun abonnement Stripe actif à modifier.');
  }

  const updatedSub = await stripe.subscriptions.update(userRecord.stripe_subscription_id, {
    cancel_at_period_end: params.cancelAtPeriodEnd,
  });

  const subRaw = updatedSub as unknown as {
    current_period_end?: number;
    cancel_at_period_end?: boolean;
  };
  const periodEndIso =
    typeof subRaw.current_period_end === 'number'
      ? new Date(subRaw.current_period_end * 1000).toISOString()
      : userRecord.current_period_end;

  const updatedUser = updateUserSubscription(userRecord.id, {
    plan: userRecord.plan,
    subscriptionStatus: mapStripeStatus(updatedSub.status),
    cancelAtPeriodEnd: Boolean(updatedSub.cancel_at_period_end),
    currentPeriodEnd: periodEndIso,
  });

  upsertSubscriptionRecord({
    userId: userRecord.id,
    stripeCustomerId: userRecord.stripe_customer_id,
    stripeSubscriptionId: updatedSub.id,
    plan: userRecord.plan,
    billingInterval: userRecord.billing_interval,
    amountCents: 0,
    status: updatedSub.status,
    cancelAtPeriodEnd: Boolean(updatedSub.cancel_at_period_end),
    currentPeriodEnd: periodEndIso,
  });

  return toPublicUser(updatedUser ?? userRecord);
}

function mapStripeStatus(status: string): SubscriptionStatus {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'past_due';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  return 'inactive';
}

function inferPlanFromPriceId(priceId: string | undefined): PlanTier | null {
  if (!priceId) return null;
  if (
    priceId === cleanEnv('STRIPE_PRICE_PRO_MONTHLY') ||
    priceId === cleanEnv('STRIPE_PRICE_PRO_ANNUAL') ||
    priceId === cleanEnv('STRIPE_PRICE_PRO')
  ) {
    return 'pro';
  }
  if (
    priceId === cleanEnv('STRIPE_PRICE_BUSINESS_MONTHLY') ||
    priceId === cleanEnv('STRIPE_PRICE_BUSINESS_ANNUAL') ||
    priceId === cleanEnv('STRIPE_PRICE_BUSINESS')
  ) {
    return 'business';
  }
  return null;
}

function inferPlanFromConfiguredAmount(
  unitAmount: number,
  interval: BillingInterval
): PlanTier | null {
  if (!unitAmount || unitAmount <= 0) return null;
  if (unitAmount === getConfiguredAmountCentsForPlan('business', interval)) return 'business';
  if (unitAmount === getConfiguredAmountCentsForPlan('pro', interval)) return 'pro';
  return null;
}

export async function processStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  stripeClientOverride?: Stripe
): Promise<{ received: boolean; eventType: string; duplicate?: boolean }> {
  const webhookSecret = cleanEnv('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET manquant côté serveur.');
  }
  if (!signature) {
    throw new Error('En-tête Stripe-Signature absent.');
  }

  const stripe =
    getStripeClient(stripeClientOverride) ??
    new Stripe(cleanEnv('STRIPE_SECRET_KEY') || 'sk_webhook_verify_only');
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  if (isStripeEventProcessed(event.id)) {
    return { received: true, eventType: event.type, duplicate: true };
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.userId || null;
      const rawPlan = session.metadata?.plan;
      const plan: PlanTier =
        rawPlan === 'business' ? 'business' : rawPlan === 'pro' ? 'pro' : 'free';
      const interval: BillingInterval =
        session.metadata?.interval === 'annual' ? 'annual' : 'monthly';
      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id ?? null;

      const user = userId
        ? findUserById(userId)
        : customerId
        ? findUserByStripeCustomerId(customerId)
        : null;

      if (user && plan !== 'free') {
        const isPaid =
          event.type === 'checkout.session.async_payment_succeeded' ||
          session.payment_status === 'paid';

        if (isPaid) {
          let periodStartIso = new Date().toISOString();
          let periodEndIso: string | null = null;
          const activeClient = getStripeClient(stripeClientOverride);
          if (subscriptionId && activeClient) {
            try {
              const subDetails = await activeClient.subscriptions.retrieve(subscriptionId);
              const subRaw = subDetails as unknown as {
                current_period_start?: number;
                current_period_end?: number;
              };
              if (typeof subRaw.current_period_start === 'number') {
                periodStartIso = new Date(subRaw.current_period_start * 1000).toISOString();
              }
              if (typeof subRaw.current_period_end === 'number') {
                periodEndIso = new Date(subRaw.current_period_end * 1000).toISOString();
              }
            } catch {
              // Keep webhook resilient if subscription retrieval fails transiently
            }
          }

          updateUserSubscription(user.id, {
            plan,
            billingInterval: interval,
            subscriptionStatus: 'active',
            cancelAtPeriodEnd: false,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            currentPeriodEnd: periodEndIso,
          });
          upsertSubscriptionRecord({
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripeCheckoutSessionId: session.id,
            plan,
            billingInterval: interval,
            amountCents:
              typeof session.amount_total === 'number'
                ? session.amount_total
                : getConfiguredAmountCentsForPlan(plan, interval) ?? 0,
            currency: session.currency ?? 'eur',
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodStart: periodStartIso,
            currentPeriodEnd: periodEndIso,
          });
        } else {
          // Payment pending / unpaid: never grant paid access before real payment confirmation
          upsertSubscriptionRecord({
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripeCheckoutSessionId: session.id,
            plan,
            billingInterval: interval,
            amountCents: getConfiguredAmountCentsForPlan(plan, interval) ?? 0,
            currency: session.currency ?? 'eur',
            status: 'pending_payment',
          });
        }
      }
      break;
    }

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.userId || null;
      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null;
      const user = userId
        ? findUserById(userId)
        : customerId
        ? findUserByStripeCustomerId(customerId)
        : null;

      if (user && user.subscription_status !== 'active') {
        updateUserSubscription(user.id, {
          plan: 'free',
          subscriptionStatus: 'canceled',
          cancelAtPeriodEnd: false,
        });
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      const userId = sub.metadata?.userId;
      const user = userId
        ? findUserById(userId)
        : findUserByStripeSubscriptionId(sub.id) ??
          (customerId ? findUserByStripeCustomerId(customerId) : null);

      if (user) {
        const mappedStatus =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : mapStripeStatus(sub.status);

        const firstPrice = sub.items?.data?.[0]?.price?.id;
        const unitAmount = sub.items?.data?.[0]?.price?.unit_amount ?? 0;
        const metaPlan = sub.metadata?.plan;
        const rawInterval = sub.items?.data?.[0]?.price?.recurring?.interval;
        const resolvedInterval: BillingInterval =
          rawInterval === 'year' || sub.metadata?.interval === 'annual'
            ? 'annual'
            : 'monthly';

        const isRevoked =
          mappedStatus === 'canceled' ||
          mappedStatus === 'inactive' ||
          event.type === 'customer.subscription.deleted';

        const inferredPlan: PlanTier = isRevoked
          ? 'free'
          : inferPlanFromPriceId(firstPrice) ??
            inferPlanFromConfiguredAmount(unitAmount, resolvedInterval) ??
            (metaPlan === 'business'
              ? 'business'
              : metaPlan === 'pro'
              ? 'pro'
              : user.plan);

        const subRaw = sub as unknown as {
          current_period_start?: number;
          current_period_end?: number;
          canceled_at?: number;
        };
        const periodStartIso =
          typeof subRaw.current_period_start === 'number'
            ? new Date(subRaw.current_period_start * 1000).toISOString()
            : null;
        const periodEndIso =
          typeof subRaw.current_period_end === 'number'
            ? new Date(subRaw.current_period_end * 1000).toISOString()
            : null;
        const canceledAtIso =
          typeof subRaw.canceled_at === 'number'
            ? new Date(subRaw.canceled_at * 1000).toISOString()
            : event.type === 'customer.subscription.deleted'
            ? new Date().toISOString()
            : null;

        updateUserSubscription(user.id, {
          plan: inferredPlan,
          billingInterval: resolvedInterval,
          subscriptionStatus: mappedStatus,
          cancelAtPeriodEnd: isRevoked ? false : Boolean(sub.cancel_at_period_end),
          stripeCustomerId: customerId ?? user.stripe_customer_id,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: periodEndIso,
        });

        upsertSubscriptionRecord({
          userId: user.id,
          stripeCustomerId: customerId ?? user.stripe_customer_id,
          stripeSubscriptionId: sub.id,
          plan: inferredPlan,
          billingInterval: resolvedInterval,
          amountCents: unitAmount,
          status: sub.status,
          cancelAtPeriodEnd: isRevoked ? false : Boolean(sub.cancel_at_period_end),
          currentPeriodStart: periodStartIso,
          currentPeriodEnd: periodEndIso,
          canceledAt: canceledAtIso,
        });
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id ?? null;
      const invSub = (invoice as unknown as { subscription?: string | { id: string } | null })
        .subscription;
      const subscriptionId =
        typeof invSub === 'string' ? invSub : invSub?.id ?? null;

      const user =
        (subscriptionId ? findUserByStripeSubscriptionId(subscriptionId) : null) ??
        (customerId ? findUserByStripeCustomerId(customerId) : null);

      if (user && user.plan !== 'free') {
        const linePeriodEnd = invoice.lines?.data?.[0]?.period?.end;
        const periodEndIso =
          typeof linePeriodEnd === 'number'
            ? new Date(linePeriodEnd * 1000).toISOString()
            : user.current_period_end;

        updateUserSubscription(user.id, {
          plan: user.plan,
          subscriptionStatus: 'active',
          currentPeriodEnd: periodEndIso,
        });
        if (subscriptionId) {
          upsertSubscriptionRecord({
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            plan: user.plan,
            billingInterval: user.billing_interval,
            amountCents: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'active',
            currentPeriodEnd: periodEndIso,
          });
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id ?? null;
      const invSub = (invoice as unknown as { subscription?: string | { id: string } | null })
        .subscription;
      const subscriptionId =
        typeof invSub === 'string' ? invSub : invSub?.id ?? null;

      const user =
        (subscriptionId ? findUserByStripeSubscriptionId(subscriptionId) : null) ??
        (customerId ? findUserByStripeCustomerId(customerId) : null);

      if (user) {
        updateUserSubscription(user.id, {
          plan: user.plan,
          subscriptionStatus: 'past_due',
        });
        if (subscriptionId) {
          upsertSubscriptionRecord({
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            plan: user.plan,
            billingInterval: user.billing_interval,
            amountCents: 0,
            status: 'past_due',
          });
        }
      }
      break;
    }

    default:
      break;
  }

  markStripeEventProcessed(event.id, event.type);
  return { received: true, eventType: event.type };
}
