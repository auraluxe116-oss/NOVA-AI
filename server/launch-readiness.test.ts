import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

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
  recordUsage,
  sanitizeDbErrorMessage,
  setDatabaseAdapterForTests,
} = await import('./db.js');
const { hashIp, hashPassword } = await import('./auth.js');

let server: http.Server;
let baseUrl = '';
const testPgAdapter = createMemoryPgAdapter();

function createConfiguredApp() {
  return createApp({
    providerKeyChecker: () => 'test-key-only',
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
    user: { id: string; email: string; effectivePlan: string; zeroCostMode: boolean };
    recoveryCode: string;
  };
  assert.equal(regJson.user.effectivePlan, 'free');
  assert.equal(regJson.user.zeroCostMode, true);
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

  // Alice envoie un message chat + publie un site
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

  // Bob ne peut ni lire, ni supprimer la conversation ou le site d'Alice
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

  // Export RGPD d'Alice : contient ses données sans aucun hash sensible ni champ paiement
  const exportRes = await fetch(`${baseUrl}/api/auth/export`, {
    headers: { Cookie: cookieA },
  });
  assert.equal(exportRes.status, 200);
  const exportBody = await exportRes.text();
  assert.match(exportBody, /Donnée secrète stratégie Alice/);
  assert.doesNotMatch(exportBody, /password_hash|recovery_code_hash|Bob Isolation|stripe/i);

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

test('budget strict 0 € : aucun service payant, rejet fournisseurs tiers payants, limites gratuites et message non facturant', async () => {
  // 1. Toutes les routes de paiement Stripe sont absentes (404)
  for (const route of ['/api/stripe/status', '/api/stripe/subscriptions', '/api/stripe/webhook']) {
    const res = await fetch(`${baseUrl}${route}`);
    assert.equal(res.status, 404, `${route} ne doit plus exister en mode 0 €`);
  }

  // 2. /api/health confirme le mode strict 0 € sans aucune exposition Stripe
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthRaw = await healthRes.text();
  assert.doesNotMatch(healthRaw, /stripe/i);
  const healthJson = JSON.parse(healthRaw) as {
    budgetMode: string;
    zeroCostMode: boolean;
    paidServicesDisabled: boolean;
  };
  assert.equal(healthJson.budgetMode, 'strict-0-eur');
  assert.equal(healthJson.zeroCostMode, true);
  assert.equal(healthJson.paidServicesDisabled, true);

  // 3. Rejet immédiat des fournisseurs payants (openai, anthropic, mistral)
  for (const paidProvider of ['openai', 'anthropic', 'mistral']) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', provider: paidProvider }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'PAID_PROVIDER_DISABLED');
  }

  // 4. Droits unifiés gratuits pour utilisateur connecté : 512 Ko PJ, max 10 sites, cap HTML 500 Ko
  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'free-limits@nova-test.local',
      password: 'PasswordFree123!',
      displayName: 'Free Limits User',
    }),
  });
  assert.equal(reg.status, 201);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // Pièce jointe 200 Ko acceptée (<= 512 Ko)
  const attOk = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse ce document de 200 Ko',
      attachment: { name: 'ok.txt', content: 'A'.repeat(200 * 1024) },
    }),
  });
  assert.equal(attOk.status, 200);
  await attOk.text();

  // Pièce jointe > 512 Ko refusée (413)
  const attTooBig = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Analyse ce document trop lourd',
      attachment: { name: 'big.txt', content: 'B'.repeat(520 * 1024) },
    }),
  });
  assert.equal(attTooBig.status, 413);
  assert.equal(((await attTooBig.json()) as { code: string }).code, 'ATTACHMENT_TOO_LARGE');

  // Jusqu'à 10 sites publiés gratuits + 11e bloqué + anti-bypass existingSlug + cap HTML 500 Ko
  let firstSiteSlug = '';
  for (let i = 1; i <= 10; i += 1) {
    const pub = await fetch(`${baseUrl}/api/sites/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: `Site Gratuit ${i}`,
        htmlContent: `<!doctype html><html><body><h1>Site ${i}</h1></body></html>`,
      }),
    });
    assert.equal(pub.status, 200);
    if (i === 1) {
      firstSiteSlug = ((await pub.json()) as { site: { slug: string } }).site.slug;
    }
  }

  const free11th = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Site 11 bloqué',
      htmlContent: '<!doctype html><html><body><h1>Site 11</h1></body></html>',
    }),
  });
  assert.equal(free11th.status, 403);
  const free11thBody = (await free11th.json()) as { code: string; error: string };
  assert.equal(free11thBody.code, 'SITES_LIMIT_REACHED');
  assert.match(free11thBody.error, /aucun paiement/i);

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

  // 5. Quota journalier visiteur anonyme (25 messages/jour) -> HTTP 429 FREE_QUOTA_REACHED sans facturation
  const guestIp = '203.0.113.99';
  const guestIpHash = hashIp(guestIp);
  for (let i = 0; i < 25; i += 1) {
    await recordUsage({ userId: null, ipHash: guestIpHash, kind: 'chat' });
  }

  const overCap = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': guestIp },
    body: JSON.stringify({ message: 'Msg invité 26' }),
  });
  assert.equal(overCap.status, 429);
  const overBody = (await overCap.json()) as { code: string; error: string };
  assert.equal(overBody.code, 'FREE_QUOTA_REACHED');
  assert.match(overBody.error, /aucun paiement ni facturation/i);
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

  // 2. En-têtes de sécurité sur /api/health & cache sur /api/ai/providers
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(healthRes.headers.get('permissions-policy'));
  const healthBody = (await healthRes.json()) as {
    sessionSecretConfigured: boolean;
    zeroCostMode: boolean;
    paidServicesDisabled: boolean;
  };
  assert.equal(typeof healthBody.sessionSecretConfigured, 'boolean');
  assert.equal(healthBody.zeroCostMode, true);
  assert.equal(healthBody.paidServicesDisabled, true);

  const providersRes = await fetch(`${baseUrl}/api/ai/providers`);
  assert.equal(providersRes.status, 200);
  assert.match(providersRes.headers.get('cache-control') ?? '', /max-age=300/);
  const providersJson = (await providersRes.json()) as {
    providers: Array<{ id: string }>;
  };
  assert.deepEqual(
    providersJson.providers.map((p) => p.id),
    ['gemini']
  );

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

  // 3. Création utilisateur + lecture directe + conversation (plan strictement gratuit 0 €)
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
      user: { id: string; effectivePlan: string; zeroCostMode: boolean };
    };
    assert.equal(loginJson.user.id, regJson.user.id);
    assert.equal(loginJson.user.effectivePlan, 'free');
    assert.equal(loginJson.user.zeroCostMode, true);

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
    const convs = await listUserConversations(created.id);
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
