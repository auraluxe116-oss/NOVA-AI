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
  | 'paiement-echec'
  | 'confidentialite'
  | 'mentions-legales';

export type PlanTier = 'free' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled';
export type ExperienceLevel = 'debutant' | 'intermediaire' | 'confirme';
export type AIProviderId = 'gemini' | 'openai' | 'anthropic' | 'mistral';

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  configured: boolean;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
  note: string;
}

export interface UserPreferences {
  defaultExperience: ExperienceLevel;
  preferredProvider: AIProviderId;
  preferredModel: string;
  autoWebSearch: boolean;
}

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
  hasRecoveryCode: boolean;
  preferences: UserPreferences;
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
  unlimitedInAppMessages: boolean;
  chatUsedToday: number;
  businessUsedToday: number;
  maxAttachmentBytes: number;
  maxPublishedSites: number | null;
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
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAfterSec?: number | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  category: string;
  context_summary?: string;
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

export interface CompanyCreationResult {
  brandIdentity: {
    brandName: string;
    slogan: string;
    positioning: string;
    toneOfVoice: string;
    targetAudience: string;
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      text: string;
    };
    typography: {
      displayFont: string;
      bodyFont: string;
      rationale: string;
    };
    visualGuidelines: string[];
  };
  logoSvg: string;
  commercialOffer: {
    headline: string;
    valueProposition: string;
    packages: Array<{
      name: string;
      priceLabel: string;
      targetClient: string;
      deliverables: string[];
      timeline: string;
    }>;
    salesPitch: string;
  };
  businessPlan: {
    executiveSummary: string;
    financialPlan: {
      startupCostsEur: Array<{ item: string; amountEur: number }>;
      monthlyFixedCostsEur: number;
      unitPriceEur: number;
      unitVariableCostEur: number;
      breakEvenClientsPerMonth: number;
      prudentScenarioNote: string;
    };
    marketingStrategy: string[];
    firstClientsPlan: {
      days7: string[];
      days30: string[];
      days90: string[];
    };
    keyRisks: string[];
  };
  websiteHtml: string;
}

export interface SavedCompanyCreation {
  id: string;
  user_id: string;
  title: string;
  sector: string;
  budget_eur: number;
  data_json: string;
  logo_svg: string;
  website_html: string;
  published_slug: string | null;
  model_used: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishedSiteSummary {
  id: string;
  slug: string;
  user_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface UserDocument {
  id: string;
  user_id: string;
  doc_type: string;
  title: string;
  content_markdown: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface VideoScene {
  id: string;
  title: string;
  shotType: string;
  visualDirection: string;
  onScreenText: string;
  voiceover: string;
  subtitle: string;
  durationSec: number;
  accentColor: string;
}

export interface VideoStoryboard {
  title: string;
  format: '9:16' | '16:9';
  hook: string;
  callToAction: string;
  scenes: VideoScene[];
}

export interface PlanPricingSnapshot {
  monthlyCents: number | null;
  annualCents: number | null;
  currency: string;
  monthlyConfigured: boolean;
  annualConfigured: boolean;
  source: 'stripe_price' | 'env_cents' | 'unconfigured';
}

export interface StripeStatus {
  stripeConfigured: boolean;
  stripeMode: 'test' | 'live' | 'unconfigured';
  liveAuthorized: boolean;
  webhookConfigured: boolean;
  checkoutReady: boolean;
  usingConfiguredPriceIds: boolean;
  prices: {
    proMonthly: boolean;
    proAnnual: boolean;
    businessMonthly: boolean;
    businessAnnual: boolean;
  };
  catalog: {
    pro: PlanPricingSnapshot;
    business: PlanPricingSnapshot;
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
    totalCompanyCreations: number;
    totalDocuments: number;
    totalPublishedSites: number;
  };
  recentConversations: ConversationSummary[];
  recentProjects: BusinessProject[];
  recentCompanyCreations: SavedCompanyCreation[];
  publishedSites: PublishedSiteSummary[];
  recentDocuments: UserDocument[];
  subscriptions: SubscriptionRecord[];
}
