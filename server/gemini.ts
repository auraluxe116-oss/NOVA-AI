import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { PlanTier, SourceLink } from './types.js';

export const GEMINI_MODELS = {
  primary: 'gemini-4-hydrogen',
  fallback: 'gemini-3.1-flash-lite',
} as const;

const TTFT_PRIMARY_MS = 5_500;
const TTFT_FALLBACK_MS = 14_000;
const STREAM_INACTIVITY_MS = 35_000;
const COOLDOWN_MS = 90_000;

let primaryCooldownUntil = 0;

function isPrimaryHealthy(): boolean {
  return Date.now() >= primaryCooldownUntil;
}

function tripPrimaryCooldown(reason: unknown): void {
  primaryCooldownUntil = Date.now() + COOLDOWN_MS;
  console.warn(
    `[NOVA AI] Bascule temporaire vers ${GEMINI_MODELS.fallback} pendant 90s :`,
    reason instanceof Error ? reason.message : String(reason)
  );
}

export function getGeminiApiKey(): string | null {
  const raw = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY') return null;
  return raw;
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
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
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
        "Clé API Gemini invalide ou non autorisée. Vérifie GEMINI_API_KEY dans les paramètres Secrets.",
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      code: 'AI_RATE_LIMIT',
      message:
        "L'API IA atteint temporairement sa limite de requêtes. Patiente quelques secondes avant de réessayer.",
    };
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
    return {
      status: 503,
      code: 'AI_BUSY',
      message:
        'Le serveur IA est momentanément saturé. Réessaie dans un court instant.',
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

const GENERAL_SYSTEM_INSTRUCTION = `Tu es NOVA AI, une intelligence artificielle conversationnelle professionnelle francophone.

RÈGLES DE FIABILITÉ ET D'HONNÊTETÉ STRICTES :
1. Ne jamais inventer de faits, chiffres, dates, lois, statistiques, citations ou URLs.
2. Si tu ne sais pas ou si une donnée ne peut pas être vérifiée avec certitude, dis-le clairement et sans détour.
3. Distingue explicitement les faits vérifiés des hypothèses, estimations ou scénarios.
4. Si l'utilisateur relève une erreur dans une de tes réponses, reconnais-la franchement et corrige-la immédiatement.
5. Comprends l'intention réelle même si la question est mal formulée, abrégée ou comporte des fautes.
6. Réponds en français naturel, clair, structuré (titres courts, listes lisibles, blocs de code propres si technique). Adapte la profondeur à la demande : concis pour une question simple, complet et structuré pour un sujet complexe.`;

export interface ChatTurnInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onModelSelected?: (model: string) => void;
}

export interface StreamResult {
  fullText: string;
  sources: SourceLink[];
  modelUsed: string;
  latencyMs: number;
}

