import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

const { createApp } = await import('./app.js');
const {
  BUSINESS_MODULE_LABELS,
  buildAssistantSystemInstruction,
  normalizeBusinessModuleKey,
  sanitizeSvgLogo,
  summarizeConversationHistory,
} = await import('./gemini.js');
const {
  addMessage,
  closeDatabase,
  createConversation,
  createMemoryPgAdapter,
  setDatabaseAdapterForTests,
} = await import('./db.js');

function parseSsePayloads(rawText: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const block of rawText.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      events.push(JSON.parse(jsonStr) as Record<string, unknown>);
    }
  }
  return events;
}

function extractSseText(events: Array<Record<string, unknown>>): string {
  return events
    .filter((ev) => ev.type === 'delta' && typeof ev.text === 'string')
    .map((ev) => String(ev.text))
    .join('');
}

let server: http.Server;
let baseUrl = '';
const capturedChatCalls: Array<{
  userMessage: string;
  historyLen: number;
  contextSummary: string;
  experienceLevel: string | undefined;
  useWebSearch: boolean;
}> = [];
const capturedBusinessCalls: Array<{
  moduleKey: string;
  projectTitle: string;
  experienceLevel: string | undefined;
  useWebSearch: boolean;
}> = [];
let nextBusinessError: Error | null = null;
let summarizeInvocations = 0;

