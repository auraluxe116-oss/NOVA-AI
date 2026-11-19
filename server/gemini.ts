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
const GENERATE_TIMEOUT_MS = 35_000;
const COOLDOWN_MS = 90_000;
const DEFAULT_RETRY_BASE_MS = 600;
const MAX_AUTO_RETRY_WAIT_MS = 10_000;

let primaryCooldownUntil = 0;
let fallbackCooldownUntil = 0;

function isPrimaryHealthy(): boolean {
  return Date.now() >= primaryCooldownUntil;
}

function isFallbackHealthy(): boolean {
  return Date.now() >= fallbackCooldownUntil;
}

function tripPrimaryCooldown(reason: unknown): void {
  primaryCooldownUntil = Date.now() + COOLDOWN_MS;
  console.warn(
    `[NOVA AI PRO] Bascule temporaire depuis ${GEMINI_MODELS.primary} pendant 90s :`,
    reason instanceof Error ? reason.message : String(reason)
  );
}

function tripFallbackCooldown(reason: unknown): void {
  fallbackCooldownUntil = Date.now() + COOLDOWN_MS;
  console.warn(
    `[NOVA AI PRO] Modèle de secours indisponible temporairement pendant 90s :`,
    reason instanceof Error ? reason.message : String(reason)
  );
}

export function resetGeminiHealthStateForTests(): void {
  primaryCooldownUntil = 0;
  fallbackCooldownUntil = 0;
}

export function resolveConfiguredFallbackModel(activeModel: string): string | null {
  if (!getGeminiApiKey()) return null;

  const envOverride = process.env.GEMINI_FALLBACK_MODEL?.trim();
  if (envOverride !== undefined) {
    const lower = envOverride.toLowerCase();
    if (!envOverride || lower === 'none' || lower === 'off' || lower === 'false' || lower === 'disabled') {
      return null;
    }
    if (
      envOverride !== GEMINI_MODELS.primary &&
      envOverride !== GEMINI_MODELS.fallback
    ) {
      return null;
    }
    if (envOverride === activeModel) return null;
    return isFallbackHealthy() ? envOverride : null;
  }

  if (activeModel !== GEMINI_MODELS.primary) {
    return null;
  }

  return isFallbackHealthy() ? GEMINI_MODELS.fallback : null;
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

export type GeminiErrorCategory =
  | 'aborted'
  | 'quota_exhausted'
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'model_unavailable'
  | 'unknown';

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  httpStatus: number | null;
  retryAfterMs: number | null;
  rawMessage: string;
}

function readHeaderValue(headers: unknown, key: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const target = key.toLowerCase();
  if ('get' in headers && typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get: (k: string) => unknown }).get(key) ??
      (headers as { get: (k: string) => unknown }).get(target);
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }
  const record = headers as Record<string, unknown>;
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === target && v !== undefined && v !== null) {
      const str = String(v).trim();
      if (str) return str;
    }
  }
  return null;
}

export function extractRetryAfterMs(err: unknown): number | null {
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const rawHeader =
    readHeaderValue(errObj?.headers, 'retry-after') ??
    readHeaderValue((errObj?.response as Record<string, unknown> | undefined)?.headers, 'retry-after') ??
    readHeaderValue((errObj?.cause as Record<string, unknown> | undefined)?.headers, 'retry-after');

  if (rawHeader) {
    const numeric = Number(rawHeader);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.round(numeric * 1000);
    }
    const parsedDate = Date.parse(rawHeader);
    if (!Number.isNaN(parsedDate)) {
      return Math.max(0, parsedDate - Date.now());
    }
  }

  const rawText = err instanceof Error ? err.message : String(err);
  const secMatch =
    rawText.match(/retry[-_\s]?after\s*[:=]\s*["']?(\d+(?:\.\d+)?)\s*s?/i) ||
    rawText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i) ||
    rawText.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch && secMatch[1]) {
    const sec = Number(secMatch[1]);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.round(sec * 1000);
    }
  }

  return null;
}

