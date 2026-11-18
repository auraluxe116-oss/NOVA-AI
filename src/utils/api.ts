import type {
  BillingInterval,
  BusinessProject,
  ChatMessage,
  ConversationSummary,
  DashboardData,
  PlanTier,
  PublicUser,
  QuotaSnapshot,
  SourceLink,
  StripeStatus,
  SubscriptionRecord,
} from '../types/nova';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    throw new ApiError(
      String(parsed.error || `Erreur serveur (${res.status})`),
      res.status,
      String(parsed.code || 'HTTP_ERROR')
    );
  }
  return parsed as T;
}

export async function fetchAuthMe(): Promise<{
  user: PublicUser | null;
  quota: QuotaSnapshot;
}> {
  return requestJson('/api/auth/me');
}

export async function registerUser(payload: {
  email: string;
  password: string;
  displayName: string;
  companyName?: string;
}): Promise<{ user: PublicUser; quota: QuotaSnapshot }> {
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

export async function logoutUser(): Promise<void> {
  await requestJson('/api/auth/logout', { method: 'POST' });
}

export async function updateProfile(payload: {
  displayName?: string;
  companyName?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<{ user: PublicUser; quota: QuotaSnapshot }> {
  return requestJson('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchDashboard(): Promise<DashboardData> {
  return requestJson('/api/dashboard');
}

export async function fetchConversations(): Promise<{
  conversations: ConversationSummary[];
}> {
  return requestJson('/api/conversations');
}

export async function fetchConversationDetail(id: string): Promise<{
  conversation: ConversationSummary;
  messages: ChatMessage[];
}> {
  return requestJson(`/api/conversations/${encodeURIComponent(id)}`);
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

export async function fetchStripeStatus(): Promise<StripeStatus> {
  return requestJson('/api/stripe/status');
}

export async function createStripeCheckout(
  plan: Exclude<PlanTier, 'free'>,
  interval: BillingInterval
): Promise<{ url: string; sessionId: string; mode: 'test' | 'live' }> {
  return requestJson('/api/stripe/create-checkout-session', {
    method: 'POST',
    body: JSON.stringify({ plan, interval }),
  });
}

export async function verifyStripeCheckoutSession(sessionId: string): Promise<{
  verified: boolean;
  paymentStatus: string;
  plan: PlanTier;
  interval: BillingInterval;
  user: PublicUser;
  quota: QuotaSnapshot;
}> {
  return requestJson(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`);
}

export async function createStripePortal(): Promise<{ url: string }> {
  return requestJson('/api/stripe/create-portal-session', {
    method: 'POST',
  });
}

export async function cancelStripeSubscription(): Promise<{
  user: PublicUser;
  quota: QuotaSnapshot;
  subscriptions: SubscriptionRecord[];
}> {
  return requestJson('/api/stripe/cancel-subscription', { method: 'POST' });
}

export async function reactivateStripeSubscription(): Promise<{
  user: PublicUser;
  quota: QuotaSnapshot;
  subscriptions: SubscriptionRecord[];
}> {
  return requestJson('/api/stripe/reactivate-subscription', { method: 'POST' });
}

export async function fetchUserSubscriptions(): Promise<{
  subscriptions: SubscriptionRecord[];
}> {
  return requestJson('/api/stripe/subscriptions');
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
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
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
        : `Erreur serveur (${res.status})`;
    throw new ApiError(
      String(errObj.error || fallbackMessage),
      res.status,
      String(errObj.code || (res.status === 404 ? 'API_NOT_FOUND' : 'STREAM_HTTP_ERROR'))
    );
  }

  if (!res.body) {
    throw new ApiError('Flux de réponse indisponible.', 500, 'NO_STREAM_BODY');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const dispatchBlock = (rawEvent: string) => {
    const trimmed = rawEvent.trim();
    if (!trimmed) return;
    for (const line of trimmed.split('\n')) {
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
        throw new ApiError(
          String(event.error || 'Erreur lors de la génération IA.'),
          500,
          String(event.code || 'STREAM_ERROR')
        );
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
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
  if (tail) {
    dispatchBlock(tail);
  }
}

export async function streamChatMessage(params: {
  message: string;
  conversationId?: string | null;
  useWebSearch?: boolean;
  attachment?: { name: string; content: string } | null;
  guestHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal: AbortSignal;
  onStatus?: (label: string, conversationId?: string | null) => void;
  onDelta: (delta: string) => void;
  onSources?: (sources: SourceLink[]) => void;
  onDone: (payload: {
    conversationId?: string | null;
    modelUsed?: string;
    latencyMs?: number;
    quota?: QuotaSnapshot;
  }) => void;
}): Promise<void> {
  await consumeSseStream(
    '/api/chat',
    {
      message: params.message,
      conversationId: params.conversationId ?? null,
      useWebSearch: Boolean(params.useWebSearch),
      attachment: params.attachment ?? null,
      guestHistory: params.guestHistory ?? [],
    },
    params.signal,
    {
      onStatus: params.onStatus,
      onDelta: params.onDelta,
      onSources: params.onSources,
      onDone: (payload) =>
        params.onDone(
          payload as {
            conversationId?: string | null;
            modelUsed?: string;
            latencyMs?: number;
            quota?: QuotaSnapshot;
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
