import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { GoogleGenAI } from '@google/genai';

const { createApp } = await import('./app.js');
const { closeDatabase, createMemoryPgAdapter, setDatabaseAdapterForTests } = await import('./db.js');
const {
  GEMINI_MODELS,
  classifyGeminiError,
  extractHttpStatus,
  extractRetryAfterMs,
  generateContentWithResilience,
  getAvailableAIProviders,
  getVerifiedAlternativeFreeModels,
  mapGeminiErrorMessage,
  markGeminiModelUnavailable,
  resetGeminiHealthStateForTests,
  resolveConfiguredFallbackModel,
  runWithResilientGeminiFallback,
} = await import('./gemini.js');

const dummyAi = new GoogleGenAI({ apiKey: 'test-key-only' });
const sampleContents = [{ role: 'user' as const, parts: [{ text: 'Bonjour NOVA' }] }];

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

function makeHttpError(
  status: number,
  message: string,
  headers?: Record<string, string>
): Error & { status: number; headers?: Record<string, string> } {
  const err = new Error(message) as Error & { status: number; headers?: Record<string, string> };
  err.status = status;
  if (headers) {
    err.headers = headers;
  }
  return err;
}

let server: http.Server;
let baseUrl = '';
let nextChatError: Error | null = null;
let nextChatSuccess: { text: string; modelUsed?: string } | null = null;
let nextCompanyError: Error | null = null;
let lastCompanyRequestedModel: string | null = null;

