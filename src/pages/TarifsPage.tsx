import { AlertCircle, Check, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BillingInterval, PageView, PlanTier, PublicUser, StripeStatus } from '../types/nova';
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
    feature: 'Messages Assistant IA',
    free: '15 / jour (5 invité)',
    pro: '500 / jour',
    business: '2 000 / jour',
  },
  {
    feature: 'Analyses Mode Business',
    free: '3 / jour (1 invité)',
    pro: '100 / jour',
    business: '300 / jour',
  },
  {
    feature: 'Documents joints max',
    free: '40 Ko',
    pro: '150 Ko',
    business: '300 Ko',
  },
  {
    feature: 'Propositions, factures & devis',
    free: 'Inclus',
    pro: 'Inclus + Export .md',
    business: 'Inclus + Export .md',
  },
  {
    feature: 'Business Plans & E-commerce',
    free: 'Non inclus',
    pro: 'Inclus',
    business: 'Inclus',
  },
  {
    feature: "Création d'entreprise & Étude de marché",
    free: 'Non inclus',
    pro: 'Non inclus',
    business: 'Inclus (priorité max)',
  },
  {
    feature: 'Factures & gestion Stripe',
    free: '—',
    pro: 'Portail client Stripe',
    business: 'Portail client Stripe',
  },
];

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

  const proPrice = interval === 'annual' ? '7,99 €' : '9,99 €';
  const businessPrice = interval === 'annual' ? '15,99 €' : '19,99 €';

  return (
    <main className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A78BFA]">
          Tarifs transparents
        </p>
        <h1 className="font-display text-3xl font-bold text-[#FAFAFA] sm:text-4xl">
          Une formule adaptée à votre rythme d&apos;utilisation.
        </h1>
        <p className="text-sm text-[#A8A8BE] sm:text-base">
          Passez au niveau supérieur à tout moment. Paiements sécurisés par Stripe avec
          facturation mensuelle ou annuelle (-20 %).
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
            Annuel (-20 %)
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
              débit bancaire réel n&apos;est effectué tant que vous utilisez les clés de test.
            </p>
          </div>
        </div>
      )}

      {stripeStatus && !stripeStatus.checkoutReady && (
        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-xl border border-[#32324A] bg-[#111117] p-4 text-xs leading-relaxed text-[#CFCFE2]">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
          <div>
            <p className="font-semibold text-white">
              Paiements Stripe en attente de configuration serveur
            </p>
            <p className="mt-1 text-[#A4A4BA]">
              La passerelle Stripe Checkout et la vérification par webhook s&apos;activent dès
              que <code className="font-mono text-[#C4B5FD]">STRIPE_SECRET_KEY</code> et{' '}
              <code className="font-mono text-[#C4B5FD]">STRIPE_WEBHOOK_SECRET</code> sont
              renseignés dans les variables d&apos;environnement du serveur. Aucun paiement
              fictif n&apos;est jamais simulé.
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
              Découverte
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">GRATUIT</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">0 €</span>
              <span className="text-xs text-[#8D8DA4]">/ mois</span>
            </div>
            <p className="mt-2 text-xs text-[#A5A5BB]">
              Pour poser vos questions du quotidien et tester NOVA AI.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#D6D6E6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Questions générales &amp; IA en streaming</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>15 messages / jour (5 / jour sans compte)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>3 analyses Mode Business / jour (1 sans compte)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Propositions, factures rapides &amp; docs 40 Ko max</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(user ? 'assistant' : 'inscription')}
            className="mt-8 w-full rounded-lg border border-[#2C2C40] bg-[#171722] py-2.5 text-sm font-semibold text-white hover:border-[#7C3AED] transition-colors"
          >
            {user && effectivePlan === 'free' ? 'Formule active' : "S'abonner gratuitement"}
          </button>
        </div>

        {/* PRO */}
        <div className="flex flex-col justify-between rounded-xl border border-[#7C3AED] bg-[#141122] p-6">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#C4B5FD]">
                Recommandé
              </p>
              {interval === 'annual' && (
                <span className="font-mono text-xs tabular-nums text-emerald-400">
                  95,88 €/an
                </span>
              )}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">PRO</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">
                {proPrice}
              </span>
              <span className="text-xs text-[#B5B5CC]">/ mois</span>
            </div>
            <p className="mt-2 text-xs text-[#B8B8D0]">
              Pour entrepreneurs, créateurs et professionnels actifs.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#ECECF6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>500 messages / jour et 100 analyses Business / jour</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Mode Business avancé &amp; Business Plans complets</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Stratégies marketing, e-commerce &amp; concurrence</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Réponses prioritaires &amp; historique complet</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#A78BFA]" />
                <span>Export Markdown &amp; documents jusqu&apos;à 150 Ko</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            disabled={loadingPlan === 'pro' || effectivePlan === 'pro'}
            onClick={() => void handleSubscribe('pro')}
            className="mt-8 w-full rounded-lg bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-55 transition-colors"
          >
            {effectivePlan === 'pro'
              ? 'Formule active'
              : loadingPlan === 'pro'
              ? 'Redirection Stripe...'
              : hasActivePaidSubscription
              ? 'Changer via Portail Stripe'
              : "S'abonner"}
          </button>
        </div>

        {/* BUSINESS */}
        <div className="flex flex-col justify-between rounded-xl border border-[#232332] bg-[#111117] p-6">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#9E9EB5]">
                Direction &amp; Croissance
              </p>
              {interval === 'annual' && (
                <span className="font-mono text-xs tabular-nums text-emerald-400">
                  191,88 €/an
                </span>
              )}
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">BUSINESS</h2>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-white">
                {businessPrice}
              </span>
              <span className="text-xs text-[#8D8DA4]">/ mois</span>
            </div>
            <p className="mt-2 text-xs text-[#A5A5BB]">
              Pour fondateurs et entreprises exigeant une analyse stratégique complète.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-[#D6D6E6]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>2 000 messages / jour et 300 analyses Business / jour</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Assistant complet création d&apos;entreprise</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Analyses commerciales &amp; études de marché avancées</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Plans de développement &amp; stratégies commerciales</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <span>Documents jusqu&apos;à 300 Ko &amp; priorité maximale</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            disabled={loadingPlan === 'business' || effectivePlan === 'business'}
            onClick={() => void handleSubscribe('business')}
            className="mt-8 w-full rounded-lg bg-[#FAFAFA] py-2.5 text-sm font-semibold text-[#08080B] hover:bg-[#E4E4EE] disabled:opacity-55 transition-colors"
          >
            {effectivePlan === 'business'
              ? 'Formule active'
              : loadingPlan === 'business'
              ? 'Redirection Stripe...'
              : hasActivePaidSubscription
              ? 'Passer à BUSINESS (Portail Stripe)'
              : "S'abonner"}
          </button>
        </div>
      </div>

      {/* Limits & Comparison Matrix */}
      <section className="mt-14 rounded-xl border border-[#232332] bg-[#111117] overflow-hidden">
        <div className="border-b border-[#1F1F2D] px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-white">
            Comparatif détaillé des limites et droits
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm tabular-nums">
            <thead>
              <tr className="border-b border-[#232332] bg-[#0E0E14] text-[#FAFAFA]">
                <th className="px-6 py-3 font-semibold">Capacité / Limite</th>
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

      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-[#8E8EA6]">
        <ShieldCheck className="h-4 w-4 text-[#8B5CF6]" />
        <span>
          Résiliation possible à tout moment depuis votre Profil ou le portail client Stripe.
          Aucun engagement caché.
        </span>
      </div>
    </main>
  );
}