before(async () => {
  setDatabaseAdapterForTests(createMemoryPgAdapter());
  const app = createApp({
    providerKeyChecker: () => 'test-key-only',
    summarizeHistory: async ({ turnsToSummarize }) => {
      summarizeInvocations += 1;
      return `Résumé contextuel (${turnsToSummarize.length} messages résumés) : projet agence IA B2B, budget 500 €, objectif 3 premiers clients.`;
    },
    streamConversation: async (params) => {
      capturedChatCalls.push({
        userMessage: params.userMessage,
        historyLen: params.history.length,
        contextSummary: params.contextSummary ?? '',
        experienceLevel: params.experienceLevel,
        useWebSearch: params.useWebSearch,
      });

      const lower = params.userMessage.toLowerCase();
      let text = '';
      if (lower.includes('agence') || lower.includes('business') || lower.includes('e-commerce')) {
        text = [
          '## 1. Analyse du projet',
          'Marché B2B porteur sans garantie de chiffre d’affaires.',
          '## 2. Plan d’action étape par étape',
          'Définir une offre cible et valider par entretiens.',
          '## 3. Outils adaptés',
          'Notion (offre gratuite limitée à un espace personnel), CRM gratuit limité en contacts.',
          '## 4. Budget estimé',
          'Estimation : 150 € à 500 € selon domaine et prospection.',
          '## 5. Risques',
          'Risque commercial de cycle de vente long.',
          '## 6. Méthodes pour trouver des clients',
          'Prospection directe honnête et réseau local.',
          '## 7. Prochaines actions concrètes',
          'Contacter 10 prospects ciblés cette semaine.',
        ].join('\n');
      } else if (lower.includes('postgresql') || lower.includes('sql')) {
        text = 'SQL & Sécurité : utilisez des requêtes paramétrées et des index sur les clés étrangères.';
      } else {
        text = `Réponse ciblée [${params.experienceLevel ?? 'debutant'}] : ${params.userMessage}`;
      }

      params.callbacks.onModelSelected?.('gemini-4-hydrogen');
      params.callbacks.onDelta(text);
      return {
        fullText: text,
        sources: params.useWebSearch
          ? [{ title: 'Service-Public.fr', url: 'https://www.service-public.fr' }]
          : [],
        modelUsed: 'gemini-4-hydrogen',
        latencyMs: 18,
      };
    },
    streamBusiness: async (params) => {
      if (nextBusinessError) {
        throw nextBusinessError;
      }
      capturedBusinessCalls.push({
        moduleKey: params.moduleKey,
        projectTitle: params.projectTitle,
        experienceLevel: params.experienceLevel,
        useWebSearch: params.useWebSearch,
      });
      const content = [
        `## 1. Analyse du projet & Objectif stratégique (${params.moduleKey})`,
        `Projet : ${params.projectTitle} — Secteur : ${params.sector}.`,
        '## 7. Plan d’action étape par étape (7 jours · 30 jours · 90 jours)',
        'Semaine 1 : validation terrain honnête.',
      ].join('\n');
      params.callbacks.onModelSelected?.('gemini-4-hydrogen');
      params.callbacks.onDelta(content);
      return {
        fullText: content,
        sources: [],
        modelUsed: 'gemini-4-hydrogen',
        latencyMs: 22,
      };
    },
  });

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

test('buildAssistantSystemInstruction intègre les 11 domaines business, le plan 7 volets, l’honnêteté, le niveau et la vérité recherche web', () => {
  const noSearchConfirm = buildAssistantSystemInstruction({
    experienceLevel: 'confirme',
    webSearchEnabled: false,
    contextSummary: 'Budget initial 1500 EUR',
  });

  assert.match(noSearchConfirm, /Agences IA/i);
  assert.match(noSearchConfirm, /E-commerce et dropshipping/i);
  assert.match(noSearchConfirm, /Développement de logiciels et SaaS/i);
  assert.match(noSearchConfirm, /Analyse du projet/);
  assert.match(noSearchConfirm, /Ouvrir|Outils adaptés/);
  assert.match(noSearchConfirm, /offres gratuites vs payantes/i);
  assert.match(noSearchConfirm, /Ne garantis JAMAIS de revenus/i);
  assert.match(noSearchConfirm, /législation française/i);
  assert.match(noSearchConfirm, /formalites\.entreprises\.gouv\.fr/i);
  assert.match(noSearchConfirm, /10\s*000\s*€/);
  assert.match(noSearchConfirm, /RC Pro/i);
  assert.match(noSearchConfirm, /trésorerie/i);
  assert.match(noSearchConfirm, /eval\(/i);
  assert.match(noSearchConfirm, /NIVEAU UTILISATEUR : Confirmé/);
  assert.match(noSearchConfirm, /RECHERCHE WEB NON ACTIVÉE/);
  assert.match(noSearchConfirm, /Budget initial 1500 EUR/);

  const withSearchDebutant = buildAssistantSystemInstruction({
    experienceLevel: 'debutant',
    webSearchEnabled: true,
  });
  assert.match(withSearchDebutant, /NIVEAU UTILISATEUR : Débutant/);
  assert.match(withSearchDebutant, /RECHERCHE WEB ACTIVÉE/);
  assert.match(withSearchDebutant, /Service-Public\.fr|URSSAF/i);
});

test('tous les 18 modules business et anciens alias fonctionnent sans HTTP 400 INVALID_MODULE', async () => {
  const allCanonical = Object.keys(BUSINESS_MODULE_LABELS);
  assert.equal(allCanonical.length, 18);

  const modReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'modules-suite@nova-test.local',
      password: 'PasswordModules123!',
      displayName: 'Modules Suite',
    }),
  });
  assert.equal(modReg.status, 201);
  const modCookie = (modReg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const aliasReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'modules-alias@nova-test.local',
      password: 'PasswordModules123!',
      displayName: 'Modules Alias',
    }),
  });
  assert.equal(aliasReg.status, 201);
  const aliasCookie = (aliasReg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const previouslyBrokenAliases = [
    'market_research',
    'quote_builder',
    'professional_emails',
    'automation_workflow',
    'business_growth',
  ];

  for (const modKey of allCanonical) {
    const res = await fetch(`${baseUrl}/api/business/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: modCookie },
      body: JSON.stringify({
        moduleKey: modKey,
        title: `Test ${modKey}`,
        sector: 'Conseil B2B',
        budgetEur: 300,
        goal: 'Valider offre et trouver 2 clients pilotes',
      }),
    });
    assert.equal(res.status, 200, `Le module ${modKey} doit réussir en SSE 200`);
    const events = parseSsePayloads(await res.text());
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, `Événement done attendu pour ${modKey}`);
    const body = extractSseText(events);
    assert.ok(body.includes(normalizeBusinessModuleKey(modKey)!));
  }

  for (const modKey of previouslyBrokenAliases) {
    const res = await fetch(`${baseUrl}/api/business/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliasCookie },
      body: JSON.stringify({
        moduleKey: modKey,
        title: `Test ${modKey}`,
        sector: 'Conseil B2B',
        budgetEur: 300,
        goal: 'Valider offre et trouver 2 clients pilotes',
      }),
    });
    assert.equal(res.status, 200, `L'alias ${modKey} doit réussir en SSE 200`);
    const events = parseSsePayloads(await res.text());
    const done = events.find((e) => e.type === 'done');
    assert.ok(done, `Événement done attendu pour ${modKey}`);
    const body = extractSseText(events);
    assert.ok(body.includes(normalizeBusinessModuleKey(modKey)!));
  }

  const invalidRes = await fetch(`${baseUrl}/api/business/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: aliasCookie },
    body: JSON.stringify({
      moduleKey: 'module_inexistant_xyz',
      title: 'Test',
      sector: 'Tech',
      budgetEur: 0,
      goal: 'Test',
    }),
  });
  assert.equal(invalidRes.status, 400);
  const invalidJson = (await invalidRes.json()) as { code: string };
  assert.equal(invalidJson.code, 'INVALID_MODULE');
});

test('question business -> changement complet de sujet -> transmission du niveau sans répétition', async () => {
  capturedChatCalls.length = 0;

  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'biz-user@nova-test.local',
      password: 'PasswordUltra123!',
      displayName: 'Fondateur Test',
    }),
  });
  assert.equal(reg.status, 201);
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  // 1. Question business structurée
  const bizRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      message: 'Je veux lancer une agence IA B2B avec 500 euros de budget.',
      experienceLevel: 'confirme',
      useWebSearch: true,
    }),
  });
  assert.equal(bizRes.status, 200);
  const bizEvents = parseSsePayloads(await bizRes.text());
  const bizText = extractSseText(bizEvents);
  const convId = String(bizEvents.find((e) => e.type === 'done')?.conversationId ?? '');
  assert.ok(convId);
  assert.match(bizText, /1\. Analyse du projet/);
  assert.match(bizText, /7\. Prochaines actions concrètes/);
  assert.equal(capturedChatCalls[0]?.experienceLevel, 'confirme');
  assert.equal(capturedChatCalls[0]?.useWebSearch, true);

  // 2. Changement complet de sujet dans la même conversation
  const sqlRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      conversationId: convId,
      message: 'Comment indexer une table PostgreSQL multi-tenant en SQL ?',
      experienceLevel: 'intermediaire',
      useWebSearch: false,
    }),
  });
  assert.equal(sqlRes.status, 200);
  const sqlText = extractSseText(parseSsePayloads(await sqlRes.text()));
  assert.match(sqlText, /SQL & Sécurité/);
  assert.notEqual(sqlText, bizText);
  assert.equal(capturedChatCalls[1]?.historyLen, 2);
  assert.equal(capturedChatCalls[1]?.experienceLevel, 'intermediaire');
  assert.equal(capturedChatCalls[1]?.useWebSearch, false);

  // 3. Requête plan d'action via module action_plan persistée pour l'utilisateur connecté
  const planRes = await fetch(`${baseUrl}/api/business/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      moduleKey: 'action_plan',
      title: 'Agence Automatisation PME',
      sector: 'B2B Services',
      budgetEur: 500,
      goal: 'Signer 3 clients en 45 jours',
      experienceLevel: 'intermediaire',
    }),
  });
  assert.equal(planRes.status, 200);
  const planEvents = parseSsePayloads(await planRes.text());
  const planDone = planEvents.find((e) => e.type === 'done') as { project?: { id: string } };
  assert.ok(planDone?.project?.id, 'Le plan d’action doit être persisté en base');
});

