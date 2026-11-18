export type PageView =
  | 'accueil'
  | 'assistant'
  | 'business'
  | 'tarifs'
  | 'connexion'
  | 'inscription'
  | 'dashboard'
  | 'historique'
  | 'profil'
  | 'paiement-succes'
  | 'paiement-echec';

export type PlanTier = 'free' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled';
export type ExperienceLevel = 'debutant' | 'intermediaire' | 'confirme';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  companyName: string;
  plan: PlanTier;
  effectivePlan: PlanTier;
  billingInterval: BillingInterval;
  subscriptionStatus: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  plan: PlanTier;
  billing_interval: BillingInterval;
  amount_cents: number;
  currency: string;
  status: string;
  cancel_at_period_end: number;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotaSnapshot {
  plan: PlanTier;
  isAuthenticated: boolean;
  chatUsed: number;
  chatLimit: number;
  chatRemaining: number;
  businessUsed: number;
  businessLimit: number;
  businessRemaining: number;
  maxAttachmentBytes: number;
  exportEnabled: boolean;
  fullBusinessSuite: boolean;
  companyCreationSuite: boolean;
}

export interface SourceLink {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceLink[];
  attachmentName?: string | null;
  modelUsed?: string | null;
  latencyMs?: number | null;
  createdAt: string;
  isStreaming?: boolean;
  isError?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  category: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message_preview?: string;
}

export interface BusinessProject {
  id: string;
  module_key: string;
  title: string;
  sector: string;
  budget_eur: number;
  goal: string;
  content_markdown: string;
  model_used: string | null;
  created_at: string;
}

export interface StripeStatus {
  stripeConfigured: boolean;
  stripeMode: 'test' | 'live' | 'unconfigured';
  webhookConfigured: boolean;
  checkoutReady: boolean;
  usingConfiguredPriceIds: boolean;
  prices: {
    proMonthly: boolean;
    proAnnual: boolean;
    businessMonthly: boolean;
    businessAnnual: boolean;
  };
}

export interface StripeInvoiceSummary {
  id: string;
  number: string | null;
  status: string | null;
  amountPaidCents: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface DashboardData {
  user: PublicUser;
  quota: QuotaSnapshot;
  stats: {
    messagesToday: number;
    businessToday: number;
    totalMessages: number;
    totalConversations: number;
    totalBusinessProjects: number;
  };
  recentConversations: ConversationSummary[];
  recentProjects: BusinessProject[];
  subscriptions: SubscriptionRecord[];
}
