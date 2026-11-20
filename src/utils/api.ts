import type {
  AIProviderId,
  AIProviderInfo,
  AlternativeFreeModel,
  BusinessProject,
  ChatMessage,
  CompanyCreationResult,
  ConversationSummary,
  DashboardData,
  ExperienceLevel,
  PublicUser,
  PublishedSiteSummary,
  QuotaSnapshot,
  SavedCompanyCreation,
  SourceLink,
  UserDocument,
  UserPreferences,
  VideoStoryboard,
} from '../types/nova';

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSec: number | null;
  failedModel: string | null;
  alternativeModels: AlternativeFreeModel[];
  noAlternativeAvailable: boolean;

  constructor(
    message: string,
    status = 500,
    code = 'API_ERROR',
    retryAfterSec: number | null = null,
    options?: {
      failedModel?: string | null;
      alternativeModels?: AlternativeFreeModel[];
      noAlternativeAvailable?: boolean;
    }
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    this.failedModel = options?.failedModel ?? null;
    this.alternativeModels = Array.isArray(options?.alternativeModels)
      ? options.alternativeModels
      : [];
    this.noAlternativeAvailable = Boolean(options?.noAlternativeAvailable);
  }
}

function parseAlternativeModels(raw: unknown): AlternativeFreeModel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is AlternativeFreeModel =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { label?: unknown }).label === 'string'
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      provider: 'gemini' as const,
    }));
}

