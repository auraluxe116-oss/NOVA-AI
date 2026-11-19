import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import Stripe from 'stripe';

// Clear Stripe env initially to verify safe unconfigured defaults
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_ALLOW_LIVE;
delete process.env.STRIPE_PRICE_PRO;
delete process.env.STRIPE_PRICE_BUSINESS;
delete process.env.STRIPE_PRICE_PRO_MONTHLY;
delete process.env.STRIPE_PRICE_PRO_ANNUAL;
delete process.env.STRIPE_PRICE_BUSINESS_MONTHLY;
delete process.env.STRIPE_PRICE_BUSINESS_ANNUAL;
delete process.env.STRIPE_PRO_MONTHLY_CENTS;
delete process.env.STRIPE_PRO_ANNUAL_CENTS;
delete process.env.STRIPE_BUSINESS_MONTHLY_CENTS;
delete process.env.STRIPE_BUSINESS_ANNUAL_CENTS;

const { createApp } = await import('./app.js');
const {
  checkDatabaseHealth,
  closeDatabase,
  createConversation,
  createMemoryPgAdapter,
  createUser,
  deleteUserAccount,
  ensureDatabaseReady,
  findUserByEmail,
  findUserById,
  getConfiguredDatabaseUrl,
  listUserConversations,
  sanitizeDbErrorMessage,
  setDatabaseAdapterForTests,
} = await import('./db.js');
const { hashPassword } = await import('./auth.js');

const TEST_WEBHOOK_SECRET = 'whsec_test_nova_launch_readiness_secret_12345';

interface MockSessionState {
  id: string;
  client_reference_id: string;
  customer: string;
  subscription: string;
  payment_status: 'paid' | 'unpaid';
  amount_total: number;
  currency: string;
  lineItems?: Stripe.Checkout.SessionCreateParams.LineItem[];
  metadata: Record<string, string>;
}

const mockSessions = new Map<string, MockSessionState>();
const realStripeCrypto = new Stripe('sk_test_crypto_helper_only');

function createTestStripeClient(): Stripe {
  const client = {
    webhooks: realStripeCrypto.webhooks,
    prices: {
      retrieve: async (priceId: string) => ({
        id: priceId,
        unit_amount: priceId.includes('business') ? 1990 : 990,
        currency: 'eur',
        recurring: {
          interval: priceId.includes('annual') ? 'year' : 'month',
        },
      }),
    },
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          const id = `cs_test_${Math.random().toString(36).slice(2, 10)}`;
          const userId = String(params.client_reference_id ?? params.metadata?.userId ?? '');
          const customer =
            typeof params.customer === 'string'
              ? params.customer
              : `cus_test_${userId.slice(0, 8)}`;
          const subscription = `sub_test_${Math.random().toString(36).slice(2, 10)}`;
          mockSessions.set(id, {
            id,
            client_reference_id: userId,
            customer,
            subscription,
            payment_status: 'unpaid',
            amount_total: 990,
            currency: 'eur',
            lineItems: params.line_items,
            metadata: (params.metadata as Record<string, string>) ?? {},
          });
          return {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
          };
        },
        retrieve: async (sessionId: string) => {
          const found = mockSessions.get(sessionId);
          if (!found) {
            throw new Error(`No such checkout session: ${sessionId}`);
          }
          return {
            ...found,
            subscription: {
              id: found.subscription,
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
              cancel_at_period_end: false,
            },
          };
        },
      },
    },
    subscriptions: {
      retrieve: async (subId: string) => ({
        id: subId,
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        cancel_at_period_end: false,
      }),
      update: async (subId: string, params: { cancel_at_period_end?: boolean }) => ({
        id: subId,
        status: 'active',
        cancel_at_period_end: Boolean(params.cancel_at_period_end),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      }),
    },
    billingPortal: {
      sessions: {
        create: async (params: { customer: string }) => ({
          url: `https://billing.stripe.com/p/session/test_${params.customer}`,
        }),
      },
    },
    invoices: {
      list: async () => ({
        data: [],
      }),
    },
  };
  return client as unknown as Stripe;
}

