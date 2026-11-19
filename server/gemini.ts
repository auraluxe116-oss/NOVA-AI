import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AIProviderId,
  AIProviderInfo,
  CompanyCreationResult,
  ExperienceLevel,
  PlanTier,
  SourceLink,
  VideoStoryboard,
} from './types.js';

export const GEMINI_MODELS = {
  primary: 'gemini-4-hydrogen',
  fallback: 'gemini-3.1-flash-lite',
} as const;

const TTFT_PRIMARY_MS = 6_500;
const TTFT_FALLBACK_MS = 16_000;
const STREAM_INACTIVITY_MS = 35_000;
const COOLDOWN_MS = 90_000;

let primaryCooldownUntil = 0;

function isPrimaryHealthy(): boolean {
  return Date.now() >= primaryCooldownUntil;
}

function tripPrimaryCooldown(reason: unknown): void {
  primaryCooldownUntil = Date.now() + COOLDOWN_MS;
  console.warn(
    `[NOVA AI PRO] Bascule temporaire vers ${GEMINI_MODELS.fallback} pendant 90s :`,
    reason instanceof Error ? reason.message : String(reason)
  );
}

function cleanSecret(value: string | undefined, placeholders: string[]): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (placeholders.includes(raw)) return null;
  return raw;
}

export function getGeminiApiKey(): string | null {
  return cleanSecret(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, [
    'MY_GEMINI_API_KEY',
  ]);
}

export function getProviderApiKey(provider: AIProviderId): string | null {
  switch (provider) {
    case 'gemini':
      return getGeminiApiKey();
    case 'openai':
      return cleanSecret(process.env.OPENAI_API_KEY, ['MY_OPENAI_API_KEY']);
    case 'anthropic':
      return cleanSecret(process.env.ANTHROPIC_API_KEY, ['MY_ANTHROPIC_API_KEY']);
    case 'mistral':
      return cleanSecret(process.env.MISTRAL_API_KEY, ['MY_MISTRAL_API_KEY']);
    default:
      return null;
  }
}

export function getAvailableAIProviders(): AIProviderInfo[] {
  const geminiKey = Boolean(getGeminiApiKey());
  const openaiKey = Boolean(getProviderApiKey('openai'));
  const anthropicKey = Boolean(getProviderApiKey('anthropic'));
  const mistralKey = Boolean(getProviderApiKey('mistral'));

  return [
    {
      id: 'gemini',
      label: 'Google Gemini',
      configured: geminiKey,
      defaultModel: GEMINI_MODELS.primary,
      models: [
        { id: GEMINI_MODELS.primary, label: 'Gemini 4 Hydrogen (Principal)' },
        { id: GEMINI_MODELS.fallback, label: 'Gemini 3.1 Flash Lite (Rapide)' },
      ],
      note: geminiKey
        ? 'Connecté (recherche web Google incluse).'
        : 'Clé GEMINI_API_KEY requise dans Settings > Secrets.',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      configured: openaiKey,
      defaultModel: 'gpt-4o-mini',
      models: [
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        { id: 'gpt-4o', label: 'GPT-4o' },
      ],
      note: openaiKey
        ? 'Connecté via OPENAI_API_KEY.'
        : 'Non configuré (ajoutez OPENAI_API_KEY côté serveur pour activer).',
    },
    {
      id: 'mistral',
      label: 'Mistral AI',
      configured: mistralKey,
      defaultModel: 'mistral-small-latest',
      models: [
        { id: 'mistral-small-latest', label: 'Mistral Small' },
        { id: 'mistral-large-latest', label: 'Mistral Large' },
      ],
      note: mistralKey
        ? 'Connecté via MISTRAL_API_KEY.'
        : 'Non configuré (ajoutez MISTRAL_API_KEY côté serveur pour activer).',
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude',
      configured: anthropicKey,
      defaultModel: 'claude-3-5-haiku-latest',
      models: [{ id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' }],
      note: anthropicKey
        ? 'Connecté via ANTHROPIC_API_KEY.'
        : 'Non configuré (ajoutez ANTHROPIC_API_KEY côté serveur pour activer).',
    },
  ];
}

let cachedKey: string | null = null;
let cachedClient: GoogleGenAI | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedKey = apiKey;
  cachedClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedClient;
}

function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
}

export function mapGeminiErrorMessage(err: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('ttft_timeout') || lower.includes('stream_timeout') || lower.includes('timed out')) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message:
        "Le délai d'attente du moteur IA a été dépassé. Clique sur Réessayer pour relancer immédiatement.",
    };
  }
  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      code: 'AI_AUTH_ERROR',
      message:
        'Clé API IA invalide ou non autorisée. Vérifie ta clé dans Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      code: 'AI_RATE_LIMIT',
      message:
        "Limite temporaire de débit atteinte chez le fournisseur IA (HTTP 429). Aucun blocage interne NOVA n'est actif : patiente quelques secondes puis clique sur Réessayer.",
    };
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
    return {
      status: 503,
      code: 'AI_BUSY',
      message:
        'Le serveur IA du fournisseur est momentanément saturé. Réessaie dans un court instant.',
    };
  }
  return {
    status: 500,
    code: 'AI_ERROR',
    message: `Le moteur IA n'a pas pu finaliser la réponse : ${raw}`,
  };
}

