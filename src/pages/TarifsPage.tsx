import { AlertCircle, Check, CreditCard, ExternalLink, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  BillingInterval,
  PageView,
  PlanPricingSnapshot,
  PlanTier,
  PublicUser,
  StripeStatus,
} from '../types/nova';
import { ApiError, createStripeCheckout, createStripePortal, fetchStripeStatus } from '../utils/api';

interface TarifsPageProps {
  user: PublicUser | null;
  onNavigate: (view: PageView) => void;
}

const COMPARISON_ROWS: Array<{
  feature: string;
  free: string;
  pro: string;
  business: string;
}> = [
  {
    feature: 'Messages Assistant IA (NOVA)',
    free: 'Sans limite interne NOVA*',
    pro: 'Sans limite interne NOVA*',
    business: 'Sans limite interne NOVA*',
  },
  {
    feature: 'Mémoire longue par résumé',
    free: 'Inclus',
    pro: 'Inclus',
    business: 'Inclus',
  },
  {
    feature: '18 Modules Business & Contenu',
    free: 'Inclus (accès découverte)',
    pro: 'Inclus (routage prioritaire)',
    business: 'Inclus (priorité maximale)',
  },
  {
    feature: 'Création entreprise (Logo PNG + Site)',
    free: 'Inclus',
    pro: 'Inclus',
    business: 'Inclus',
  },
  {
    feature: 'Hébergement de sites publiés',
    free: 'Jusqu’à 3 sites',
    pro: 'Jusqu’à 25 sites',
    business: 'Illimités',
  },
  {
    feature: 'Studio Vidéo (.webm) & Export PDF',
    free: 'Inclus',
    pro: 'Inclus',
    business: 'Inclus',
  },
  {
    feature: 'Documents joints max',
    free: '120 Ko',
    pro: '512 Ko',
    business: '2 Mo',
  },
  {
    feature: 'Factures & gestion Stripe',
    free: '—',
    pro: 'Portail client Stripe',
    business: 'Portail client Stripe',
  },
];

function formatCents(cents: number, currency = 'eur'): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function getDisplayPrice(
  snapshot: PlanPricingSnapshot | undefined,
  interval: BillingInterval
): {
  configured: boolean;
  headline: string;
  cadenceLabel: string;
  annualNote: string | null;
} {
  if (!snapshot) {
    return {
      configured: false,
      headline: 'À configurer',
      cadenceLabel: 'Via Stripe',
      annualNote: null,
    };
  }
  const cents = interval === 'annual' ? snapshot.annualCents : snapshot.monthlyCents;
  const isConfigured = interval === 'annual' ? snapshot.annualConfigured : snapshot.monthlyConfigured;

  if (!isConfigured) {
    return {
      configured: false,
      headline: 'À configurer',
      cadenceLabel: 'Dans Stripe',
      annualNote: null,
    };
  }

  if (cents === null) {
    return {
      configured: true,
      headline: 'Tarif Stripe',
      cadenceLabel: interval === 'annual' ? '/ an' : '/ mois',
      annualNote: 'Prix défini sur votre tableau Stripe',
    };
  }

  if (interval === 'annual') {
    const monthlyEquiv = Math.round(cents / 12);
    return {
      configured: true,
      headline: formatCents(monthlyEquiv, snapshot.currency),
      cadenceLabel: '/ mois',
      annualNote: `${formatCents(cents, snapshot.currency)}/an`,
    };
  }

  return {
    configured: true,
    headline: formatCents(cents, snapshot.currency),
    cadenceLabel: '/ mois',
    annualNote: null,
  };
}

