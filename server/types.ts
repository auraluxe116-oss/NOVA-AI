export type PlanTier = 'free';
export type ExperienceLevel = 'debutant' | 'intermediaire' | 'confirme';
export type AIProviderId = 'gemini';

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

export const FREE_TIER_LIMITS = {
  maxAttachmentBytes: 512 * 1024,
  maxPublishedSites: 10,
  chatBurstPerMinute: 30,
} as const;

export interface PlanSpec {
  id: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceEur: 0;
  maxAttachmentBytes: number;
  maxPublishedSites: number;
  dailyChatLimitGuest: number | null;
  dailyChatLimitUser: number | null;
  dailyBusinessLimitGuest: number | null;
  dailyBusinessLimitUser: number | null;
  webSearchIncluded: boolean;
  fullBusinessSuite: boolean;
  companyCreationSuite: boolean;
  exportEnabled: boolean;
}

export const PLAN_SPECS: Record<PlanTier, PlanSpec> = {
  free: {
    id: 'free',
    name: 'GRATUIT · 0 €',
    tagline:
      'Plateforme IA 100 % gratuite (budget strict 0 €) — sans carte bancaire, sans abonnement et sans limite artificielle de messages',
    monthlyPriceEur: 0,
    maxAttachmentBytes: FREE_TIER_LIMITS.maxAttachmentBytes,
    maxPublishedSites: FREE_TIER_LIMITS.maxPublishedSites,
    dailyChatLimitGuest: null,
    dailyChatLimitUser: null,
    dailyBusinessLimitGuest: null,
    dailyBusinessLimitUser: null,
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
  zeroCostMode: true;
  hasRecoveryCode: boolean;
  preferences: UserPreferences;
  createdAt: string;
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

export function resolveEffectivePlan(): PlanTier {
  return 'free';
}