test('conversation longue (> 24 messages) déclenche le résumé automatique sans blocage', async () => {
  summarizeInvocations = 0;

  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'long-conv@nova-test.local',
      password: 'PasswordUltra123!',
      displayName: 'Long Chat User',
    }),
  });
  const regJson = (await reg.json()) as { user: { id: string } };
  const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const conv = await createConversation({
    userId: regJson.user.id,
    title: 'Longue conversation stratégie',
    category: 'business',
  });

  // Seed 26 alternating historical turns (13 Q/A pairs > 24 threshold)
  for (let i = 1; i <= 13; i += 1) {
    await addMessage({ conversationId: conv.id, role: 'user', content: `Question étape ${i}` });
    await addMessage({ conversationId: conv.id, role: 'assistant', content: `Réponse étape ${i}` });
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      conversationId: conv.id,
      message: 'Quelle est la prochaine action prioritaire ?',
    }),
  });
  assert.equal(res.status, 200);
  const events = parseSsePayloads(await res.text());
  const done = events.find((e) => e.type === 'done');
  assert.equal(summarizeInvocations, 1);
  assert.equal(done?.summarizedActive, true);

  const latestCall = capturedChatCalls[capturedChatCalls.length - 1]!;
  assert.match(latestCall.contextSummary, /Résumé contextuel/);

  // summarizeConversationHistory without API key returns null rapidly without throwing
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const noKeySummary = await summarizeConversationHistory({
    existingSummary: '',
    turnsToSummarize: [{ role: 'user', content: 'Test' }],
  });
  assert.equal(noKeySummary, null);
  if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
});