export function extractHttpStatus(err: unknown): number | null {
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const candidates = [
    errObj?.status,
    errObj?.statusCode,
    (errObj?.response as Record<string, unknown> | undefined)?.status,
    (errObj?.cause as Record<string, unknown> | undefined)?.status,
    typeof errObj?.code === 'number' ? errObj.code : null,
  ];
  for (const val of candidates) {
    if (typeof val === 'number' && val >= 100 && val <= 599) {
      return val;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/\b(401|403|404|408|429|500|502|503|504)\b/);
  if (statusMatch && statusMatch[1]) {
    return Number(statusMatch[1]);
  }
  return null;
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();
  const httpStatus = extractHttpStatus(err);
  const retryAfterMs = extractRetryAfterMs(err);

  if (
    rawMessage === 'CLIENT_ABORTED' ||
    (err instanceof Error && err.name === 'AbortError' && !lower.includes('timeout'))
  ) {
    return { category: 'aborted', httpStatus, retryAfterMs, rawMessage };
  }

  if (
    lower.includes('ttft_timeout') ||
    lower.includes('stream_timeout') ||
    lower.includes('generate_timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('timeout') ||
    httpStatus === 408 ||
    httpStatus === 504
  ) {
    return { category: 'timeout', httpStatus: httpStatus ?? 504, retryAfterMs, rawMessage };
  }

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthorized')
  ) {
    return { category: 'auth', httpStatus: httpStatus ?? 403, retryAfterMs, rawMessage };
  }

  if (
    httpStatus === 404 ||
    lower.includes('model not found') ||
    lower.includes('is not found for api version') ||
    lower.includes('is not supported for')
  ) {
    return { category: 'model_unavailable', httpStatus: 404, retryAfterMs, rawMessage };
  }

  if (
    httpStatus === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit')
  ) {
    const hasHardQuotaSignal =
      lower.includes('exceeded your current quota') ||
      lower.includes('quota exceeded') ||
      lower.includes('insufficient quota') ||
      lower.includes('billing') ||
      lower.includes('limit: 0') ||
      lower.includes('per_day') ||
      lower.includes('per day') ||
      lower.includes('daily') ||
      lower.includes('free_tier') ||
      (retryAfterMs !== null && retryAfterMs > MAX_AUTO_RETRY_WAIT_MS);

    return {
      category: hasHardQuotaSignal ? 'quota_exhausted' : 'rate_limit',
      httpStatus: 429,
      retryAfterMs,
      rawMessage,
    };
  }

  if (
    httpStatus === 503 ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable')
  ) {
    return { category: 'unavailable', httpStatus: 503, retryAfterMs, rawMessage };
  }

  if (
    httpStatus === 502 ||
    lower.includes('econnreset') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('socket hang up')
  ) {
    return { category: 'network', httpStatus: httpStatus ?? 503, retryAfterMs, rawMessage };
  }

  return { category: 'unknown', httpStatus, retryAfterMs, rawMessage };
}

export function mapGeminiErrorMessage(err: unknown): {
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number;
} {
  const classified = classifyGeminiError(err);
  const retryAfterSec =
    classified.retryAfterMs !== null && classified.retryAfterMs > 0
      ? Math.max(1, Math.ceil(classified.retryAfterMs / 1000))
      : undefined;

  switch (classified.category) {
    case 'timeout':
      return {
        status: 504,
        code: 'AI_TIMEOUT',
        retryAfterSec,
        message:
          "Le délai d'attente du moteur Gemini a été dépassé (timeout). Votre message a été conservé : cliquez sur Réessayer.",
      };
    case 'auth':
      return {
        status: 403,
        code: 'AI_AUTH_ERROR',
        message:
          'Clé API IA invalide, expirée ou non autorisée (HTTP 401/403). Vérifiez la clé dans Settings > Secrets.',
      };
    case 'quota_exhausted':
      return {
        status: 429,
        code: 'AI_QUOTA_EXHAUSTED',
        retryAfterSec,
        message: retryAfterSec
          ? `Quota de l'API Gemini épuisé pour le moment (HTTP 429 — délai indiqué : ${retryAfterSec}s). Patientez jusqu'au renouvellement du quota ou utilisez une clé/capacité API adaptée.`
          : "Quota de l'API Gemini épuisé pour le moment (HTTP 429). Aucune relance en boucle n'est effectuée : patientez jusqu'au renouvellement du quota ou utilisez une clé/capacité API adaptée.",
      };
    case 'rate_limit':
      return {
        status: 429,
        code: 'AI_RATE_LIMIT',
        retryAfterSec,
        message: retryAfterSec
          ? `Limite temporaire de débit atteinte chez Gemini (HTTP 429). Patientez environ ${retryAfterSec} seconde(s) avant de cliquer sur Réessayer.`
          : "Limite temporaire de débit atteinte chez le fournisseur IA (HTTP 429). Aucun blocage interne NOVA n'est actif : patientez quelques secondes puis cliquez sur Réessayer.",
      };
    case 'unavailable':
      return {
        status: 503,
        code: 'AI_BUSY',
        retryAfterSec,
        message: retryAfterSec
          ? `Le moteur Gemini est momentanément saturé (HTTP 503). Réessayez dans ${retryAfterSec} seconde(s).`
          : 'Le moteur Gemini est momentanément saturé ou indisponible (HTTP 503). Réessayez dans un court instant.',
      };
    case 'model_unavailable':
      return {
        status: 503,
        code: 'AI_MODEL_UNAVAILABLE',
        message:
          'Le modèle Gemini demandé est indisponible pour cette configuration API. Sélectionnez un autre modèle disponible.',
      };
    case 'network':
      return {
        status: 503,
        code: 'AI_NETWORK_ERROR',
        message:
          'Erreur réseau temporaire lors de la connexion au moteur Gemini. Votre message a été conservé : cliquez sur Réessayer.',
      };
    default:
      return {
        status: 500,
        code: 'AI_ERROR',
        message: `Le moteur IA n'a pas pu finaliser la réponse : ${classified.rawMessage}`,
      };
  }
}

export function shouldAutoEnableWebSearch(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(2025|2026|aujourd'hui|actualit[ée]|r[ée]cent|prix actuel|taux actuel|loi|r[ée]glementation|statistique|chiffre officiel|source|v[ée]rifie|cours du|bourses?)\b/.test(
    lower
  );
}

const GENERAL_SYSTEM_INSTRUCTION = `Tu es NOVA AI PRO, une intelligence artificielle professionnelle spécialisée dans le business, l'entrepreneuriat, la stratégie commerciale et la productivité.

DOMAINES D'EXPERTISE PRINCIPAUX :
1. Création d'entreprise : choix de statut en France (micro-entreprise, EI, EURL, SASU, SAS), démarches guichet unique INPI, TVA/franchises et obligations légales.
2. Agences IA : structuration d'offre B2B, cadrage du ROI réaliste, intégration API, conformité et livraison client.
3. E-commerce et dropshipping : positionnement produit, fournisseurs conformes UE, marges nettes après publicité/logistique/retours et SAV.
4. Marketing digital : positionnement, proposition de valeur, SEO, contenu organique et tunnels d'acquisition.
5. Publicité et réseaux sociaux : Meta Ads, Google Ads, TikTok, Instagram, LinkedIn B2B, suivi du coût d'acquisition (CAC) et mentions légales.
6. Automatisation : workflows no-code/code, CRM, webhooks, traitement documentaire et gains de temps mesurables.
7. Vente et prospection : prospection B2B/B2C multicanale, scripts d'appel et d'email, traitement d'objections, devis et closing honnête.
8. Gestion financière : charges fixes/variables, marge nette, seuil de rentabilité, trésorerie et facturation conforme.
9. Business en ligne : conseil, services récurrents, produits numériques, validation terrain avant développement lourd.
10. Développement de logiciels et SaaS : cadrage MVP, architecture fiable, sécurité, facturation récurrente et rétention.
11. Stratégies commerciales : tarification, montée en gamme, partenariats et fidélisation.

STRUCTURE POUR TOUT PROJET OU DEMANDE DE CRÉATION / LANCEMENT DE BUSINESS :
Lorsque l'utilisateur demande de lancer, concevoir, structurer ou analyser un projet business, organise clairement ta réponse autour de ces 7 volets concrets :
1. Analyse du projet (marché, valeur, adéquation contraintes/compétences)
2. Plan d'action étape par étape
3. Outils adaptés (indique toujours clairement les limites réelles des offres gratuites vs payantes ; ne présente jamais un outil payant comme gratuit)
4. Budget estimé (fourchettes réalistes et transparentes)
5. Risques (opérationnels, financiers, juridiques)
6. Méthodes pour trouver des clients
7. Prochaines actions concrètes

Pour une question directe, technique, rédactionnelle ou ponctuelle, réponds directement avec précision sans imposer artificiellement cette grille en 7 points.

RÈGLES ABSOLUES DE FIABILITÉ, D'HONNÊTETÉ ET DE SÉCURITÉ :
1. Ne garantis JAMAIS de revenus, de chiffre d'affaires, de rentabilité ni de succès automatique.
2. N'invente JAMAIS de statistiques, chiffres de marché, clients, études de cas, résultats passés, URLs, ni données administratives (SIRET, SIREN, TVA, IBAN, adresse) : utilise [À COMPLÉTER] ou [À vérifier] si une donnée manque.
3. Distingue explicitement les faits établis, les estimations (en précisant les hypothèses) et les hypothèses à valider sur le terrain.
4. Signale honnêtement tout point incertain ou qui nécessite une vérification officielle (comptable, avocat, URSSAF, impôts, textes légaux).
5. Ne conseille jamais de mentir sur l'expérience, de fabriquer de faux avis clients ni d'utiliser des pratiques commerciales trompeuses.
6. Respecte la législation française et européenne (mentions obligatoires sur devis/factures, TVA / art. 293 B CGI, RGPD, droit de rétractation e-commerce, transparence publicitaire).
7. Protège les données personnelles et confidentielles : ne demande jamais de mots de passe, clés API ou secrets bancaires dans le chat.
8. Ne pose des questions de clarification que lorsqu'elles sont réellement nécessaires pour éviter un conseil inadapté.
9. Réponds en français par défaut, et réponds dans la langue de l'utilisateur s'il écrit explicitement dans une autre langue.
10. PRIORITÉ ABSOLUE AU DERNIER MESSAGE : Traite toujours spécifiquement la TOUTE DERNIÈRE demande de l'utilisateur à la fin de l'historique. Exploite le contexte utile des échanges précédents sans jamais répéter automatiquement une ancienne réponse.`;

const EXPERIENCE_CHAT_HINTS: Record<ExperienceLevel, string> = {
  debutant:
    "NIVEAU UTILISATEUR : Débutant. Explique simplement les termes métier, évite le jargon inutile, privilégie les étapes accessibles à faible risque et les erreurs de démarrage à éviter.",
  intermediaire:
    "NIVEAU UTILISATEUR : Intermédiaire. Va à l'essentiel sur l'exécution, les canaux d'acquisition mesurables, le chiffrage des marges et l'optimisation opérationnelle.",
  confirme:
    "NIVEAU UTILISATEUR : Confirmé / Dirigeant. Adopte un niveau exécutif : unit economics, KPIs, structuration juridique/fiscale, délégation, automatisation et leviers de croissance.",
};

export function buildAssistantSystemInstruction(params: {
  contextSummary?: string;
  experienceLevel?: ExperienceLevel;
  webSearchEnabled: boolean;
}): string {
  const levelKey: ExperienceLevel =
    params.experienceLevel === 'intermediaire' || params.experienceLevel === 'confirme'
      ? params.experienceLevel
      : 'debutant';

  const webSearchClause = params.webSearchEnabled
    ? `RECHERCHE WEB ACTIVÉE : Pour les données récentes, chiffrées ou réglementaires, appuie-toi sur la recherche web en privilégiant les sources officielles et fiables (Service-Public.fr, URSSAF, INSEE, Légifrance, CNIL, documentation officielle), cite tes références et signale explicitement tout point non vérifié.`
    : `RECHERCHE WEB NON ACTIVÉE POUR CETTE REQUÊTE : Ne prétends JAMAIS avoir effectué une recherche web en direct ni consulté Internet pour cette réponse. Si la question porte sur des chiffres actuels, des tarifs ou des lois susceptibles d'avoir évolué, précise-le clairement et invite à vérifier sur une source officielle ou à activer la recherche web.`;

  const sections = [
    GENERAL_SYSTEM_INSTRUCTION,
    EXPERIENCE_CHAT_HINTS[levelKey],
    webSearchClause,
  ];

  if (params.contextSummary?.trim()) {
    sections.push(
      `[RÉSUMÉ DU CONTEXTE ANTÉRIEUR DE LA CONVERSATION]\n${params.contextSummary.trim()}`
    );
  }

  return sections.join('\n\n');
}

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

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error('SUMMARY_TIMEOUT'));
  }, 6_000);

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
        abortSignal: controller.signal,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    const text = response.text?.trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutTimer);
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