before(async () => {
  setDatabaseAdapterForTests(createMemoryPgAdapter());
  const app = createApp({
    providerKeyChecker: () => 'test-key-present',
    summarizeHistory: async () => null,
    streamConversation: async ({ model, callbacks }) => {
      const selectedModel = model || GEMINI_MODELS.primary;
      callbacks.onModelSelected?.(selectedModel);
      if (nextChatError) {
        throw nextChatError;
      }
      if (nextChatSuccess) {
        const finalModel = nextChatSuccess.modelUsed || selectedModel;
        callbacks.onDelta(nextChatSuccess.text);
        return {
          fullText: nextChatSuccess.text,
          sources: [],
          modelUsed: finalModel,
          latencyMs: 25,
        };
      }
      throw new Error('Unexpected non-error invocation in gemini-errors.test');
    },
    generateCompanySuite: async (params) => {
      lastCompanyRequestedModel = params.model ?? null;
      if (nextCompanyError) {
        throw nextCompanyError;
      }
      throw new Error('Unexpected non-error invocation in company-suite test');
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

beforeEach(() => {
  resetGeminiHealthStateForTests();
  nextChatError = null;
  nextChatSuccess = null;
  nextCompanyError = null;
  lastCompanyRequestedModel = null;
});

test('extractHttpStatus et extractRetryAfterMs analysent les codes 429, 503, timeout et en-têtes Retry-After', () => {
  const err503 = makeHttpError(503, 'Service Unavailable');
  assert.equal(extractHttpStatus(err503), 503);

  const err429Header = makeHttpError(429, 'Too Many Requests', { 'Retry-After': '4' });
  assert.equal(extractHttpStatus(err429Header), 429);
  assert.equal(extractRetryAfterMs(err429Header), 4000);

  const errHeadersGet = Object.assign(new Error('429 RESOURCE_EXHAUSTED'), {
    status: 429,
    response: {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'retry-after' ? '7' : null),
      },
    },
  });
  assert.equal(extractRetryAfterMs(errHeadersGet), 7000);

  const futureDate = new Date(Date.now() + 5000).toUTCString();
  const errDateHeader = makeHttpError(503, 'Overloaded', { 'retry-after': futureDate });
  const parsedDateMs = extractRetryAfterMs(errDateHeader);
  assert.ok(parsedDateMs !== null && parsedDateMs >= 2000 && parsedDateMs <= 6000);

  const errJsonRetryDelay = new Error(
    '429 RESOURCE_EXHAUSTED {"details":[{"retryDelay":"3s"}]}'
  );
  assert.equal(extractHttpStatus(errJsonRetryDelay), 429);
  assert.equal(extractRetryAfterMs(errJsonRetryDelay), 3000);
});

test('classifyGeminiError et mapGeminiErrorMessage distinguent 429 temporaire, 429 quota épuisé, 503 et timeout', () => {
  const transient429 = makeHttpError(429, 'RESOURCE_EXHAUSTED: Too many requests per minute', {
    'Retry-After': '4',
  });
  const mappedTransient429 = mapGeminiErrorMessage(transient429);
  assert.equal(classifyGeminiError(transient429).category, 'rate_limit');
  assert.equal(mappedTransient429.status, 429);
  assert.equal(mappedTransient429.code, 'AI_RATE_LIMIT');
  assert.equal(mappedTransient429.retryAfterSec, 4);
  assert.match(mappedTransient429.message, /4 seconde/);

  const quota429 = makeHttpError(
    429,
    'You exceeded your current quota, please check your plan and billing details. limit: 0'
  );
  const mappedQuota429 = mapGeminiErrorMessage(quota429);
  assert.equal(classifyGeminiError(quota429).category, 'quota_exhausted');
  assert.equal(mappedQuota429.status, 429);
  assert.equal(mappedQuota429.code, 'AI_QUOTA_EXHAUSTED');
  assert.match(mappedQuota429.message, /service gratuit IA atteinte.*Aucun paiement ni facturation/i);

  const err503 = makeHttpError(503, 'The model is overloaded. Service unavailable.', {
    'Retry-After': '3',
  });
  const mapped503 = mapGeminiErrorMessage(err503);
  assert.equal(classifyGeminiError(err503).category, 'unavailable');
  assert.equal(mapped503.status, 503);
  assert.equal(mapped503.code, 'AI_BUSY');
  assert.equal(mapped503.retryAfterSec, 3);
  assert.match(mapped503.message, /503/);

  const errTimeout = new Error('TTFT_TIMEOUT');
  const mappedTimeout = mapGeminiErrorMessage(errTimeout);
  assert.equal(classifyGeminiError(errTimeout).category, 'timeout');
  assert.equal(mappedTimeout.status, 504);
  assert.equal(mappedTimeout.code, 'AI_TIMEOUT');
  assert.match(mappedTimeout.message, /timeout|conservé/i);
});

test('resolveConfiguredFallbackModel respecte la configuration serveur et la disponibilité réelle', () => {
  const prevApiKey = process.env.GEMINI_API_KEY;
  const prevFallback = process.env.GEMINI_FALLBACK_MODEL;

  try {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_FALLBACK_MODEL;
    assert.equal(
      resolveConfiguredFallbackModel(GEMINI_MODELS.primary),
      GEMINI_MODELS.fallback
    );
    assert.equal(resolveConfiguredFallbackModel(GEMINI_MODELS.fallback), null);

    process.env.GEMINI_FALLBACK_MODEL = 'none';
    assert.equal(resolveConfiguredFallbackModel(GEMINI_MODELS.primary), null);

    process.env.GEMINI_FALLBACK_MODEL = 'unknown-model-xyz';
    assert.equal(resolveConfiguredFallbackModel(GEMINI_MODELS.primary), null);

    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_FALLBACK_MODEL;
    assert.equal(resolveConfiguredFallbackModel(GEMINI_MODELS.primary), null);
  } finally {
    if (prevApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevApiKey;

    if (prevFallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = prevFallback;
  }
});

test('503 avant toute réponse : backoff progressif puis bascule vers le modèle de secours configuré', async () => {
  const modelsTried: string[] = [];
  const sleepDelays: number[] = [];

  const result = await runWithResilientGeminiFallback({
    ai: dummyAi,
    contents: sampleContents,
    systemInstruction: 'test',
    useWebSearch: false,
    callbacks: { onDelta: () => {} },
    startedAt: Date.now(),
    retryBaseMs: 250,
    maxAutoRetryWaitMs: 5000,
    sleepFn: async (ms) => {
      sleepDelays.push(ms);
    },
    fallbackModelResolver: (active) =>
      active === GEMINI_MODELS.primary ? GEMINI_MODELS.fallback : null,
    streamOnceFn: async ({ model, onDelta }) => {
      modelsTried.push(model);
      if (modelsTried.length <= 2) {
        throw makeHttpError(503, 'Service temporarily overloaded');
      }
      onDelta('Réponse via modèle de secours');
      return { fullText: 'Réponse via modèle de secours', sources: [] };
    },
  });

  assert.deepEqual(modelsTried, [
    GEMINI_MODELS.primary,
    GEMINI_MODELS.primary,
    GEMINI_MODELS.fallback,
  ]);
  assert.deepEqual(sleepDelays, [250, 500]);
  assert.equal(result.modelUsed, GEMINI_MODELS.fallback);
  assert.equal(result.fullText, 'Réponse via modèle de secours');
});

test('429 temporaire respecte le délai Retry-After et limite à 1 nouvelle tentative maximum', async () => {
  const sleepDelays: number[] = [];
  let calls = 0;

  const okRes = await runWithResilientGeminiFallback({
    ai: dummyAi,
    contents: sampleContents,
    systemInstruction: 'test',
    useWebSearch: false,
    callbacks: { onDelta: () => {} },
    startedAt: Date.now(),
    retryBaseMs: 300,
    maxAutoRetryWaitMs: 8000,
    sleepFn: async (ms) => {
      sleepDelays.push(ms);
    },
    fallbackModelResolver: () => GEMINI_MODELS.fallback,
    streamOnceFn: async ({ onDelta }) => {
      calls += 1;
      if (calls === 1) {
        throw makeHttpError(429, 'Too Many Requests', { 'Retry-After': '3' });
      }
      onDelta('OK après pause Retry-After');
      return { fullText: 'OK après pause Retry-After', sources: [] };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(sleepDelays, [3000]);
  assert.equal(okRes.fullText, 'OK après pause Retry-After');

  // Si un deuxième 429 survient après la tentative unique autorisée, on s'arrête sans boucle
  let persistentCalls = 0;
  const persistentSleeps: number[] = [];
  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        callbacks: { onDelta: () => {} },
        startedAt: Date.now(),
        retryBaseMs: 200,
        maxAutoRetryWaitMs: 8000,
        sleepFn: async (ms) => {
          persistentSleeps.push(ms);
        },
        fallbackModelResolver: () => GEMINI_MODELS.fallback,
        streamOnceFn: async () => {
          persistentCalls += 1;
          throw makeHttpError(429, 'Rate limit persistent', { 'Retry-After': '2' });
        },
      }),
    /Rate limit persistent/
  );
  assert.equal(persistentCalls, 2);
  assert.deepEqual(persistentSleeps, [2000]);
});

test('429 quota épuisé ou Retry-After excessif : zéro boucle et zéro tentative supplémentaire', async () => {
  let quotaCalls = 0;
  const quotaSleeps: number[] = [];

  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        callbacks: { onDelta: () => {} },
        startedAt: Date.now(),
        sleepFn: async (ms) => {
          quotaSleeps.push(ms);
        },
        fallbackModelResolver: () => GEMINI_MODELS.fallback,
        streamOnceFn: async () => {
          quotaCalls += 1;
          throw makeHttpError(
            429,
            'RESOURCE_EXHAUSTED: You exceeded your current quota for today (per day)'
          );
        },
      }),
    /exceeded your current quota/
  );
  assert.equal(quotaCalls, 1);
  assert.equal(quotaSleeps.length, 0);

  let longWaitCalls = 0;
  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        callbacks: { onDelta: () => {} },
        startedAt: Date.now(),
        maxAutoRetryWaitMs: 10_000,
        sleepFn: async () => {},
        fallbackModelResolver: () => GEMINI_MODELS.fallback,
        streamOnceFn: async () => {
          longWaitCalls += 1;
          throw makeHttpError(429, 'Too many requests', { 'Retry-After': '45' });
        },
      }),
    /Too many requests/
  );
  assert.equal(longWaitCalls, 1);
});

