import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ExperienceLevel, PlanTier, SourceLink } from './types.js';

export const GEMINI_MODELS = {
  primary: 'gemini-4-hydrogen',
  fallback: 'gemini-3.5-flash-lite',
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

const GENERAL_SYSTEM_INSTRUCTION = `Tu es NOVA AI PRO, une intelligence artificielle conversationnelle professionnelle francophone.

RÈGLES DE FIABILITÉ ET D'HONNÊTETÉ STRICTES :
1. Ne jamais inventer de faits, chiffres, dates, lois, statistiques, citations ou URLs.
2. Si tu ne sais pas ou si une donnée ne peut pas être vérifiée avec certitude, dis-le clairement.
3. Distingue les faits vérifiés des hypothèses et estimations.
4. Si l'utilisateur relève une erreur, reconnais-la et corrige-la.
5. Comprends les demandes même si elles comportent des fautes.
6. Réponds en français naturel, clair et structuré.

EXPERTISE :
- Business, entrepreneuriat et marketing.
- Création de sites Internet et applications.
- Intelligence artificielle et automatisation.
- Organisation, productivité et stratégie commerciale.
- Explications administratives et financières prudentes.

MÉTHODE :
1. Comprends l'objectif de l'utilisateur.
2. Adapte tes conseils à son budget et à son niveau.
3. Donne des étapes concrètes et faciles à suivre.
4. Pour les informations récentes, utilise la recherche Internet lorsqu'elle est disponible.
5. Privilégie les sources officielles.
6. Ne garantis jamais des revenus ou des résultats.
7. Ne prétends jamais avoir effectué une action que tu n'as pas réalisée.

Ton objectif est de fournr des réponses fiables, utiles, professionnelles et directement applicables.`;

export interface ChatTurnInput {
  role: 'user' | 'assistant';
  content: string;
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

async function runWithResilientFallback(params: {
  ai: GoogleGenAI;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  useWebSearch: boolean;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
  startedAt: number;
}): Promise<StreamResult> {
  const tryOrder: Array<{ model: string; ttftMs: number; label: string }> = isPrimaryHealthy()
    ? [
        {
          model: GEMINI_MODELS.primary,
          ttftMs: TTFT_PRIMARY_MS,
          label: 'NOVA réfléchit...',
        },
        {
          model: GEMINI_MODELS.fallback,
          ttftMs: TTFT_FALLBACK_MS,
          label: 'Reconnexion automatique sur le moteur rapide...',
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

    // Up to 2 quick attempts on the fallback candidate if a transient glitch happens before first token
    const maxAttempts = i === tryOrder.length - 1 ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (i > 0 || attempt > 0) {
          params.callbacks.onStatus?.(candidate.label);
        }
        params.callbacks.onModelSelected?.(candidate.model);
        const res = await streamOnceWithModel({
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
        const canRecover =
          !emittedAnyDelta && (isTransientError(err) || rawMsg.includes('TTFT_TIMEOUT'));
        if (canRecover && attempt + 1 < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 350));
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

  // Keep bounded recent conversation context for high relevance & low latency (last 14 turns)
  const boundedHistory = params.history.slice(-14).map((turn) => ({
    role: (turn.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: turn.content.slice(0, 4500) }],
  }));

  const finalUserPrompt = params.attachment
    ? `[Document joint : ${params.attachment.name}]\n\nContenu du document :\n"""\n${params.attachment.content}\n"""\n\nDemande de l'utilisateur :\n${params.userMessage}`
    : params.userMessage;

  const contents = [
    ...boundedHistory,
    { role: 'user' as const, parts: [{ text: finalUserPrompt }] },
  ];

  const enableSearch = params.useWebSearch || shouldAutoEnableWebSearch(params.userMessage);

  return runWithResilientFallback({
    ai,
    contents,
    systemInstruction: GENERAL_SYSTEM_INSTRUCTION,
    useWebSearch: enableSearch,
    externalSignal: params.externalSignal,
    callbacks: params.callbacks,
    startedAt,
  });
}

export const BUSINESS_MODULE_LABELS: Record<string, string> = {
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
  commercial_proposal: 'Rédaction de proposition commerciale & devis structuré',
  invoice_billing: 'Modèle de facture professionnelle, conditions & relance client',
  professional_texts: 'Textes professionnels, emails B2B et argumentaires commerciaux',
  company_creation: "Accompagnement complet création d'entreprise & étude de marché",
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
  'commercial_proposal',
  'invoice_billing',
  'professional_texts',
]);

export async function streamBusinessProject(params: {
  moduleKey: string;
  projectTitle: string;
  sector: string;
  budgetEur: number;
  goal: string;
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

  const systemInstruction = `Tu es NOVA AI Mode Business, un consultant senior en entrepreneuriat, finance d'entreprise, marketing, facturation et stratégie commerciale.

RÈGLES OBLIGATOIRES :
1. Sois réaliste, concret, chiffré et honnête. Ne fais JAMAIS de promesses de richesse ni de revenus garantis.
2. Adapte précisément tes conseils au budget déclaré (${params.budgetEur} €) et au niveau de l'utilisateur (${levelDescription}).
3. Chaque analyse doit impérativement contenir ces 7 sections exactes dans l'ordre, en Markdown clair :
## 1. L'objectif
## 2. Le budget nécessaire
## 3. Les outils nécessaires
## 4. Les étapes de réalisation
## 5. Les risques
## 6. Les possibilités de revenus
## 7. Un plan d'action concret

4. Dans la section 6 (Les possibilités de revenus), précise explicitement qu'aucun gain n'est garanti et distingue clairement hypothèses prudentes et scénarios réalistes.
5. Dans la section 2, respecte scrupuleusement le budget indiqué (${params.budgetEur} €) et propose des alternatives gratuites si le budget est de 0 €.
${
  isDocumentModule
    ? `6. Comme il s'agit d'un module de rédaction commerciale/facturation, inclus dans la section 7 ("## 7. Un plan d'action concret") un modèle complet prêt à copier/adapter (proposition commerciale, modèle de facture avec mentions obligatoires françaises type SIRET/TVA/conditions de paiement, ou séquences d'emails B2B professionnelles) immédiatement exploitable.`
    : ''
}
7. Réponds exclusivement en français professionnel, actionnable et structuré.`;

  const prompt = [
    `Module demandé : ${moduleLabel}`,
    `Titre du projet / document : ${params.projectTitle}`,
    `Secteur / Marché : ${params.sector}`,
    `Budget disponible : ${params.budgetEur} €`,
    `Niveau de l'utilisateur : ${levelDescription}`,
    `Objectif principal : ${params.goal}`,
    params.contextDetails ? `Précisions complémentaires : ${params.contextDetails}` : '',
    `Génère l'étude complète et actionnable en suivant strictement les 7 sections obligatoires.`,
  ]
    .filter(Boolean)
    .join('\n');

  const contents = [{ role: 'user' as const, parts: [{ text: prompt }] }];

  return runWithResilientFallback({
    ai,
    contents,
    systemInstruction,
    useWebSearch: params.useWebSearch,
    externalSignal: params.externalSignal,
    callbacks: params.callbacks,
    startedAt,
  });
}
