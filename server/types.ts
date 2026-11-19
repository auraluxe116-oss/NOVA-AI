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

export interface SourceLink {
  title: string;
  url: string;
}

export interface UserPreferences {
  defaultExperience: ExperienceLevel;
  preferredProvider: AIProviderId;
  preferredModel: string;
  autoWebSearch: boolean;
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

export interface PlanSpec {
  id: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceEur: number;
  annualMonthlyEquivalentEur: number;
  annualTotalEur: number;
  unlimitedInAppMessages: boolean;
  maxAttachmentBytes: number;
  maxPublishedSites: number | null;
  priorityRouting: boolean;
  webSearchIncluded: boolean;
  fullBusinessSuite: boolean;
  companyCreationSuite: boolean;
  exportEnabled: boolean;
}

export const PLAN_SPECS: Record<PlanTier, PlanSpec> = {
  free: {
    id: 'free',
    name: 'GRATUIT',
    tagline: 'Pour découvrir NOVA AI PRO sans plafond interne de messages',
    monthlyPriceEur: 0,
    annualMonthlyEquivalentEur: 0,
    annualTotalEur: 0,
    unlimitedInAppMessages: true,
    maxAttachmentBytes: 120 * 1024,
    maxPublishedSites: 3,
    priorityRouting: false,
    webSearchIncluded: true,
    fullBusinessSuite: true,
    companyCreationSuite: true,
    exportEnabled: true,
  },
  pro: {
    id: 'pro',
    name: 'PRO',
    tagline: 'Pour entrepreneurs, indépendants et créateurs exigeants',
    monthlyPriceEur: 9.99,
    annualMonthlyEquivalentEur: 7.99,
    annualTotalEur: 95.88,
    unlimitedInAppMessages: true,
    maxAttachmentBytes: 512 * 1024,
    maxPublishedSites: 25,
    priorityRouting: true,
    webSearchIncluded: true,
    fullBusinessSuite: true,
    companyCreationSuite: true,
    exportEnabled: true,
  },
  business: {
    id: 'business',
    name: 'BUSINESS',
    tagline: 'Pour fondateurs, dirigeants et équipes en croissance',
    monthlyPriceEur: 19.99,
    annualMonthlyEquivalentEur: 15.99,
    annualTotalEur: 191.88,
    unlimitedInAppMessages: true,
    maxAttachmentBytes: 2048 * 1024,
    maxPublishedSites: null,
    priorityRouting: true,
    webSearchIncluded: true,
    fullBusinessSuite: true,
    companyCreationSuite: true,
    exportEnabled: true,
  },
};

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  company_name: string;
  plan: PlanTier;
  billing_interval: BillingInterval;
  subscription_status: SubscriptionStatus;
  cancel_at_period_end: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  recovery_code_hash?: string | null;
  preferences_json?: string | null;
  token_version?: number;
  created_at: string;
  updated_at: string;
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

export interface SubscriptionRow {
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

export function resolveEffectivePlan(input: {
  plan?: PlanTier | string;
  subscription_status?: SubscriptionStatus | string;
  subscriptionStatus?: SubscriptionStatus | string;
  current_period_end?: string | null;
  currentPeriodEnd?: string | null;
}): PlanTier {
  const plan = input.plan;
  if (plan !== 'pro' && plan !== 'business') {
    return 'free';
  }
  const status = input.subscriptionStatus ?? input.subscription_status ?? 'inactive';
  if (status !== 'active') {
    return 'free';
  }
  const periodEnd = input.currentPeriodEnd ?? input.current_period_end ?? null;
  if (periodEnd) {
    const endMs = Date.parse(periodEnd);
    if (Number.isFinite(endMs) && Date.now() > endMs + 5 * 60_000) {
      return 'free';
    }
  }
  return plan;
}