test('aucune bascule si aucun modèle de secours n’est disponible ou configuré', async () => {
  const modelsTried: string[] = [];

  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        callbacks: { onDelta: () => {} },
        startedAt: Date.now(),
        retryBaseMs: 100,
        sleepFn: async () => {},
        fallbackModelResolver: () => null,
        streamOnceFn: async ({ model }) => {
          modelsTried.push(model);
          throw makeHttpError(503, 'Service unavailable');
        },
      }),
    /Service unavailable/
  );

  assert.equal(modelsTried.length, 3);
  assert.ok(modelsTried.every((m) => m === GEMINI_MODELS.primary));
});

test('CRITIQUE : aucune relance automatique après le début d’affichage de la réponse (zéro doublon)', async () => {
  let attempts = 0;
  const receivedDeltas: string[] = [];
  let slept = false;

  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        callbacks: {
          onDelta: (d) => receivedDeltas.push(d),
        },
        startedAt: Date.now(),
        sleepFn: async () => {
          slept = true;
        },
        fallbackModelResolver: () => GEMINI_MODELS.fallback,
        streamOnceFn: async ({ onDelta }) => {
          attempts += 1;
          onDelta('Début déjà affiché ');
          throw new Error('STREAM_TIMEOUT');
        },
      }),
    /STREAM_TIMEOUT/
  );

  assert.equal(attempts, 1);
  assert.equal(slept, false);
  assert.deepEqual(receivedDeltas, ['Début déjà affiché ']);
});