function normalizeNetworkError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ApiError(
      'Vous semblez hors ligne. Vérifiez votre connexion Internet puis réessayez — votre texte est conservé.',
      0,
      'NETWORK_ERROR'
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|err_connection|econnrefused|econnreset/i.test(
      msg
    )
  ) {
    return new ApiError(
      'Impossible de joindre le serveur NOVA AI. Vérifiez votre connexion Internet puis réessayez — votre texte est conservé.',
      0,
      'NETWORK_ERROR'
    );
  }
  return new ApiError(
    msg || 'Erreur réseau inattendue lors de la communication avec le serveur.',
    0,
    'NETWORK_ERROR'
  );
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';
  const maxAttempts = isIdempotent ? 2 : 1;
  const timeoutMs = options.timeoutMs ?? 22_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const externalSignal = init.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        ...init,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }

      if (!res.ok) {
        const isTransientHttp = res.status === 502 || res.status === 503 || res.status === 504;
        if (isIdempotent && isTransientHttp && attempt < maxAttempts) {
          await waitMs(850, externalSignal ?? undefined);
          continue;
        }
        const headerRetry = Number(res.headers.get('retry-after') ?? '');
        const retryAfterSec =
          typeof parsed.retryAfterSec === 'number'
            ? parsed.retryAfterSec
            : Number.isFinite(headerRetry) && headerRetry > 0
              ? Math.ceil(headerRetry)
              : null;
        const fallbackErr =
          res.status === 404
            ? `Route API introuvable (${url} — HTTP 404).`
            : isTransientHttp
              ? 'Le serveur NOVA AI est momentanément saturé ou indisponible. Réessayez dans quelques secondes.'
              : `Erreur serveur (${res.status})`;
        throw new ApiError(
          String(parsed.error || fallbackErr),
          res.status,
          String(parsed.code || (res.status === 404 ? 'API_NOT_FOUND' : 'HTTP_ERROR')),
          retryAfterSec,
          {
            failedModel: typeof parsed.failedModel === 'string' ? parsed.failedModel : null,
            alternativeModels: parseAlternativeModels(parsed.alternativeModels),
            noAlternativeAvailable: Boolean(parsed.noAlternativeAvailable),
          }
        );
      }

      return parsed as T;
    } catch (err) {
      if (externalSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (timedOut) {
        if (isIdempotent && attempt < maxAttempts) {
          await waitMs(850, externalSignal ?? undefined);
          continue;
        }
        throw new ApiError(
          'Le serveur met trop de temps à répondre (délai dépassé). Veuillez réessayer.',
          504,
          'CLIENT_TIMEOUT'
        );
      }
      if (err instanceof ApiError) {
        throw err;
      }
      if (isIdempotent && attempt < maxAttempts) {
        await waitMs(850, externalSignal ?? undefined);
        continue;
      }
      throw normalizeNetworkError(err);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw new ApiError('Impossible de joindre le serveur.', 0, 'NETWORK_ERROR');
}

export async function fetchAuthMe(): Promise<{
  user: PublicUser | null;
  quota: QuotaSnapshot;
}> {
  return requestJson('/api/auth/me');
}

export async function fetchAIProviders(): Promise<{
  providers: AIProviderInfo[];
}> {
  return requestJson('/api/ai/providers');
}

export async function registerUser(payload: {
  email: string;
  password: string;
  displayName: string;
  companyName?: string;
}): Promise<{ user: PublicUser; quota: QuotaSnapshot; recoveryCode?: string }> {
  return requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; quota: QuotaSnapshot }> {
  return requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resetPasswordApi(payload: {
  email: string;
  recoveryCode: string;
  newPassword: string;
}): Promise<{ ok: boolean; nextRecoveryCode: string; message: string }> {
  return requestJson('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logoutUser(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' });
}

export async function updateProfile(payload: {
  displayName?: string;
  companyName?: string;
  currentPassword?: string;
  newPassword?: string;
  regenerateRecoveryCode?: boolean;
  preferences?: Partial<UserPreferences>;
}): Promise<{ user: PublicUser; quota: QuotaSnapshot; recoveryCode?: string | null }> {
  return requestJson('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteAccountApi(password: string): Promise<void> {
  await requestJson('/api/auth/account', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

export async function exportUserDataApi(): Promise<Record<string, unknown>> {
  return requestJson('/api/auth/export');
}

export async function fetchDashboard(): Promise<DashboardData> {
  return requestJson('/api/dashboard');
}

export async function fetchConversations(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  conversations: ConversationSummary[];
  hasMore: boolean;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.offset !== undefined) params.set('offset', String(options.offset));
  const qs = params.toString();
  return requestJson(`/api/conversations${qs ? `?${qs}` : ''}`);
}

export async function fetchConversationDetail(
  id: string,
  options?: { limit?: number; beforeSeq?: number | null }
): Promise<{
  conversation: ConversationSummary;
  messages: ChatMessage[];
  hasMoreOlder: boolean;
  nextBeforeSeq: number | null;
  totalMessages: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.beforeSeq !== undefined && options?.beforeSeq !== null) {
    params.set('beforeSeq', String(options.beforeSeq));
  }
  const qs = params.toString();
  return requestJson(`/api/conversations/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
}

export async function renameConversationApi(
  id: string,
  title: string
): Promise<{ conversation: ConversationSummary }> {
  return requestJson(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversationApi(id: string): Promise<void> {
  await requestJson(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchBusinessProjects(): Promise<{
  projects: BusinessProject[];
}> {
  return requestJson('/api/business/projects');
}

export async function deleteBusinessProjectApi(id: string): Promise<void> {
  await requestJson(`/api/business/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// Company Creation Suite APIs
export async function generateCompanySuiteApi(payload: {
  title: string;
  sector: string;
  budgetEur: number;
  goal: string;
  skills?: string;
  weeklyHours?: number;
  experienceLevel?: ExperienceLevel;
  contextDetails?: string;
}): Promise<{
  suite: CompanyCreationResult;
  creationId: string | null;
  modelUsed: string;
  quota: QuotaSnapshot;
}> {
  return requestJson(
    '/api/business/company-suite',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 65_000 }
  );
}

export async function regenerateLogoApi(payload: {
  brandName: string;
  sector: string;
  primaryColor: string;
  secondaryColor: string;
  styleHint?: string;
  creationId?: string | null;
}): Promise<{ logoSvg: string; modelUsed: string }> {
  return requestJson(
    '/api/business/generate-logo',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 45_000 }
  );
}

export async function regenerateWebsiteApi(payload: {
  brandName: string;
  slogan: string;
  sector: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  packagesText: string;
  logoSvg: string;
  customInstructions?: string;
  creationId?: string | null;
}): Promise<{ websiteHtml: string; modelUsed: string }> {
  return requestJson(
    '/api/business/generate-website',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 65_000 }
  );
}

export async function fetchCompanyCreations(): Promise<{
  creations: SavedCompanyCreation[];
}> {
  return requestJson('/api/business/company-creations');
}

export async function deleteCompanyCreationApi(id: string): Promise<void> {
  await requestJson(`/api/business/company-creations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function publishWebsiteApi(payload: {
  title: string;
  htmlContent: string;
  existingSlug?: string | null;
  creationId?: string | null;
}): Promise<{
  site: PublishedSiteSummary;
  publicPath: string;
  publicUrl: string;
}> {
  return requestJson('/api/sites/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPublishedSites(): Promise<{
  sites: PublishedSiteSummary[];
}> {
  return requestJson('/api/sites');
}

export async function deletePublishedSiteApi(id: string): Promise<void> {
  await requestJson(`/api/sites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function generateContentMarketingApi(payload: {
  formatKey: string;
  topic: string;
  targetAudience?: string;
  tone?: string;
  callToAction?: string;
}): Promise<{ content: string; modelUsed: string }> {
  return requestJson(
    '/api/content/generate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 55_000 }
  );
}

export async function generateVideoStoryboardApi(payload: {
  topic: string;
  format: '9:16' | '16:9';
  tone?: string;
  durationTargetSec?: number;
  sourceScript?: string;
}): Promise<{ storyboard: VideoStoryboard; modelUsed: string }> {
  return requestJson(
    '/api/video/storyboard',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 55_000 }
  );
}

export async function fetchDocuments(): Promise<{
  documents: UserDocument[];
}> {
  return requestJson('/api/documents');
}

export async function generateDocumentApi(payload: {
  docType: string;
  title: string;
  companyName?: string;
  clientName?: string;
  context: string;
}): Promise<{
  contentMarkdown: string;
  modelUsed: string;
  document: UserDocument | null;
}> {
  return requestJson(
    '/api/documents/generate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 55_000 }
  );
}

export async function saveDocumentApi(payload: {
  docType: string;
  title: string;
  contentMarkdown: string;
}): Promise<{ document: UserDocument }> {
  return requestJson('/api/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteDocumentApi(id: string): Promise<void> {
  await requestJson(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

async function consumeSseStream(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  handlers: {
    onStatus?: (label: string, conversationId?: string | null) => void;
    onMeta?: (model: string, conversationId?: string | null) => void;
    onDelta: (delta: string) => void;
    onSources?: (sources: SourceLink[]) => void;
    onDone: (payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(
      'Vous semblez hors ligne. Vérifiez votre connexion Internet puis réessayez — votre message est conservé.',
      0,
      'NETWORK_ERROR'
    );
  }

  const internalController = new AbortController();
  let timedOut = false;
  let watchdog = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, 55_000);
  const resetWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      timedOut = true;
      internalController.abort();
    }, 55_000);
  };

  const onExternalAbort = () => internalController.abort();
  signal.addEventListener('abort', onExternalAbort, { once: true });

  // Bounded pre-stream retry (max 1 automatic retry ONLY if handshake fails before any SSE stream starts)
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const candidate = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: internalController.signal,
      });

      const isTransientGateway =
        candidate.status === 502 || candidate.status === 503 || candidate.status === 504;
      if (!candidate.ok && isTransientGateway && attempt < 2 && !signal.aborted) {
        handlers.onStatus?.('Serveur momentanément occupé, nouvelle tentative automatique...');
        await waitMs(900, signal);
        resetWatchdog();
        continue;
      }
      res = candidate;
      break;
    } catch (err) {
      if (signal.aborted) {
        clearTimeout(watchdog);
        signal.removeEventListener('abort', onExternalAbort);
        throw new DOMException('Aborted', 'AbortError');
      }
      if (timedOut) {
        clearTimeout(watchdog);
        signal.removeEventListener('abort', onExternalAbort);
        throw new ApiError(
          'Le serveur met trop de temps à répondre (délai dépassé). Clique sur Réessayer — ton texte est conservé.',
          504,
          'CLIENT_TIMEOUT'
        );
      }
      if (attempt < 2) {
        handlers.onStatus?.('Connexion instable, reconnexion automatique...');
        await waitMs(900, signal);
        resetWatchdog();
        continue;
      }
      clearTimeout(watchdog);
      signal.removeEventListener('abort', onExternalAbort);
      throw normalizeNetworkError(err);
    }
  }

  if (!res) {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', onExternalAbort);
    throw new ApiError(
      'Impossible de joindre le serveur NOVA AI. Réessaye dans quelques instants.',
      0,
      'NETWORK_ERROR'
    );
  }

  if (!res.ok) {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', onExternalAbort);
    const text = await res.text();
    let errObj: Record<string, unknown> = {};
    try {
      errObj = JSON.parse(text) as Record<string, unknown>;
    } catch {
      errObj = {};
    }
    const fallbackMessage =
      res.status === 404
        ? `Route API introuvable (${url} — HTTP 404). Vérifiez le déploiement des fonctions serverless /api.`
        : res.status === 502 || res.status === 503 || res.status === 504
          ? 'Le serveur NOVA AI est temporairement indisponible. Réessayez dans quelques secondes.'
          : `Erreur serveur (${res.status})`;
    const headerRetry = Number(res.headers.get('retry-after') ?? '');
    const retryAfterSec =
      typeof errObj.retryAfterSec === 'number'
        ? errObj.retryAfterSec
        : Number.isFinite(headerRetry) && headerRetry > 0
          ? Math.ceil(headerRetry)
          : null;
    throw new ApiError(
      String(errObj.error || fallbackMessage),
      res.status,
      String(errObj.code || (res.status === 404 ? 'API_NOT_FOUND' : 'STREAM_HTTP_ERROR')),
      retryAfterSec,
      {
        failedModel: typeof errObj.failedModel === 'string' ? errObj.failedModel : null,
        alternativeModels: parseAlternativeModels(errObj.alternativeModels),
        noAlternativeAvailable: Boolean(errObj.noAlternativeAvailable),
      }
    );
  }

  if (!res.body) {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', onExternalAbort);
    throw new ApiError('Flux de réponse indisponible.', 500, 'NO_STREAM_BODY');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const dispatchBlock = (rawEvent: string) => {
    if (signal.aborted) return;
    const trimmed = rawEvent.trim();
    if (!trimmed) return;
    for (const line of trimmed.split('\n')) {
      if (signal.aborted) return;
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = String(event.type || '');
      if (type === 'status') {
        handlers.onStatus?.(
          String(event.label || 'NOVA réfléchit...'),
          (event.conversationId as string | null | undefined) ?? null
        );
      } else if (type === 'meta') {
        handlers.onMeta?.(
          String(event.model || ''),
          (event.conversationId as string | null | undefined) ?? null
        );
      } else if (type === 'delta') {
        const txt = typeof event.text === 'string' ? event.text : '';
        if (txt) handlers.onDelta(txt);
      } else if (type === 'sources') {
        if (Array.isArray(event.sources)) {
          handlers.onSources?.(event.sources as SourceLink[]);
        }
      } else if (type === 'done') {
        handlers.onDone(event);
      } else if (type === 'error') {
        const errStatus =
          typeof event.status === 'number' && Number.isFinite(event.status)
            ? event.status
            : 500;
        const retryAfterSec =
          typeof event.retryAfterSec === 'number' && Number.isFinite(event.retryAfterSec)
            ? event.retryAfterSec
            : null;
        throw new ApiError(
          String(event.error || 'Erreur lors de la génération IA.'),
          errStatus,
          String(event.code || 'STREAM_ERROR'),
          retryAfterSec,
          {
            failedModel: typeof event.failedModel === 'string' ? event.failedModel : null,
            alternativeModels: parseAlternativeModels(event.alternativeModels),
            noAlternativeAvailable: Boolean(event.noAlternativeAvailable),
          }
        );
      }
    }
  };

  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const { value, done } = await reader.read();
      if (done) break;
      resetWatchdog();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sepIndex = buffer.indexOf('\n\n');
      while (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        sepIndex = buffer.indexOf('\n\n');
        dispatchBlock(rawEvent);
      }
    }

    const tail = (buffer + decoder.decode()).replace(/\r\n/g, '\n').trim();
    if (tail && !signal.aborted) {
      dispatchBlock(tail);
    }
  } catch (err) {
    if (timedOut) {
      throw new ApiError(
        "Le flux de réponse IA a été interrompu après un délai d'inactivité. Clique sur Réessayer.",
        504,
        'CLIENT_STREAM_TIMEOUT'
      );
    }
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    throw err instanceof ApiError ? err : normalizeNetworkError(err);
  } finally {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', onExternalAbort);
  }
}