export function shouldAutoEnableWebSearch(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(2025|2026|aujourd'hui|actualit[ée]|r[ée]cent|prix actuel|taux actuel|loi|r[ée]glementation|statistique|chiffre officiel|source|v[ée]rifie|cours du|bourses?)\b/.test(
    lower
  );
}

const GENERAL_SYSTEM_INSTRUCTION = `Tu es NOVA AI PRO, un assistant et conseiller stratégique francophone de niveau senior.

DOMAINES D'EXPERTISE :
- Business & Entrepreneuriat : création d'entreprise (micro-entreprise, EURL, SASU, SAS), validation d'offre, business plans, études de marché, tarification, marges et trésorerie.
- Marketing & Vente : positionnement, acquisition organique et payante, prospection B2B/B2C, tunnels de conversion, rédaction de propositions commerciales, devis, factures conformes et emails professionnels.
- Technologie & Produit : architecture logicielle, programmation, automatisation, IA, SQL, sécurité et productivité.
- Analyse de documents, éducation, sciences et synthèse claire.

RÈGLES DE QUALITÉ, CONTEXTE ET FIABILITÉ :
1. Exploite pleinement le résumé de contexte et les messages précédents pour maintenir une cohérence parfaite même dans les très longues conversations.
2. Adapte ton niveau d'explication et tes recommandations au profil et aux moyens de l'utilisateur.
3. Ne jamais inventer de faits, chiffres, dates, lois, statistiques, citations, informations administratives (SIRET, IBAN, adresse) ou URLs. Si une donnée ne peut pas être vérifiée, indique-le clairement.
4. Distingue explicitement les faits établis des hypothèses, estimations ou scénarios.
5. Si l'utilisateur relève une erreur, reconnais-la franchement et corrige-la immédiatement.
6. Comprends l'intention réelle même si la question est courte, mal formulée ou comporte des fautes.
7. Réponds en français naturel, précis et directement actionnable.
8. PRIORITÉ ABSOLUE AU DERNIER MESSAGE : Traite toujours spécifiquement la TOUTE DERNIÈRE demande de l'utilisateur à la fin de l'historique. Utilise les échanges précédents comme contexte utile, mais ne répète jamais une ancienne réponse à la place de la nouvelle question.`;