function sendSignedWebhook(
  baseUrl: string,
  eventPayload: Record<string, unknown>,
  secret = TEST_WEBHOOK_SECRET,
  tamperSignature = false
) {
  const rawBody = JSON.stringify(eventPayload);
  let signature = realStripeCrypto.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
  });
  if (tamperSignature) {
    signature = signature.replace(/v1=[a-f0-9]+/, 'v1=00000000000000000000000000000000');
  }
  return fetch(`${baseUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: rawBody,
  });
}

let server: http.Server;
let baseUrl = '';
const testPgAdapter = createMemoryPgAdapter();

function createConfiguredApp() {
  return createApp({
    providerKeyChecker: () => 'test-key-only',
    stripeClient: createTestStripeClient(),
    streamConversation: async (params) => {
      const reply = `Réponse isolée à : ${params.userMessage}`;
      params.callbacks.onModelSelected?.('gemini-4-hydrogen');
      params.callbacks.onDelta(reply);
      return {
        fullText: reply,
        sources: [],
        modelUsed: 'gemini-4-hydrogen',
        latencyMs: 12,
      };
    },
  });
}

before(async () => {
  setDatabaseAdapterForTests(testPgAdapter);
  await ensureDatabaseReady();
  const app = createConfiguredApp();

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  await closeDatabase();
  setDatabaseAdapterForTests(null);
});

test('comptes utilisateurs : inscription, connexion, déconnexion, reset mot de passe + révocation d’anciennes sessions', async () => {
  // 1. Validation entrées inscription
  const badReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'invalide',
      password: '123',
      displayName: 'A',
    }),
  });
  assert.equal(badReg.status, 400);

  // 2. Inscription valide
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      password: 'PasswordLaunch123!',
      displayName: 'Fondateur Lancement',
      companyName: 'Studio Test',
    }),
  });
  assert.equal(regRes.status, 201);
  const regText = await regRes.text();
  assert.doesNotMatch(regText, /password_hash|recovery_code_hash/);
  const regJson = JSON.parse(regText) as {
    user: { id: string; email: string; effectivePlan: string };
    recoveryCode: string;
  };
  assert.equal(regJson.user.effectivePlan, 'free');
  assert.ok(regJson.recoveryCode.startsWith('NOVA-'));
  const oldCookie = (regRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(oldCookie.includes('nova_session='));

  // 3. Session active confirmée
  const meActive = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: oldCookie },
  });
  assert.equal(((await meActive.json()) as { user: { id: string } | null }).user?.id, regJson.user.id);

  // 4. Mauvais mot de passe refusé
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      password: 'WrongPassword!',
    }),
  });
  assert.equal(badLogin.status, 401);

  // 5. Réinitialisation mot de passe invalide puis valide -> révoque immédiatement oldCookie
  const badReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      recoveryCode: 'NOVA-WRONG999',
      newPassword: 'NewPassword456!',
    }),
  });
  assert.equal(badReset.status, 401);

  const okReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      recoveryCode: regJson.recoveryCode,
      newPassword: 'NewPassword456!',
    }),
  });
  assert.equal(okReset.status, 200);

  // L'ancien cookie capturé avant le reset ne doit PLUS fonctionner (token_version incrémenté)
  const meAfterReset = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: oldCookie },
  });
  assert.equal(((await meAfterReset.json()) as { user: unknown }).user, null);

  // 6. Connexion avec le nouveau mot de passe puis déconnexion
  const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      password: 'NewPassword456!',
    }),
  });
  assert.equal(newLogin.status, 200);
  const newCookie = (newLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: newCookie },
  });
  assert.equal(logoutRes.status, 200);
  assert.match(logoutRes.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('protection des données, isolation stricte, export RGPD et suppression complète (y compris usage_logs)', async () => {
  const regA = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'iso-a@nova-test.local',
      password: 'PasswordIsoA123!',
      displayName: 'Alice Isolation',
    }),
  });
  const jsonA = (await regA.json()) as { user: { id: string } };
  const cookieA = (regA.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const regB = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'iso-b@nova-test.local',
      password: 'PasswordIsoB123!',
      displayName: 'Bob Isolation',
    }),
  });
  const cookieB = (regB.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // Alice envoie un message chat + publie un site + crée un document
  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ message: 'Donnée secrète stratégie Alice' }),
  });
  assert.equal(chatRes.status, 200);
  const chatText = await chatRes.text();
  const doneMatch = chatText.match(/"conversationId":"([^"]+)"/);
  const convIdA = doneMatch?.[1] ?? '';
  assert.ok(convIdA);

  const siteRes = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      title: 'Site Privé Alice',
      htmlContent: '<!doctype html><html><body><h1>Alice</h1></body></html>',
    }),
  });
  assert.equal(siteRes.status, 200);
  const siteJson = (await siteRes.json()) as { site: { id: string } };

  // Bob ne peut ni lire, ni renommer, ni supprimer la conversation ou le site d'Alice
  assert.equal(
    (await fetch(`${baseUrl}/api/conversations/${convIdA}`, { headers: { Cookie: cookieB } })).status,
    404
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/conversations/${convIdA}`, {
        method: 'DELETE',
        headers: { Cookie: cookieB },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/sites/${siteJson.site.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieB },
      })
    ).status,
    404
  );

  // Export RGPD d'Alice : contient ses données sans aucun hash sensible
  const exportRes = await fetch(`${baseUrl}/api/auth/export`, {
    headers: { Cookie: cookieA },
  });
  assert.equal(exportRes.status, 200);
  const exportBody = await exportRes.text();
  assert.match(exportBody, /Donnée secrète stratégie Alice/);
  assert.doesNotMatch(exportBody, /password_hash|recovery_code_hash|Bob Isolation/);

  // Suppression du compte d'Alice : mauvais mot de passe refusé, bon mot de passe supprime TOUT
  const badDel = await fetch(`${baseUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ password: 'WrongPassword!' }),
  });
  assert.equal(badDel.status, 400);

  const okDel = await fetch(`${baseUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ password: 'PasswordIsoA123!' }),
  });
  assert.equal(okDel.status, 200);

  // Vérification directe PostgreSQL : plus aucune ligne liée à Alice (y compris usage_logs)
  const db = await ensureDatabaseReady();
  const usageLeft = await db.query<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM usage_logs WHERE user_id = $1',
    [jsonA.user.id]
  );
  const convLeft = await db.query<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM conversations WHERE user_id = $1',
    [jsonA.user.id]
  );
  const sitesLeft = await db.query<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM published_sites WHERE user_id = $1',
    [jsonA.user.id]
  );

  assert.equal(usageLeft.rows[0]?.c, 0);
  assert.equal(convLeft.rows[0]?.c, 0);
  assert.equal(sitesLeft.rows[0]?.c, 0);
});