async function streamOnceWithModel(params: {
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

export async function streamConversationResponse(params: {
  history: ChatTurnInput[];
  userMessage: string;
  attachment?: { name: string; content: string } | null;
  useWebSearch: boolean;
  plan: PlanTier;
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

  // Keep bounded conversation context for maximum speed & low latency (last 10 turns)
  const boundedHistory = params.history.slice(-10).map((turn) => ({
    role: (turn.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: turn.content.slice(0, 4000) }],
  }));

  const finalUserPrompt = params.attachment
    ? `[Document joint : ${params.attachment.name}]\n\nContenu du document :\n"""\n${params.attachment.content}\n"""\n\nDemande de l'utilisateur :\n${params.userMessage}`
    : params.userMessage;

  const contents = [
    ...boundedHistory,
    { role: 'user' as const, parts: [{ text: finalUserPrompt }] },
  ];

  const enableSearch = params.useWebSearch || shouldAutoEnableWebSearch(params.userMessage);
  const tryOrder: Array<{ model: string; ttftMs: number }> = isPrimaryHealthy()
    ? [
        { model: GEMINI_MODELS.primary, ttftMs: TTFT_PRIMARY_MS },
        { model: GEMINI_MODELS.fallback, ttftMs: TTFT_FALLBACK_MS },
      ]
    : [{ model: GEMINI_MODELS.fallback, ttftMs: TTFT_FALLBACK_MS }];

  let lastError: unknown;
  let emittedAnyDelta = false;

  for (let i = 0; i < tryOrder.length; i += 1) {
    const candidate = tryOrder[i];
    if (!candidate) continue;

    try {
      params.callbacks.onModelSelected?.(candidate.model);
      const res = await streamOnceWithModel({
        ai,
        model: candidate.model,
        contents,
        systemInstruction: GENERAL_SYSTEM_INSTRUCTION,
        useWebSearch: enableSearch,
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
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg === 'CLIENT_ABORTED') {
        throw err;
      }
      // If we haven't streamed partial text yet and failure is transient or TTFT timeout, fail over immediately
      if (!emittedAnyDelta && i < tryOrder.length - 1 && (isTransientError(err) || rawMsg.includes('TTFT_TIMEOUT'))) {
        if (candidate.model === GEMINI_MODELS.primary) {
          tripPrimaryCooldown(err);
        }
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

const BUSINESS_MODULE_LABELS: Record<string, string> = {
  business_ideas: "Génération d'idées de business rentables et réalistes",
  zero_budget: 'Création de business avec 0 € de budget initial',
  business_plan: 'Rédaction de Business Plan complet',
  find_clients: 'Stratégie de prospection et acquisition de clients',
  marketing_strategy: 'Stratégie marketing & positionnement multicanal',
  brand_creation: 'Création de marque, identité et offre différenciante',
  ecommerce_store: 'Création et lancement de boutique en ligne (e-commerce)',
  competitor_analysis: 'Analyse concurrentielle et avantages comparatifs',
  costs_margins: 'Structuration des coûts, pricing et marges nettes',
  sales_strategy: 'Tunnel de conversion et stratégie de vente',
  low_budget_growth: 'Croissance organique à petit budget',
  action_plan: "Plan d'exécution opérationnel étape par étape",
  company_creation: "Accompagnement complet création d'entreprise & étude de marché",
};

export async function streamBusinessProject(params: {
  moduleKey: string;
  projectTitle: string;
  sector: string;
  budgetEur: number;
  goal: string;
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

  const systemInstruction = `Tu es NOVA AI Mode Business, un consultant senior en entrepreneuriat, finance d'entreprise, marketing et stratégie commerciale.

RÈGLES OBLIGATOIRES :
1. Sois réaliste, concret, chiffré et honnête. Ne fais JAMAIS de promesses de richesse ni de revenus garantis.
2. Chaque analyse doit impérativement contenir ces 7 sections exactes dans l'ordre, en Markdown clair :
## 1. L'objectif
## 2. Le budget nécessaire
## 3. Les outils nécessaires
## 4. Les étapes de réalisation
## 5. Les risques
## 6. Les possibilités de revenus
## 7. Un plan d'action concret

3. Dans la section 6 (Les possibilités de revenus), précise explicitement qu'aucun gain n'est garanti et distingue clairement hypothèses prudentes et scénarios réalistes.
4. Dans la section 2, respecte scrupuleusement le budget indiqué par l'utilisateur (${params.budgetEur} €) et détaille les postes de dépenses ou alternatives gratuites si le budget est de 0 €.
5. Réponds exclusivement en français professionnel, actionnable et structuré.`;

  const prompt = [
    `Module demandé : ${moduleLabel}`,
    `Titre du projet : ${params.projectTitle}`,
    `Secteur / Marché : ${params.sector}`,
    `Budget disponible : ${params.budgetEur} €`,
    `Objectif principal : ${params.goal}`,
    params.contextDetails ? `Précisions complémentaires : ${params.contextDetails}` : '',
    `Génère l'étude complète et actionnable en suivant strictement les 7 sections obligatoires.`,
  ]
    .filter(Boolean)
    .join('\n');

  const contents = [{ role: 'user' as const, parts: [{ text: prompt }] }];
  const tryOrder: Array<{ model: string; ttftMs: number }> = isPrimaryHealthy()
    ? [
        { model: GEMINI_MODELS.primary, ttftMs: TTFT_PRIMARY_MS },
        { model: GEMINI_MODELS.fallback, ttftMs: TTFT_FALLBACK_MS },
      ]
    : [{ model: GEMINI_MODELS.fallback, ttftMs: TTFT_FALLBACK_MS }];

  let lastError: unknown;
  let emittedAnyDelta = false;

  for (let i = 0; i < tryOrder.length; i += 1) {
    const candidate = tryOrder[i];
    if (!candidate) continue;

    try {
      params.callbacks.onModelSelected?.(candidate.model);
      const res = await streamOnceWithModel({
        ai,
        model: candidate.model,
        contents,
        systemInstruction,
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
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg === 'CLIENT_ABORTED') throw err;
      if (!emittedAnyDelta && i < tryOrder.length - 1 && (isTransientError(err) || rawMsg.includes('TTFT_TIMEOUT'))) {
        if (candidate.model === GEMINI_MODELS.primary) {
          tripPrimaryCooldown(err);
        }
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
