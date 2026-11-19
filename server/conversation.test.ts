import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-conv-test-'));
const tempDbPath = path.join(tempDir, 'test.db');
process.env.SQLITE_DB_PATH = tempDbPath;

const { createApp } = await import('./app.js');
const {
  buildNormalizedChatMessages,
  buildNormalizedGeminiContents,
  getGeminiApiKey,
  streamConversationResponse,
} = await import('./gemini.js');

interface RecordedCall {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  normalizedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  contextSummary: string;
}

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

function extractResponseText(events: Array<Record<string, unknown>>): string {
  return events
    .filter((ev) => ev.type === 'delta' && typeof ev.text === 'string')
    .map((ev) => String(ev.text))
    .join('');
}

let server: http.Server;
let baseUrl = '';
const recordedCalls: RecordedCall[] = [];
let answerCounter = 0;

before(async () => {
  const app = createApp({
    providerKeyChecker: () => 'test-key-present',
    summarizeHistory: async () => null,
    streamConversation: async (params) => {
      const normalizedContents = buildNormalizedGeminiContents(
        params.history,
        params.userMessage,
        12
      );
      recordedCalls.push({
        history: params.history.map((h) => ({ ...h })),
        userMessage: params.userMessage,
        normalizedContents,
        contextSummary: params.contextSummary ?? '',
      });

      answerCounter += 1;
      const lastTurn = normalizedContents[normalizedContents.length - 1];
      const promptText = lastTurn?.parts[0]?.text ?? '';

      let replyText = '';
      if (promptText.includes('micro-entreprise')) {
        replyText = `Réponse #${answerCounter} [MICRO-ENTREPRISE]: Déclaration Guichet Unique INPI, plafond CA et franchise en base de TVA.`;
      } else if (promptText.includes('TypeScript')) {
        replyText = `Réponse #${answerCounter} [TYPESCRIPT]: \`const sorted = [...nums].sort((a, b) => a - b);\``;
      } else if (promptText.includes('marketing')) {
        replyText = `Réponse #${answerCounter} [MARKETING]: Acquisition organique, prospection ciblée et suivi hebdomadaire.`;
      } else {
        replyText = `Réponse #${answerCounter} pour: ${promptText}`;
      }

      params.callbacks.onModelSelected?.('gemini-4-hydrogen');
      params.callbacks.onDelta(replyText);

      return {
        fullText: replyText,
        sources: [],
        modelUsed: 'gemini-4-hydrogen',
        latencyMs: 12,
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
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buildNormalizedGeminiContents préserve ordre chronologique, rôles et dernier message utilisateur', () => {
  const history = [
    { role: 'user' as const, content: 'Première question' },
    { role: 'assistant' as const, content: 'Première réponse' },
    { role: 'user' as const, content: 'Deuxième question' },
    { role: 'assistant' as const, content: 'Deuxième réponse' },
  ];

  const contents = buildNormalizedGeminiContents(history, 'Troisième question', 12);

  assert.equal(contents.length, 5);
  assert.deepEqual(
    contents.map((c) => c.role),
    ['user', 'model', 'user', 'model', 'user']
  );
  assert.equal(contents[0]?.parts[0]?.text, 'Première question');
  assert.equal(contents[1]?.parts[0]?.text, 'Première réponse');
  assert.equal(contents[4]?.parts[0]?.text, 'Troisième question');
});

test('buildNormalizedGeminiContents gère un historique tronqué ou un tour utilisateur précédent échoué sans répéter une ancienne question', () => {
  const historyWithFailure = [
    { role: 'user' as const, content: 'Question 1' },
    { role: 'assistant' as const, content: 'Réponse 1' },
    { role: 'user' as const, content: 'Ancienne question échouée sans réponse' },
  ];

  const contents = buildNormalizedGeminiContents(
    historyWithFailure,
    'Nouvelle question totalement différente',
    12
  );

  assert.deepEqual(
    contents.map((c) => c.role),
    ['user', 'model', 'user']
  );
  assert.equal(contents[0]?.parts[0]?.text, 'Question 1');
  assert.equal(contents[1]?.parts[0]?.text, 'Réponse 1');
  assert.equal(contents[2]?.parts[0]?.text, 'Nouvelle question totalement différente');

  // If maxHistoryTurns slices right onto an assistant message, the preceding user message is included
  const chatMsgs = buildNormalizedChatMessages(
    [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ],
    'Q3',
    3
  );
  assert.deepEqual(
    chatMsgs.map((m) => [m.role, m.content]),
    [
      ['user', 'Q1'],
      ['assistant', 'A1'],
      ['user', 'Q2'],
      ['assistant', 'A2'],
      ['user', 'Q3'],
    ]
  );
});

test('deux questions différentes dans une même conversation produisent deux réponses distinctes et adaptées sans répétition', async () => {
  recordedCalls.length = 0;

  // 1. Créer un compte utilisateur isolé pour récupérer un cookie de session valide
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'conv-test@nova-test.local',
      password: 'TestPassword123!',
      displayName: 'Testeur NOVA',
    }),
  });
  assert.equal(registerRes.status, 201);
  const rawSetCookie = registerRes.headers.get('set-cookie');
  assert.ok(rawSetCookie, 'Cookie de session attendu après inscription');
  const sessionCookie = rawSetCookie.split(';')[0] ?? '';

  // 2. Envoyer Question 1
  const q1 = 'Quelles sont les étapes de la micro-entreprise ?';
  const res1 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ message: q1 }),
  });
  assert.equal(res1.status, 200);
  assert.match(res1.headers.get('cache-control') ?? '', /no-store/);
  const events1 = parseSsePayloads(await res1.text());
  const done1 = events1.find((e) => e.type === 'done');
  const answer1 = extractResponseText(events1);
  const conversationId = String(done1?.conversationId ?? '');
  assert.ok(conversationId.length > 0, 'conversationId créé attendu');
  assert.match(answer1, /MICRO-ENTREPRISE/);

  // 3. Envoyer Question 2 (différente) dans la même conversation
  const q2 = 'Écris une fonction TypeScript pour trier un tableau.';
  const res2 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ message: q2, conversationId }),
  });
  assert.equal(res2.status, 200);
  const events2 = parseSsePayloads(await res2.text());
  const answer2 = extractResponseText(events2);

  assert.notEqual(answer2, answer1, 'La seconde réponse ne doit jamais répéter la première');
  assert.match(answer2, /TYPESCRIPT/);
  assert.doesNotMatch(answer2, /MICRO-ENTREPRISE/);

  // Vérifier exactement ce qui a été transmis au modèle pour Question 2
  assert.equal(recordedCalls.length, 2);
  const secondCall = recordedCalls[1]!;
  assert.equal(secondCall.userMessage, q2);
  assert.deepEqual(secondCall.history, [
    { role: 'user', content: q1 },
    { role: 'assistant', content: answer1 },
  ]);
  assert.deepEqual(
    secondCall.normalizedContents.map((c) => [c.role, c.parts[0]?.text]),
    [
      ['user', q1],
      ['model', answer1],
      ['user', q2],
    ]
  );

  // 4. Vérifier la persistance chronologique et la régénération (isRetry) sans duplication
  const retryRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ message: q2, conversationId, isRetry: true }),
  });
  assert.equal(retryRes.status, 200);
  const retryEvents = parseSsePayloads(await retryRes.text());
  const answer2Regen = extractResponseText(retryEvents);
  assert.notEqual(answer2Regen, answer2);
  assert.match(answer2Regen, /TYPESCRIPT/);

  const thirdCall = recordedCalls[2]!;
  assert.deepEqual(
    thirdCall.normalizedContents.map((c) => [c.role, c.parts[0]?.text]),
    [
      ['user', q1],
      ['model', answer1],
      ['user', q2],
    ]
  );

  const detailRes = await fetch(`${baseUrl}/api/conversations/${conversationId}`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(detailRes.status, 200);
  assert.match(detailRes.headers.get('cache-control') ?? '', /no-store/);
  const detail = (await detailRes.json()) as {
    messages: Array<{ role: string; content: string }>;
  };
  assert.deepEqual(
    detail.messages.map((m) => [m.role, m.content]),
    [
      ['user', q1],
      ['assistant', answer1],
      ['user', q2],
      ['assistant', answer2Regen],
    ]
  );
});