test('Stripe abonnements : verrou sécurité live, tarifs configurables, mode test, vérif serveur, webhooks et paiements refusés', async () => {
  const regOwner = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'stripe-owner@nova-test.local',
      password: 'PasswordStripe123!',
      displayName: 'Stripe Owner',
    }),
  });
  const ownerJson = (await regOwner.json()) as { user: { id: string } };
  const ownerCookie = (regOwner.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const regOther = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'stripe-other@nova-test.local',
      password: 'PasswordStripe123!',
      displayName: 'Stripe Other',
    }),
  });
  const otherCookie = (regOther.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // 1. Non configuré : aucun prix inventé, checkout bloqué (503)
  const statusUnconf = await (await fetch(`${baseUrl}/api/stripe/status`)).json() as {
    stripeConfigured: boolean;
    checkoutReady: boolean;
    catalog: { pro: { monthlyCents: number | null } };
  };
  assert.equal(statusUnconf.stripeConfigured, false);
  assert.equal(statusUnconf.checkoutReady, false);
  assert.equal(statusUnconf.catalog.pro.monthlyCents, null);

  const checkoutUnconf = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
  });
  assert.equal(checkoutUnconf.status, 503);

  // 2. Clé live sans STRIPE_ALLOW_LIVE=true : bloqué par sécurité (STRIPE_LIVE_LOCKED)
  process.env.STRIPE_SECRET_KEY = 'sk_live_blocked_unless_authorized';
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_live_pro_m';
  const liveLockedRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
  });
  assert.equal(liveLockedRes.status, 503);
  assert.equal(((await liveLockedRes.json()) as { code: string }).code, 'STRIPE_LIVE_LOCKED');

  // 3. Mode Test configuré avec webhook secret mais sans tarif pour business annuel -> 503 STRIPE_PRICE_NOT_CONFIGURED
  process.env.STRIPE_SECRET_KEY = 'sk_test_nova_valid_test_mode';
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  const noPriceRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ plan: 'business', interval: 'annual' }),
  });
  assert.equal(noPriceRes.status, 503);
  assert.equal(((await noPriceRes.json()) as { code: string }).code, 'STRIPE_PRICE_NOT_CONFIGURED');

  // 4. Configuration explicite des tarifs de test -> checkout Ready et aucun secret exposé
  process.env.STRIPE_PRO_MONTHLY_CENTS = '990';
  process.env.STRIPE_BUSINESS_MONTHLY_CENTS = '1990';
  const statusReadyText = await (await fetch(`${baseUrl}/api/stripe/status`)).text();
  assert.doesNotMatch(statusReadyText, /sk_test_|whsec_/);
  const statusReady = JSON.parse(statusReadyText) as {
    stripeMode: string;
    checkoutReady: boolean;
    catalog: { pro: { monthlyCents: number | null } };
  };
  assert.equal(statusReady.stripeMode, 'test');
  assert.equal(statusReady.checkoutReady, true);
  assert.equal(statusReady.catalog.pro.monthlyCents, 990);

  // 5. Création session Checkout Test
  const checkoutRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutJson = (await checkoutRes.json()) as {
    url: string;
    sessionId: string;
    mode: string;
  };
  assert.equal(checkoutJson.mode, 'test');
  assert.ok(checkoutJson.url.includes(checkoutJson.sessionId));

  // 6. Ne jamais activer l'abonnement tant que Stripe indique unpaid
  const unpaidVerify = await fetch(
    `${baseUrl}/api/stripe/verify-session?session_id=${checkoutJson.sessionId}`,
    { headers: { Cookie: ownerCookie } }
  );
  assert.equal(unpaidVerify.status, 200);
  const unpaidJson = (await unpaidVerify.json()) as {
    verified: boolean;
    user: { effectivePlan: string };
  };
  assert.equal(unpaidJson.verified, false);
  assert.equal(unpaidJson.user.effectivePlan, 'free');

  // 7. Rejet cross-user : un autre utilisateur ne peut pas récupérer la session d'Owner
  const sessionState = mockSessions.get(checkoutJson.sessionId)!;
  sessionState.payment_status = 'paid';
  const hijackVerify = await fetch(
    `${baseUrl}/api/stripe/verify-session?session_id=${checkoutJson.sessionId}`,
    { headers: { Cookie: otherCookie } }
  );
  assert.equal(hijackVerify.status, 400);

  // 8. Rejet webhook sans signature ou signature altérée
  const noSigHook = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'evt_nosig' }),
  });
  assert.equal(noSigHook.status, 400);

  const badSigHook = await sendSignedWebhook(
    baseUrl,
    { id: 'evt_badsig', type: 'checkout.session.completed', data: { object: {} } },
    TEST_WEBHOOK_SECRET,
    true
  );
  assert.equal(badSigHook.status, 400);

  // 9. Webhook checkout.session.completed unpaid ne doit pas activer PRO
  const unpaidHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_unpaid_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_unpaid_evt',
        client_reference_id: ownerJson.user.id,
        customer: sessionState.customer,
        subscription: sessionState.subscription,
        payment_status: 'unpaid',
        metadata: { userId: ownerJson.user.id, plan: 'pro', interval: 'monthly' },
      },
    },
  });
  assert.equal(unpaidHook.status, 200);
  const meStillFree = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: ownerCookie } })
  ).json()) as { user: { effectivePlan: string } };
  assert.equal(meStillFree.user.effectivePlan, 'free');

  // 10. Webhook checkout.session.completed payé -> active PRO + idempotence
  const paidEvent = {
    id: 'evt_paid_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutJson.sessionId,
        client_reference_id: ownerJson.user.id,
        customer: sessionState.customer,
        subscription: sessionState.subscription,
        payment_status: 'paid',
        amount_total: 990,
        currency: 'eur',
        metadata: { userId: ownerJson.user.id, plan: 'pro', interval: 'monthly' },
      },
    },
  };
  const paidHook = await sendSignedWebhook(baseUrl, paidEvent);
  assert.equal(paidHook.status, 200);
  const dupHook = await sendSignedWebhook(baseUrl, paidEvent);
  assert.equal(((await dupHook.json()) as { duplicate?: boolean }).duplicate, true);

  const mePro = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: ownerCookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(mePro.user.effectivePlan, 'pro');
  assert.equal(mePro.user.subscriptionStatus, 'active');

  // 11. Paiement refusé (invoice.payment_failed) -> passe en past_due & révoque effectivePlan à free
  const failedInvoiceHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_inv_failed_1',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_fail_1',
        customer: sessionState.customer,
        subscription: sessionState.subscription,
      },
    },
  });
  assert.equal(failedInvoiceHook.status, 200);

  const mePastDue = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: ownerCookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(mePastDue.user.subscriptionStatus, 'past_due');
  assert.equal(mePastDue.user.effectivePlan, 'free');

  // 12. Régularisation paiement + résiliation en fin de période + suppression webhook
  const paidInvoiceHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_inv_paid_1',
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_ok_1',
        customer: sessionState.customer,
        subscription: sessionState.subscription,
        amount_paid: 990,
        currency: 'eur',
      },
    },
  });
  assert.equal(paidInvoiceHook.status, 200);

  const cancelRes = await fetch(`${baseUrl}/api/stripe/cancel-subscription`, {
    method: 'POST',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(((await cancelRes.json()) as { user: { cancelAtPeriodEnd: boolean } }).user.cancelAtPeriodEnd, true);

  const deletedSubHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_sub_deleted_1',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: sessionState.subscription,
        customer: sessionState.customer,
        status: 'canceled',
        metadata: { userId: ownerJson.user.id, plan: 'pro', interval: 'monthly' },
        items: { data: [{ price: { unit_amount: 990, recurring: { interval: 'month' } } }] },
      },
    },
  });
  assert.equal(deletedSubHook.status, 200);
  const meCanceled = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: ownerCookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(meCanceled.user.subscriptionStatus, 'canceled');
  assert.equal(meCanceled.user.effectivePlan, 'free');

  // Clean up test env flags
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRO_MONTHLY_CENTS;
  delete process.env.STRIPE_BUSINESS_MONTHLY_CENTS;
});

