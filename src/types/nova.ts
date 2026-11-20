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
  | 'confidentialite'
  | 'mentions-legales'
  | 'cgv';

export type PlanTier = 'free';
export type ExperienceLevel = 'debutant' | 'intermediaire' | 'confirme';
export type AIProviderId = 'gemini';

export interface AlternativeFreeModel {
  id: string;
  label: string;
  provider: AIProviderId;
}

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  configured: boolean;
  defaultModel: string;
  models: Array<{
    id: string;
    label: string;
    available?: boolean;
    unavailableReason?: string | null;
  }>;
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
  zeroCostMode: true;
  hasRecoveryCode: boolean;
  preferences: UserPreferences;
  createdAt: string;
}

export interface QuotaSnapshot {
  plan: PlanTier;
  zeroCostMode: true;
  providerQuotaManaged?: boolean;
  isAuthenticated: boolean;
  chatUsedToday: number;
  businessUsedToday: number;
  dailyChatLimit: number | null;
  dailyBusinessLimit: number | null;
  dailyChatRemaining: number | null;
  dailyBusinessRemaining: number | null;
  maxAttachmentBytes: number;
  maxPublishedSites: number;
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
  seq?: number;
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
  failedModel?: string | null;
  alternativeModels?: AlternativeFreeModel[];
  noAlternativeAvailable?: boolean;
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
}