export interface ChatTurnInput {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Normalizes multi-turn history so:
 * - Chronological order (oldest -> newest) is strictly preserved.
 * - Leading assistant turns without a preceding user turn are dropped.
 * - Adjacent historical turns of the same role are merged to keep strict alternation.
 * - Trailing unanswered user turns from failed prior requests are excluded so they never
 *   collide with or hijack the new user prompt.
 * - The latest user prompt is ALWAYS placed as the exact final 'user' turn.
 */
export function buildNormalizedChatMessages(
  history: ChatTurnInput[],
  currentUserMessage: string,
  maxHistoryTurns = 12
): ChatTurnInput[] {
  const cleanCurrent = currentUserMessage.trim();
  const nonEmptyHistory = history
    .map((turn) => ({
      role: (turn.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: String(turn.content ?? '').trim().slice(0, 6000),
    }))
    .filter((turn) => turn.content.length > 0);

  let windowStart = Math.max(0, nonEmptyHistory.length - maxHistoryTurns);
  if (
    windowStart > 0 &&
    nonEmptyHistory[windowStart]?.role === 'assistant' &&
    nonEmptyHistory[windowStart - 1]?.role === 'user'
  ) {
    windowStart -= 1;
  }

  let sliced = nonEmptyHistory.slice(windowStart);
  while (sliced.length > 0 && sliced[0]?.role !== 'user') {
    sliced = sliced.slice(1);
  }

  const normalizedHistory: ChatTurnInput[] = [];
  for (const turn of sliced) {
    const prev = normalizedHistory[normalizedHistory.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${turn.content}`.slice(0, 6000);
    } else {
      normalizedHistory.push({ role: turn.role, content: turn.content });
    }
  }

  while (
    normalizedHistory.length > 0 &&
    normalizedHistory[normalizedHistory.length - 1]?.role === 'user'
  ) {
    normalizedHistory.pop();
  }

  return [...normalizedHistory, { role: 'user', content: cleanCurrent }];
}

export function buildNormalizedGeminiContents(
  history: ChatTurnInput[],
  currentUserMessage: string,
  maxHistoryTurns = 12
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  return buildNormalizedChatMessages(history, currentUserMessage, maxHistoryTurns).map(
    (turn) => ({
      role: (turn.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: turn.content }],
    })
  );
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onModelSelected?: (model: string) => void;
  onStatus?: (label: string) => void;
}

export interface StreamResult {
  fullText: string;
  sources: SourceLink[];
  modelUsed: string;
  latencyMs: number;
}

/**
 * Summarize older messages when a conversation becomes long so token usage stays
 * optimized without silently losing historical facts or user constraints.
 */
export async function summarizeConversationHistory(params: {
  existingSummary: string;
  turnsToSummarize: ChatTurnInput[];
}): Promise<string | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || params.turnsToSummarize.length === 0) return null;

  try {
    const ai = getClient(apiKey);
    const transcript = params.turnsToSummarize
      .map((t) => `${t.role === 'user' ? 'Utilisateur' : 'NOVA'}: ${t.content.slice(0, 1200)}`)
      .join('\n\n');

    const prompt = [
      params.existingSummary
        ? `Résumé précédent à mettre à jour :\n${params.existingSummary}\n\n`
        : '',
      `Nouveaux échanges à intégrer dans le résumé :\n${transcript}\n\n`,
      `Produis un résumé factuel et concis en français (maximum 180 mots) retenant uniquement : objectifs de l'utilisateur, contraintes, décisions prises, préférences techniques/business et chiffres cités.`,
    ].join('');

    const response = await ai.models.generateContent({
      model: GEMINI_MODELS.fallback,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    const text = response.text?.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function streamOnceWithGeminiModel(params: {
  ai: GoogleGenAI;
  model: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  useWebSearch: boolean;
  ttftTimeoutMs: number;
  externalSignal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<{ fullText: string; sources: SourceLink[] }> {
  const {
    ai,
    model,
    contents,
    systemInstruction,
    useWebSearch,
    ttftTimeoutMs,
    externalSignal,
    onDelta,
  } = params;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(new Error('CLIENT_ABORTED'));
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  let gotFirstToken = false;
  let fullText = '';
  const sourceMap = new Map<string, SourceLink>();

  let watchdogTimer: NodeJS.Timeout | null = null;
  const resetWatchdog = (ms: number, code: string) => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      controller.abort(new Error(code));
    }, ms);
  };

  resetWatchdog(ttftTimeoutMs, 'TTFT_TIMEOUT');

  try {
    const thinkingConfig =
      model === GEMINI_MODELS.fallback
        ? { thinkingLevel: ThinkingLevel.MINIMAL }
        : { thinkingLevel: ThinkingLevel.LOW };

    const config: Record<string, unknown> = {
      systemInstruction,
      thinkingConfig,
      abortSignal: controller.signal,
    };

    if (useWebSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config,
    });

    for await (const chunk of stream) {
      if (externalSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(groundingChunks)) {
        for (const gc of groundingChunks) {
          const uri = gc?.web?.uri?.trim();
          const title = gc?.web?.title?.trim() || uri;
          if (uri && !sourceMap.has(uri)) {
            sourceMap.set(uri, { title: title || 'Source web', url: uri });
          }
        }
      }

      const textPiece = chunk.text;
      if (textPiece && textPiece.length > 0) {
        if (!gotFirstToken) {
          gotFirstToken = true;
        }
        resetWatchdog(STREAM_INACTIVITY_MS, 'STREAM_TIMEOUT');
        fullText += textPiece;
        onDelta(textPiece);
      }
    }

    if (!fullText.trim()) {
      throw new Error('EMPTY_MODEL_RESPONSE');
    }

    return {
      fullText,
      sources: Array.from(sourceMap.values()).slice(0, 8),
    };
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

async function runWithResilientGeminiFallback(params: {
  ai: GoogleGenAI;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  useWebSearch: boolean;
  preferredModel?: string;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
  startedAt: number;
}): Promise<StreamResult> {
  const validPreferred =
    params.preferredModel === GEMINI_MODELS.fallback
      ? GEMINI_MODELS.fallback
      : GEMINI_MODELS.primary;

  const tryOrder: Array<{ model: string; ttftMs: number; label: string }> =
    validPreferred === GEMINI_MODELS.fallback
      ? [
          {
            model: GEMINI_MODELS.fallback,
            ttftMs: TTFT_FALLBACK_MS,
            label: 'NOVA réfléchit...',
          },
        ]
      : isPrimaryHealthy()
      ? [
          {
            model: GEMINI_MODELS.primary,
            ttftMs: TTFT_PRIMARY_MS,
            label: 'NOVA réfléchit...',
          },
          {
            model: GEMINI_MODELS.fallback,
            ttftMs: TTFT_FALLBACK_MS,
            label: 'Bascule automatique vers Gemini Flash Lite...',
          },
        ]
      : [
          {
            model: GEMINI_MODELS.fallback,
            ttftMs: TTFT_FALLBACK_MS,
            label: 'NOVA réfléchit...',
          },
        ];

  let lastError: unknown;
  let emittedAnyDelta = false;

  for (let i = 0; i < tryOrder.length; i += 1) {
    const candidate = tryOrder[i];
    if (!candidate) continue;

    const maxAttempts = i === tryOrder.length - 1 ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (i > 0 || attempt > 0) {
          params.callbacks.onStatus?.(candidate.label);
        }
        params.callbacks.onModelSelected?.(candidate.model);
        const res = await streamOnceWithGeminiModel({
          ai: params.ai,
          model: candidate.model,
          contents: params.contents,
          systemInstruction: params.systemInstruction,
          useWebSearch: params.useWebSearch,
          ttftTimeoutMs: candidate.ttftMs,
          externalSignal: params.externalSignal,
          onDelta: (delta) => {
            emittedAnyDelta = true;
            params.callbacks.onDelta(delta);
          },
        });

        return {
          fullText: res.fullText,
          sources: res.sources,
          modelUsed: candidate.model,
          latencyMs: Date.now() - params.startedAt,
        };
      } catch (err) {
        lastError = err;
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg === 'CLIENT_ABORTED') {
          throw err;
        }
        const is429 = rawMsg.toLowerCase().includes('429') || rawMsg.toLowerCase().includes('resource_exhausted');
        // Never loop on 429 to bypass provider limits; allow at most single fallback to a different healthy model if no deltas emitted
        const canRecover =
          !emittedAnyDelta &&
          !is429 &&
          (isTransientError(err) || rawMsg.includes('TTFT_TIMEOUT'));
        if (canRecover && attempt + 1 < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        if (canRecover && i < tryOrder.length - 1) {
          if (candidate.model === GEMINI_MODELS.primary) {
            tripPrimaryCooldown(err);
          }
          break;
        }
        throw err;
      }
    }
  }

  throw lastError;
}

async function streamOpenAICompatibleProvider(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
  startedAt: number;
}): Promise<StreamResult> {
  params.callbacks.onModelSelected?.(params.model);
  const res = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      stream: true,
      messages: [
        { role: 'system', content: params.systemInstruction },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
    signal: params.externalSignal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          params.callbacks.onDelta(delta);
        }
      } catch {
        // ignore partial chunk
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error('EMPTY_MODEL_RESPONSE');
  }

  return {
    fullText,
    sources: [],
    modelUsed: params.model,
    latencyMs: Date.now() - params.startedAt,
  };
}

async function streamAnthropicProvider(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
  startedAt: number;
}): Promise<StreamResult> {
  params.callbacks.onModelSelected?.(params.model);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
      stream: true,
      system: params.systemInstruction,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: params.externalSignal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const json = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === 'content_block_delta' && json.delta?.text) {
          fullText += json.delta.text;
          params.callbacks.onDelta(json.delta.text);
        }
      } catch {
        // ignore partial chunk
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error('EMPTY_MODEL_RESPONSE');
  }

  return {
    fullText,
    sources: [],
    modelUsed: params.model,
    latencyMs: Date.now() - params.startedAt,
  };
}