test('erreur IA sur /api/business/generate remonte proprement un événement SSE typé', async () => {
  nextBusinessError = Object.assign(new Error('Model overloaded'), {
    status: 503,
    headers: { 'Retry-After': '4' },
  });
  const res = await fetch(`${baseUrl}/api/business/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.77',
    },
    body: JSON.stringify({
      moduleKey: 'business_plan',
      title: 'Test Erreur',
      sector: 'SaaS',
      budgetEur: 1000,
      goal: 'Tester résilience',
    }),
  });
  nextBusinessError = null;
  assert.equal(res.status, 200);
  const errEvent = parseSsePayloads(await res.text()).find((e) => e.type === 'error');
  assert.ok(errEvent);
  assert.equal(errEvent.status, 503);
  assert.equal(errEvent.code, 'AI_BUSY');
  assert.equal(errEvent.retryAfterSec, 4);
});

test('sécurité, isolation multi-utilisateurs, en-têtes no-store, assainissement SVG et publication de site', async () => {
  // 1. Routes protégées refusent l'accès anonyme
  for (const route of ['/api/dashboard', '/api/conversations', '/api/business/projects', '/api/documents', '/api/sites']) {
    const unauth = await fetch(`${baseUrl}${route}`);
    assert.equal(unauth.status, 401, `${route} doit exiger l'authentification`);
  }

  // 2. En-têtes Cache-Control: no-store sur /api/auth/me
  const meRes = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(meRes.status, 200);
  assert.match(meRes.headers.get('cache-control') ?? '', /no-store/);

  // 3. Aucun secret exposé dans /api/health ou /api/ai/providers
  const healthText = await (await fetch(`${baseUrl}/api/health`)).text();
  const providersText = await (await fetch(`${baseUrl}/api/ai/providers`)).text();
  assert.doesNotMatch(healthText, /test-key-only|AIza/);
  assert.doesNotMatch(providersText, /test-key-only|AIza/);

  // 4. Isolation stricte entre Utilisateur A et Utilisateur B
  const regA = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user-a@nova-test.local',
      password: 'PasswordUltra123!',
      displayName: 'User A',
    }),
  });
  const cookieA = (regA.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const regB = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user-b@nova-test.local',
      password: 'PasswordUltra123!',
      displayName: 'User B',
    }),
  });
  const cookieB = (regB.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const docRes = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      docType: 'Devis',
      title: 'Devis Confidentiel A',
      contentMarkdown: '# Devis confidentiel',
    }),
  });
  assert.equal(docRes.status, 201);
  const docJson = (await docRes.json()) as { document: { id: string } };

  const delByB = await fetch(`${baseUrl}/api/documents/${docJson.document.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieB },
  });
  assert.equal(delByB.status, 404, 'Un autre utilisateur ne doit pas pouvoir supprimer un document');

  // 5. Assainissement SVG contre XSS
  const cleanSvg = sanitizeSvgLogo(
    '<svg viewBox="0 0 100 100" onclick="alert(1)"><script>alert(1)</script><circle cx="50" cy="50" r="40" fill="#3B82F6"/></svg>',
    'Nova',
    '#3B82F6'
  );
  assert.doesNotMatch(cleanSvg, /<script|onclick=|javascript:/i);
  assert.match(cleanSvg, /<circle/);

  // 6. Publication réelle d'un site HTML et accessibilité HTTP /sites/:slug
  const pubRes = await fetch(`${baseUrl}/api/sites/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      title: 'Site Entreprise A',
      htmlContent: '<!doctype html><html lang="fr"><body><h1>Site Entreprise A</h1></body></html>',
    }),
  });
  assert.equal(pubRes.status, 200);
  const pubJson = (await pubRes.json()) as { publicPath: string };
  const liveRes = await fetch(`${baseUrl}${pubJson.publicPath}`);
  assert.equal(liveRes.status, 200);
  assert.match(await liveRes.text(), /Site Entreprise A/);

  // 7. Assainissement SVG renforcé (script auto-fermant, iframe/object/embed, unquoted handlers, vbscript, data:text/html)
  const hardSvg = sanitizeSvgLogo(
    '<svg viewBox="0 0 100 100" onclick=alert(1)><script/><iframe src="https://evil.test"/><object data="x"/><embed src="x"/><a href="vbscript:msgbox(1)">x</a><image href="data:text/html,<script>1</script>"/><rect x="10" y="10" width="80" height="80" fill="#7C3AED"/></svg>',
    'Nova',
    '#7C3AED'
  );
  assert.doesNotMatch(hardSvg, /<script|<iframe|<object|<embed|onclick=|vbscript:|data:text\/html/i);
  assert.match(hardSvg, /<rect/);

  // 8. Précision 2026, distinction comptable & protection anti-injection document_utilisateur
  const prompt2026 = buildAssistantSystemInstruction({
    experienceLevel: 'debutant',
    webSearchEnabled: false,
  });
  assert.match(prompt2026, /2026/);
  assert.match(prompt2026, /TVA.*IS.*IR.*CFE|TVA, IS\/IR, CFE/i);
  assert.match(prompt2026, /document_utilisateur/i);
});
