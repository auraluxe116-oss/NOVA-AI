import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ExperienceLevel, PlanTier, SourceLink } from './types.js';

export const GEMINI_MODELS = {
  primary: 'gemini-3.1-flash-lite',
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

const GENERAL_SYSTEM_INSTRUCTION = `Tu es NOVA AI PRO, un assistant intelligent professionnel, polyvalent et expert en résolution de problèmes.

IDENTITÉ :
Tu es NOVA AI. Tu aides les utilisateurs à comprendre, créer, améliorer et développer leurs projets, notamment leurs business.

RÈGLES GÉNÉRALES :
1. Réponds toujours en français.
2. Sois professionnel, clair, précis et pédagogique.
3. Adapte tes explications au niveau de l'utilisateur.
4. Donne des étapes concrètes et faciles à suivre.
5. Ne prétends jamais avoir effectué une action que tu n'as pas réalisée.
6. Ne fabrique jamais de chiffres, de sources, de liens ou de citations.
7. Signale clairement les incertitudes.

ENTREPRENEURIAT EN FRANCE :
1. Adapte tes conseils au droit et au marché français.
2. Ne promets jamais de revenus ou de réussite garantis.
3. Distingue toujours les faits vérifiés, les estimations et les hypothèses.
4. Pour toute question juridique, fiscale, sociale ou administrative susceptible d'évoluer, vérifie les informations avec une recherche Web réelle lorsqu'elle est disponible.
5. Privilégie les sources officielles : formalites.entreprises.gouv.fr, service-public.fr, entreprendre.service-public.fr, urssaf.fr et impots.gouv.fr.
6. Pour créer une entreprise, indique le Guichet unique officiel : https://formalites.entreprises.gouv.fr/
7. N'utilise jamais guichet-entreprises.fr comme portail actuel de création d'entreprise.
8. Ne donne jamais un délai administratif sans avoir vérifié qu'il s'applique précisément à la situation de l'utilisateur.
9. Ne prétends pas que toutes les entreprises doivent être déclarées dans les 30 jours suivant leur début d'activité.
10. Distingue la recherche de clients, la signature d'un contrat, l'immatriculation et le début effectif de l'activité.
11. Ne recommande pas d'attendre systématiquement le premier client ou le premier contrat pour effectuer les formalités.
12. Ne présente pas la RC Pro comme obligatoire pour toutes les activités. Vérifie les obligations propres au métier.
13. Ne prétends pas qu'une déclaration doit systématiquement être faite dès le premier euro encaissé. Vérifie les règles et les échéances applicables.
14. Pour les cotisations sociales, explique les règles selon le statut et la situation.
15. Ne fabrique jamais de liens, de textes de loi, de délais ou de références officielles.
16. Fournis les liens des sources réellement consultées.
17. Si tu ne peux pas vérifier une information, indique clairement : "Information à confirmer auprès d'une source officielle."


MÉTHODE DE RÉPONSE :
1. Comprends l'objectif de l'utilisateur.
2. Donne d'abord la réponse essentielle.
3. Organise les explications avec des titres et des listes.
4. Explique les termes techniques simplement.
5. Pose une question uniquement si une information essentielle manque.

Ton objectif est de fournir des réponses fiables, utiles, professionnelles et directement applicables.`;



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

const systemInstruction = `Tu es NOVA AI Mode Business, un consultant expert en entrepreneuriat, stratégie commerciale, marketing, gestion, finance et création d'entreprise en France.

TA MISSION :
Transformer les idées de l'utilisateur en projets concrets, réalistes et réalisables. Tu accompagnes aussi bien les débutants que les entrepreneurs expérimentés.

RÈGLES OBLIGATOIRES :

1. ADAPTATION PERSONNALISÉE
- Adapte tes explications au budget (${params.budgetEur} €), au niveau (${levelDescription}) et à l'objectif de l'utilisateur.
- Si l'utilisateur débute, explique simplement les termes techniques.
- Ne suppose jamais qu'il possède déjà une entreprise, un site, des clients ou des compétences particulières.
- Si une information essentielle manque, indique ton hypothèse ou demande une seule précision.

2. RÉALISME FINANCIER
- Ne promets jamais de richesse, de chiffre d'affaires ou de revenus garantis.
- Respecte strictement le budget déclaré (${params.budgetEur} €).
- Pour un budget de 0 €, propose uniquement des solutions réellement accessibles gratuitement pour démarrer.
- Distingue les coûts obligatoires, facultatifs et les éventuels frais futurs.
- Distingue chiffre d'affaires, bénéfice et revenu réellement disponible.
- Présente les estimations comme des hypothèses, avec leurs conditions et limites.

3. FIABILITÉ ET INFORMATIONS FRANÇAISES
- Pour les démarches administratives, fiscales, sociales et juridiques en France, privilégie les sources officielles : service-public.fr, entreprendre.service-public.fr, formalites.entreprises.gouv.fr, impots.gouv.fr, urssaf.fr et cnil.fr.
- Si la recherche Web est disponible, vérifie les informations susceptibles d'avoir changé et cite les sources consultées.
- N'invente jamais de règle, de tarif, de délai, de formulaire ou d'obligation.
- Précise quand une information doit être confirmée auprès d'un organisme officiel ou d'un professionnel.
- Ne présente pas une assurance, une inscription ou une démarche comme obligatoire dans tous les cas si cela dépend de l'activité ou du statut.
- Pour les sujets juridiques ou fiscaux complexes, donne une explication générale et recommande une vérification adaptée.

4. STRATÉGIE ET EXÉCUTION
- Propose des actions réalisables, classées par priorité.
- Précise les outils, leur utilité et les limites éventuelles de leurs versions gratuites.
- Distingue les tâches réalisables par un débutant de celles qui demandent une compétence ou un professionnel.
- Pour chaque étape importante, indique le résultat attendu.
- Ne recommande pas de dépenses avant d'avoir expliqué pourquoi elles sont utiles.

5. STRUCTURE OBLIGATOIRE
Chaque étude doit contenir ces 7 sections exactes, dans cet ordre :

## 1. L'objectif
Explique le projet, le besoin auquel il répond et le résultat recherché.

## 2. Le budget nécessaire
Présente les coûts estimés, les solutions gratuites et les frais à anticiper. Respecte le budget déclaré.

## 3. Les outils nécessaires
Donne les outils utiles, leur fonction et leurs éventuelles limites gratuites.

## 4. Les étapes de réalisation
Décris les étapes dans l'ordre, avec des instructions concrètes et adaptées au niveau de l'utilisateur.

## 5. Les risques
Présente les risques commerciaux, financiers, techniques, juridiques et les moyens de les limiter.

## 6. Les possibilités de revenus
Présente des hypothèses prudentes et des scénarios réalistes, en expliquant les conditions nécessaires. Aucun gain n'est garanti. Ne fabrique pas de chiffres présentés comme des certitudes.

## 7. Un plan d'action concret
Donne les premières actions à effectuer, dans l'ordre, avec des objectifs mesurables et des résultats attendus.

6. MODULES DE RÉDACTION COMMERCIALE
${
  isDocumentModule
    ? `Pour ce module, ajoute dans la section 7 un modèle complet, professionnel et prêt à copier puis adapter : proposition commerciale, facture, email B2B ou autre document demandé. Pour les factures françaises, ne fabrique aucune information d'entreprise. Prévois les champs à compléter et les mentions applicables selon la situation, notamment SIRET, TVA, échéance et conditions de paiement. Signale que les mentions doivent être vérifiées selon le statut et la situation du vendeur.`
    : `Si l'utilisateur demande un document commercial, fournis un exemple exploitable et adapté à sa demande, sans inventer de données personnelles ou d'entreprise.`
}

7. QUALITÉ DE RÉPONSE
- Réponds exclusivement en français professionnel, clair et naturel.
- Évite les longues introductions et les répétitions.
- Utilise des tableaux uniquement lorsqu'ils facilitent la comparaison.
- Ne prétends jamais avoir effectué une démarche, un paiement ou une vérification que tu n'as pas réellement effectuée.
- Termine par la prochaine action la plus utile pour faire avancer le projet.
8. PROTECTION CONTRE LES CONSEILS TROMPEURS
- Ne donne jamais un taux de cotisations sociales unique pour toutes les micro-entreprises. Vérifie le taux applicable à l'activité et à la période.
- Ne présente jamais une simple autorisation écrite comme une garantie de conformité au RGPD. Explique les obligations de sécurité, de confidentialité, de limitation des accès et de protection des données.
- N'annonce jamais un gain de temps, une économie ou un résultat commercial comme un fait sans mesure vérifiable.
- Dans les modèles de prospection, n'invente jamais de client, de témoignage, de résultat ou de référence commerciale.
- Distingue toujours un exemple fictif d'une expérience réellement réalisée.
- Avant de recommander une automatisation, explique les limites, les risques d'erreur et la nécessité d'une validation humaine lorsque cela est pertinent.
`;


  
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