export async function streamChatMessage(params: {
  message: string;
  conversationId?: string | null;
  useWebSearch?: boolean;
  experienceLevel?: ExperienceLevel;
  isRetry?: boolean;
  provider?: AIProviderId;
  model?: string;
  attachment?: { name: string; content: string } | null;
  guestHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal: AbortSignal;
  onStatus?: (label: string, conversationId?: string | null) => void;
  onMeta?: (model: string, conversationId?: string | null) => void;
  onDelta: (delta: string) => void;
  onSources?: (sources: SourceLink[]) => void;
  onDone: (payload: {
    conversationId?: string | null;
    modelUsed?: string;
    latencyMs?: number;
    quota?: QuotaSnapshot;
    summarizedActive?: boolean;
  }) => void;
}): Promise<void> {
  await consumeSseStream(
    '/api/chat',
    {
      message: params.message,
      conversationId: params.conversationId ?? null,
      useWebSearch: Boolean(params.useWebSearch),
      experienceLevel: params.experienceLevel,
      isRetry: Boolean(params.isRetry),
      provider: params.provider ?? 'gemini',
      model: params.model,
      attachment: params.attachment ?? null,
      guestHistory: params.guestHistory ?? [],
    },
    params.signal,
    {
      onStatus: params.onStatus,
      onMeta: params.onMeta,
      onDelta: params.onDelta,
      onSources: params.onSources,
      onDone: (payload) =>
        params.onDone(
          payload as {
            conversationId?: string | null;
            modelUsed?: string;
            latencyMs?: number;
            quota?: QuotaSnapshot;
            summarizedActive?: boolean;
          }
        ),
    }
  );
}