test('Stripe configuration Vercel : lecture exacte de STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO et STRIPE_PRICE_BUSINESS', async () => {
  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'vercel-stripe@nova-test.local',
      password: 'PasswordStripe123!',
      displayName: 'Vercel Stripe User',
    }),
  });
  const regJson = (await reg.json()) as { user: { id: string } };
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // Simuler exactement les 4 variables Vercel (y compris guillemets éventuels autour d'un Price ID)
  process.env.STRIPE_SECRET_KEY = 'sk_test_vercel_exact_4_vars';
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = '"price_test_pro_single"';
  process.env.STRIPE_PRICE_BUSINESS = 'price_test_business_single';

  const statusText = await (await fetch(`${baseUrl}/api/stripe/status`)).text();
  assert.doesNotMatch(statusText, /sk_test_|whsec_/);
  const statusJson = JSON.parse(statusText) as {
    stripeConfigured: boolean;
    stripeMode: string;
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
      pro: { monthlyCents: number | null; monthlyConfigured: boolean; annualConfigured: boolean; source: string };
      business: { monthlyCents: number | null; monthlyConfigured: boolean; annualConfigured: boolean; source: string };
    };
  };

  assert.equal(statusJson.stripeConfigured, true);
  assert.equal(statusJson.stripeMode, 'test');
  assert.equal(statusJson.webhookConfigured, true);
  assert.equal(statusJson.checkoutReady, true);
  assert.equal(statusJson.usingConfiguredPriceIds, true);
  assert.equal(statusJson.prices.proMonthly, true);
  assert.equal(statusJson.prices.businessMonthly, true);
  assert.equal(statusJson.catalog.pro.monthlyConfigured, true);
  assert.equal(statusJson.catalog.pro.monthlyCents, 990);
  assert.equal(statusJson.catalog.pro.source, 'stripe_price');
  assert.equal(statusJson.catalog.business.monthlyConfigured, true);
  assert.equal(statusJson.catalog.business.monthlyCents, 1990);
  assert.equal(statusJson.catalog.business.source, 'stripe_price');

  // /api/health reflète aussi checkoutReady=true sans aucune fuite de secret
  const healthText = await (await fetch(`${baseUrl}/api/health`)).text();
  assert.doesNotMatch(healthText, /sk_test_|whsec_/);
  const healthJson = JSON.parse(healthText) as {
    stripeConfigured: boolean;
    webhookConfigured: boolean;
    checkoutReady: boolean;
  };
  assert.equal(healthJson.stripeConfigured, true);
  assert.equal(healthJson.webhookConfigured, true);
  assert.equal(healthJson.checkoutReady, true);

  // Checkout PRO utilise exactement le Price ID STRIPE_PRICE_PRO (nettoyé)
  const proCheckoutRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ plan: 'pro', interval: 'monthly' }),
  });
  assert.equal(proCheckoutRes.status, 200);
  const proCheckout = (await proCheckoutRes.json()) as { sessionId: string; mode: string };
  assert.equal(proCheckout.mode, 'test');
  assert.equal(mockSessions.get(proCheckout.sessionId)?.lineItems?.[0]?.price, 'price_test_pro_single');

  // Checkout BUSINESS utilise exactement le Price ID STRIPE_PRICE_BUSINESS
  const bizCheckoutRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ plan: 'business', interval: 'monthly' }),
  });
  assert.equal(bizCheckoutRes.status, 200);
  const bizCheckout = (await bizCheckoutRes.json()) as { sessionId: string; mode: string };
  assert.equal(mockSessions.get(bizCheckout.sessionId)?.lineItems?.[0]?.price, 'price_test_business_single');

  // Requête annuelle lorsque seul un Price ID mensuel est configuré -> rejet sécurisé 503 STRIPE_PRICE_NOT_CONFIGURED
  const annualMismatchRes = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ plan: 'pro', interval: 'annual' }),
  });
  assert.equal(annualMismatchRes.status, 503);
  assert.equal(((await annualMismatchRes.json()) as { code: string }).code, 'STRIPE_PRICE_NOT_CONFIGURED');

  // Webhook customer.subscription.updated avec price.id = STRIPE_PRICE_BUSINESS infère plan='business'
  const subUpdatedRes = await sendSignedWebhook(baseUrl, {
    id: 'evt_vercel_sub_biz_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_vercel_biz_1',
        customer: 'cus_vercel_biz_1',
        status: 'active',
        metadata: { userId: regJson.user.id },
        items: {
          data: [
            {
              price: {
                id: 'price_test_business_single',
                unit_amount: 1990,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      },
    },
  });
  assert.equal(subUpdatedRes.status, 200);

  const meAfterWebhook = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(meAfterWebhook.user.effectivePlan, 'business');
  assert.equal(meAfterWebhook.user.subscriptionStatus, 'active');

  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_PRO;
  delete process.env.STRIPE_PRICE_BUSINESS;
});

