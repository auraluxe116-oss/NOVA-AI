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
import type { BillingInterval, PlanTier, PublicUser, SubscriptionStatus } from './types.js';

function cleanEnv(name: string): string | null {
  const val = process.env[name]?.trim();
  if (
    !val ||
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

function getStripeClient(): Stripe | null {
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

export function getPriceIdForPlan(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval
): string | null {
  if (plan === 'pro' && interval === 'monthly') return cleanEnv('STRIPE_PRICE_PRO_MONTHLY');
  if (plan === 'pro' && interval === 'annual') return cleanEnv('STRIPE_PRICE_PRO_ANNUAL');
  if (plan === 'business' && interval === 'monthly') return cleanEnv('STRIPE_PRICE_BUSINESS_MONTHLY');
  if (plan === 'business' && interval === 'annual') return cleanEnv('STRIPE_PRICE_BUSINESS_ANNUAL');
  return null;
}

export function getAmountCentsForPlan(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval
): number {
  if (plan === 'pro') {
    return interval === 'annual' ? 9588 : 999; // 95,88 €/an ou 9,99 €/mois
  }
  return interval === 'annual' ? 19188 : 1999; // 191,88 €/an ou 19,99 €/mois
}

export function getStripeConfigStatus() {
  const secretKeyPresent = Boolean(cleanEnv('STRIPE_SECRET_KEY'));
  const webhookSecretPresent = Boolean(cleanEnv('STRIPE_WEBHOOK_SECRET'));
  const prices = {
    proMonthly: Boolean(getPriceIdForPlan('pro', 'monthly')),
    proAnnual: Boolean(getPriceIdForPlan('pro', 'annual')),
    businessMonthly: Boolean(getPriceIdForPlan('business', 'monthly')),
    businessAnnual: Boolean(getPriceIdForPlan('business', 'annual')),
  };

  return {
    stripeConfigured: secretKeyPresent,
    stripeMode: getStripeMode(),
    webhookConfigured: webhookSecretPresent,
    checkoutReady: secretKeyPresent,
    usingConfiguredPriceIds:
      prices.proMonthly && prices.proAnnual && prices.businessMonthly && prices.businessAnnual,
    prices,
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
}): Promise<{ url: string; sessionId: string; mode: 'test' | 'live' }> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error(
      'STRIPE_NON_CONFIGURE: Stripe n’est pas encore activé côté serveur. Ajoutez STRIPE_SECRET_KEY (clé test sk_test_...) et STRIPE_WEBHOOK_SECRET (whsec_...) dans Settings > Secrets.'
    );
  }

  const configuredPriceId = getPriceIdForPlan(params.plan, params.interval);
  const amountCents = getAmountCentsForPlan(params.plan, params.interval);

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = configuredPriceId
    ? { price: configuredPriceId, quantity: 1 }
    : {
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          recurring: {
            interval: params.interval === 'annual' ? 'year' : 'month',
          },
          product_data: {
            name: params.plan === 'pro' ? 'NOVA AI — Abonnement PRO' : 'NOVA AI — Abonnement BUSINESS',
            description:
              params.plan === 'pro'
                ? 'Assistant IA prioritaire, Mode Business avancé, Business Plans, historique complet et exports.'
                : "Assistant création d'entreprise, études de marché avancées, stratégies commerciales et priorité maximale.",
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
    mode: getStripeMode() === 'live' ? 'live' : 'test',
  };
}

export async function verifyCheckoutSessionForUser(params: {
  user: PublicUser;
  sessionId: string;
}): Promise<{
  verified: boolean;
  paymentStatus: string;
  plan: PlanTier;
  interval: BillingInterval;
  user: PublicUser;
}> {
  const stripe = getStripeClient();
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
        : getAmountCentsForPlan(plan, interval),
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
}): Promise<{ url: string }> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error(
      'STRIPE_NON_CONFIGURE: Ajoutez STRIPE_SECRET_KEY dans Settings > Secrets pour gérer la facturation Stripe.'
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

export async function setSubscriptionCancellation(params: {
  userId: string;
  cancelAtPeriodEnd: boolean;
}): Promise<PublicUser> {
  const stripe = getStripeClient();
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
    priceId === cleanEnv('STRIPE_PRICE_PRO_ANNUAL')
  ) {
    return 'pro';
  }
  if (
    priceId === cleanEnv('STRIPE_PRICE_BUSINESS_MONTHLY') ||
    priceId === cleanEnv('STRIPE_PRICE_BUSINESS_ANNUAL')
  ) {
    return 'business';
  }
  return null;
}

export async function processStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined
): Promise<{ received: boolean; eventType: string; duplicate?: boolean }> {
  const webhookSecret = cleanEnv('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET manquant côté serveur.');
  }
  if (!signature) {
    throw new Error('En-tête Stripe-Signature absent.');
  }

  const stripe =
    getStripeClient() ?? new Stripe(cleanEnv('STRIPE_SECRET_KEY') || 'sk_webhook_verify_only');
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
          updateUserSubscription(user.id, {
            plan,
            billingInterval: interval,
            subscriptionStatus: 'active',
            cancelAtPeriodEnd: false,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
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
                : getAmountCentsForPlan(plan, interval),
            currency: session.currency ?? 'eur',
            status: 'active',
            cancelAtPeriodEnd: false,
            currentPeriodStart: new Date().toISOString(),
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
            amountCents: getAmountCentsForPlan(plan, interval),
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