test('TTFT_TIMEOUT avant le premier token effectue une relance bornée et annulation abort interrompt le sleep', async () => {
  let attempts = 0;
  const sleeps: number[] = [];

  const res = await runWithResilientGeminiFallback({
    ai: dummyAi,
    contents: sampleContents,
    systemInstruction: 'test',
    useWebSearch: false,
    callbacks: { onDelta: () => {} },
    startedAt: Date.now(),
    retryBaseMs: 150,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    fallbackModelResolver: () => GEMINI_MODELS.fallback,
    streamOnceFn: async ({ onDelta }) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('TTFT_TIMEOUT');
      }
      onDelta('Réponse rapide après timeout initial');
      return { fullText: 'Réponse rapide après timeout initial', sources: [] };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [150]);
  assert.equal(res.fullText, 'Réponse rapide après timeout initial');

  // Vérifier l'interruption immédiate du délai d'attente en cas d'annulation client
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 15);
  await assert.rejects(
    () =>
      runWithResilientGeminiFallback({
        ai: dummyAi,
        contents: sampleContents,
        systemInstruction: 'test',
        useWebSearch: false,
        externalSignal: ac.signal,
        callbacks: { onDelta: () => {} },
        startedAt: Date.now(),
        retryBaseMs: 5000,
        fallbackModelResolver: () => null,
        streamOnceFn: async () => {
          throw makeHttpError(503, 'Overloaded');
        },
      }),
    /CLIENT_ABORTED/
  );
});