test('droits serveur Free/PRO/BUSINESS, anti-bypass sites publiés, double checkout bloqué, remboursements & litiges Stripe', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_audit_entitlements';
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = 'price_test_pro_audit';
  process.env.STRIPE_PRICE_BUSINESS = 'price_test_business_audit';

  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'audit-entitlements@nova-test.local',
      password: 'PasswordAudit123!',
      displayName: 'Audit Entitlements',
    }),
  });
  assert.equal(reg.status, 201);
  const regJson = (await reg.json()) as { user: { id: string } };
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // 1. Formule GRATUITE : pièce jointe > 120 Ko refusée (413)
  const freeAttBig = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse ce document',
      attachment: { name: 'big.txt', content: 'A'.repeat(130 * 1024) },
    }),
  });
  assert.equal(freeAttBig.status, 413);
  assert.equal(((await freeAttBig.json()) as { code: string }).code, 'ATTACHMENT_TOO_LARGE');

  // 2. Formule GRATUITE : max 3 sites publiés + impossible de contourner avec un faux existingSlug + cap HTML 500 Ko
  let firstSiteSlug = '';
  for (let i = 1; i <= 3; i += 1) {
    const pub = await fetch(`${baseUrl}/api/sites/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: `Site Audit ${i}`,
        htmlContent: `<!doctype html><html><body><h1>Site ${i}</h1></body></html>`,
      }),
    });
    assert.equal(pub.status, 200);
    if (i === 1) {
      firstSiteSlug = ((await pub.json()) as { site: { slug: string } }).site.slug;
    }
  }

  const free4th = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Site 4 bloque',
      htmlContent: '<!doctype html><html><body><h1>Site 4</h1></body></html>',
    }),
  });
  assert.equal(free4th.status, 403);
  assert.equal(((await free4th.json()) as { code: string }).code, 'SITES_LIMIT_REACHED');

  const fakeBypass = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Tentative Bypass Slug',
      existingSlug: 'faux-slug-inexistant',
      htmlContent: '<!doctype html><html><body><h1>Bypass</h1></body></html>',
    }),
  });
  assert.equal(fakeBypass.status, 403);
  assert.equal(((await fakeBypass.json()) as { code: string }).code, 'SITES_LIMIT_REACHED');

  const htmlTooBig = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Site Trop Lourd',
      existingSlug: firstSiteSlug,
      htmlContent: `<!doctype html><html><body>${'X'.repeat(513_000)}</body></html>`,
    }),
  });
  assert.equal(htmlTooBig.status, 413);
  assert.equal(((await htmlTooBig.json()) as { code: string }).code, 'HTML_TOO_LARGE');

  // 3. Activation PRO via webhook -> pièce jointe 200 Ko OK, 600 Ko refusée, 4e site OK, double checkout bloqué (409)
  const subId = 'sub_audit_pro_1';
  const cusId = 'cus_audit_pro_1';
  const proHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_pro_created',
    type: 'customer.subscription.created',
    livemode: false,
    data: {
      object: {
        id: subId,
        customer: cusId,
        status: 'active',
        metadata: { userId: regJson.user.id, plan: 'pro', interval: 'monthly' },
        items: {
          data: [
            {
              price: {
                id: 'price_test_pro_audit',
                unit_amount: 990,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      },
    },
  });
  assert.equal(proHook.status, 200);

  const proAttOk = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse doc 200 Ko',
      attachment: { name: 'pro.txt', content: 'B'.repeat(200 * 1024) },
    }),
  });
  assert.equal(proAttOk.status, 200);

  const proAttTooBig = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse doc 600 Ko',
      attachment: { name: 'too-big-pro.txt', content: 'C'.repeat(600 * 1024) },
    }),
  });
  assert.equal(proAttTooBig.status, 413);

  const pro4thSite = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Site 4 PRO',
      htmlContent: '<!doctype html><html><body><h1>Site 4 PRO</h1></body></html>',
    }),
  });
  assert.equal(pro4thSite.status, 200);

  const dupCheckout = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ plan: 'business', interval: 'monthly' }),
  });
  assert.equal(dupCheckout.status, 409);
  assert.equal(((await dupCheckout.json()) as { code: string }).code, 'ACTIVE_SUBSCRIPTION_EXISTS');

  // 4. Passage à BUSINESS via webhook -> pièce jointe 700 Ko acceptée (limite 2 Mo)
  const bizHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_biz_updated',
    type: 'customer.subscription.updated',
    livemode: false,
    data: {
      object: {
        id: subId,
        customer: cusId,
        status: 'active',
        metadata: { userId: regJson.user.id, plan: 'business', interval: 'monthly' },
        items: {
          data: [
            {
              price: {
                id: 'price_test_business_audit',
                unit_amount: 1990,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      },
    },
  });
  assert.equal(bizHook.status, 200);

  const bizAttOk = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse doc 700 Ko',
      attachment: { name: 'biz.txt', content: 'D'.repeat(700 * 1024) },
    }),
  });
  assert.equal(bizAttOk.status, 200);

  // 5. Protection mode webhook : événement livemode=true rejeté quand le serveur utilise sk_test_...
  const liveEventRejected = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_live_mismatch',
    type: 'customer.subscription.updated',
    livemode: true,
    data: { object: { id: subId, customer: cusId, status: 'active' } },
  });
  assert.equal(liveEventRejected.status, 400);

  // 6. Litige (dispute) créé -> suspension immédiate ; litige gagné -> rétablissement ; litige perdu -> résiliation
  const disputeCreated = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_dispute_open',
    type: 'charge.dispute.created',
    livemode: false,
    data: {
      object: {
        id: 'dp_audit_1',
        status: 'needs_response',
        charge: { id: 'ch_audit_1', customer: cusId },
      },
    },
  });
  assert.equal(disputeCreated.status, 200);
  const meDisputeOpen = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(meDisputeOpen.user.effectivePlan, 'free');
  assert.equal(meDisputeOpen.user.subscriptionStatus, 'past_due');

  const disputeWon = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_dispute_won',
    type: 'charge.dispute.closed',
    livemode: false,
    data: {
      object: {
        id: 'dp_audit_1',
        status: 'won',
        charge: { id: 'ch_audit_1', customer: cusId },
      },
    },
  });
  assert.equal(disputeWon.status, 200);
  const meDisputeWon = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(meDisputeWon.user.effectivePlan, 'business');
  assert.equal(meDisputeWon.user.subscriptionStatus, 'active');

  // 7. Remboursement intégral (charge.refunded) -> révocation immédiate + statut refunded enregistré
  const refundedHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_audit_refund_full',
    type: 'charge.refunded',
    livemode: false,
    data: {
      object: {
        id: 'ch_audit_2',
        customer: cusId,
        refunded: true,
        amount: 1990,
        amount_refunded: 1990,
      },
    },
  });
  assert.equal(refundedHook.status, 200);
  const meRefunded = (await (
    await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  ).json()) as { user: { effectivePlan: string; subscriptionStatus: string } };
  assert.equal(meRefunded.user.effectivePlan, 'free');
  assert.equal(meRefunded.user.subscriptionStatus, 'canceled');

  const subsRes = (await (
    await fetch(`${baseUrl}/api/stripe/subscriptions`, { headers: { Cookie: cookie } })
  ).json()) as { subscriptions: Array<{ status: string }> };
  assert.equal(subsRes.subscriptions[0]?.status, 'refunded');

  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_PRO;
  delete process.env.STRIPE_PRICE_BUSINESS;
});

test('sécurité API : en-têtes HTTP, CSRF Origin, mots de passe blancs refusés et sandbox CSP sur /sites/:slug', async () => {
  // 1. Mot de passe composé uniquement d'espaces refusé
  const blankPwdRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'blank-pwd@nova-test.local',
      password: '         ',
      displayName: 'Test Blank',
    }),
  });
  assert.equal(blankPwdRes.status, 400);

  // 2. En-têtes de sécurité sur /api/health
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(healthRes.headers.get('permissions-policy'));
  const healthBody = (await healthRes.json()) as {
    sessionSecretConfigured: boolean;
    stripeMode: string;
  };
  assert.equal(typeof healthBody.sessionSecretConfigured, 'boolean');
  assert.ok(['unconfigured', 'test', 'live'].includes(healthBody.stripeMode));

  // 3. Protection CSRF Origin sur requêtes mutantes avec origine étrangère
  const csrfBlocked = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil-attacker.example',
    },
    body: JSON.stringify({
      email: 'launch-user@nova-test.local',
      password: 'NewPassword456!',
    }),
  });
  assert.equal(csrfBlocked.status, 403);
  assert.equal(((await csrfBlocked.json()) as { code: string }).code, 'ORIGIN_MISMATCH');

  // 4. Site publié isolé dans une origine opaque via CSP sandbox (sans allow-same-origin)
  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'csp-sandbox@nova-test.local',
      password: 'PasswordSandbox123!',
      displayName: 'Sandbox Owner',
    }),
  });
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const pub = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Site Sandbox Test',
      htmlContent: '<!doctype html><html><body><h1>Sandbox</h1></body></html>',
    }),
  });
  assert.equal(pub.status, 200);
  const pubJson = (await pub.json()) as { publicPath: string };

  const publicSiteRes = await fetch(`${baseUrl}${pubJson.publicPath}`);
  assert.equal(publicSiteRes.status, 200);
  const csp = publicSiteRes.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox allow-scripts allow-forms allow-popups/);
  assert.doesNotMatch(csp, /allow-same-origin/);
});

test('PostgreSQL : /api/health, masquage DATABASE_URL, création/lecture utilisateur et persistance après redémarrage serveur', async () => {
  // 1. /api/health vérifie la connexion PostgreSQL sans exposer DATABASE_URL
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthText = await healthRes.text();
  assert.doesNotMatch(healthText, /postgres(ql)?:\/\/|DATABASE_URL/i);
  const health = JSON.parse(healthText) as {
    status: string;
    database: {
      configured: boolean;
      connected: boolean;
      engine: string;
      schemaVersion: number | null;
      error: string | null;
    };
    storage: {
      engine: string;
      ephemeral: boolean;
    };
  };
  assert.equal(health.status, 'ok');
  assert.equal(health.database.configured, true);
  assert.equal(health.database.connected, true);
  assert.equal(health.database.engine, 'postgresql');
  assert.equal(health.database.schemaVersion, 2);
  assert.equal(health.database.error, null);
  assert.equal(health.storage.engine, 'postgresql');
  assert.equal(health.storage.ephemeral, false);

  // 2. Masquage strict de DATABASE_URL et mots de passe dans les erreurs
  const sanitized = sanitizeDbErrorMessage(
    new Error('Failed connecting postgres://neondb_owner:SuperSecretPass99@ep-test.neon.tech/neondb?sslmode=require')
  );
  assert.doesNotMatch(sanitized, /SuperSecretPass99|neondb_owner/);
  assert.match(sanitized, /postgresql:\/\/\[MASQUE\]/);

  // 3. Création utilisateur + lecture directe + conversation + abonnement PRO via webhook
  process.env.STRIPE_SECRET_KEY = 'sk_test_restart_pg';
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = 'price_test_pro_restart';

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'persist-restart@nova-test.local',
      password: 'PasswordPersist123!',
      displayName: 'Persist Restart',
      companyName: 'Neon SaaS SAS',
    }),
  });
  assert.equal(regRes.status, 201);
  const regJson = (await regRes.json()) as { user: { id: string; email: string } };

  const foundUser = await findUserByEmail('persist-restart@nova-test.local');
  assert.ok(foundUser);
  assert.equal(foundUser.id, regJson.user.id);
  const foundById = await findUserById(regJson.user.id);
  assert.equal(foundById?.company_name, 'Neon SaaS SAS');

  const cookie1 = (regRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({ message: 'Test persistance PostgreSQL après redémarrage' }),
  });
  assert.equal(chatRes.status, 200);
  await chatRes.text();

  const proHook = await sendSignedWebhook(baseUrl, {
    id: 'evt_persist_restart_pro',
    type: 'customer.subscription.created',
    livemode: false,
    data: {
      object: {
        id: 'sub_persist_restart',
        customer: 'cus_persist_restart',
        status: 'active',
        metadata: { userId: regJson.user.id, plan: 'pro', interval: 'monthly' },
        items: {
          data: [
            {
              price: {
                id: 'price_test_pro_restart',
                unit_amount: 990,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      },
    },
  });
  assert.equal(proHook.status, 200);

  // 4. Simulation d'un redémarrage complet d'instance serveur (nouvelle app Express sur la même base PostgreSQL)
  const appAfterRestart = createConfiguredApp();
  let restartedServer: http.Server | null = null;
  let restartedUrl = '';
  try {
    await new Promise<void>((resolve) => {
      restartedServer = appAfterRestart.listen(0, '127.0.0.1', () => {
        const addr = restartedServer!.address();
        assert.ok(addr && typeof addr === 'object');
        restartedUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const loginAfterRestart = await fetch(`${restartedUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'persist-restart@nova-test.local',
        password: 'PasswordPersist123!',
      }),
    });
    assert.equal(loginAfterRestart.status, 200);
    const loginJson = (await loginAfterRestart.json()) as {
      user: { id: string; effectivePlan: string; subscriptionStatus: string };
    };
    assert.equal(loginJson.user.id, regJson.user.id);
    assert.equal(loginJson.user.effectivePlan, 'pro');
    assert.equal(loginJson.user.subscriptionStatus, 'active');

    const cookie2 = (loginAfterRestart.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const convsAfterRestart = await fetch(`${restartedUrl}/api/conversations`, {
      headers: { Cookie: cookie2 },
    });
    assert.equal(convsAfterRestart.status, 200);
    const convsJson = (await convsAfterRestart.json()) as {
      conversations: Array<{ title: string }>;
    };
    assert.equal(convsJson.conversations.length, 1);
    assert.match(convsJson.conversations[0]?.title ?? '', /Test persistance PostgreSQL/);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_PRO;
    if (restartedServer) {
      await new Promise<void>((resolve) => {
        restartedServer!.close(() => resolve());
      });
    }
  }
});

