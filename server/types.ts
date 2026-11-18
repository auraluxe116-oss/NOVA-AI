export type PlanTier = 'free' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'annual';
export type SubscriptionStatus = 'inactive' | 'active' | 'past_due' | 'canceled';

export interface SourceLink {
  title: string;
  url: string;
}

export interface PlanSpec {
  id: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceEur: number;
  annualMonthlyEquivalentEur: number;
  annualTotalEur: number;
  dailyChatLimit: number;
  dailyBusinessLimit: number;
  maxAttachmentBytes: number;
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
    tagline: 'Pour découvrir NOVA AI au quotidien',
    monthlyPriceEur: 0,
    annualMonthlyEquivalentEur: 0,
    annualTotalEur: 0,
    dailyChatLimit: 15,
    dailyBusinessLimit: 3,
    maxAttachmentBytes: 40 * 1024,
    priorityRouting: false,
    webSearchIncluded: true,
    fullBusinessSuite: false,
    companyCreationSuite: false,
    exportEnabled: false,
  },
  pro: {
    id: 'pro',
    name: 'PRO',
    tagline: 'Pour entrepreneurs, indépendants et créateurs',
    monthlyPriceEur: 9.99,
    annualMonthlyEquivalentEur: 7.99,
    annualTotalEur: 95.88,
    dailyChatLimit: 500,
    dailyBusinessLimit: 100,
    maxAttachmentBytes: 150 * 1024,
    priorityRouting: true,
    webSearchIncluded: true,
    fullBusinessSuite: true,
    companyCreationSuite: false,
    exportEnabled: true,
  },
  business: {
    id: 'business',
    name: 'BUSINESS',
    tagline: 'Pour fondateurs, dirigeants et équipes en croissance',
    monthlyPriceEur: 19.99,
    annualMonthlyEquivalentEur: 15.99,
    annualTotalEur: 191.88,
    dailyChatLimit: 2000,
    dailyBusinessLimit: 300,
    maxAttachmentBytes: 300 * 1024,
    priorityRouting: true,
    webSearchIncluded: true,
    fullBusinessSuite: true,
    companyCreationSuite: true,
    exportEnabled: true,
  },
};

export const GUEST_DAILY_CHAT_LIMIT = 5;
export const GUEST_DAILY_BUSINESS_LIMIT = 1;

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