export async function streamConversationResponse(params: {
  history: ChatTurnInput[];
  contextSummary?: string;
  userMessage: string;
  attachment?: { name: string; content: string } | null;
  useWebSearch: boolean;
  provider?: AIProviderId;
  model?: string;
  plan: PlanTier;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
}): Promise<StreamResult> {
  const provider: AIProviderId = params.provider ?? 'gemini';
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `Le fournisseur IA "${provider}" n'est pas configuré côté serveur. Configure sa clé API dans Settings > Secrets ou utilise Google Gemini.`
    );
  }

  const startedAt = Date.now();
  const systemInstruction = params.contextSummary
    ? `${GENERAL_SYSTEM_INSTRUCTION}\n\n[RÉSUMÉ DU CONTEXTE ANTÉRIEUR DE LA CONVERSATION]\n${params.contextSummary}`
    : GENERAL_SYSTEM_INSTRUCTION;

  const finalUserPrompt = params.attachment
    ? `[Document joint : ${params.attachment.name}]\n\nContenu du document :\n"""\n${params.attachment.content}\n"""\n\nDemande de l'utilisateur :\n${params.userMessage}`
    : params.userMessage;

  const normalizedMessages = buildNormalizedChatMessages(
    params.history,
    finalUserPrompt,
    12
  );

  if (provider === 'openai') {
    return streamOpenAICompatibleProvider({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey,
      model: params.model || 'gpt-4o-mini',
      systemInstruction,
      messages: normalizedMessages,
      externalSignal: params.externalSignal,
      callbacks: params.callbacks,
      startedAt,
    });
  }

  if (provider === 'mistral') {
    return streamOpenAICompatibleProvider({
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      apiKey,
      model: params.model || 'mistral-small-latest',
      systemInstruction,
      messages: normalizedMessages,
      externalSignal: params.externalSignal,
      callbacks: params.callbacks,
      startedAt,
    });
  }

  if (provider === 'anthropic') {
    return streamAnthropicProvider({
      apiKey,
      model: params.model || 'claude-3-5-haiku-latest',
      systemInstruction,
      messages: normalizedMessages,
      externalSignal: params.externalSignal,
      callbacks: params.callbacks,
      startedAt,
    });
  }

  const ai = getClient(apiKey);
  const contents = buildNormalizedGeminiContents(params.history, finalUserPrompt, 12);

  const enableSearch = params.useWebSearch || shouldAutoEnableWebSearch(params.userMessage);

  return runWithResilientGeminiFallback({
    ai,
    contents,
    systemInstruction,
    useWebSearch: enableSearch,
    preferredModel: params.model,
    externalSignal: params.externalSignal,
    callbacks: params.callbacks,
    startedAt,
  });
}

// 18 Requested Business Modules
export const BUSINESS_MODULE_LABELS: Record<string, string> = {
  business_ideas: 'Idées de business rentables et réalistes',
  zero_budget: 'Création de business avec 0 €',
  business_plan: 'Business plan complet',
  market_study: 'Étude de marché structurée',
  competitor_analysis: 'Analyse concurrentielle',
  company_creation: "Création d'entreprise complète",
  find_clients: 'Recherche de clients & prospection',
  marketing_strategy: 'Stratégie marketing multicanal',
  brand_creation: 'Branding & identité de marque',
  ecommerce_store: 'Boutique en ligne & e-commerce',
  sales_strategy: 'Stratégie commerciale & closing',
  costs_margins: 'Calcul des coûts, pricing et marges',
  quote_creation: 'Création de devis professionnels',
  invoice_billing: 'Factures conformes & relances',
  professional_texts: 'Emails professionnels & argumentaires',
  action_plan: "Plans d'action opérationnels",
  automation_ops: "Automatisation des tâches & workflows",
  low_budget_growth: "Croissance d'entreprise & passage à l'échelle",
};