async function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    throw new Error('CLIENT_ABORTED');
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('CLIENT_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runWithResilientGeminiFallback(params: {
  ai: GoogleGenAI;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  useWebSearch: boolean;
  preferredModel?: string;
  externalSignal?: AbortSignal;
  callbacks: StreamCallbacks;
  startedAt: number;
  retryBaseMs?: number;
  maxAutoRetryWaitMs?: number;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fallbackModelResolver?: (activeModel: string) => string | null;
  streamOnceFn?: typeof streamOnceWithGeminiModel;
}): Promise<StreamResult> {
  const sleep = params.sleepFn ?? cancellableSleep;
  const retryBaseMs = params.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const maxRetryWaitMs = params.maxAutoRetryWaitMs ?? MAX_AUTO_RETRY_WAIT_MS;
  const resolveFallback = params.fallbackModelResolver ?? resolveConfiguredFallbackModel;
  const streamOnce = params.streamOnceFn ?? streamOnceWithGeminiModel;

  const requestedPrimary =
    params.preferredModel === GEMINI_MODELS.fallback
      ? GEMINI_MODELS.fallback
      : GEMINI_MODELS.primary;

  // Determine initial healthy model
  let activeModel: string = requestedPrimary;
  if (activeModel === GEMINI_MODELS.primary && !isPrimaryHealthy()) {
    const healthyBackup = resolveFallback(GEMINI_MODELS.primary);
    if (healthyBackup) {
      activeModel = healthyBackup;
    }
  }

  let emittedAnyDelta = false;
  let totalRetriesUsed = 0;
  let rateLimitRetriesUsed = 0;
  let sameModelRetries = 0;
  let fallbackAttempted = false;
  const MAX_TOTAL_RETRIES = 2;

  while (true) {
    const ttftTimeoutMs =
      activeModel === GEMINI_MODELS.fallback ? TTFT_FALLBACK_MS : TTFT_PRIMARY_MS;

    try {
      params.callbacks.onModelSelected?.(activeModel);
      const res = await streamOnce({
        ai: params.ai,
        model: activeModel,
        contents: params.contents,
        systemInstruction: params.systemInstruction,
        useWebSearch: params.useWebSearch,
        ttftTimeoutMs,
        externalSignal: params.externalSignal,
        onDelta: (delta) => {
          emittedAnyDelta = true;
          params.callbacks.onDelta(delta);
        },
      });

      return {
        fullText: res.fullText,
        sources: res.sources,
        modelUsed: activeModel,
        latencyMs: Date.now() - params.startedAt,
      };
    } catch (err) {
      const classified = classifyGeminiError(err);

      // Never retry manual user cancellation
      if (classified.category === 'aborted') {
        throw err;
      }

      // CRITICAL: Never automatically retry once partial output was already emitted
      if (emittedAnyDelta) {
        throw err;
      }

      // Never retry hard quota exhaustion or invalid auth (avoid loops / bypassing limits)
      if (classified.category === 'quota_exhausted' || classified.category === 'auth' || classified.category === 'unknown') {
        throw err;
      }

      if (totalRetriesUsed >= MAX_TOTAL_RETRIES) {
        if (activeModel === GEMINI_MODELS.primary && classified.category === 'unavailable') {
          tripPrimaryCooldown(err);
        }
        throw err;
      }

      // If Retry-After exceeds safe short wait threshold, surface clearly without stalling/looping
      if (classified.retryAfterMs !== null && classified.retryAfterMs > maxRetryWaitMs) {
        throw err;
      }

      // On temporary 429 rate limit: at most 1 bounded retry respecting Retry-After, no fallback loop
      if (classified.category === 'rate_limit') {
        if (rateLimitRetriesUsed >= 1) {
          throw err;
        }
        const progressiveMs = retryBaseMs * Math.pow(2, totalRetriesUsed);
        const waitMs = Math.min(
          maxRetryWaitMs,
          Math.max(progressiveMs, classified.retryAfterMs ?? 0)
        );
        rateLimitRetriesUsed += 1;
        totalRetriesUsed += 1;
        params.callbacks.onStatus?.(
          `Limite temporaire Gemini (429), nouvelle tentative dans ${(waitMs / 1000).toFixed(1)}s...`
        );
        await sleep(waitMs, params.externalSignal);
        continue;
      }

      // On model_unavailable (404): switch directly if configured fallback exists; never retry dead model
      if (classified.category === 'model_unavailable') {
        const nextFallback = !fallbackAttempted ? resolveFallback(activeModel) : null;
        if (!nextFallback) {
          if (activeModel === GEMINI_MODELS.fallback) {
            tripFallbackCooldown(err);
          }
          throw err;
        }
        fallbackAttempted = true;
        totalRetriesUsed += 1;
        activeModel = nextFallback;
        params.callbacks.onStatus?.(`Modèle indisponible, bascule vers ${nextFallback}...`);
        continue;
      }

      // On transient 503 / TTFT timeout / network before first token
      const progressiveMs = retryBaseMs * Math.pow(2, totalRetriesUsed);
      const waitMs = Math.min(
        maxRetryWaitMs,
        Math.max(progressiveMs, classified.retryAfterMs ?? 0)
      );

      if (sameModelRetries < 1) {
        sameModelRetries += 1;
        totalRetriesUsed += 1;
        params.callbacks.onStatus?.(
          classified.category === 'timeout'
            ? 'Délai dépassé avant réponse, nouvelle tentative...'
            : 'Service Gemini surchargé (503), nouvelle tentative...'
        );
        await sleep(waitMs, params.externalSignal);
        continue;
      }

      const backupModel = !fallbackAttempted ? resolveFallback(activeModel) : null;
      if (backupModel) {
        if (activeModel === GEMINI_MODELS.primary) {
          tripPrimaryCooldown(err);
        }
        fallbackAttempted = true;
        sameModelRetries = 0;
        totalRetriesUsed += 1;
        activeModel = backupModel;
        params.callbacks.onStatus?.(`Bascule vers le modèle de secours ${backupModel}...`);
        await sleep(waitMs, params.externalSignal);
        continue;
      }

      // No verified fallback model configured/available; allow 1 final progressive retry if under cap
      totalRetriesUsed += 1;
      params.callbacks.onStatus?.('Nouvelle tentative en cours...');
      await sleep(waitMs, params.externalSignal);
    }
  }
}