test('generateContentWithResilience gère 503, 429 Retry-After, quota épuisé et timeout de génération', async () => {
  // 1. 503 + bascule sur modèle de secours
  const tried: string[] = [];
  const sleeps: number[] = [];
  const ok = await generateContentWithResilience({
    ai: dummyAi,
    retryBaseMs: 100,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    fallbackModelResolver: (active) =>
      active === GEMINI_MODELS.primary ? GEMINI_MODELS.fallback : null,
    invokeModel: async (model) => {
      tried.push(model);
      if (tried.length <= 2) {
        throw makeHttpError(503, 'Busy');
      }
      return { ok: true };
    },
  });
  assert.deepEqual(tried, [
    GEMINI_MODELS.primary,
    GEMINI_MODELS.primary,
    GEMINI_MODELS.fallback,
  ]);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(ok.modelUsed, GEMINI_MODELS.fallback);

  // 2. Timeout via AbortSignal (GENERATE_TIMEOUT)
  let timeoutAttempts = 0;
  await assert.rejects(
    () =>
      generateContentWithResilience({
        ai: dummyAi,
        timeoutMs: 20,
        retryBaseMs: 10,
        sleepFn: async () => {},
        fallbackModelResolver: () => null,
        invokeModel: (_model, signal) => {
          timeoutAttempts += 1;
          return new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(signal.reason ?? new Error('GENERATE_TIMEOUT')),
              { once: true }
            );
          });
        },
      }),
    /GENERATE_TIMEOUT/
  );
  assert.equal(timeoutAttempts, 3);
});