test('mode invité : deux questions consécutives avec historique transmettent la dernière question à la fin', async () => {
  const beforeCount = recordedCalls.length;
  const q1 = 'Donne un conseil marketing';
  const r1 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: q1, guestHistory: [] }),
  });
  const a1 = extractResponseText(parseSsePayloads(await r1.text()));
  assert.match(a1, /MARKETING/);

  const q2 = 'Écris une fonction TypeScript';
  const r2 = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: q2,
      guestHistory: [
        { role: 'user', content: q1 },
        { role: 'assistant', content: a1 },
      ],
    }),
  });
  const a2 = extractResponseText(parseSsePayloads(await r2.text()));
  assert.notEqual(a2, a1);
  assert.match(a2, /TYPESCRIPT/);

  const latestCall = recordedCalls[beforeCount + 1]!;
  assert.equal(
    latestCall.normalizedContents[latestCall.normalizedContents.length - 1]?.parts[0]?.text,
    q2
  );
});

test('live Gemini API (si GEMINI_API_KEY configurée) : deux questions différentes donnent deux réponses adaptées', async (t) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    t.skip('GEMINI_API_KEY absente dans l’environnement du test');
    return;
  }

  const resA = await streamConversationResponse({
    history: [],
    userMessage: 'Réponds uniquement par le nom de la capitale de la France.',
    useWebSearch: false,
    provider: 'gemini',
    plan: 'free',
    callbacks: { onDelta: () => {} },
  });

  const resB = await streamConversationResponse({
    history: [
      { role: 'user', content: 'Réponds uniquement par le nom de la capitale de la France.' },
      { role: 'assistant', content: resA.fullText },
    ],
    userMessage: 'Réponds uniquement par le résultat numérique de 12 * 13.',
    useWebSearch: false,
    provider: 'gemini',
    plan: 'free',
    callbacks: { onDelta: () => {} },
  });

  assert.match(resA.fullText.toLowerCase(), /paris/);
  assert.match(resB.fullText, /156/);
  assert.notEqual(resA.fullText.trim(), resB.fullText.trim());
});