export async function generateContentWithResilience<T>(params: {
  ai: GoogleGenAI;
  preferredModel?: string;
  timeoutMs?: number;
  retryBaseMs?: number;
  maxAutoRetryWaitMs?: number;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fallbackModelResolver?: (activeModel: string) => string | null;
  invokeModel: (targetModel: string, abortSignal: AbortSignal) => Promise<T>;
}): Promise<{ response: T; modelUsed: string }> {
  const sleep = params.sleepFn ?? cancellableSleep;
  const retryBaseMs = params.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const maxRetryWaitMs = params.maxAutoRetryWaitMs ?? MAX_AUTO_RETRY_WAIT_MS;
  const resolveFallback = params.fallbackModelResolver ?? resolveConfiguredFallbackModel;
  const timeoutMs = params.timeoutMs ?? GENERATE_TIMEOUT_MS;

  let activeModel =
    params.preferredModel === GEMINI_MODELS.fallback
      ? GEMINI_MODELS.fallback
      : isPrimaryHealthy()
      ? GEMINI_MODELS.primary
      : resolveFallback(GEMINI_MODELS.primary) ?? GEMINI_MODELS.primary;

  let totalRetries = 0;
  let rateLimitRetries = 0;
  let sameModelRetries = 0;
  let fallbackAttempted = false;
  const MAX_TOTAL_RETRIES = 2;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('GENERATE_TIMEOUT'));
    }, timeoutMs);

    try {
      const response = await params.invokeModel(activeModel, controller.signal);
      return { response, modelUsed: activeModel };
    } catch (err) {
      const normalizedErr =
        controller.signal.aborted && controller.signal.reason instanceof Error
          ? controller.signal.reason
          : err;
      const classified = classifyGeminiError(normalizedErr);

      if (
        classified.category === 'aborted' ||
        classified.category === 'quota_exhausted' ||
        classified.category === 'auth' ||
        classified.category === 'unknown' ||
        totalRetries >= MAX_TOTAL_RETRIES
      ) {
        throw normalizedErr;
      }

      if (classified.retryAfterMs !== null && classified.retryAfterMs > maxRetryWaitMs) {
        throw normalizedErr;
      }

      if (classified.category === 'rate_limit') {
        if (rateLimitRetries >= 1) throw normalizedErr;
        const waitMs = Math.min(
          maxRetryWaitMs,
          Math.max(retryBaseMs * Math.pow(2, totalRetries), classified.retryAfterMs ?? 0)
        );
        rateLimitRetries += 1;
        totalRetries += 1;
        await sleep(waitMs);
        continue;
      }

      if (classified.category === 'model_unavailable') {
        const nextFallback = !fallbackAttempted ? resolveFallback(activeModel) : null;
        if (!nextFallback) {
          if (activeModel === GEMINI_MODELS.fallback) tripFallbackCooldown(normalizedErr);
          throw normalizedErr;
        }
        fallbackAttempted = true;
        totalRetries += 1;
        activeModel = nextFallback;
        continue;
      }

      const waitMs = Math.min(
        maxRetryWaitMs,
        Math.max(retryBaseMs * Math.pow(2, totalRetries), classified.retryAfterMs ?? 0)
      );

      if (sameModelRetries < 1) {
        sameModelRetries += 1;
        totalRetries += 1;
        await sleep(waitMs);
        continue;
      }

      const backupModel = !fallbackAttempted ? resolveFallback(activeModel) : null;
      if (backupModel) {
        if (activeModel === GEMINI_MODELS.primary) tripPrimaryCooldown(normalizedErr);
        fallbackAttempted = true;
        sameModelRetries = 0;
        totalRetries += 1;
        activeModel = backupModel;
        await sleep(waitMs);
        continue;
      }

      totalRetries += 1;
      await sleep(waitMs);
    } finally {
      clearTimeout(timer);
    }
  }
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
  experienceLevel?: ExperienceLevel;
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
  const enableSearch =
    provider === 'gemini' &&
    (params.useWebSearch || shouldAutoEnableWebSearch(params.userMessage));
  const systemInstruction = buildAssistantSystemInstruction({
    contextSummary: params.contextSummary,
    experienceLevel: params.experienceLevel,
    webSearchEnabled: enableSearch,
  });

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