test('routes HTTP (/api/chat SSE & /api/business/company-suite JSON) exposent clairement 429, 503 et 504 timeout', async () => {
  // 1. /api/chat SSE -> 429 temporaire
  nextChatError = makeHttpError(429, 'Too many requests', { 'Retry-After': '6' });
  const r429 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Test 429' }),
  });
  const ev429 = parseSsePayloads(await r429.text()).find((e) => e.type === 'error');
  assert.ok(ev429);
  assert.equal(ev429.status, 429);
  assert.equal(ev429.code, 'AI_RATE_LIMIT');
  assert.equal(ev429.retryAfterSec, 6);

  // 2. /api/chat SSE -> 429 quota épuisé
  nextChatError = makeHttpError(
    429,
    'You exceeded your current quota, check your billing details'
  );
  const rQuota = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Test Quota' }),
  });
  const evQuota = parseSsePayloads(await rQuota.text()).find((e) => e.type === 'error');
  assert.ok(evQuota);
  assert.equal(evQuota.status, 429);
  assert.equal(evQuota.code, 'AI_QUOTA_EXHAUSTED');
  assert.match(String(evQuota.error), /service gratuit IA atteinte.*Aucun paiement ni facturation/i);

  // 3. /api/chat SSE -> 503 surchargé
  nextChatError = makeHttpError(503, 'High demand on Gemini', { 'Retry-After': '4' });
  const r503 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Test 503' }),
  });
  const ev503 = parseSsePayloads(await r503.text()).find((e) => e.type === 'error');
  assert.ok(ev503);
  assert.equal(ev503.status, 503);
  assert.equal(ev503.code, 'AI_BUSY');
  assert.equal(ev503.retryAfterSec, 4);

  // 4. /api/chat SSE -> timeout
  nextChatError = new Error('TTFT_TIMEOUT');
  const rTimeout = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Test timeout' }),
  });
  const evTimeout = parseSsePayloads(await rTimeout.text()).find((e) => e.type === 'error');
  assert.ok(evTimeout);
  assert.equal(evTimeout.status, 504);
  assert.equal(evTimeout.code, 'AI_TIMEOUT');

  // 5. /api/business/company-suite JSON -> HTTP 503 + Retry-After header + 504 timeout
  nextCompanyError = makeHttpError(503, 'Service unavailable', { 'Retry-After': '5' });
  const c503 = await fetch(`${baseUrl}/api/business/company-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Nova Studio',
      sector: 'Conseil IA',
      budgetEur: 1500,
      goal: 'Trouver 5 clients',
    }),
  });
  assert.equal(c503.status, 503);
  assert.equal(c503.headers.get('retry-after'), '5');
  const c503Body = (await c503.json()) as Record<string, unknown>;
  assert.equal(c503Body.code, 'AI_BUSY');
  assert.equal(c503Body.retryAfterSec, 5);

  nextCompanyError = new Error('GENERATE_TIMEOUT');
  const cTimeout = await fetch(`${baseUrl}/api/business/company-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Nova Studio',
      sector: 'Conseil IA',
      budgetEur: 1500,
      goal: 'Trouver 5 clients',
    }),
  });
  assert.equal(cTimeout.status, 504);
  const cTimeoutBody = (await cTimeout.json()) as Record<string, unknown>;
  assert.equal(cTimeoutBody.code, 'AI_TIMEOUT');

  // 6. /api/business/company-suite JSON -> HTTP 500 avec masquage strict des clés API
  nextCompanyError = new Error(
    'Backend failure AIzaSySecretTestKey1234567890 ?key=SecretQueryParam Bearer sk_live_secret_token'
  );
  const c500 = await fetch(`${baseUrl}/api/business/company-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Nova Studio',
      sector: 'Conseil IA',
      budgetEur: 1500,
      goal: 'Trouver 5 clients',
    }),
  });
  assert.equal(c500.status, 500);
  const c500Body = (await c500.json()) as Record<string, unknown>;
  assert.equal(c500Body.code, 'AI_ERROR');
  assert.doesNotMatch(String(c500Body.error), /AIzaSySecretTestKey|SecretQueryParam|sk_live_secret_token/);
});

test('vérification réelle des modèles gratuits alternatifs (429, fallback désactivé, saturation totale et /api/ai/providers)', async () => {
  const prevFallback = process.env.GEMINI_FALLBACK_MODEL;
  try {
    delete process.env.GEMINI_FALLBACK_MODEL;

    // 1. Aucun alternatif prétendu si la clé API est absente
    const noKeyAlts = getVerifiedAlternativeFreeModels(GEMINI_MODELS.primary, {
      aiConfigured: false,
    });
    assert.deepEqual(noKeyAlts, []);

    // 2. HTTP 429 sur le modèle principal -> propose uniquement Flash Lite réellement disponible
    nextChatError = makeHttpError(
      429,
      'You exceeded your current quota, limit: 0'
    );
    const rPrimary429 = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Plan action business 0 €',
        model: GEMINI_MODELS.primary,
      }),
    });
    const evPrimary429 = parseSsePayloads(await rPrimary429.text()).find((e) => e.type === 'error');
    assert.ok(evPrimary429);
    assert.equal(evPrimary429.status, 429);
    assert.equal(evPrimary429.failedModel, GEMINI_MODELS.primary);
    assert.equal(evPrimary429.noAlternativeAvailable, false);
    assert.deepEqual(
      (evPrimary429.alternativeModels as Array<{ id: string }>).map((m) => m.id),
      [GEMINI_MODELS.fallback]
    );

    // /api/ai/providers reflète la disponibilité réelle
    const providersAfterPrimary429 = await (await fetch(`${baseUrl}/api/ai/providers`)).json() as {
      providers: Array<{ models: Array<{ id: string; available?: boolean }> }>;
    };
    const modelsAfterPrimary = providersAfterPrimary429.providers[0].models;
    assert.equal(modelsAfterPrimary.find((m) => m.id === GEMINI_MODELS.primary)?.available, false);
    assert.equal(modelsAfterPrimary.find((m) => m.id === GEMINI_MODELS.fallback)?.available, true);

    // 3. HTTP 429 ensuite sur Flash Lite aussi -> aucun modèle alternatif disponible, message clair
    nextChatError = makeHttpError(429, 'RESOURCE_EXHAUSTED: Quota exceeded per day');
    const rBoth429 = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Plan action business 0 €',
        model: GEMINI_MODELS.fallback,
      }),
    });
    const evBoth429 = parseSsePayloads(await rBoth429.text()).find((e) => e.type === 'error');
    assert.ok(evBoth429);
    assert.equal(evBoth429.status, 429);
    assert.equal(evBoth429.failedModel, GEMINI_MODELS.fallback);
    assert.equal(evBoth429.noAlternativeAvailable, true);
    assert.deepEqual(evBoth429.alternativeModels, []);
    assert.match(String(evBoth429.error), /service est temporairement indisponible/i);
    assert.match(String(evBoth429.error), /Aucun paiement ni facturation/i);

    const providersAfterBoth429 = getAvailableAIProviders({ aiConfigured: true });
    assert.ok(providersAfterBoth429[0].models.every((m) => m.available === false));

    // 4. Si GEMINI_FALLBACK_MODEL=none, jamais de modèle alternatif prétendu disponible
    resetGeminiHealthStateForTests();
    process.env.GEMINI_FALLBACK_MODEL = 'none';
    markGeminiModelUnavailable(GEMINI_MODELS.primary, makeHttpError(429, 'Quota exceeded'));
    const mappedDisabledFallback = mapGeminiErrorMessage(
      makeHttpError(429, 'Quota exceeded'),
      { failedModel: GEMINI_MODELS.primary, aiConfigured: true }
    );
    assert.equal(mappedDisabledFallback.noAlternativeAvailable, true);
    assert.deepEqual(mappedDisabledFallback.alternativeModels, []);
    assert.match(mappedDisabledFallback.message, /aucun autre modèle gratuit/i);
  } finally {
    if (prevFallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = prevFallback;
  }
});

test('erreurs 429, 500, 503 et timeout préservent intact l’historique de conversation et permettent le réessai sans doublon', async () => {
  // Créer un compte utilisateur authentifié pour tester la persistance complète en base
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'error-history@nova-test.local',
      password: 'Password123!',
      displayName: 'Historique Test',
    }),
  });
  assert.equal(regRes.status, 201);
  const setCookie = regRes.headers.get('set-cookie');
  assert.ok(setCookie);
  const cookieHeader = setCookie.split(';')[0];

  // Tour 1 réussi
  nextChatError = null;
  nextChatSuccess = { text: 'Réponse initiale réussie.', modelUsed: GEMINI_MODELS.primary };
  const turn1Res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ message: 'Première question business' }),
  });
  const turn1Done = parseSsePayloads(await turn1Res.text()).find((e) => e.type === 'done');
  assert.ok(turn1Done && typeof turn1Done.conversationId === 'string');
  const convId = String(turn1Done.conversationId);

  // Tour 2 échoue avec HTTP 429, puis HTTP 500, puis HTTP 503, puis timeout 504
  const simulatedFailures: Array<{ err: Error; expectedStatus: number; expectedCode: string }> = [
    {
      err: makeHttpError(429, 'You exceeded your current quota for today'),
      expectedStatus: 429,
      expectedCode: 'AI_QUOTA_EXHAUSTED',
    },
    {
      err: new Error('Internal server failure 500'),
      expectedStatus: 500,
      expectedCode: 'AI_ERROR',
    },
    {
      err: makeHttpError(503, 'Model overloaded'),
      expectedStatus: 503,
      expectedCode: 'AI_BUSY',
    },
    {
      err: new Error('TTFT_TIMEOUT'),
      expectedStatus: 504,
      expectedCode: 'AI_TIMEOUT',
    },
  ];

  for (const [idx, scenario] of simulatedFailures.entries()) {
    resetGeminiHealthStateForTests();
    nextChatSuccess = null;
    nextChatError = scenario.err;
    const failRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        conversationId: convId,
        message: 'Question 2 à conserver',
        isRetry: idx > 0,
        model: GEMINI_MODELS.primary,
      }),
    });
    const failEv = parseSsePayloads(await failRes.text()).find((e) => e.type === 'error');
    assert.ok(failEv);
    assert.equal(failEv.status, scenario.expectedStatus);
    assert.equal(failEv.code, scenario.expectedCode);
  }

  // Vérifier que l'historique complet (Tour 1 + Question 2 sans doublon) est intact
  const detailBeforeRetry = await (
    await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(convId)}`, {
      headers: { Cookie: cookieHeader },
    })
  ).json() as { messages: Array<{ role: string; content: string; modelUsed?: string }> };
  assert.equal(detailBeforeRetry.messages.length, 3);
  assert.equal(detailBeforeRetry.messages[0].content, 'Première question business');
  assert.equal(detailBeforeRetry.messages[1].content, 'Réponse initiale réussie.');
  assert.equal(detailBeforeRetry.messages[2].content, 'Question 2 à conserver');

  // Réessai avec le modèle alternatif gratuit Flash Lite -> succès sans doublon
  nextChatError = null;
  nextChatSuccess = {
    text: 'Réponse via modèle alternatif gratuit.',
    modelUsed: GEMINI_MODELS.fallback,
  };
  const retryRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({
      conversationId: convId,
      message: 'Question 2 à conserver',
      isRetry: true,
      model: GEMINI_MODELS.fallback,
    }),
  });
  const retryEvents = parseSsePayloads(await retryRes.text());
  const retryDone = retryEvents.find((e) => e.type === 'done');
  assert.ok(retryDone);
  assert.equal(retryDone.modelUsed, GEMINI_MODELS.fallback);

  const detailAfterRetry = await (
    await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(convId)}`, {
      headers: { Cookie: cookieHeader },
    })
  ).json() as { messages: Array<{ role: string; content: string; modelUsed?: string | null }> };
  assert.equal(detailAfterRetry.messages.length, 4);
  assert.equal(detailAfterRetry.messages[2].content, 'Question 2 à conserver');
  assert.equal(detailAfterRetry.messages[3].content, 'Réponse via modèle alternatif gratuit.');
  assert.equal(detailAfterRetry.messages[3].modelUsed, GEMINI_MODELS.fallback);
});

test('/api/business/company-suite transmet le modèle sélectionné et retourne failedModel + alternativeModels vérifiés sur HTTP 429', async () => {
  nextCompanyError = makeHttpError(429, 'You exceeded your current quota, limit: 0');
  const first429 = await fetch(`${baseUrl}/api/business/company-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Atelier Solaire',
      sector: 'Conseil B2B',
      budgetEur: 500,
      goal: 'Signer 3 clients',
      model: GEMINI_MODELS.primary,
    }),
  });
  assert.equal(first429.status, 429);
  assert.equal(lastCompanyRequestedModel, GEMINI_MODELS.primary);
  const firstBody = (await first429.json()) as {
    code: string;
    failedModel: string;
    noAlternativeAvailable: boolean;
    alternativeModels: Array<{ id: string }>;
  };
  assert.equal(firstBody.code, 'AI_QUOTA_EXHAUSTED');
  assert.equal(firstBody.failedModel, GEMINI_MODELS.primary);
  assert.equal(firstBody.noAlternativeAvailable, false);
  assert.deepEqual(
    firstBody.alternativeModels.map((m) => m.id),
    [GEMINI_MODELS.fallback]
  );

  // Bascule vers Flash Lite -> transmet bien GEMINI_MODELS.fallback et signale saturation si celui-ci renvoie 429 aussi
  const second429 = await fetch(`${baseUrl}/api/business/company-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Atelier Solaire',
      sector: 'Conseil B2B',
      budgetEur: 500,
      goal: 'Signer 3 clients',
      model: GEMINI_MODELS.fallback,
    }),
  });
  assert.equal(second429.status, 429);
  assert.equal(lastCompanyRequestedModel, GEMINI_MODELS.fallback);
  const secondBody = (await second429.json()) as {
    failedModel: string;
    noAlternativeAvailable: boolean;
    alternativeModels: Array<{ id: string }>;
  };
  assert.equal(secondBody.failedModel, GEMINI_MODELS.fallback);
  assert.equal(secondBody.noAlternativeAvailable, true);
  assert.deepEqual(secondBody.alternativeModels, []);
});