export async function streamBusinessGeneration(params: {
  moduleKey: string;
  title: string;
  sector: string;
  budgetEur: number;
  goal: string;
  skills?: string;
  weeklyHours?: number;
  experienceLevel?: ExperienceLevel;
  contextDetails?: string;
  useWebSearch?: boolean;
  signal: AbortSignal;
  onStatus?: (label: string) => void;
  onDelta: (delta: string) => void;
  onSources?: (sources: SourceLink[]) => void;
  onDone: (payload: {
    project?: BusinessProject | null;
    modelUsed?: string;
    latencyMs?: number;
    quota?: QuotaSnapshot;
  }) => void;
}): Promise<void> {
  await consumeSseStream(
    '/api/business/generate',
    {
      moduleKey: params.moduleKey,
      title: params.title,
      sector: params.sector,
      budgetEur: params.budgetEur,
      goal: params.goal,
      skills: params.skills ?? '',
      weeklyHours: params.weeklyHours,
      experienceLevel: params.experienceLevel ?? 'debutant',
      contextDetails: params.contextDetails ?? '',
      useWebSearch: Boolean(params.useWebSearch),
    },
    params.signal,
    {
      onStatus: (label) => params.onStatus?.(label),
      onDelta: params.onDelta,
      onSources: params.onSources,
      onDone: (payload) =>
        params.onDone(
          payload as {
            project?: BusinessProject | null;
            modelUsed?: string;
            latencyMs?: number;
            quota?: QuotaSnapshot;
          }
        ),
    }
  );
}