const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  debutant:
    'Débutant (premier projet, privilégier la simplicité, les explications pédagogiques et les risques évitables)',
  intermediaire:
    'Intermédiaire (déjà familier avec les bases business, privilégier l’exécution rapide et les leviers mesurables)',
  confirme:
    'Confirmé / Dirigeant (aller droit à l’optimisation, KPIs avancés, délégation, marges et structuration)',
};

const DOCUMENT_MODULES = new Set([
  'quote_creation',
  'invoice_billing',
  'professional_texts',
]);

export async function streamBusinessProject(params: {
  moduleKey: string;
  projectTitle: string;
  sector: string;
  budgetEur: number;
  goal: string;
  skills?: string;
  weeklyHours?: number;
  experienceLevel?: ExperienceLevel;
  contextDetails?: string;
  useWebSearch: boolean;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
}): Promise<StreamResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Configure-la dans Settings > Secrets.'
    );
  }

  const startedAt = Date.now();
  const ai = getClient(apiKey);
  const moduleLabel =
    BUSINESS_MODULE_LABELS[params.moduleKey] ?? 'Conseil stratégique & création de projet';
  const levelKey: ExperienceLevel =
    params.experienceLevel === 'intermediaire' || params.experienceLevel === 'confirme'
      ? params.experienceLevel
      : 'debutant';
  const levelDescription = EXPERIENCE_LEVEL_LABELS[levelKey];
  const isDocumentModule = DOCUMENT_MODULES.has(params.moduleKey);

  const systemInstruction = `Tu es NOVA AI PRO Mode Business, un consultant senior en entrepreneuriat, finance d'entreprise, marketing, automatisation et stratégie commerciale.

RÈGLES OBLIGATOIRES :
1. Sois réaliste, concret, chiffré et honnête. Ne garantis JAMAIS de revenus ni de promesses de richesse.
2. Adapte précisément tes recommandations au budget déclaré (${params.budgetEur} €), au temps disponible${params.weeklyHours ? ` (${params.weeklyHours}h/semaine)` : ''}, aux compétences déclarées et au niveau de l'utilisateur (${levelDescription}).
3. Ne jamais inventer d'informations administratives ou bancaires (SIRET, IBAN, adresse) : utilise [À COMPLÉTER] si nécessaire.
4. Structure ta réponse en Markdown clair avec ces sections obligatoires :
## 1. Idée & Objectif stratégique
## 2. Client cible & Offre (Prix & Positionnement)
## 3. Budget nécessaire & Coûts détaillés
## 4. Outils & Ressources nécessaires
## 5. Acquisition clients & Stratégie de lancement
## 6. Risques & Scénarios réalistes (sans garantie de revenus)
## 7. Plan d'action concret (7 jours · 30 jours · 90 jours)

${
  isDocumentModule
    ? `Inclus dans la section 7 un modèle complet prêt à copier/adapter (devis, facture avec mentions légales françaises type SIRET/TVA [À COMPLÉTER], ou séquence d'emails B2B professionnelles).`
    : ''
}
5. Réponds exclusivement en français professionnel, directement exploitable.`;

  const prompt = [
    `Module demandé : ${moduleLabel}`,
    `Titre du projet / document : ${params.projectTitle}`,
    `Secteur / Marché : ${params.sector}`,
    `Budget disponible : ${params.budgetEur} €`,
    params.skills ? `Compétences disponibles : ${params.skills}` : '',
    params.weeklyHours ? `Temps disponible par semaine : ${params.weeklyHours} heures` : '',
    `Niveau d'expérience : ${levelDescription}`,
    `Objectif principal : ${params.goal}`,
    params.contextDetails ? `Précisions complémentaires : ${params.contextDetails}` : '',
    `Génère le livrable complet en suivant strictement les 7 sections et en incluant le plan 7, 30 et 90 jours.`,
  ]
    .filter(Boolean)
    .join('\n');

  const contents = [{ role: 'user' as const, parts: [{ text: prompt }] }];

  return runWithResilientGeminiFallback({
    ai,
    contents,
    systemInstruction,
    useWebSearch: params.useWebSearch,
    externalSignal: params.externalSignal,
    callbacks: params.callbacks,
    startedAt,
  });
}

/**
 * Sanitize generated SVG strictly to ensure safe rasterization to PNG
 * and prevent XSS or external network calls inside SVG.
 */
export function sanitizeSvgLogo(rawSvg: string, fallbackName: string, primaryHex: string): string {
  const cleaned = rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .trim();

  const svgMatch = cleaned.match(/<svg[\s\S]*<\/svg>/i);
  if (svgMatch && svgMatch[0].includes('<path') || (svgMatch && svgMatch[0].includes('<circle')) || (svgMatch && svgMatch[0].includes('<rect')) || (svgMatch && svgMatch[0].includes('<polygon'))) {
    let svg = svgMatch[0];
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!/viewBox=/.test(svg)) {
      svg = svg.replace('<svg', '<svg viewBox="0 0 512 512"');
    }
    return svg;
  }

  // Deterministic geometric vector fallback ONLY if model returned invalid markup
  const initials = fallbackName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'NV';
  const safeColor = /^#[0-9A-Fa-f]{6}$/.test(primaryHex) ? primaryHex : '#3B82F6';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="novaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${safeColor}" />
      <stop offset="100%" stop-color="#7C3AED" />
    </linearGradient>
  </defs>
  <rect x="36" y="36" width="440" height="440" rx="96" fill="url(#novaGrad)" />
  <circle cx="256" cy="256" r="154" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="10" />
  <text x="256" y="286" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="144" fill="#FFFFFF" letter-spacing="4">${initials}</text>