export const BUSINESS_MODULE_ALIASES: Record<string, string> = {
  market_research: 'market_study',
  quote_builder: 'quote_creation',
  professional_emails: 'professional_texts',
  automation_workflow: 'automation_ops',
  business_growth: 'low_budget_growth',
};

export function normalizeBusinessModuleKey(rawKey: string): string | null {
  const clean = rawKey.trim();
  const canonical = BUSINESS_MODULE_ALIASES[clean] ?? clean;
  return Object.prototype.hasOwnProperty.call(BUSINESS_MODULE_LABELS, canonical)
    ? canonical
    : null;
}

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

  const webClause = params.useWebSearch
    ? `Recherche web activée : privilégie des sources officielles/fiables (Service-Public.fr, URSSAF, INSEE, Légifrance), cite les sources et signale les points non vérifiés.`
    : `Recherche web désactivée : ne prétends pas avoir effectué une recherche web en direct et signale les données volatiles à vérifier.`;

  const systemInstruction = `Tu es NOVA AI PRO Mode Business, un consultant senior en création d'entreprise, agences IA, e-commerce, SaaS, marketing digital, automatisation, vente et finance d'entreprise.

RÈGLES OBLIGATOIRES :
1. Sois réaliste, concret, chiffré et honnête. Ne garantis JAMAIS de revenus ni de succès automatique.
2. Adapte précisément tes recommandations au budget déclaré (${params.budgetEur} €), au temps disponible${params.weeklyHours ? ` (${params.weeklyHours}h/semaine)` : ''}, aux compétences déclarées et au niveau de l'utilisateur (${levelDescription}).
3. Distingue clairement les faits établis, les estimations chiffrées (avec hypothèses) et les hypothèses à tester.
4. Pour les outils recommandés : vérifie et précise toujours les limites réelles des formules gratuites vs payantes (ne qualifie jamais un outil payant de 100 % gratuit).
5. Ne jamais inventer de statistiques, de cas clients ni d'informations administratives/bancaires (SIRET, IBAN, adresse) : utilise [À COMPLÉTER] ou [À vérifier]. Ne conseille jamais de mentir sur l'expérience. Respecte la législation française et le RGPD.
6. ${webClause}
7. Structure ta réponse en Markdown clair avec ces 7 sections obligatoires :
## 1. Analyse du projet & Objectif stratégique
## 2. Client cible, Offre commerciale & Positionnement
## 3. Budget estimé & Coûts détaillés
## 4. Outils adaptés & Ressources (limites gratuit/payant précisées)
## 5. Risques, Conformité & Scénarios réalistes (sans garantie de revenus)
## 6. Méthodes pour trouver des clients & Prospection
## 7. Plan d'action étape par étape & Prochaines actions concrètes (7 jours · 30 jours · 90 jours)

${
  isDocumentModule
    ? `Inclus dans la section 7 un modèle complet prêt à copier/adapter (devis, facture avec mentions légales françaises type SIRET/TVA [À COMPLÉTER], ou séquence d'emails B2B professionnelles sans fausse affirmation d'expérience).`
    : ''
}
8. Réponds en français professionnel (ou dans la langue explicitement employée dans l'objectif/contexte de l'utilisateur).`;

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
    `Génère le livrable complet en suivant strictement les 7 sections, le respect légal français et le plan 7, 30 et 90 jours.`,
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

  const { response, modelUsed: usedModel } = await generateContentWithResilience({
    ai,
    timeoutMs: 45_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
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
      }),
  });

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

  const prompt = `Crée un logo vectoriel SVG minimaliste, moderne et mémorable pour la marque "${params.brandName}" (secteur : ${params.sector}).
Couleurs : primaire ${params.primaryColor}, secondaire ${params.secondaryColor}.
Style demandé : ${params.styleHint || 'Emblème géométrique épuré de niveau studio design'}.
Retourne uniquement un JSON avec la propriété "logoSvg" contenant un SVG valide viewBox="0 0 512 512" (sans script, sans lien externe, géométrie nette et équilibrée).`;

  const { response, modelUsed } = await generateContentWithResilience({
    ai,
    timeoutMs: 25_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              logoSvg: { type: Type.STRING },
            },
          },
        },
      }),
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as { logoSvg?: string };
  return {
    logoSvg: sanitizeSvgLogo(parsed.logoSvg || '', params.brandName, params.primaryColor),
    modelUsed,
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

  const prompt = `Développe une page web HTML5 complète, autonome, responsive et professionnelle en français pour :
- Marque : ${params.brandName}
- Slogan : ${params.slogan}
- Secteur : ${params.sector}
- Palette : Primaire ${params.primaryColor}, Secondaire ${params.secondaryColor}, Accent ${params.accentColor}
- Offres & tarifs : ${params.packagesText}
- Directives spécifiques : ${params.customInstructions || 'Design épuré, sections Hero, Services/Tarifs, Méthode, Preuve/Engagements, Formulaire de contact interactif avec confirmation JS, Footer.'}

Retourne un JSON { "websiteHtml": "<!doctype html>..." }.`;

  const { response, modelUsed } = await generateContentWithResilience({
    ai,
    timeoutMs: 35_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              websiteHtml: { type: Type.STRING },
            },
          },
        },
      }),
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as { websiteHtml?: string };
  let html = sanitizeWebsiteHtml(parsed.websiteHtml || '');
  if (params.logoSvg && !/<svg[\s\S]*<\/svg>/i.test(html)) {
    html = html.replace(
      /<body([^>]*)>/i,
      `<body$1><div style="display:none" aria-hidden="true">${params.logoSvg}</div>`
    );
  }
  return { websiteHtml: html, modelUsed };
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

  const formatLabels: Record<string, string> = {
    tiktok_script: 'Script TikTok percutant (accroche 3s, corps, CTA)',
    short_video: 'Script Vidéo Courte (Reels / YouTube Shorts)',
    instagram_post: 'Publication Instagram (carrousel ou légende engageante + hashtags pertinents)',
    facebook_post: 'Publication Facebook orientée engagement & conversion',
    linkedin_post: 'Post LinkedIn B2B structuré à forte valeur ajoutée',
    ad_copy: 'Annonces publicitaires (Meta Ads / Google Ads avec 3 variantes de titres & textes)',
    slogans: 'Liste de 10 slogans et accroches de marque différenciants',
    marketing_email: 'Email marketing / prospection structuré (objet, corps, relance)',
    sales_email: 'Email marketing / prospection structuré (objet, corps, relance)',
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

  const { response, modelUsed } = await generateContentWithResilience({
    ai,
    timeoutMs: 25_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Contenu vide retourné par Gemini.');
  }
  return { content: text, modelUsed };
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

  const { response, modelUsed } = await generateContentWithResilience({
    ai,
    timeoutMs: 30_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
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
      }),
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
    modelUsed,
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

  const prompt = `Rédige un document professionnel complet en Markdown en français.
Type de document : ${params.docType}
Titre : ${params.title}
Émetteur fourni : ${params.companyName || '[À COMPLÉTER — Raison sociale]'}
Destinataire fourni : ${params.clientName || '[À COMPLÉTER — Nom du client]'}
Contexte et détails fournis par l'utilisateur :
${params.context}

RÈGLE DE SÉCURITÉ & FIABILITÉ ABSOLUE :
Ne JAMAIS inventer de numéro SIRET, SIREN, TVA intracommunautaire, IBAN, BIC, adresse postale, téléphone ou email s'ils n'ont pas été fournis ci-dessus. Indique explicitement [À COMPLÉTER] pour toute information administrative ou bancaire manquante.`;

  const { response, modelUsed } = await generateContentWithResilience({
    ai,
    timeoutMs: 30_000,
    invokeModel: (targetModel, abortSignal) =>
      ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          abortSignal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Document vide retourné par Gemini.');
  }
  return { contentMarkdown: text, modelUsed };
}
