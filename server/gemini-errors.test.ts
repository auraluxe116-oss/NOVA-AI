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
  mapGeminiErrorMessage,
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
let nextCompanyError: Error | null = null;

before(async () => {
  setDatabaseAdapterForTests(createMemoryPgAdapter());
  const app = createApp({
    providerKeyChecker: () => 'test-key-present',
    summarizeHistory: async () => null,
    streamConversation: async () => {
      if (nextChatError) {
        throw nextChatError;
      }
      throw new Error('Unexpected non-error invocation in gemini-errors.test');
    },
    generateCompanySuite: async () => {
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
  nextCompanyError = null;
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
  assert.match(mappedQuota429.message, /renouvellement du quota|capacité API adaptée/i);

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
  assert.match(String(evQuota.error), /renouvellement du quota|capacité API adaptée/i);

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
});