</svg>`;
}

function sanitizeWebsiteHtml(rawHtml: string): string {
  let html = rawHtml.trim();
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    html = fenced[1].trim();
  }
  if (!/<html/i.test(html)) {
    html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  }
  return html;
}

/**
 * Generates real structured artifacts for Company Creation:
 * 1. Brand Identity (name, slogan, hex colors, typography, visual rules)
 * 2. Real vector SVG Logo (rasterizable to high-res PNG)
 * 3. Commercial Offer (services, 3 pricing tiers, pitch)
 * 4. Business Plan (financial plan, marketing strategy, 7/30/90 days client acquisition)
 * 5. Real standalone responsive HTML/CSS/JS website
 */
export async function generateCompanyCreationSuite(params: {
  projectTitle: string;
  sector: string;
  budgetEur: number;
  goal: string;
  skills?: string;
  weeklyHours?: number;
  experienceLevel?: ExperienceLevel;
  contextDetails?: string;
}): Promise<{ suite: CompanyCreationResult; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'Clé API Gemini manquante côté serveur (GEMINI_API_KEY). Configure-la dans Settings > Secrets.'
    );
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;

  const prompt = `Tu es un studio complet de création d'entreprise (Brand Designer, Directeur Artistique SVG, Stratège Commercial, Expert Business Plan et Développeur Web Frontend).

Crée un dossier réel et complet en français pour lancer cette entreprise :
- Nom / Idée : ${params.projectTitle}
- Secteur : ${params.sector}
- Budget initial : ${params.budgetEur} €
- Objectif : ${params.goal}
- Compétences : ${params.skills || 'Non précisées'}
- Temps disponible : ${params.weeklyHours ? `${params.weeklyHours}h / semaine` : 'Non précisé'}
- Niveau : ${params.experienceLevel || 'debutant'}
- Précisions : ${params.contextDetails || 'Aucune'}