export function TarifsPage({ user, onNavigate }: TarifsPageProps) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanTier | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checkoutUrlFallback, setCheckoutUrlFallback] = useState<string | null>(null);

  const effectivePlan = user?.effectivePlan ?? 'free';
  const hasActivePaidSubscription =
    Boolean(user) &&
    effectivePlan !== 'free' &&
    user?.subscriptionStatus === 'active' &&
    Boolean(user?.stripeCustomerId);

  useEffect(() => {
    void fetchStripeStatus()
      .then(setStripeStatus)
      .catch(() => setStripeStatus(null));
  }, []);

  const redirectToStripe = (url: string) => {
    setCheckoutUrlFallback(url);
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch {
      // Cross-origin iframe fallback handled by direct target="_top" button below
    }
    window.location.assign(url);
  };

  const handleSubscribe = async (plan: Exclude<PlanTier, 'free'>) => {
    setFeedback(null);
    setCheckoutUrlFallback(null);
    if (!user) {
      onNavigate('inscription');
      return;
    }
    setLoadingPlan(plan);
    try {
      if (hasActivePaidSubscription) {
        const portal = await createStripePortal();
        redirectToStripe(portal.url);
        return;
      }
      const session = await createStripeCheckout(plan, interval);
      redirectToStripe(session.url);
    } catch (err) {
      const msg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de lancer le paiement Stripe.';
      setFeedback(msg);
    } finally {
      setLoadingPlan(null);
    }
  };

  const proPrice = getDisplayPrice(stripeStatus?.catalog?.pro, interval);
  const businessPrice = getDisplayPrice(stripeStatus?.catalog?.business, interval);
  const liveLocked =
    stripeStatus?.stripeMode === 'live' && !stripeStatus.liveAuthorized;

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#3B82F6]">
          Tarifs transparents &amp; Abonnements · NOVA AI PRO
        </p>
        <h1 className="font-display text-3xl font-bold text-[#FAFAFA] sm:text-4xl">
          Trois formules claires, sans plafond artificiel de messages.
        </h1>
        <p className="text-sm text-[#A8A8BE] sm:text-base">
          Démarrez gratuitement puis passez à Pro ou Business via Stripe pour héberger davantage de
          sites publiés, joindre des documents volumineux et profiter du routage prioritaire.
        </p>

        {/* Billing Cadence Switch */}
        <div className="inline-flex items-center rounded-xl border border-[#232332] bg-[#111117] p-1">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
              interval === 'monthly'
                ? 'bg-[#7C3AED] text-white'
                : 'text-[#A8A8BE] hover:text-white'
            }`}
          >
            Mensuel
          </button>
          <button
            type="button"
            onClick={() => setInterval('annual')}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
              interval === 'annual'
                ? 'bg-[#7C3AED] text-white'
                : 'text-[#A8A8BE] hover:text-white'
            }`}
          >
            Annuel
          </button>
        </div>
      </div>

      {stripeStatus?.stripeConfigured && stripeStatus.stripeMode === 'test' && (
        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-xl border border-[#3B2B68] bg-[#151125] p-4 text-xs leading-relaxed text-[#DDD6FE]">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
          <div>
            <p className="font-semibold text-white">Stripe actif en mode Test</p>
            <p className="mt-0.5 text-[#C2B8E6]">
              Les paiements sont connectés à Stripe Checkout en environnement de test. Aucun
              débit bancaire réel n&apos;est effectué tant que les clés de test sont actives.
            </p>
          </div>
        </div>
      )}

      {liveLocked && (
        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold text-white">
              Paiements réels verrouillés par sécurité (pré-lancement)
            </p>
            <p className="mt-0.5">
              Une clé Stripe live est détectée, mais l&apos;activation commerciale réelle nécessite{' '}
              <code className="font-mono">STRIPE_ALLOW_LIVE=true</code> après validation complète
              en mode Test.
            </p>
          </div>
        </div>
      )}

      {stripeStatus && !stripeStatus.checkoutReady && !liveLocked && (
        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-xl border border-[#32324A] bg-[#111117] p-4 text-xs leading-relaxed text-[#CFCFE2]">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
          <div>
            <p className="font-semibold text-white">
              Passerelle Stripe en attente de configuration serveur
            </p>
            <p className="mt-1 text-[#A4A4BA]">
              Aucun tarif inventé n&apos;est facturé. Configurez{' '}
              <code className="font-mono text-[#C4B5FD]">STRIPE_SECRET_KEY</code> (commencez en
              mode test <code className="font-mono text-[#C4B5FD]">sk_test_...</code>),{' '}
              <code className="font-mono text-[#C4B5FD]">STRIPE_WEBHOOK_SECRET</code> et vos{' '}
              <code className="font-mono text-[#C4B5FD]">STRIPE_PRICE_*</code> pour activer les
              formules Pro et Business.
            </p>
          </div>
        </div>
      )}

      {checkoutUrlFallback && (
        <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-[#7C3AED] bg-[#17132A] p-4 text-xs text-white">
          <span>Votre session sécurisée Stripe est prête.</span>
          <a
            href={checkoutUrlFallback}
            target="_top"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-4 py-2 font-semibold text-white hover:bg-[#6D28D9]"
          >
            Ouvrir Stripe
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {feedback && (
        <div className="mx-auto mt-6 flex max-w-3xl items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {/* GRATUIT */}
        <div className="flex flex-col justify-between rounded-xl border border-[#232332] bg-[#111117] p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
              Accès limité · Découverte
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">GRATUIT</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">0 €</span>
              <span className="text-xs text-[#8D8DA4]">/ mois</span>
            </div>
            <p className="mt-2 text-xs text-[#A5A5BB]">
              Pour découvrir l&apos;assistant et créer vos premiers projets avec des limites
              définies.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#D6D6E6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Messagerie continue sans plafond NOVA*</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Création d&apos;entreprise (Logo PNG + Site web)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Jusqu&apos;à 3 sites publiés hébergés</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Pièces jointes texte jusqu&apos;à 120 Ko &amp; export PDF</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(user ? 'assistant' : 'inscription')}
            className="mt-8 w-full rounded-lg border border-[#2C2C40] bg-[#171722] py-2.5 text-sm font-semibold text-white hover:border-[#7C3AED] transition-colors"
          >
            {user && effectivePlan === 'free' ? 'Formule active' : 'Commencer gratuitement'}
          </button>
        </div>

        {/* PRO */}
        <div className="flex flex-col justify-between rounded-xl border border-[#7C3AED] bg-[#141122] p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#C4B5FD]">
                Fonctionnalités avancées
              </p>
              {proPrice.annualNote && (
                <span className="font-mono text-xs tabular-nums text-emerald-400">
                  {proPrice.annualNote}
                </span>
              )}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">PRO</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">
                {proPrice.headline}
              </span>
              <span className="text-xs text-[#B5B5CC]">{proPrice.cadenceLabel}</span>
            </div>
            <p className="mt-2 text-xs text-[#B8B8D0]">
              Pour entrepreneurs, indépendants et créateurs actifs.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#ECECF6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Messagerie continue sans plafond NOVA* + priorité</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Jusqu&apos;à 25 sites publiés en ligne</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Documents joints jusqu&apos;à 512 Ko</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Suite 18 modules, Contenu, Vidéo .webm &amp; PDF</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Factures &amp; portail client Stripe</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            disabled={
              loadingPlan === 'pro' ||
              effectivePlan === 'pro' ||
              (!hasActivePaidSubscription &&
                (!stripeStatus?.checkoutReady || !proPrice.configured))
            }
            onClick={() => void handleSubscribe('pro')}
            className="mt-8 w-full rounded-lg bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
          >
            {effectivePlan === 'pro'
              ? 'Formule active'
              : loadingPlan === 'pro'
              ? 'Redirection Stripe...'
              : hasActivePaidSubscription
              ? 'Changer via Portail Stripe'
              : !stripeStatus?.checkoutReady || !proPrice.configured
              ? 'Configuration Stripe requise'
              : "S'abonner à PRO"}
          </button>
        </div>

        {/* BUSINESS */}
        <div className="flex flex-col justify-between rounded-xl border border-[#232332] bg-[#111117] p-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                Fonctionnalités professionnelles
              </p>
              {businessPrice.annualNote && (
                <span className="font-mono text-xs tabular-nums text-emerald-400">
                  {businessPrice.annualNote}
                </span>
              )}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">BUSINESS</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">
                {businessPrice.headline}
              </span>
              <span className="text-xs text-[#8D8DA4]">{businessPrice.cadenceLabel}</span>
            </div>
            <p className="mt-2 text-xs text-[#A5A5BB]">
              Pour studios, agences et entreprises multi-projets.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#D6D6E6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Messagerie continue sans plafond NOVA* + priorité max</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Sites web publiés illimités</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Documents joints volumineux jusqu&apos;à 2 Mo</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Créations d&apos;entreprise, Logos PNG &amp; Dossiers PDF</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
                <span>Multi-fournisseurs IA &amp; portail Stripe dédié</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            disabled={
              loadingPlan === 'business' ||
              effectivePlan === 'business' ||
              (!hasActivePaidSubscription &&
                (!stripeStatus?.checkoutReady || !businessPrice.configured))
            }
            onClick={() => void handleSubscribe('business')}
            className="mt-8 w-full rounded-lg bg-[#FAFAFA] py-2.5 text-sm font-semibold text-[#08080B] hover:bg-[#E4E4EE] disabled:opacity-50 transition-colors"
          >
            {effectivePlan === 'business'
              ? 'Formule active'
              : loadingPlan === 'business'
              ? 'Redirection Stripe...'
              : hasActivePaidSubscription
              ? 'Passer à BUSINESS (Portail Stripe)'
              : !stripeStatus?.checkoutReady || !businessPrice.configured
              ? 'Configuration Stripe requise'
              : "S'abonner à BUSINESS"}
          </button>
        </div>
      </div>

      {/* Limits & Comparison Matrix */}
      <section className="mt-14 rounded-xl border border-[#232332] bg-[#111117] overflow-hidden">
        <div className="border-b border-[#1F1F2D] px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-white">
            Comparatif détaillé des capacités et limites
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm tabular-nums">
            <thead>
              <tr className="border-b border-[#232332] bg-[#0E0E14] text-[#FAFAFA]">
                <th className="px-6 py-3 font-semibold">Capacité</th>
                <th className="px-6 py-3 font-semibold">Gratuit</th>
                <th className="px-6 py-3 font-semibold text-[#C4B5FD]">Pro</th>
                <th className="px-6 py-3 font-semibold">Business</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E1E2B]">
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature} className="hover:bg-[#151520]">
                  <td className="px-6 py-3 font-medium text-[#E8E8F2]">{row.feature}</td>
                  <td className="px-6 py-3 text-[#A5A5BB]">{row.free}</td>
                  <td className="px-6 py-3 text-[#DDD6FE]">{row.pro}</td>
                  <td className="px-6 py-3 text-[#FAFAFA]">{row.business}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-8 space-y-2 text-center text-xs text-[#8E8EA6]">
        <p>
          * NOVA AI PRO n&apos;impose aucun compteur quotidien ou mensuel artificiel dans
          l&apos;application. Seules les limites de débit techniques du fournisseur d&apos;IA
          externe (ex. quota Google HTTP 429) et les protections anti-abus restent actives.
        </p>
        <div className="flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#8B5CF6]" />
          <span>
            Aucun abonnement n&apos;est activé sans confirmation serveur et webhook Stripe.
            Résiliation possible à tout moment depuis votre Profil.
          </span>
        </div>
      </div>
    </main>
  );
}