test('Neon PostgreSQL réel (si DATABASE_URL configurée) : connexion live, migrations, CRUD utilisateur et persistance', async (t) => {
  const realUrl = getConfiguredDatabaseUrl();
  if (!realUrl) {
    t.skip('DATABASE_URL absente dans cet environnement — test live Neon ignoré');
    return;
  }

  setDatabaseAdapterForTests(null);
  const testEmail = `neon-live-${Date.now()}@nova-test.local`;
  let createdUserId: string | null = null;

  try {
    const health = await checkDatabaseHealth();
    assert.equal(health.configured, true);
    assert.equal(health.connected, true);
    assert.equal(health.engine, 'postgresql');
    assert.ok(health.schemaVersion && health.schemaVersion >= 2);

    const passwordHash = hashPassword('NeonLivePass123!');
    const recoveryHash = hashPassword('NOVA-NEON-LIVE');
    const created = await createUser({
      email: testEmail,
      passwordHash,
      displayName: 'Test Live Neon',
      companyName: 'Neon Integration Check',
      recoveryCodeHash: recoveryHash,
    });
    createdUserId = created.id;

    await createConversation({
      userId: created.id,
      title: 'Test persistance Neon live',
      category: 'general',
    });

    // Réinitialiser le client et relire depuis Neon pour prouver la persistance distante
    await closeDatabase();
    const reloadedUser = await findUserById(created.id);
    assert.ok(reloadedUser);
    assert.equal(reloadedUser.email, testEmail);
    const convs = await listUserConversations(created.id, 10);
    assert.equal(convs.length, 1);
    assert.equal(convs[0]?.title, 'Test persistance Neon live');
  } finally {
    if (createdUserId) {
      await deleteUserAccount(createdUserId);
    }
    await closeDatabase();
    setDatabaseAdapterForTests(testPgAdapter);
  }
});