EXIGENCES STRICTES :
1. brandIdentity :
   - Crée un nom de marque mémorable, un slogan percutant, le positionnement, le ton éditorial, le public cible.
   - Palette de 5 couleurs hexadécimales valides (#RRGGBB) harmonieuses adaptées au secteur.
   - Typographie Google Fonts réelle (displayFont et bodyFont, ex: "Plus Jakarta Sans", "Bricolage Grotesque", "Outfit", "DM Sans", "Playfair Display").
2. logoSvg :
   - Génère un VÉRITABLE logo vectoriel SVG complet (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">...</svg>).
   - Utilise des formes géométriques propres (<path>, <circle>, <rect>, <polygon>, <linearGradient>) formant un emblème de marque moderne, équilibré et centré dans 512x512, avec fond transparent ou badge intégré élégant. Aucun script ni image externe.
3. commercialOffer :
   - Offre claire avec 3 formules tarifaires réalistes (ex: Essentiel, Pro/Standard, Premium) adaptées au marché, avec livrables concrets et délais.
4. businessPlan :
   - Plan financier réaliste basé sur le budget de ${params.budgetEur} €, coûts de démarrage chiffrés, charges mensuelles fixes, prix unitaire, coût variable, seuil de rentabilité cohérent mathématiquement, note prudente précisant explicitement qu'aucun revenu n'est garanti.
   - Stratégie marketing actionnable et plan concret d'acquisition des premiers clients sur 7, 30 et 90 jours.
5. websiteHtml :
   - Code HTML5 complet autonome (<!doctype html>...) avec CSS moderne embarqué dans <style>, polices Google Fonts, design responsive (mobile + desktop), navigation fluide, section Hero avec nom & slogan, section Services & Tarifs reprenant les 3 offres, section À propos / Méthode, formulaire de contact fonctionnel côté client (sans rechargement de page, avec message de confirmation visuel), et footer. Utilise les couleurs exactes de brandIdentity.`;

  const callGenerate = async (targetModel: string) =>
    ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        thinkingConfig: {
          thinkingLevel:
            targetModel === GEMINI_MODELS.fallback
              ? ThinkingLevel.MINIMAL
              : ThinkingLevel.LOW,
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brandIdentity: {
              type: Type.OBJECT,
              properties: {
                brandName: { type: Type.STRING },
                slogan: { type: Type.STRING },
                positioning: { type: Type.STRING },
                toneOfVoice: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                colors: {
                  type: Type.OBJECT,
                  properties: {
                    primary: { type: Type.STRING },
                    secondary: { type: Type.STRING },
                    accent: { type: Type.STRING },
                    background: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                },
                typography: {
                  type: Type.OBJECT,
                  properties: {
                    displayFont: { type: Type.STRING },
                    bodyFont: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                  },
                },
                visualGuidelines: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
            },
            logoSvg: { type: Type.STRING },
            commercialOffer: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                valueProposition: { type: Type.STRING },
                packages: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      priceLabel: { type: Type.STRING },
                      targetClient: { type: Type.STRING },
                      deliverables: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      timeline: { type: Type.STRING },
                    },
                  },
                },
                salesPitch: { type: Type.STRING },
              },
            },
            businessPlan: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                financialPlan: {
                  type: Type.OBJECT,
                  properties: {
                    startupCostsEur: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          item: { type: Type.STRING },
                          amountEur: { type: Type.NUMBER },
                        },
                      },
                    },
                    monthlyFixedCostsEur: { type: Type.NUMBER },
                    unitPriceEur: { type: Type.NUMBER },
                    unitVariableCostEur: { type: Type.NUMBER },
                    breakEvenClientsPerMonth: { type: Type.NUMBER },
                    prudentScenarioNote: { type: Type.STRING },
                  },
                },
                marketingStrategy: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                firstClientsPlan: {
                  type: Type.OBJECT,
                  properties: {
                    days7: { type: Type.ARRAY, items: { type: Type.STRING } },
                    days30: { type: Type.ARRAY, items: { type: Type.STRING } },
                    days90: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
                keyRisks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
            },
            websiteHtml: { type: Type.STRING },
          },
        },
      },
    });

  let response;
  let usedModel: string = model;
  try {
    response = await callGenerate(model);
  } catch (err) {
    if (model === GEMINI_MODELS.primary && isTransientError(err)) {
      tripPrimaryCooldown(err);
      usedModel = GEMINI_MODELS.fallback;
      response = await callGenerate(GEMINI_MODELS.fallback);
    } else {
      throw err;
    }
  }

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error("Le moteur IA n'a renvoyé aucune donnée structurée.");
  }

  const parsed = JSON.parse(rawText) as CompanyCreationResult;
  const brandName = parsed.brandIdentity?.brandName?.trim() || params.projectTitle;
  const primaryHex = parsed.brandIdentity?.colors?.primary || '#3B82F6';

  const cleanSvg = sanitizeSvgLogo(parsed.logoSvg || '', brandName, primaryHex);
  let cleanHtml = sanitizeWebsiteHtml(parsed.websiteHtml || '');

  // Inject the real SVG logo cleanly into website if it lacks an <svg> brand mark
  if (cleanHtml && !/<svg[\s\S]*<\/svg>/i.test(cleanHtml)) {
    cleanHtml = cleanHtml.replace(
      /<header([^>]*)>/i,
      `<header$1><div style="display:inline-flex;align-items:center;gap:10px;"><span style="display:inline-block;width:36px;height:36px;">${cleanSvg}</span></div>`
    );
  }

  return {
    suite: {
      ...parsed,
      logoSvg: cleanSvg,
      websiteHtml: cleanHtml,
    },
    modelUsed: usedModel,
  };
}

export async function generateLogoSvgOnly(params: {
  brandName: string;
  sector: string;
  primaryColor: string;
  secondaryColor: string;
  styleHint?: string;
}): Promise<{ logoSvg: string; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante côté serveur (GEMINI_API_KEY).');
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;

  const prompt = `Crée un logo vectoriel SVG minimaliste, moderne et mémorable pour la marque "${params.brandName}" (secteur : ${params.sector}).
Couleurs : primaire ${params.primaryColor}, secondaire ${params.secondaryColor}.
Style demandé : ${params.styleHint || 'Emblème géométrique épuré de niveau studio design'}.
Retourne uniquement un JSON avec la propriété "logoSvg" contenant un SVG valide viewBox="0 0 512 512" (sans script, sans lien externe, géométrie nette et équilibrée).`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          logoSvg: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as { logoSvg?: string };
  return {
    logoSvg: sanitizeSvgLogo(parsed.logoSvg || '', params.brandName, params.primaryColor),
    modelUsed: model,
  };
}

export async function regenerateWebsiteHtmlOnly(params: {
  brandName: string;
  slogan: string;
  sector: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  packagesText: string;
  logoSvg: string;
  customInstructions?: string;
}): Promise<{ websiteHtml: string; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante côté serveur (GEMINI_API_KEY).');
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;

  const prompt = `Développe une page web HTML5 complète, autonome, responsive et professionnelle en français pour :
- Marque : ${params.brandName}
- Slogan : ${params.slogan}
- Secteur : ${params.sector}
- Palette : Primaire ${params.primaryColor}, Secondaire ${params.secondaryColor}, Accent ${params.accentColor}
- Offres & tarifs : ${params.packagesText}
- Directives spécifiques : ${params.customInstructions || 'Design épuré, sections Hero, Services/Tarifs, Méthode, Preuve/Engagements, Formulaire de contact interactif avec confirmation JS, Footer.'}

Retourne un JSON { "websiteHtml": "<!doctype html>..." }.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          websiteHtml: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as { websiteHtml?: string };
  let html = sanitizeWebsiteHtml(parsed.websiteHtml || '');
  if (params.logoSvg && !/<svg[\s\S]*<\/svg>/i.test(html)) {
    html = html.replace(
      /<body([^>]*)>/i,
      `<body$1><div style="display:none" aria-hidden="true">${params.logoSvg}</div>`
    );
  }
  return { websiteHtml: html, modelUsed: model };
}

export async function generateMarketingContent(params: {
  formatKey: string;
  topic: string;
  targetAudience: string;
  tone: string;
  callToAction?: string;
}): Promise<{ content: string; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante côté serveur (GEMINI_API_KEY).');
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;

  const formatLabels: Record<string, string> = {
    tiktok_script: 'Script TikTok percutant (accroche 3s, corps, CTA)',
    short_video: 'Script Vidéo Courte (Reels / YouTube Shorts)',
    instagram_post: 'Publication Instagram (carrousel ou légende engageante + hashtags pertinents)',
    facebook_post: 'Publication Facebook orientée engagement & conversion',
    linkedin_post: 'Post LinkedIn B2B structuré à forte valeur ajoutée',
    ad_copy: 'Annonces publicitaires (Meta Ads / Google Ads avec 3 variantes de titres & textes)',
    slogans: 'Liste de 10 slogans et accroches de marque différenciants',
    marketing_email: 'Email marketing / prospection structuré (objet, corps, relance)',
    product_description: 'Fiche et description de produit orientée bénéfices & conversion',
    editorial_calendar: 'Calendrier éditorial concret sur 14 jours (thèmes, formats, objectifs)',
  };

  const label = formatLabels[params.formatKey] || 'Contenu marketing professionnel';
  const prompt = `Tu es un directeur de création et copywriter senior francophone.
Génère directement le contenu prêt à publier/éditer pour :
- Format : ${label}
- Sujet / Produit / Offre : ${params.topic}
- Public cible : ${params.targetAudience || 'Entrepreneurs et clients francophones'}
- Ton souhaité : ${params.tone || 'Professionnel, direct et authentique'}
- Appel à l'action : ${params.callToAction || 'Découvrir l’offre / Prendre contact'}

Sois concret, structuré en Markdown propre, sans blabla introductif inutile.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Contenu vide retourné par Gemini.');
  }
  return { content: text, modelUsed: model };
}

export async function generateVideoStoryboard(params: {
  topic: string;
  format: '9:16' | '16:9';
  tone: string;
  durationTargetSec: number;
  sourceScript?: string;
}): Promise<{ storyboard: VideoStoryboard; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante côté serveur (GEMINI_API_KEY).');
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;
  const sceneCount = params.durationTargetSec >= 40 ? 6 : 4;

  const prompt = `Tu es réalisateur et monteur vidéo senior.
Crée un storyboard vidéo réel et prêt pour le rendu Canvas/WebM en français :
- Sujet / Script : ${params.sourceScript || params.topic}
- Format : ${params.format} (${params.format === '9:16' ? 'Vertical TikTok/Reels/Shorts' : 'Horizontal YouTube/Web'})
- Ton : ${params.tone}
- Nombre de scènes : ${sceneCount} (durée totale proche de ${params.durationTargetSec}s)

Chaque scène doit avoir :
- id (ex: "scene-1")
- title (court titre de la scène)
- shotType (ex: "Plan serré", "Plan large dynamique", "Texte cinétique", "Démonstration")
- visualDirection (description précise du visuel)
- onScreenText (texte court lisible à l'écran, max 8 mots)
- voiceover (texte exact de la voix off en français naturel)
- subtitle (sous-titre court synchronisé)
- durationSec (nombre entier entre 3 et 10)
- accentColor (couleur hexadécimale ex: "#3B82F6" ou "#7C3AED")`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          format: { type: Type.STRING },
          hook: { type: Type.STRING },
          callToAction: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                shotType: { type: Type.STRING },
                visualDirection: { type: Type.STRING },
                onScreenText: { type: Type.STRING },
                voiceover: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                durationSec: { type: Type.NUMBER },
                accentColor: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as VideoStoryboard;
  const normalizedScenes = (parsed.scenes || []).map((s, idx) => ({
    id: s.id || `scene-${idx + 1}`,
    title: s.title || `Scène ${idx + 1}`,
    shotType: s.shotType || 'Plan dynamique',
    visualDirection: s.visualDirection || '',
    onScreenText: s.onScreenText || params.topic.slice(0, 48),
    voiceover: s.voiceover || s.subtitle || '',
    subtitle: s.subtitle || s.voiceover || '',
    durationSec: Math.max(2, Math.min(15, Math.round(Number(s.durationSec) || 5))),
    accentColor: /^#[0-9A-Fa-f]{6}$/.test(s.accentColor || '') ? s.accentColor : '#3B82F6',
  }));

  return {
    storyboard: {
      title: parsed.title || params.topic.slice(0, 60),
      format: params.format,
      hook: parsed.hook || '',
      callToAction: parsed.callToAction || '',
      scenes: normalizedScenes,
    },
    modelUsed: model,
  };
}

export async function generateStructuredDocument(params: {
  docType: string;
  title: string;
  companyName?: string;
  clientName?: string;
  context: string;
}): Promise<{ contentMarkdown: string; modelUsed: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante côté serveur (GEMINI_API_KEY).');
  }

  const ai = getClient(apiKey);
  const model = isPrimaryHealthy() ? GEMINI_MODELS.primary : GEMINI_MODELS.fallback;

  const prompt = `Rédige un document professionnel complet en Markdown en français.
Type de document : ${params.docType}
Titre : ${params.title}
Émetteur fourni : ${params.companyName || '[À COMPLÉTER — Raison sociale]'}
Destinataire fourni : ${params.clientName || '[À COMPLÉTER — Nom du client]'}
Contexte et détails fournis par l'utilisateur :
${params.context}

RÈGLE DE SÉCURITÉ & FIABILITÉ ABSOLUE :
Ne JAMAIS inventer de numéro SIRET, SIREN, TVA intracommunautaire, IBAN, BIC, adresse postale, téléphone ou email s'ils n'ont pas été fournis ci-dessus. Indique explicitement [À COMPLÉTER] pour toute information administrative ou bancaire manquante.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Document vide retourné par Gemini.');
  }
  return { contentMarkdown: text, modelUsed: model };
}
